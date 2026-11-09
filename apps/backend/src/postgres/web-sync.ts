import { createHash, randomBytes } from 'node:crypto';
import { ApiError, integer, object, text, upload } from '../models/validation.js';
import type { PgDatabase } from './database.js';
import type { PgWebStore } from './web-store.js';
import type { LocalUser } from '../../../desktop/src/main/auth-contract';
import type { ManagementRecord, MonthlyExpense } from '../../../desktop/src/main/management-contract';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const lease = 30 * 86400000;
function recordedAt(value: unknown) {
  const date = text(value, 30), time = Date.parse(date);
  if (!Number.isFinite(time) || time > Date.now()+300000) throw new ApiError(409,'Check the terminal clock. The offline entry date is invalid or in the future; the local entry is retained.');
  return new Date(time).toISOString();
}

export class WebSync {
  constructor(private db: PgDatabase, private web: PgWebStore) {}
  async login(input: unknown) {
    const body=object(input), deviceId=text(body.deviceId,64);
    if (!/^[a-f\d-]{36}$/i.test(deviceId)) throw new ApiError(400,'Invalid device ID.');
    const login=await this.web.auth.login(body.username,body.password);
    if (!login.ok) return { ...login };
    const previous=await this.db.prepare('SELECT * FROM desktop_devices WHERE id=?').get(deviceId);
    let deviceToken=typeof body.deviceToken==='string'?body.deviceToken:'';
    if (!previous || hash(deviceToken)!==previous.token_hash) {
      if (login.user.role==='cashier') throw new ApiError(403,'An administrator must connect this terminal to the website first.');
      deviceToken=randomBytes(32).toString('hex');
      await this.db.prepare('INSERT INTO desktop_devices VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET token_hash=excluded.token_hash,paired_by=excluded.paired_by').run(deviceId,hash(deviceToken),login.user.id);
    }
    return { ok:true,user:{...login.user,shopId:login.user.shopId||'main-shop'},deviceToken,token:await this.web.session(login.user,lease),expiresAt:Date.now()+lease };
  }
  async device(token: string) {
    const device=await this.db.prepare('SELECT * FROM desktop_devices WHERE token_hash=?').get(hash(token));
    const owner=device&&await this.web.auth.user(String(device.paired_by));
    if (!device || !owner || owner.role==='cashier') throw new ApiError(401,'An active administrator must reconnect this terminal. Local changes are retained.');
    return String(device.id);
  }
  async actor(token: string) {
    const user=await this.web.user(token);
    if (!user) throw new ApiError(401,'Sign in online again to synchronize this account. Local entries are retained.');
    return user;
  }
  async pull(deviceId: string, afterValue: unknown, lastValue: unknown, remainingValue: unknown) {
    const after=integer(Number(afterValue)), last=integer(Number(lastValue)),remaining=integer(Number(remainingValue));
    const high=Number((await this.db.prepare('SELECT COALESCE(MAX(last_number),0) AS n FROM desktop_invoice_ranges WHERE device_id=?').get(deviceId))!.n);
    if (remaining<1000 && last===high) {
      const range=await this.db.prepare('SELECT first_number AS first,last_number AS last FROM reserve_invoice_numbers(10000)').get();
      await this.db.prepare('INSERT INTO desktop_invoice_ranges VALUES(?,?,?)').run(deviceId,range!.first,range!.last);
    }
    const candidates=await this.db.prepare('SELECT * FROM desktop_changes WHERE version>? ORDER BY version LIMIT 20').all(after);
    let bytes=0;
    const rows=[];
    for (const row of candidates) { const size=Buffer.byteLength(String(row.payload));if(bytes+size>3500000&&rows.length)break;bytes+=size;rows.push(row); }
    return {changes:rows.map(row=>({...row,payload:JSON.parse(String(row.payload))})),cursor:rows.length?Number(rows.at(-1)!.version):after,hasMore:rows.length<candidates.length||candidates.length===20,
      invoiceRanges:await this.db.prepare('SELECT first_number AS first,last_number AS last FROM desktop_invoice_ranges WHERE device_id=? ORDER BY first_number').all(deviceId)};
  }
  async push(deviceId: string, actor: LocalUser, input: unknown) {
    if (!Array.isArray(input)||input.length>20) throw new ApiError(400,'Send at most 20 changes.');
    const acknowledgements=[];
    for (const inputRow of input) {
      const row=object(inputRow), entity=text(row.entity,20),key=text(row.key,64),revision=integer(row.revision,1),baseVersion=integer(row.baseVersion),p=object(row.payload);
      upload(row);
      if (row.actorId!==actor.id) throw new ApiError(403,'Offline entry belongs to another account.');
      if (!['record','recurring','sale','expense','repayment'].includes(entity)) throw new ApiError(400,'Unsupported offline entry.');
      const payloadHash=hash(JSON.stringify(row));
      const previous=await this.db.prepare('SELECT * FROM desktop_receipts WHERE device_id=? AND entity=? AND key=? AND revision=?').get(deviceId,entity,key,revision);
      if (previous) {
        if (previous.payload_hash!==payloadHash) throw new ApiError(409,'Offline reference was already used for different data.');
        acknowledgements.push({entity,key,revision,version:Number(previous.version)});continue;
      }
      if (entity==='record') {
        if (p.id!==key) throw new ApiError(400,'Catalog ID does not match.');
        const current=await this.db.prepare('SELECT * FROM development_records WHERE id=?').get(key);
        const version=Number((await this.db.prepare("SELECT COALESCE(MAX(version),0) AS n FROM desktop_changes WHERE entity='record' AND key=?").get(key))!.n);
        if (version!==baseVersion) throw new ApiError(409,`Catalog conflict for ${String(p.name)}. The local edit is retained; review the website change before retrying.`);
        const kind=text(p.kind,30) as ManagementRecord['kind'];
        if (p.archived) { if(current) await this.web.management.remove(actor,kind,key); }
        else {
          const record={id:current?key:'',kind,name:p.name,phone:p.phone,passport:p.passport,identity:p.identity,pricePaisa:p.pricePaisa,quantity:p.quantity,halfPricePaisa:p.half_price,tables:JSON.parse(String(p.floor_tables)),username:p.username,shopId:p.shop_id,manageCreditsExpenses:!!p.manage_finance,image:p.image,paymentCategory:p.payment_category,employee:p.employee,employeeId:p.employee_id,employeeCategory:p.employee_category,expenseType:p.expense_type,startMonth:p.start_month};
          if(p.verifier!==undefined) {
            const userVersion=Number((await this.db.prepare("SELECT COALESCE(MAX(version),0) AS n FROM desktop_changes WHERE entity='user' AND key=?").get(key))!.n);
            if(userVersion!==integer(p.verifierBaseVersion))throw new ApiError(409,'This account changed on the website. The offline password change is retained for review.');
          }
          const verifier=p.verifier===undefined?undefined:await this.web.auth.importVerifier(p.verifier);
          await this.web.management.save(actor,record,verifier,key);
        }
      } else if (entity==='recurring') {
        if (`${p.id}:${p.month}`!==key) throw new ApiError(400,'Monthly payment ID does not match.');
        const snapshot=p as unknown as MonthlyExpense;
        if (!Array.isArray(snapshot.payments)) throw new ApiError(400,'Missing monthly payments.');
        if(!snapshot.payments.length)await this.web.management.monthly(actor,snapshot.month);
        for (const payment of snapshot.payments) await this.web.management.recordPayment(actor,snapshot.id,snapshot.month,payment.amountMinor,payment.operationId,recordedAt(payment.paidAt));
        if (!snapshot.payments.length && snapshot.paid) throw new ApiError(409,'Legacy paid flags require review. Use a recorded monthly payment.');
      } else {
        const request=object(row.request);
        if (request.operationId!==key||p.id!==key) throw new ApiError(400,'Financial reference does not match.');
        const createdAt=recordedAt(entity==='sale'?p.date:p.createdAt);
        let result;
        if (entity==='sale') {
          const invoiceNumber=integer(p.invoiceNumber,1001,99999999),catalogVersion=integer(row.catalogVersion);
          if (!await this.db.prepare('SELECT device_id FROM desktop_invoice_ranges WHERE device_id=? AND first_number<=? AND last_number>=?').get(deviceId,invoiceNumber,invoiceNumber)) throw new ApiError(409,'Invoice number was not reserved for this terminal.');
          result=await this.web.sales.save(actor,request,{createdAt,invoiceNumber,catalogVersion});
        } else if (entity==='expense') result=await this.web.sales.saveExpense(actor,request,createdAt);
        else result=await this.web.sales.recoverCredit(actor,request,createdAt);
        if (!result.ok) throw new ApiError(409,`${result.message} The offline entry is retained.`);
        const table=entity==='sale'?'sale_outbox':entity==='expense'?'expense_outbox':'repayment_outbox';
        await this.db.prepare(`UPDATE ${table} SET state='synced' WHERE operation_id=?`).run(key);
      }
      const version=Number((await this.db.prepare('SELECT COALESCE(MAX(version),0) AS n FROM desktop_changes WHERE entity=? AND key=?').get(entity,key))!.n);
      await this.db.prepare('INSERT INTO desktop_receipts VALUES(?,?,?,?,?,?)').run(deviceId,entity,key,revision,payloadHash,version);
      acknowledgements.push({entity,key,revision,version});
    }
    return {acknowledgements};
  }
}
