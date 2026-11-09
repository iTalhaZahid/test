import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type { LocalUser } from './auth-contract';

export interface SyncProtection { encrypt(value: string): Uint8Array; decrypt(value: Uint8Array): string }
export interface SyncChange { entity: string; key: string; revision: number; baseVersion: number; payload: Record<string, unknown>; actorId?: string; request?: unknown; catalogVersion?: number }
export interface Acknowledgement { entity: string; key: string; revision: number; version: number }
export interface DeviceCredentials { deviceId: string; deviceToken?: string; token?: string; expiresAt?: number; users?: Record<string,{token:string;expiresAt:number}> }
const financial = {sale:['sales','sale_outbox'],expense:['expenses','expense_outbox'],repayment:['repayments','repayment_outbox']} as const;

export class SyncStore {
  readonly db: DatabaseSync;
  constructor(filename: string, private protection: SyncProtection, readonly backend: string, readonly website = false) {
    this.db=new DatabaseSync(filename);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS sync_control(id INTEGER PRIMARY KEY CHECK(id=1),applying INTEGER NOT NULL DEFAULT 0) STRICT;
      INSERT OR IGNORE INTO sync_control(id,applying) VALUES(1,0);
      CREATE TABLE IF NOT EXISTS sync_queue(revision INTEGER PRIMARY KEY AUTOINCREMENT,entity TEXT NOT NULL,key TEXT NOT NULL,payload TEXT NOT NULL) STRICT;
      CREATE INDEX IF NOT EXISTS sync_queue_key ON sync_queue(entity,key,revision);
      CREATE TABLE IF NOT EXISTS sync_versions(entity TEXT NOT NULL,key TEXT NOT NULL,version INTEGER NOT NULL,PRIMARY KEY(entity,key)) STRICT;
      CREATE TABLE IF NOT EXISTS sync_meta(key TEXT PRIMARY KEY,value ANY NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS online_logins(username TEXT NOT NULL COLLATE NOCASE,backend TEXT NOT NULL,expires INTEGER NOT NULL,PRIMARY KEY(username,backend)) STRICT;`);
    if(!this.db.prepare('PRAGMA table_info(sync_control)').all().some(row=>row.name==='actor_id'))this.db.exec("ALTER TABLE sync_control ADD COLUMN actor_id TEXT NOT NULL DEFAULT ''");
    if(!this.db.prepare('PRAGMA table_info(sync_queue)').all().some(row=>row.name==='actor_id'))this.db.exec("ALTER TABLE sync_queue ADD COLUMN actor_id TEXT NOT NULL DEFAULT ''");
    if(website) {
      this.db.exec(`CREATE TABLE IF NOT EXISTS offline_invoice_ranges(first_number INTEGER PRIMARY KEY,last_number INTEGER NOT NULL,next_number INTEGER NOT NULL) STRICT;
        CREATE TABLE IF NOT EXISTS web_financial_context(entity TEXT NOT NULL,key TEXT NOT NULL,catalog_version INTEGER NOT NULL,PRIMARY KEY(entity,key)) STRICT;`);
      for(const [entity,[table]] of Object.entries(financial))this.db.exec(`CREATE TRIGGER IF NOT EXISTS web_context_${table} AFTER INSERT ON ${table} WHEN (SELECT applying FROM sync_control WHERE id=1)=0 BEGIN
        INSERT INTO web_financial_context VALUES('${entity}',NEW.id,COALESCE((SELECT value FROM sync_meta WHERE key='cursor'),0)); END;`);
    }
    for(const [,outbox] of Object.values(financial))this.db.exec(`CREATE INDEX IF NOT EXISTS ${outbox}_state ON ${outbox}(state)`);
    const previous=this.db.prepare("SELECT value FROM sync_meta WHERE key='backend'").get();
    if(previous && previous.value!==backend && this.db.prepare("SELECT key FROM sync_meta WHERE key='credentials'").get() && this.credentials().deviceToken)throw new Error('This terminal is paired to a different backend. Restore its original POS_API_URL.');
    this.db.prepare("INSERT INTO sync_meta VALUES('backend',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(backend);
    this.track('development_records','record',"NEW.id");
    this.track('recurring_payments','recurring',"NEW.id||':'||NEW.month");
    this.track('local_users','user','NEW.id','NEW.is_demo=0 AND NEW.is_superuser=0');
    // Older local management marked real staff as demo; retain them for online provisioning after pairing.
    if(!website)this.db.exec("UPDATE local_users SET is_demo=0,username=username WHERE is_demo=1 AND is_superuser=0 AND id NOT IN ('development-demo','development-admin','sample-cashier-1','sample-cashier-2')");
    if(!this.db.prepare("SELECT key FROM sync_meta WHERE key='initialized'").get()) {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        if(!website) {
          for(const row of this.db.prepare('SELECT * FROM development_records').all())this.enqueue('record',String(row.id),row);
          for(const row of this.db.prepare('SELECT * FROM recurring_payments').all())this.enqueue('recurring',`${row.id}:${row.month}`,JSON.parse(String(row.payload)));
        }
        this.db.prepare("INSERT INTO sync_meta VALUES('initialized',1)").run();
        this.db.exec('COMMIT');
      } catch(error) { this.db.exec('ROLLBACK'); throw error; }
    }
    if(!this.db.prepare("SELECT key FROM sync_meta WHERE key='credentials'").get())this.setCredentials({deviceId:randomUUID()});
  }
  private track(table: string, entity: string, key: string, condition='1') {
    const columns=this.db.prepare(`PRAGMA table_info(${table})`).all().map(row=>String(row.name));
    const payload=table==='recurring_payments'?'NEW.payload':`json_object(${columns.flatMap(column=>[`'${column}'`,column==='verifier'?`hex(NEW.${column})`:`NEW.${column}`]).join(',')})`;
    for(const action of ['INSERT','UPDATE'])this.db.exec(`DROP TRIGGER IF EXISTS sync_${table}_${action}; CREATE TRIGGER sync_${table}_${action} AFTER ${action}${table==='local_users'&&action==='UPDATE'?(this.website?' OF verifier':' OF username,display_name,verifier,role'):''} ON ${table}
      WHEN (SELECT applying FROM sync_control WHERE id=1)=0 AND (${condition}) BEGIN
        INSERT INTO sync_queue(entity,key,payload,actor_id) VALUES('${entity}',${key},${payload},(SELECT actor_id FROM sync_control WHERE id=1)); END;`);
  }
  private enqueue(entity: string,key: string,payload: unknown) {
    this.db.prepare('INSERT INTO sync_queue(entity,key,payload) VALUES(?,?,?)').run(entity,key,JSON.stringify(payload));
  }
  setActor(userId: string) { this.db.prepare('UPDATE sync_control SET actor_id=? WHERE id=1').run(userId); }
  invoiceStatus() {
    if(!this.website)return {last:0,remaining:0};
    const row=this.db.prepare('SELECT COALESCE(MAX(last_number),0) AS last,COALESCE(SUM(MAX(0,last_number-next_number+1)),0) AS remaining FROM offline_invoice_ranges').get()!;
    return {last:Number(row.last),remaining:Number(row.remaining)};
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
      WHERE ${this.website?"q.entity<>'user' AND ":''}q.revision=(SELECT MAX(x.revision) FROM sync_queue x WHERE x.entity=q.entity AND x.key=q.key)
      ORDER BY CASE q.entity WHEN 'record' THEN 0 WHEN 'user' THEN 1 ELSE 2 END,q.revision LIMIT ${this.website?5:20}`).all();
    const batch: SyncChange[]=rows.map(row=>{
      const payload=JSON.parse(String(row.payload));
      if(row.entity==='user')payload.verifier=JSON.parse(this.protection.decrypt(Buffer.from(payload.verifier,'hex')));
      if(this.website&&row.entity==='record'&&['cashier','admin'].includes(payload.kind)) {
        const account=this.db.prepare("SELECT revision,payload FROM sync_queue WHERE entity='user' AND key=? ORDER BY revision DESC LIMIT 1").get(String(row.key));
        if(account) {
          payload.verifier=JSON.parse(this.protection.decrypt(Buffer.from(JSON.parse(String(account.payload)).verifier,'hex')));
          payload.verifierRevision=Number(account.revision);
          payload.verifierBaseVersion=Number(this.db.prepare("SELECT version FROM sync_versions WHERE entity='user' AND key=?").get(String(row.key))?.version??0);
        }
      }
      return {entity:String(row.entity),key:String(row.key),revision:Number(row.revision),baseVersion:Number(row.base_version),payload,...(this.website?{actorId:String(row.actor_id)}:{})};
    });
    if(batch.length){
      let bytes=0;
      return batch.filter(change=>{bytes+=Buffer.byteLength(JSON.stringify(change));return bytes<(this.website?3500000:10000000);});
    }
    for(const [entity,[table,outbox]] of Object.entries(financial)) {
      for(const row of this.db.prepare(`SELECT o.operation_id,o.payload,s.request${entity==='sale'?',s.invoice_number':''} FROM ${outbox} o JOIN ${table} s ON s.id=o.operation_id WHERE o.state='pending' AND s.recovery_ready=1 ORDER BY s.rowid LIMIT ${this.website?5:20}`).all()) {
        const payload=JSON.parse(String(row.payload));
        if(entity==='sale')payload.invoiceNumber=Number(row.invoice_number);
        const context=this.website?this.db.prepare('SELECT catalog_version FROM web_financial_context WHERE entity=? AND key=?').get(entity,String(row.operation_id)):undefined;
        batch.push({entity,key:String(row.operation_id),revision:1,baseVersion:0,payload,...(this.website?{actorId:String(payload.cashierId??payload.acceptedBy),request:JSON.parse(String(row.request)),catalogVersion:Number(context?.catalog_version??0)}:{})});
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
          const verifierRevision=sent.find(change=>change.entity===ack.entity&&change.key===ack.key)?.payload.verifierRevision;
          if(this.website&&ack.entity==='record'&&typeof verifierRevision==='number')this.db.prepare("DELETE FROM sync_queue WHERE entity='user' AND key=? AND revision<=?").run(ack.key,verifierRevision);
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
    const {changes,cursor,invoiceRanges}=input as {changes:{entity:string;key:string;version:number;payload:Record<string,unknown>}[];cursor:number;invoiceRanges?:{first:number;last:number}[]};
    if(!Array.isArray(changes)||changes.length>50||!Number.isSafeInteger(cursor)||cursor<this.cursor())throw new Error('Invalid catalog cursor.');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.exec('UPDATE sync_control SET applying=1 WHERE id=1');
      if(this.website) {
        if(!Array.isArray(invoiceRanges))throw new Error('Missing offline invoice allocation.');
        for(const range of invoiceRanges) {
          if(!Number.isSafeInteger(range.first)||!Number.isSafeInteger(range.last)||range.first<1001||range.last>99999999||range.last<range.first)throw new Error('Invalid invoice allocation.');
          this.db.prepare('INSERT INTO offline_invoice_ranges VALUES(?,?,?) ON CONFLICT DO NOTHING').run(range.first,range.last,range.first);
        }
      }
      for(const change of changes) {
        if(!change||!(this.website?['record','recurring','user','sale','expense','repayment']:['record','recurring','user']).includes(change.entity)||typeof change.key!=='string'||!change.payload||!Number.isSafeInteger(change.version)||change.version>cursor)throw new Error('Invalid catalog change.');
        if(this.db.prepare('SELECT key FROM sync_queue WHERE entity=? AND key=?').get(change.entity,change.key))continue;
        if(change.entity==='user'&&this.db.prepare("SELECT key FROM sync_queue WHERE entity='record' AND key=?").get(change.key))continue;
        const known=this.db.prepare('SELECT version FROM sync_versions WHERE entity=? AND key=?').get(change.entity,change.key);
        if(known&&Number(known.version)>=change.version)continue;
        const payload=change.entity==='record'?{half_price:0,...change.payload}:change.payload;
        if(this.website&&change.entity in financial) {
          const [table,outbox]=financial[change.entity as keyof typeof financial];
          if(this.db.prepare(`SELECT operation_id FROM ${outbox} WHERE operation_id=? AND state='pending'`).get(change.key))continue;
          const columns=this.db.prepare(`PRAGMA table_info(${table})`).all().map(row=>String(row.name));
          if(payload.id!==change.key||columns.some(column=>!(column in payload)))throw new Error('Incomplete website financial entry.');
          this.db.prepare(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')}) ON CONFLICT(id) DO UPDATE SET ${columns.filter(c=>c!=='id').map(c=>`${c}=excluded.${c}`).join(',')}`).run(...columns.map(column=>column==='recovery_ready'?1:payload[column] as string|number));
          if(change.entity==='sale') {
            const sale=JSON.parse(String(payload.payload));
            if(sale.creditor)this.db.prepare('INSERT INTO customer_credit_entries VALUES(?,?,?,?,?) ON CONFLICT(operation_id) DO UPDATE SET amount_minor=excluded.amount_minor').run(change.key,sale.creditor.id,sale.date,sale.cashierId,sale.credit);
          }
          this.db.prepare('INSERT INTO sync_versions VALUES(?,?,?) ON CONFLICT(entity,key) DO UPDATE SET version=excluded.version').run(change.entity,change.key,change.version);
          continue;
        }
        if(change.entity==='record') {
          const columns=this.db.prepare('PRAGMA table_info(development_records)').all().map(row=>String(row.name));
          if(payload.id!==change.key||columns.some(column=>!(column in payload)))throw new Error('Incomplete catalog record.');
          this.db.prepare(`INSERT INTO development_records(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')}) ON CONFLICT(id) DO UPDATE SET ${columns.filter(c=>c!=='id').map(c=>`${c}=excluded.${c}`).join(',')}`).run(...columns.map(column=>payload[column] as string|number));
        } else if(change.entity==='recurring') {
          if(`${payload.id}:${payload.month}`!==change.key)throw new Error('Invalid monthly catalog record.');
          const monthly=this.website?JSON.parse(String(payload.payload)):payload;
          this.db.prepare('INSERT INTO recurring_payments VALUES(?,?,?,?) ON CONFLICT(id,month) DO UPDATE SET shop_id=excluded.shop_id,payload=excluded.payload').run(String(payload.id),String(payload.month),String(monthly.shopId),JSON.stringify(monthly));
        } else {
          if(payload.archived) {
            this.db.prepare('UPDATE development_records SET archived=1 WHERE id=?').run(change.key);
            this.db.prepare('DELETE FROM online_logins WHERE username IN (SELECT username FROM local_users WHERE id=?)').run(change.key);
          } else {
            if(typeof payload.username!=='string'||typeof payload.displayName!=='string'||!['cashier','admin','superuser'].includes(String(payload.role))||typeof payload.shopId!=='string')throw new Error('Invalid account metadata.');
            const profile=this.db.prepare('SELECT manage_finance FROM development_records WHERE id=?').get(change.key);
            this.withRemoteUser({...payload,manageCreditsExpenses:typeof payload.manageCreditsExpenses==='boolean'?payload.manageCreditsExpenses:!!profile?.manage_finance} as unknown as LocalUser);
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
