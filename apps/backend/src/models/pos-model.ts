import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, scrypt, createHash, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { ApiError, object, text, passwordText, upload, type Upload } from './validation.js';

const derive = promisify(scrypt);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export interface User { id: string; username: string; displayName: string; role: 'superuser'|'admin'|'cashier'; shopId: string; manageCreditsExpenses: boolean }
export class PosModel {
  readonly db: DatabaseSync;
  constructor(filename: string) {
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,username TEXT NOT NULL COLLATE NOCASE UNIQUE,display_name TEXT NOT NULL,role TEXT NOT NULL,salt TEXT NOT NULL,hash TEXT NOT NULL,shop_id TEXT NOT NULL,manage_finance INTEGER NOT NULL DEFAULT 0,archived INTEGER NOT NULL DEFAULT 0,failures INTEGER NOT NULL DEFAULT 0,blocked_until INTEGER NOT NULL DEFAULT 0) STRICT;
      CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY,token_hash TEXT NOT NULL UNIQUE) STRICT;
      CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires INTEGER NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS documents(entity TEXT NOT NULL,key TEXT NOT NULL,payload TEXT NOT NULL,version INTEGER NOT NULL,PRIMARY KEY(entity,key)) STRICT;
      CREATE TABLE IF NOT EXISTS changes(version INTEGER PRIMARY KEY AUTOINCREMENT,entity TEXT NOT NULL,key TEXT NOT NULL,payload TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS events(device_id TEXT NOT NULL,entity TEXT NOT NULL,key TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(device_id,entity,key)) STRICT;`);
    this.db.exec('CREATE TABLE IF NOT EXISTS sync_receipts(device_id TEXT NOT NULL,entity TEXT NOT NULL,key TEXT NOT NULL,revision INTEGER NOT NULL,payload_hash TEXT NOT NULL,version INTEGER NOT NULL,PRIMARY KEY(device_id,entity,key,revision)) STRICT');
  }
  async bootstrap() {
    if (this.db.prepare('SELECT id FROM users LIMIT 1').get()) return;
    await this.createUser({id:'bootstrap-admin',username:'superadmin',password:'PosSuperAdmin123!',displayName:'Super Administrator',role:'superuser',shopId:'main-shop',manageCreditsExpenses:true},true);
  }
  user(id: string): User | null {
    const row = this.db.prepare('SELECT * FROM users WHERE id=? AND archived=0').get(id);
    return row ? {id:String(row.id),username:String(row.username),displayName:String(row.display_name),role:row.role as User['role'],shopId:String(row.shop_id),manageCreditsExpenses:!!row.manage_finance} : null;
  }
  private change(entity: string, key: string, payload: unknown): number {
    const data = JSON.stringify(payload);
    const version = Number(this.db.prepare('INSERT INTO changes(entity,key,payload) VALUES(?,?,?)').run(entity,key,data).lastInsertRowid);
    this.db.prepare('INSERT INTO documents VALUES(?,?,?,?) ON CONFLICT(entity,key) DO UPDATE SET payload=excluded.payload,version=excluded.version').run(entity,key,data,version);
    return version;
  }
  async createUser(value: unknown, superuser: boolean) {
    const body=object(value), username=text(body.username,64), password=passwordText(body.password), displayName=text(body.displayName), shopId=text(body.shopId,64);
    if (!/^[a-zA-Z0-9_.-]{3,64}$/.test(username) || password.length<8 || !['cashier','admin','superuser'].includes(String(body.role)) || (body.role !== 'cashier' && !superuser)) throw new ApiError(400,'Invalid account or role.');
    const id=body.id ? text(body.id,64) : randomUUID(), salt=randomBytes(16).toString('hex'), hash=(await derive(password,salt,64) as Buffer).toString('hex');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT INTO users(id,username,display_name,role,salt,hash,shop_id,manage_finance) VALUES(?,?,?,?,?,?,?,?)').run(id,username,displayName,String(body.role),salt,hash,shopId,body.manageCreditsExpenses===true?1:0);
      this.change('user',id,this.user(id));
      this.db.exec('COMMIT');
    } catch(error) { this.db.exec('ROLLBACK'); throw error; }
    return this.user(id);
  }
  async login(value: unknown) {
    const body=object(value), username=text(body.username,64), password=passwordText(body.password), deviceId=text(body.deviceId,64);
    if (!/^[a-f\d-]{36}$/i.test(deviceId)) throw new ApiError(400,'Invalid device ID.');
    const row=this.db.prepare('SELECT * FROM users WHERE username=? COLLATE NOCASE').get(username);
    if (row && Number(row.blocked_until)>Date.now()) throw new ApiError(429,'Too many attempts. Try again in 30 seconds.');
    const actual=await derive(password,row?String(row.salt):'unknown-user',64) as Buffer;
    if (!row || row.archived || !timingSafeEqual(actual,Buffer.from(String(row.hash),'hex'))) {
      if(row)this.db.prepare('UPDATE users SET failures=failures+1,blocked_until=CASE WHEN failures>=4 THEN ? ELSE 0 END WHERE id=?').run(Date.now()+30000,row.id);
      throw new ApiError(401,'Username or password is incorrect.');
    }
    const user=this.user(String(row.id))!;
    const device=this.db.prepare('SELECT * FROM devices WHERE id=?').get(deviceId);
    let deviceToken: string;
    if (!device) {
      if(user.role==='cashier')throw new ApiError(403,'An administrator must pair this terminal first.');
      if(this.db.prepare('SELECT id FROM devices LIMIT 1').get())throw new ApiError(409,'This business already has a paired terminal. Contact support before replacing it.');
      deviceToken=randomBytes(32).toString('hex');
      this.db.prepare('INSERT INTO devices VALUES(?,?)').run(deviceId,digest(deviceToken));
    } else {
      if(typeof body.deviceToken==='string' && digest(body.deviceToken)===device.token_hash)deviceToken=body.deviceToken;
      else {
        if(user.role==='cashier')throw new ApiError(403,'An administrator must restore this terminal pairing.');
        // Recover a pairing whose very first response was lost after the server committed.
        deviceToken=randomBytes(32).toString('hex');
        this.db.prepare('UPDATE devices SET token_hash=? WHERE id=?').run(digest(deviceToken),deviceId);
      }
    }
    this.db.prepare('UPDATE users SET failures=0,blocked_until=0 WHERE id=?').run(user.id);
    const token=randomBytes(32).toString('hex'), expiresAt=Date.now()+30*86400000;
    this.db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
    this.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(token),user.id,expiresAt);
    return {user,token,deviceToken,expiresAt};
  }
  session(token: string): User {
    const row=this.db.prepare('SELECT user_id FROM sessions WHERE token_hash=? AND expires>?').get(digest(token),Date.now());
    const user=row&&this.user(String(row.user_id));
    if(!user)throw new ApiError(401,'Sign in online again.');
    return user;
  }
  device(token: string): string {
    const row=this.db.prepare('SELECT id FROM devices WHERE token_hash=?').get(digest(token));
    if(!row)throw new ApiError(401,'Terminal pairing required.');
    return String(row.id);
  }
  async password(user: User, value: unknown) {
    const body=object(value), current=passwordText(body.current), next=passwordText(body.next);
    if(next.length<8)throw new ApiError(400,'Use at least eight characters.');
    const row=this.db.prepare('SELECT salt,hash FROM users WHERE id=?').get(user.id)!;
    if(!timingSafeEqual(await derive(current,String(row.salt),64) as Buffer,Buffer.from(String(row.hash),'hex')))throw new ApiError(401,'Current password is incorrect.');
    const salt=randomBytes(16).toString('hex'), hash=(await derive(next,salt,64) as Buffer).toString('hex');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('UPDATE users SET salt=?,hash=? WHERE id=?').run(salt,hash,user.id);
      this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
      this.change('user',user.id,this.user(user.id));
      this.db.exec('COMMIT');
    } catch(error) { this.db.exec('ROLLBACK'); throw error; }
  }
  push(deviceId: string, input: unknown) {
    if(!Array.isArray(input)||input.length>50)throw new ApiError(400,'Send at most 50 changes.');
    const rows=input.map(upload);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const acknowledgements=rows.map(row=>this.accept(deviceId,row));
      this.db.exec('COMMIT');
      return {acknowledgements};
    } catch(error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private accept(deviceId: string, row: Upload) {
    const payload=JSON.stringify(row.payload);
    const receipt=this.db.prepare('SELECT * FROM sync_receipts WHERE device_id=? AND entity=? AND key=? AND revision=?').get(deviceId,row.entity,row.key,row.revision);
    if(receipt) {
      if(receipt.payload_hash!==digest(payload))throw new ApiError(409,'Sync reference belongs to different data.');
      return {entity:row.entity,key:row.key,revision:row.revision,version:Number(receipt.version)};
    }
    let version=0;
    if(['sale','expense','repayment'].includes(row.entity)) {
      const previous=this.db.prepare('SELECT payload FROM events WHERE device_id=? AND entity=? AND key=?').get(deviceId,row.entity,row.key);
      if(previous && previous.payload!==payload)throw new ApiError(409,'A saved financial entry cannot be changed.');
      if(!previous)this.db.prepare('INSERT INTO events VALUES(?,?,?,?)').run(deviceId,row.entity,row.key,payload);
    } else {
      const previous=this.db.prepare('SELECT * FROM documents WHERE entity=? AND key=?').get(row.entity,row.key);
      if(previous?.payload===payload)version=Number(previous.version);
      else {
        if((previous?Number(previous.version):0)!==row.baseVersion)throw new ApiError(409,`Sync conflict for ${row.entity} ${row.key}. Local changes were retained.`);
        if(row.entity==='user') {
          const p=row.payload,v=object(p.verifier);
          const existing=this.db.prepare('SELECT role FROM users WHERE id=?').get(row.key);
          if(p.is_superuser || existing?.role==='superuser')throw new ApiError(403,'Superuser credentials must be managed on the server.');
          const profile=this.db.prepare("SELECT payload FROM documents WHERE entity='record' AND key=?").get(row.key);
          const data=profile?JSON.parse(String(profile.payload)):{};
          this.db.prepare(`INSERT INTO users(id,username,display_name,role,salt,hash,shop_id,manage_finance,archived) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET username=excluded.username,display_name=excluded.display_name,role=excluded.role,salt=excluded.salt,hash=excluded.hash,shop_id=excluded.shop_id,manage_finance=excluded.manage_finance,archived=excluded.archived`).run(row.key,String(p.username),String(p.display_name),String(p.role),String(v.salt),String(v.hash),String(data.shop_id||'main-shop'),data.manage_finance?1:0,data.archived?1:0);
          // Password verifiers never appear in the change feed or report responses.
          version=this.change(row.entity,row.key,this.user(row.key)??{id:row.key,archived:true});
        } else {
          version=this.change(row.entity,row.key,row.payload);
          if(row.entity==='record' && ['cashier','admin'].includes(String(row.payload.kind))) {
            const p=row.payload;
            this.db.prepare('UPDATE users SET display_name=?,shop_id=?,manage_finance=?,archived=? WHERE id=?').run(String(p.name),String(p.shop_id),Number(p.manage_finance),Number(p.archived),row.key);
            if(p.archived)this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(row.key);
          }
        }
      }
    }
    this.db.prepare('INSERT INTO sync_receipts VALUES(?,?,?,?,?,?)').run(deviceId,row.entity,row.key,row.revision,digest(payload),version);
    return {entity:row.entity,key:row.key,revision:row.revision,version};
  }
  pull(after: number) {
    const candidates=this.db.prepare('SELECT * FROM changes WHERE version>? ORDER BY version LIMIT 20').all(after);
    let bytes=0;
    const rows=candidates.filter(row=>{bytes+=Buffer.byteLength(String(row.payload));return bytes<10000000;});
    return {changes:rows.map(row=>({entity:row.entity,key:row.key,version:row.version,payload:JSON.parse(String(row.payload))})),cursor:rows.length?Number(rows.at(-1)!.version):after,hasMore:rows.length<candidates.length||candidates.length===20};
  }
  close() { this.db.close(); }
}
