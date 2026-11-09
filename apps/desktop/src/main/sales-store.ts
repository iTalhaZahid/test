import { discountAmount, menuPortionPrice } from './sales-contract';
import type { MonthlyExpense } from './management-contract';
import { DatabaseSync } from 'node:sqlite';
import type { LocalUser } from './auth-contract';
import type { Creditor, MenuItem, Sale, SaleFilter, SaleRequest, Expense, ExpenseRequest, Repayment, RepaymentRequest, CreditorAccount } from './sales-contract';

function string(value: unknown, limit = 120) {
  if (typeof value !== 'string' || value.length > limit) throw new Error('Invalid text input.');
  return value.trim();
}
function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new Error('Invalid amount or quantity.');
  return value;
}
export function businessDate(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  return ['year','month','day'].map(key => parts.find(p => p.type === key)!.value).join('-');
}

export class SalesStore {
  private db: DatabaseSync;
  constructor(filename: string, private recoveryFile: string, private protect: (payload: string) => Uint8Array) {
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS sales (id TEXT PRIMARY KEY, cashier_id TEXT NOT NULL, business_date TEXT NOT NULL,
        customer_type TEXT NOT NULL, request TEXT NOT NULL, payload TEXT NOT NULL, recovery_ready INTEGER NOT NULL DEFAULT 0) STRICT;
      CREATE TABLE IF NOT EXISTS sale_outbox (operation_id TEXT PRIMARY KEY REFERENCES sales(id), payload TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending') STRICT;
      CREATE TABLE IF NOT EXISTS customer_credit_entries (operation_id TEXT PRIMARY KEY REFERENCES sales(id), customer_id TEXT NOT NULL,
        date TEXT NOT NULL, cashier_id TEXT NOT NULL, amount_minor INTEGER NOT NULL CHECK(amount_minor>=0)) STRICT;
      CREATE TABLE IF NOT EXISTS menu_favourites (cashier_id TEXT NOT NULL, item_id TEXT NOT NULL, PRIMARY KEY(cashier_id,item_id)) STRICT;
      CREATE INDEX IF NOT EXISTS sales_date ON sales(business_date);
      CREATE INDEX IF NOT EXISTS customer_credit_customer ON customer_credit_entries(customer_id);`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS expenses(id TEXT PRIMARY KEY,cashier_id TEXT NOT NULL,date TEXT NOT NULL,request TEXT NOT NULL,payload TEXT NOT NULL,recovery_ready INTEGER NOT NULL DEFAULT 0) STRICT;
      CREATE TABLE IF NOT EXISTS expense_outbox(operation_id TEXT PRIMARY KEY REFERENCES expenses(id),payload TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending') STRICT;`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS repayments(id TEXT PRIMARY KEY,customer_id TEXT NOT NULL,accepted_by TEXT NOT NULL,date TEXT NOT NULL,amount_minor INTEGER NOT NULL CHECK(amount_minor>0),request TEXT NOT NULL,payload TEXT NOT NULL,recovery_ready INTEGER NOT NULL DEFAULT 0) STRICT;
      CREATE TABLE IF NOT EXISTS repayment_outbox(operation_id TEXT PRIMARY KEY REFERENCES repayments(id),payload TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending') STRICT;
      CREATE INDEX IF NOT EXISTS repayments_customer ON repayments(customer_id);`);
    if (!this.db.prepare('PRAGMA table_info(sales)').all().some(c => c.name === 'shop_id')) this.db.exec("ALTER TABLE sales ADD COLUMN shop_id TEXT NOT NULL DEFAULT ''");
    this.db.exec('CREATE INDEX IF NOT EXISTS sales_shop_date ON sales(shop_id,business_date)');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (!this.db.prepare('PRAGMA table_info(sales)').all().some(c => c.name === 'invoice_number')) {
        this.db.exec('ALTER TABLE sales ADD COLUMN invoice_number INTEGER');
        this.db.exec('UPDATE sales SET invoice_number=rowid+1000');
      }
      const unnumbered=this.db.prepare('SELECT id FROM sales WHERE invoice_number IS NULL ORDER BY rowid').all();
      for(const row of unnumbered)this.db.prepare('UPDATE sales SET invoice_number=(SELECT COALESCE(MAX(invoice_number),1000)+1 FROM sales) WHERE id=?').run(String(row.id));
      this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS sales_invoice_number ON sales(invoice_number)');
      this.db.exec('COMMIT');
    } catch(error) { this.db.exec('ROLLBACK'); throw error; }

    for (const table of ['expenses','repayments']) {
      if (!this.db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === 'shop_id')) this.db.exec(`ALTER TABLE ${table} ADD COLUMN shop_id TEXT NOT NULL DEFAULT ''`);
      this.db.exec(`CREATE INDEX IF NOT EXISTS ${table}_shop_date ON ${table}(shop_id,date)`);
    }
  }
  private readSale(row: Record<string, unknown>): Sale {
    return {...JSON.parse(String(row.payload)),invoiceNumber:Number(row.invoice_number)} as Sale;
  }
  private cashierShop(user: LocalUser) {
    const shop = this.db.prepare(`SELECT s.id,s.name FROM development_records c
      JOIN development_records s ON s.id=c.shop_id AND s.kind='shop' AND s.archived=0
      WHERE c.id=? AND c.kind='cashier' AND c.archived=0`).get(user.id);
    if (!shop) throw new Error('Ask an administrator to assign this cashier to an active shop.');
    return { shopId:String(shop.id), shopName:String(shop.name) };
  }
  private authorize(user: LocalUser | null) {
    if (!user || !['superuser','admin','cashier'].includes(user.role)) throw new Error('Sign in to continue.');
    if (this.db.prepare('SELECT id FROM development_records WHERE id=? AND archived=1').get(user.id)) throw new Error('This account is inactive.');
    return user;
  }
  private finance(user: LocalUser | null) {
    const actor = this.authorize(user);
    if (actor.role === 'cashier' && !this.db.prepare('SELECT id FROM development_records WHERE id=? AND archived=0 AND manage_finance=1').get(actor.id)) throw new Error('Manage Credits and Expense permission required.');
    return actor;
  }
  paymentMethods(user: LocalUser | null) {
    this.authorize(user);
    return this.db.prepare("SELECT id,name,payment_category AS category FROM development_records WHERE kind='payment' AND archived=0 ORDER BY payment_category,name").all() as unknown as import('./sales-contract').PaymentMethod[];
  }
  menu(user: LocalUser | null, query: unknown): MenuItem[] {
    const actor = this.authorize(user), search = string(query);
    const tokens = search.match(/[\p{L}\p{N}]+/gu);
    if (search && !tokens) return [];
    const shopId = actor.role === 'cashier' ? this.cashierShop(actor).shopId : '';
    const match = tokens?.map(token => `"${token}"*`).join(' AND ');
    const rows = this.db.prepare(`SELECT r.id,r.name,r.image,r.pricePaisa AS priceMinor,r.half_price AS halfPriceMinor,
      EXISTS(SELECT 1 FROM menu_favourites f WHERE f.item_id=r.id AND f.cashier_id=?) AS favourite
      FROM development_records r ${search ? 'JOIN development_menu_fts fts ON fts.rowid=r.rowid' : ''}
      WHERE r.kind='menu' AND r.archived=0 AND (?='' OR r.shop_id=? OR r.shop_id='__all__') ${search ? 'AND development_menu_fts MATCH ?' : ''} ORDER BY r.name COLLATE NOCASE`)
      .all(...(search ? [actor.id, shopId, shopId, match!] : [actor.id, shopId, shopId]));
    return rows.map(row => ({ id: String(row.id), name: String(row.name), priceMinor: Number(row.priceMinor), halfPriceMinor: Number(row.halfPriceMinor)||undefined, favourite: !!row.favourite, image: String(row.image) }));
  }
  favourite(user: LocalUser | null, itemId: unknown, enabled: unknown) {
    const actor = this.authorize(user), id = string(itemId,64);
    if (actor.role === 'cashier' && !this.db.prepare("SELECT id FROM development_records WHERE id=? AND (shop_id=? OR shop_id='__all__')").get(id,this.cashierShop(actor).shopId)) throw new Error('Menu item belongs to another shop.');
    if (typeof enabled !== 'boolean' || !this.db.prepare("SELECT id FROM development_records WHERE id=? AND kind='menu' AND archived=0").get(id)) throw new Error('Menu item unavailable.');
    if (enabled) this.db.prepare('INSERT OR IGNORE INTO menu_favourites VALUES(?,?)').run(actor.id,id);
    else this.db.prepare('DELETE FROM menu_favourites WHERE cashier_id=? AND item_id=?').run(actor.id,id);
  }
  creditors(user: LocalUser | null, query: unknown): Creditor[] {
    this.finance(user); const search = string(query);
    return this.db.prepare("SELECT id,name,phone FROM development_records WHERE kind='creditor' AND archived=0 AND (instr(lower(name),lower(?))>0 OR instr(phone,?)>0) ORDER BY name COLLATE NOCASE").all(search,search) as unknown as Creditor[];
  }
  private recovery(sale: Sale | Expense | Repayment) {
    const expense = 'paidVia' in sale;
    const repayment = 'acceptedBy' in sale;
    const table = repayment ? 'pending_repayments' : expense ? 'pending_expenses' : 'pending_sales';
    const encrypted = this.protect(JSON.stringify(sale));
    const backup = new DatabaseSync(this.recoveryFile);
    try {
      backup.exec(`PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS ${table}(operation_id TEXT PRIMARY KEY,payload BLOB NOT NULL) STRICT;`);
      backup.prepare(`INSERT INTO ${table} VALUES(?,?) ON CONFLICT(operation_id) DO UPDATE SET payload=excluded.payload`).run(sale.id,encrypted);
    } finally { backup.close(); }
    this.db.prepare(`UPDATE ${repayment ? 'repayments' : expense ? 'expenses' : 'sales'} SET recovery_ready=1 WHERE id=?`).run(sale.id);
  }
  save(user: LocalUser | null, input: unknown): { ok: true; sale: Sale } | { ok: false; pending: boolean; message: string } {
    let committed = false;
    try {
      const actor = this.authorize(user);
      if (!input || typeof input !== 'object') throw new Error('Invalid order.');
      const request = input as SaleRequest;
      const id = string(request.operationId,64);
      if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error('Invalid order ID.');
      const original = this.db.prepare('SELECT * FROM sales WHERE id=?').get(id);
      if (original) {
        if (original.cashier_id !== actor.id || original.request !== JSON.stringify(request)) throw new Error('This order ID belongs to a different order.');
        committed = true;
        const sale = this.readSale(original);
        this.recovery(sale);
        return { ok:true, sale };
      }
      if (request.customerType === 'creditor') this.finance(actor);
      const paymentMethod = this.paymentMethods(actor).find(method => method.id === (request.paymentMethodId ?? 'payment-cash'));
      if (!paymentMethod) throw new Error('Choose an active payment method.');
      if (!['walk-in','creditor','delivery'].includes(request.customerType)) throw new Error('Select a customer type.');
      if (!Array.isArray(request.lines) || request.lines.length < 1 || request.lines.length > 200) throw new Error('Add between 1 and 200 items.');
      const received = integer(request.receivedMinor,0,99999999999);
      this.db.exec('BEGIN IMMEDIATE');
      let sale: Sale;
      try {
        const shop = this.cashierShop(actor);
        let creditor: Creditor | null = null;
        if (request.customerType === 'creditor') {
          creditor = this.db.prepare("SELECT id,name,phone FROM development_records WHERE id=? AND kind='creditor' AND archived=0").get(string(request.creditorId,64)) as unknown as Creditor;
          if (!creditor) throw new Error('Select an active creditor.');
        } else if (request.creditorId !== null) throw new Error('Customer type does not match creditor.');
        let table: Sale['table'];
        if(request.table!==undefined){
          if(!request.table||typeof request.table!=='object')throw new Error('Choose a valid table.');
          const floorId=string(request.table.floorId,64),number=integer(request.table.number,1,9999);
          const floor=this.db.prepare("SELECT name,floor_tables FROM development_records WHERE id=? AND kind='floor' AND archived=0").get(floorId);
          if(!floor||!(JSON.parse(String(floor.floor_tables)) as number[]).includes(number))throw new Error('This table is no longer available. Choose another table.');
          const floorName=String(floor.name);
          table={floorId,floorName,number,label:`${floorName.charAt(0).toUpperCase()}${number}`};
        }
        const seen = new Set<string>();
        const lines = request.lines.map(line => {
          if (!line || typeof line !== 'object') throw new Error('Invalid item.');
          const itemId = string(line.itemId,64), quantity = integer(line.quantity,1,9999);
          const lineKey = `${itemId}:${line.portion || 'regular'}`;
          if (seen.has(lineKey)) throw new Error('Duplicate item.');
          seen.add(lineKey);
          const item = this.db.prepare("SELECT name,pricePaisa,half_price FROM development_records WHERE id=? AND kind='menu' AND archived=0 AND (shop_id=? OR shop_id='__all__')").get(itemId,shop.shopId);
          if (!item) throw new Error('An item is no longer available. Remove it and try again.');
          const unitPrice = integer(menuPortionPrice(Number(item.pricePaisa),Number(item.half_price),line.portion),1,999999999);
          if (line.unitPrice !== unitPrice) throw new Error('A price changed. Remove and re-add the item before saving.');
          return { itemId, name:String(item.name)+(line.portion?` (${line.portion==='half'?'Half':'Full'})`:''), ...(line.portion?{portion:line.portion}:{}), quantity, unitPrice, total:unitPrice*quantity };
        });
        const subtotal = integer(lines.reduce((sum,line) => sum+line.total,0),1,99999999999);
        const discountMinor=discountAmount(subtotal,request.discount),total=subtotal-discountMinor;
        if (!creditor && received < total) throw new Error('Amount received must cover the total bill.');
        if (paymentMethod.category !== 'cash' && received > total) throw new Error('Card and online payments cannot exceed the total bill.');
        const date = new Date();
        const reserved=this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='offline_invoice_ranges'").get();
        const range=reserved?this.db.prepare('SELECT * FROM offline_invoice_ranges WHERE next_number<=last_number ORDER BY first_number LIMIT 1').get():undefined;
        if(reserved&&!range)throw new Error('Connect online to reserve more invoice numbers before recording another sale.');
        const invoiceNumber=range?Number(range.next_number):Number(this.db.prepare('SELECT COALESCE(MAX(invoice_number),1000)+1 AS next FROM sales').get()!.next);
        if(range)this.db.prepare('UPDATE offline_invoice_ranges SET next_number=next_number+1 WHERE first_number=?').run(Number(range.first_number));
        if(invoiceNumber>99999999)throw new Error('Eight-digit invoice numbers are exhausted. Contact support.');
        sale = { id, invoiceNumber, date:date.toISOString(), businessDate:businessDate(date), currency:'QAR', cashierId:actor.id, cashierName:actor.displayName, ...shop,
          customerType:request.customerType, ...(table?{table}:{}), paymentMethod, creditor, lines,subtotal,discountMinor,...(request.discount?{discount:request.discount}:{}),total,received,cashApplied:Math.min(received,total),change:Math.max(0,received-total),credit:Math.max(0,total-received) };
        const payload = JSON.stringify(sale);
        this.db.prepare('INSERT INTO sales(id,cashier_id,business_date,customer_type,request,payload,shop_id,invoice_number) VALUES(?,?,?,?,?,?,?,?)').run(id,actor.id,sale.businessDate,sale.customerType,JSON.stringify(request),payload,sale.shopId!,invoiceNumber);
        this.db.prepare('INSERT INTO sale_outbox(operation_id,payload) VALUES(?,?)').run(id,payload);
        if (creditor) this.db.prepare('INSERT INTO customer_credit_entries VALUES(?,?,?,?,?)').run(id,creditor.id,sale.date,actor.id,sale.credit);
        this.db.exec('COMMIT'); committed = true;
      } catch (error) { this.db.exec('ROLLBACK'); throw error; }
      this.recovery(sale);
      return { ok:true, sale };
    } catch (error) {
      return { ok:false, pending:committed, message:committed ? 'Recovery copy could not be confirmed. Keep this order and retry Save Order; do not enter it again.' : error instanceof Error ? error.message : 'Unable to save order.' };
    }
  }
  history(user: LocalUser | null, input: unknown): Sale[] {
    const actor = this.finance(user);
    if (!input || typeof input !== 'object') throw new Error('Invalid filter.');
    const filter = input as SaleFilter;
    const start = string(filter.start,10), end = string(filter.end,10);
    const shopId = filter.shopId === undefined ? '' : string(filter.shopId,64);
    if(actor.role==='cashier' && shopId!==this.cashierShop(actor).shopId) throw new Error('Choose your assigned shop.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end || !['all','cash','creditor'].includes(filter.type)) throw new Error('Choose a valid date range.');
    return this.db.prepare(`SELECT payload,invoice_number FROM sales WHERE business_date BETWEEN ? AND ? ${shopId ? 'AND shop_id=?' : ''} ${filter.type === 'cash' ? "AND customer_type!='creditor' AND COALESCE(json_extract(payload,'$.paymentMethod.category'),'cash')='cash'" : filter.type === 'creditor' ? "AND customer_type='creditor'" : ''} ORDER BY rowid DESC`).all(...(shopId ? [start,end,shopId === '__legacy__' ? '' : shopId] : [start,end])).map(row => this.readSale(row));
  }
  saveExpense(user: LocalUser | null, input: unknown): { ok: true; expense: Expense } | { ok: false; pending: boolean; message: string } {
    let committed=false;
    try {
      const actor=this.authorize(user);
      if (!input || typeof input!=='object') throw new Error('Invalid expense.');
      const request=input as ExpenseRequest;
      const id=string(request.operationId,64);
      if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error('Invalid expense ID.');
      const previous=this.db.prepare('SELECT * FROM expenses WHERE id=?').get(id);
      if(previous) {
        if(previous.cashier_id!==actor.id || previous.request!==JSON.stringify(request)) throw new Error('Expense ID already used.');
        committed=true; const expense=JSON.parse(String(previous.payload)) as Expense;
        this.recovery(expense); return {ok:true,expense};
      }
      const date=string(request.date,10),category=string(request.category,80),description=string(request.description,500);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10)!==date) throw new Error('Choose a valid expense date.');
      if(!category || !description) throw new Error('Enter category and description.');
      if(!['cash','online'].includes(request.paidVia)) throw new Error('Choose Cash or Online.');
      const amountMinor=integer(request.amountMinor,1,99999999999);
      let shop;
      if(actor.role==='cashier') shop=this.cashierShop(actor);
      else {
        const selected=this.db.prepare("SELECT id,name FROM development_records WHERE id=? AND kind='shop' AND archived=0").get(string(request.shopId,64));
        if(!selected)throw new Error('Choose an active shop for this expense.');
        shop={shopId:String(selected.id),shopName:String(selected.name)};
      }
      const expense: Expense={...request,id,date,category,description,amountMinor,createdAt:new Date().toISOString(),cashierId:actor.id,cashierName:actor.displayName,currency:'QAR',...shop};
      const payload=JSON.stringify(expense);
      this.db.exec('BEGIN IMMEDIATE');
      try {
        this.db.prepare('INSERT INTO expenses(id,cashier_id,date,request,payload,shop_id) VALUES(?,?,?,?,?,?)').run(id,actor.id,date,JSON.stringify(request),payload,expense.shopId!);
        this.db.prepare('INSERT INTO expense_outbox(operation_id,payload) VALUES(?,?)').run(id,payload);
        this.db.exec('COMMIT'); committed=true;
      } catch(error) { this.db.exec('ROLLBACK'); throw error; }
      this.recovery(expense); return {ok:true,expense};
    } catch(error) { return {ok:false,pending:committed,message:committed?'Recovery copy unconfirmed. Retry this expense; do not enter it again.':error instanceof Error?error.message:'Unable to save expense.'}; }
  }
  expenses(user: LocalUser | null, startValue: unknown, endValue: unknown, shopValue: unknown = ''): Expense[] {
    const actor=this.finance(user);
    const start=string(startValue,10),end=string(endValue,10);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end)||start>end)throw new Error('Invalid date range.');
    const shopId=string(shopValue,64);
    if(actor.role==='cashier' && shopId!==this.cashierShop(actor).shopId) throw new Error('Choose your assigned shop.');
    const expenses=this.db.prepare(`SELECT payload FROM expenses WHERE date BETWEEN ? AND ? ${shopId?'AND shop_id=?':''} ORDER BY date DESC,rowid DESC`).all(...(shopId?[start,end,shopId==='__legacy__'?'':shopId]:[start,end])).map(row=>JSON.parse(String(row.payload)) as Expense);
    const monthly=this.db.prepare(`SELECT p.payload,p.shop_id,s.name AS shop_name FROM recurring_payments p LEFT JOIN development_records s ON s.id=p.shop_id AND s.kind='shop' ${shopId?'WHERE p.shop_id=?':''}`).all(...(shopId?[shopId==='__legacy__'?'':shopId]:[]));
    for(const entry of monthly){
      const row=JSON.parse(String(entry.payload)) as MonthlyExpense;
      const payments=row.payments?.length?row.payments:row.paid&&row.paidAt?[{operationId:'legacy',amountMinor:row.paidMinor??row.pricePaisa,paidAt:row.paidAt,paidBy:row.paidBy||'Not recorded'}]:[];
      for(const payment of payments){
        const date=businessDate(new Date(payment.paidAt));
        if(date<start||date>end)continue;
        const id=`recurring:${row.id}:${row.month}:${payment.operationId}`;
        expenses.push({id,operationId:id,date,category:row.expenseType||'Recurring expense',description:`${row.name} (${row.month})`,amountMinor:payment.amountMinor,paidVia:'Not recorded',createdAt:payment.paidAt,cashierId:'',cashierName:payment.paidBy,currency:'QAR',shopId:String(entry.shop_id),shopName:entry.shop_name?String(entry.shop_name):undefined});
      }
    }
    return expenses.sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt));
  }
  creditorAccount(user:LocalUser|null,idValue:unknown):CreditorAccount {
    this.finance(user);
    const id=string(idValue,64);
    const creditor=this.db.prepare("SELECT id,name,phone FROM development_records WHERE id=? AND kind='creditor'").get(id) as unknown as Creditor;
    if(!creditor)throw new Error('Creditor not found.');
    const sales=this.db.prepare('SELECT s.payload,s.invoice_number FROM sales s JOIN customer_credit_entries c ON c.operation_id=s.id WHERE c.customer_id=? ORDER BY s.rowid DESC').all(id).map(row=>this.readSale(row));
    const repayments=this.db.prepare('SELECT payload FROM repayments WHERE customer_id=? ORDER BY date DESC,rowid DESC').all(id).map(row=>JSON.parse(String(row.payload)) as Repayment);
    const credit=sales.reduce((sum,sale)=>sum+sale.credit,0),recovered=repayments.reduce((sum,payment)=>sum+payment.amountMinor,0);
    return {creditor,sales,repayments,credit,recovered,outstanding:credit-recovered};
  }
  repayments(user:LocalUser|null,startValue:unknown,endValue:unknown,shopValue:unknown=''):Repayment[] {
    const actor=this.finance(user);
    const start=string(startValue,10),end=string(endValue,10);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end)||start>end)throw new Error('Invalid date range.');
    const shopId=string(shopValue,64);
    if(actor.role==='cashier' && shopId!==this.cashierShop(actor).shopId) throw new Error('Choose your assigned shop.');
    return this.db.prepare(`SELECT payload FROM repayments WHERE date BETWEEN ? AND ? ${shopId?'AND shop_id=?':''} ORDER BY date DESC,rowid DESC`).all(...(shopId?[start,end,shopId==='__legacy__'?'':shopId]:[start,end])).map(row=>JSON.parse(String(row.payload)) as Repayment);
  }
  recoverCredit(user:LocalUser|null,input:unknown):{ok:true;repayment:Repayment}|{ok:false;pending:boolean;message:string} {
    let committed=false;
    try {
      const actor=this.authorize(user);

      if(!input||typeof input!=='object')throw new Error('Invalid recovery.');
      const request=input as RepaymentRequest,id=string(request.operationId,64);
      if(!/^[a-f0-9-]{36}$/i.test(id))throw new Error('Invalid recovery ID.');
      const previous=this.db.prepare('SELECT * FROM repayments WHERE id=?').get(id);
      if(previous){
        if(previous.accepted_by!==actor.id||previous.request!==JSON.stringify(request))throw new Error('Recovery ID already used.');
        committed=true;const repayment=JSON.parse(String(previous.payload)) as Repayment;this.recovery(repayment);return {ok:true,repayment};
      }
      this.finance(actor);
      const creditorId=string(request.creditorId,64),date=string(request.date,10),amount=integer(request.amountMinor,1,99999999999);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date||date>businessDate(new Date()))throw new Error('Choose a valid collection date, no later than today.');
      let repayment:Repayment;
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const account=this.creditorAccount(actor,creditorId);
        const shop=this.db.prepare("SELECT id,name FROM development_records WHERE id=? AND kind='shop' AND archived=0").get(string(request.shopId,64));
        if(!shop)throw new Error('Choose an active collection shop.');
        if(actor.role==='cashier' && shop.id!==this.cashierShop(actor).shopId) throw new Error('Collect payments at your assigned shop.');
        if(amount>account.outstanding)throw new Error('Recovery cannot exceed the current outstanding balance.');
        repayment={operationId:id,id,creditorId,date,amountMinor:amount,createdAt:new Date().toISOString(),acceptedBy:actor.id,acceptedByName:actor.displayName,creditor:account.creditor,currency:'QAR',shopId:String(shop.id),shopName:String(shop.name)};
        const payload=JSON.stringify(repayment);
        this.db.prepare('INSERT INTO repayments(id,customer_id,accepted_by,date,amount_minor,request,payload,shop_id) VALUES(?,?,?,?,?,?,?,?)').run(id,creditorId,actor.id,date,amount,JSON.stringify(request),payload,repayment.shopId!);
        this.db.prepare('INSERT INTO repayment_outbox(operation_id,payload) VALUES(?,?)').run(id,payload);
        this.db.exec('COMMIT');committed=true;
      }catch(error){this.db.exec('ROLLBACK');throw error;}
      this.recovery(repayment);return {ok:true,repayment};
    }catch(error){return {ok:false,pending:committed,message:committed?'Recovery payment recorded but backup unconfirmed. Retry the same payment; do not collect it again.':error instanceof Error?error.message:'Unable to save recovery.'};}
  }
  close() { this.db.close(); }
}
