import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type { LocalUser } from './auth-contract';

export interface SyncProtection { encrypt(value: string): Uint8Array; decrypt(value: Uint8Array): string }
export interface SyncChange { entity: string; key: string; revision: number; baseVersion: number; payload: Record<string, unknown> }
export interface Acknowledgement { entity: string; key: string; revision: number; version: number }
export interface DeviceCredentials { deviceId: string; deviceToken?: string; token?: string; expiresAt?: number }
const financial = {sale:['sales','sale_outbox'],expense:['expenses','expense_outbox'],repayment:['repayments','repayment_outbox']} as const;

export class SyncStore {
  readonly db: DatabaseSync;
  constructor(filename: string, private protection: SyncProtection, readonly backend: string) {
    this.db=new DatabaseSync(filename);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS sync_control(id INTEGER PRIMARY KEY CHECK(id=1),applying INTEGER NOT NULL DEFAULT 0) STRICT;
      INSERT OR IGNORE INTO sync_control VALUES(1,0);
      CREATE TABLE IF NOT EXISTS sync_queue(revision INTEGER PRIMARY KEY AUTOINCREMENT,entity TEXT NOT NULL,key TEXT NOT NULL,payload TEXT NOT NULL) STRICT;
      CREATE INDEX IF NOT EXISTS sync_queue_key ON sync_queue(entity,key,revision);
      CREATE TABLE IF NOT EXISTS sync_versions(entity TEXT NOT NULL,key TEXT NOT NULL,version INTEGER NOT NULL,PRIMARY KEY(entity,key)) STRICT;
      CREATE TABLE IF NOT EXISTS sync_meta(key TEXT PRIMARY KEY,value ANY NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS online_logins(username TEXT NOT NULL COLLATE NOCASE,backend TEXT NOT NULL,expires INTEGER NOT NULL,PRIMARY KEY(username,backend)) STRICT;`);
    for(const [,outbox] of Object.values(financial))this.db.exec(`CREATE INDEX IF NOT EXISTS ${outbox}_state ON ${outbox}(state)`);
    const previous=this.db.prepare("SELECT value FROM sync_meta WHERE key='backend'").get();
    if(previous && previous.value!==backend && this.db.prepare("SELECT key FROM sync_meta WHERE key='credentials'").get() && this.credentials().deviceToken)throw new Error('This terminal is paired to a different backend. Restore its original POS_API_URL.');
    this.db.prepare("INSERT INTO sync_meta VALUES('backend',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(backend);
    this.track('development_records','record',"NEW.id");
    this.track('recurring_payments','recurring',"NEW.id||':'||NEW.month");
    this.track('local_users','user','NEW.id','NEW.is_demo=0 AND NEW.is_superuser=0');
    // Older local management marked real staff as demo; retain them for online provisioning after pairing.
    this.db.exec("UPDATE local_users SET is_demo=0,username=username WHERE is_demo=1 AND is_superuser=0 AND id NOT IN ('development-demo','development-admin','sample-cashier-1','sample-cashier-2')");
    if(!this.db.prepare("SELECT key FROM sync_meta WHERE key='initialized'").get()) {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        for(const row of this.db.prepare('SELECT * FROM development_records').all())this.enqueue('record',String(row.id),row);
        for(const row of this.db.prepare('SELECT * FROM recurring_payments').all())this.enqueue('recurring',`${row.id}:${row.month}`,JSON.parse(String(row.payload)));
        this.db.prepare("INSERT INTO sync_meta VALUES('initialized',1)").run();
        this.db.exec('COMMIT');
      } catch(error) { this.db.exec('ROLLBACK'); throw error; }
    }
    if(!this.db.prepare("SELECT key FROM sync_meta WHERE key='credentials'").get())this.setCredentials({deviceId:randomUUID()});
  }
  private track(table: string, entity: string, key: string, condition='1') {
    const columns=this.db.prepare(`PRAGMA table_info(${table})`).all().map(row=>String(row.name));
    const payload=table==='recurring_payments'?'NEW.payload':`json_object(${columns.flatMap(column=>[`'${column}'`,column==='verifier'?`hex(NEW.${column})`:`NEW.${column}`]).join(',')})`;
    for(const action of ['INSERT','UPDATE'])this.db.exec(`DROP TRIGGER IF EXISTS sync_${table}_${action}; CREATE TRIGGER sync_${table}_${action} AFTER ${action}${table==='local_users'&&action==='UPDATE'?' OF username,display_name,verifier,role':''} ON ${table}
      WHEN (SELECT applying FROM sync_control WHERE id=1)=0 AND (${condition}) BEGIN
        INSERT INTO sync_queue(entity,key,payload) VALUES('${entity}',${key},${payload}); END;`);
  }
  private enqueue(entity: string,key: string,payload: unknown) {
    this.db.prepare('INSERT INTO sync_queue(entity,key,payload) VALUES(?,?,?)').run(entity,key,JSON.stringify(payload));
  }
  credentials(): DeviceCredentials {
    const row=this.db.prepare("SELECT value FROM sync_meta WHERE key='credentials'").get()!;
    return JSON.parse(this.protection.decrypt(row.value as Uint8Array));
  }
  setCredentials(credentials: DeviceCredentials) {
    this.db.prepare("INSERT INTO sync_meta VALUES('credentials',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(this.protection.encrypt(JSON.stringify(credentials)));
  }
  rememberLogin(username: string,expires: number) {
    this.db.prepare('INSERT INTO online_logins VALUES(?,?,?) ON CONFLICT(username,backend) DO UPDATE SET expires=excluded.expires').run(username,this.backend,expires);
  }
  canLoginOffline(username: string) {
    return !!this.db.prepare('SELECT username FROM online_logins WHERE username=? COLLATE NOCASE AND backend=? AND expires>?').get(username,this.backend,Date.now());
  }
  pending() {
    let count=Number(this.db.prepare('SELECT COUNT(*) n FROM (SELECT entity,key FROM sync_queue GROUP BY entity,key)').get()!.n);
    for(const [table,outbox] of Object.values(financial))count+=Number(this.db.prepare(`SELECT COUNT(*) n FROM ${outbox} o JOIN ${table} s ON s.id=o.operation_id WHERE o.state='pending' AND s.recovery_ready=1`).get()!.n);
    return count;
  }
  batch(): SyncChange[] {
    const inflight=this.db.prepare("SELECT value FROM sync_meta WHERE key='inflight'").get();
    if(inflight)return JSON.parse(this.protection.decrypt(inflight.value as Uint8Array));
    const batch=this.prepareBatch();
    // Persist the exact request until acknowledged, even when newer local edits arrive.
    if(batch.length)this.db.prepare("INSERT INTO sync_meta VALUES('inflight',?)").run(this.protection.encrypt(JSON.stringify(batch)));
    return batch;
  }
  private prepareBatch(): SyncChange[] {
    const rows=this.db.prepare(`SELECT q.*,COALESCE(v.version,0) AS base_version FROM sync_queue q
      LEFT JOIN sync_versions v ON v.entity=q.entity AND v.key=q.key
      WHERE q.revision=(SELECT MAX(x.revision) FROM sync_queue x WHERE x.entity=q.entity AND x.key=q.key)
      ORDER BY CASE q.entity WHEN 'record' THEN 0 WHEN 'user' THEN 1 ELSE 2 END,q.revision LIMIT 20`).all();
    const batch: SyncChange[]=rows.map(row=>{
      const payload=JSON.parse(String(row.payload));
      if(row.entity==='user')payload.verifier=JSON.parse(this.protection.decrypt(Buffer.from(payload.verifier,'hex')));
      return {entity:String(row.entity),key:String(row.key),revision:Number(row.revision),baseVersion:Number(row.base_version),payload};
    });
    if(batch.length){
      let bytes=0;
      return batch.filter(change=>{bytes+=Buffer.byteLength(JSON.stringify(change));return bytes<10000000;});
    }
    for(const [entity,[table,outbox]] of Object.entries(financial)) {
      for(const row of this.db.prepare(`SELECT o.operation_id,o.payload${entity==='sale'?',s.invoice_number':''} FROM ${outbox} o JOIN ${table} s ON s.id=o.operation_id WHERE o.state='pending' AND s.recovery_ready=1 ORDER BY s.rowid LIMIT 20`).all()) {
        const payload=JSON.parse(String(row.payload));
        if(entity==='sale')payload.invoiceNumber=Number(row.invoice_number);
        batch.push({entity,key:String(row.operation_id),revision:1,baseVersion:0,payload});
      }
      if(batch.length)return batch;
    }
    return batch;
  }
  acknowledge(sent: SyncChange[], input: unknown) {
    if(!Array.isArray(input)||input.length!==sent.length)throw new Error('Server did not acknowledge every change.');
    const acknowledgements=input as Acknowledgement[];
    if(acknowledgements.some((ack,i)=>!ack||ack.entity!==sent[i].entity||ack.key!==sent[i].key||ack.revision!==sent[i].revision||!Number.isSafeInteger(ack.version)||ack.version<0))throw new Error('Invalid server acknowledgement; changes retained.');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for(const ack of acknowledgements) {
        if(ack.entity in financial) {
          const [,table]=financial[ack.entity as keyof typeof financial];
          this.db.prepare(`UPDATE ${table} SET state='synced' WHERE operation_id=?`).run(ack.key);
        } else {
          this.db.prepare('DELETE FROM sync_queue WHERE entity=? AND key=? AND revision<=?').run(ack.entity,ack.key,ack.revision);
          this.db.prepare('INSERT INTO sync_versions VALUES(?,?,?) ON CONFLICT(entity,key) DO UPDATE SET version=excluded.version').run(ack.entity,ack.key,ack.version);
        }
      }
      this.db.prepare("DELETE FROM sync_meta WHERE key='inflight'").run();
      this.db.exec('COMMIT');
    } catch(error) { this.db.exec('ROLLBACK'); throw error; }
  }
  cursor() { return Number(this.db.prepare("SELECT value FROM sync_meta WHERE key='cursor'").get()?.value??0); }
  apply(input: unknown) {
    if(!input || typeof input!=='object')throw new Error('Invalid catalog response.');
    const {changes,cursor}=input as {changes:{entity:string;key:string;version:number;payload:Record<string,unknown>}[];cursor:number};
    if(!Array.isArray(changes)||changes.length>50||!Number.isSafeInteger(cursor)||cursor<this.cursor())throw new Error('Invalid catalog cursor.');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.exec('UPDATE sync_control SET applying=1 WHERE id=1');
      for(const change of changes) {
        if(!change||!['record','recurring','user'].includes(change.entity)||typeof change.key!=='string'||!change.payload||!Number.isSafeInteger(change.version)||change.version>cursor)throw new Error('Invalid catalog change.');
        if(this.db.prepare('SELECT key FROM sync_queue WHERE entity=? AND key=?').get(change.entity,change.key))continue;
        if(change.entity==='user'&&this.db.prepare("SELECT key FROM sync_queue WHERE entity='record' AND key=?").get(change.key))continue;
        const known=this.db.prepare('SELECT version FROM sync_versions WHERE entity=? AND key=?').get(change.entity,change.key);
        if(known&&Number(known.version)>=change.version)continue;
        const payload=change.entity==='record'?{half_price:0,...change.payload}:change.payload;
        if(change.entity==='record') {
          const columns=this.db.prepare('PRAGMA table_info(development_records)').all().map(row=>String(row.name));
          if(payload.id!==change.key||columns.some(column=>!(column in payload)))throw new Error('Incomplete catalog record.');
          this.db.prepare(`INSERT INTO development_records(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')}) ON CONFLICT(id) DO UPDATE SET ${columns.filter(c=>c!=='id').map(c=>`${c}=excluded.${c}`).join(',')}`).run(...columns.map(column=>payload[column] as string|number));
        } else if(change.entity==='recurring') {
          if(`${payload.id}:${payload.month}`!==change.key)throw new Error('Invalid monthly catalog record.');
          this.db.prepare('INSERT INTO recurring_payments VALUES(?,?,?,?) ON CONFLICT(id,month) DO UPDATE SET shop_id=excluded.shop_id,payload=excluded.payload').run(String(payload.id),String(payload.month),String(payload.shopId),JSON.stringify(payload));
        } else {
          if(payload.archived) {
            this.db.prepare('UPDATE development_records SET archived=1 WHERE id=?').run(change.key);
            this.db.prepare('DELETE FROM online_logins WHERE username IN (SELECT username FROM local_users WHERE id=?)').run(change.key);
          } else {
            if(typeof payload.username!=='string'||typeof payload.displayName!=='string'||!['cashier','admin','superuser'].includes(String(payload.role))||typeof payload.shopId!=='string')throw new Error('Invalid account metadata.');
            this.withRemoteUser(payload as unknown as LocalUser);
            this.db.prepare('UPDATE local_users SET username=?,display_name=?,role=?,is_superuser=? WHERE id=?').run(String(payload.username),String(payload.displayName),payload.role==='cashier'?'cashier':'admin',payload.role==='superuser'?1:0,change.key);
          }
        }
        this.db.prepare('INSERT INTO sync_versions VALUES(?,?,?) ON CONFLICT(entity,key) DO UPDATE SET version=excluded.version').run(change.entity,change.key,change.version);
      }
      this.db.prepare("INSERT INTO sync_meta VALUES('cursor',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(cursor);
      this.db.exec('UPDATE sync_control SET applying=0 WHERE id=1; COMMIT');
    } catch(error) { this.db.exec('ROLLBACK'); throw error; }
  }
  withRemoteUser(user: LocalUser) {
    if(this.db.prepare("SELECT key FROM sync_queue WHERE entity='record' AND key=?").get(user.id))return;
    // This profile is required by the existing offline shop/permission checks.
    this.db.prepare(`INSERT INTO development_records(id,kind,name,phone,passport,identity,pricePaisa,quantity,username,shop_id,manage_finance)
      VALUES(?,?,?,'','','',0,0,?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,name=excluded.name,username=excluded.username,shop_id=excluded.shop_id,manage_finance=excluded.manage_finance,archived=0`).run(user.id,user.role==='cashier'?'cashier':'admin',user.displayName,user.username,user.shopId||'main-shop',user.manageCreditsExpenses?1:0);
  }
  close() { this.db.close(); }
}
