import { discountAmount } from './sales-contract';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { ManagementStore } from './management-store';
import { SalesStore } from './sales-store';
import type { SaleRequest } from './sales-contract';

test('portion choices price Half and Full independently and reject missing or tampered prices',()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'pos-portions-')),file=path.join(directory,'pos.sqlite');
  const management=new ManagementStore(file,true),sales=new SalesStore(file,path.join(directory,'recovery.sqlite'),value=>Buffer.from(value));
  const admin={id:'admin',username:'admin',displayName:'Admin',role:'admin' as const};
  try{
    const base={id:'',kind:'cashier' as const,name:'Portion cashier',phone:'03001234567',passport:'',identity:'',pricePaisa:0,quantity:0,shopId:'main-shop'};
    management.save(admin,base);
    const cashier={...admin,id:management.list(admin,'cashier','')[0].id,role:'cashier' as const};
    management.save(admin,{...base,kind:'menu',name:'Mutton BBQ',pricePaisa:1000,halfPricePaisa:800});
    const item=sales.menu(cashier,'Mutton BBQ')[0];
    assert.equal(item.halfPriceMinor,800);
    assert.throws(()=>management.save(admin,{...base,kind:'menu',name:'Bad portion',pricePaisa:1000,halfPricePaisa:1100}),/Half price/);
    const order:SaleRequest={operationId:randomUUID(),customerType:'walk-in',creditorId:null,receivedMinor:1800,lines:[{itemId:item.id,quantity:1,unitPrice:800,portion:'half'},{itemId:item.id,quantity:1,unitPrice:1000,portion:'full'}]};
    const result=sales.save(cashier,order);
    assert.ok(result.ok);
    assert.equal(result.sale.total,1800);
    assert.deepEqual(result.sale.lines.map(line=>line.name),['Mutton BBQ (Half)','Mutton BBQ (Full)']);
    assert.deepEqual(sales.save(cashier,order),JSON.parse(JSON.stringify(result)));
    const missing=sales.save(cashier,{...order,operationId:randomUUID(),lines:[{itemId:item.id,quantity:1,unitPrice:1000}]});
    assert.ok(!missing.ok);assert.match(missing.message,/Choose Half or Full/);
    const tampered=sales.save(cashier,{...order,operationId:randomUUID(),lines:[{itemId:item.id,quantity:1,unitPrice:1000,portion:'half'}]});
    assert.ok(!tampered.ok);assert.match(tampered.message,/price changed/);
  }finally{sales.close();management.close();rmSync(directory,{recursive:true,force:true});}
});

test('expense and recovery shop filters preserve attribution, permissions and retry safety',()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'pos-shop-ledgers-')),file=path.join(dir,'pos.sqlite');
  const management=new ManagementStore(file,true),sales=new SalesStore(file,path.join(dir,'recovery.sqlite'),value=>Buffer.from(value));
  const base={id:'',kind:'shop' as const,name:'Branch',phone:'',passport:'',identity:'',pricePaisa:0,quantity:0,shopId:'main-shop',manageCreditsExpenses:true};
  const admin={id:'admin',username:'admin',displayName:'Admin',role:'admin' as const};
  try {
    management.save('admin',base);const branch=management.list('admin','shop','Branch')[0];
    management.save('admin',{...base,kind:'cashier',name:'Cashier',phone:'03001234567',shopId:branch.id});
    const profile=management.list('admin','cashier','')[0],cashier={...admin,id:profile.id,role:'cashier' as const};
    const expense={operationId:randomUUID(),date:'2026-01-01',category:'Supplies',description:'Paper',paidVia:'cash',amountMinor:100,shopId:'main-shop'};
    assert.ok(sales.saveExpense(cashier,expense).ok);
    management.save('admin',{...profile,shopId:'main-shop'});
    assert.ok(sales.saveExpense(cashier,expense).ok);
    assert.ok(sales.saveExpense(cashier,{...expense,operationId:randomUUID(),amountMinor:200}).ok);
    assert.equal(sales.expenses(admin,expense.date,expense.date,branch.id)[0].amountMinor,100);
    assert.equal(sales.expenses(admin,expense.date,expense.date,'main-shop')[0].amountMinor,200);
    assert.equal(sales.expenses(admin,expense.date,expense.date,'missing').length,0);
    assert.throws(()=>sales.expenses(cashier,expense.date,expense.date,branch.id));
    assert.throws(()=>sales.expenses(admin,expense.date,expense.date,42));
    assert.throws(()=>management.remove('admin','shop',branch.id),/reporting/);
    management.save('admin',{...base,kind:'menu',name:'Meal',pricePaisa:1000});
    management.save('admin',{...base,kind:'creditor',name:'Customer',phone:'03001234567'});
    const item=management.list('admin','menu','')[0],customer=management.list('admin','creditor','')[0];
    assert.ok(sales.save(cashier,{operationId:randomUUID(),customerType:'creditor',creditorId:customer.id,lines:[{itemId:item.id,unitPrice:1000,quantity:1}],receivedMinor:0}).ok);
    const payment={operationId:randomUUID(),creditorId:customer.id,date:expense.date,amountMinor:100,shopId:branch.id};
    assert.equal(sales.recoverCredit(admin,{...payment,shopId:undefined}).ok,false);
    assert.equal(sales.recoverCredit(admin,{...payment,shopId:'missing'}).ok,false);
    assert.ok(sales.recoverCredit(admin,payment).ok);assert.ok(sales.recoverCredit(admin,payment).ok);
    assert.equal(sales.recoverCredit(admin,{...payment,shopId:'main-shop'}).ok,false);
    assert.ok(sales.recoverCredit(admin,{...payment,operationId:randomUUID(),shopId:'main-shop',amountMinor:200}).ok);
    assert.equal(sales.repayments(admin,expense.date,expense.date,branch.id)[0].amountMinor,100);
    assert.equal(sales.repayments(admin,expense.date,expense.date,'main-shop')[0].amountMinor,200);
    assert.equal(sales.repayments(admin,expense.date,expense.date,'missing').length,0);
    assert.throws(()=>sales.repayments(cashier,expense.date,expense.date,branch.id));
    assert.equal(sales.repayments(cashier,expense.date,expense.date,'main-shop')[0].amountMinor,200);
    assert.throws(()=>sales.repayments(cashier,expense.date,expense.date,''));
    const filter={start:'2000-01-01',end:'2099-12-31',type:'all' as const,shopId:'main-shop'};
    assert.equal(sales.history(cashier,filter).length,1);
    assert.throws(()=>sales.history(cashier,{...filter,shopId:branch.id}));
    assert.throws(()=>sales.history(cashier,{...filter,shopId:''}));
    management.save('admin',{...profile,shopId:'main-shop',manageCreditsExpenses:false});
    assert.throws(()=>sales.history(cashier,filter));
    assert.throws(()=>sales.repayments(cashier,expense.date,expense.date,'main-shop'));

    assert.throws(()=>sales.repayments(admin,expense.date,expense.date,42));
    assert.equal(sales.creditorAccount(admin,customer.id).outstanding,700);
    assert.equal(sales.saveExpense(admin,{...expense,operationId:randomUUID(),shopId:'missing'}).ok,false);
    const adminExpense=sales.saveExpense(admin,{...expense,operationId:randomUUID(),shopId:branch.id});
    assert.ok(adminExpense.ok);
    if(adminExpense.ok){assert.equal(adminExpense.expense.shopId,branch.id);assert.equal(adminExpense.expense.cashierId,admin.id);}

    const db=new DatabaseSync(file);
    try {
      db.exec("UPDATE expenses SET shop_id=''; UPDATE repayments SET shop_id=''");
      assert.equal(sales.expenses(admin,expense.date,expense.date,'__legacy__').length,3);
      assert.equal(sales.repayments(admin,expense.date,expense.date,'__legacy__').length,2);
    }finally{db.close();}
  }finally{sales.close();management.close();rmSync(dir,{recursive:true,force:true});}
});

test('shops validate assignments and preserve sale attribution across transfers, renames and retries',()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'pos-shops-')),file=path.join(dir,'pos.sqlite');
  const management=new ManagementStore(file,true);
  let sales=new SalesStore(file,path.join(dir,'recovery.sqlite'),value=>Buffer.from(value));
  const base={id:'',kind:'shop' as const,name:'North shop',phone:'',passport:'',identity:'',pricePaisa:0,quantity:0,shopId:'main-shop',manageCreditsExpenses:true};
  const admin={id:'admin',username:'admin',displayName:'Admin',role:'admin' as const};
  const filter={start:'2000-01-01',end:'2099-12-31',type:'all' as const};
  try {
    assert.throws(()=>management.save('cashier',base));
    management.save('admin',base);
    const north=management.list('admin','shop','North')[0];
    const profile={...base,kind:'cashier' as const,name:'Assigned cashier',phone:'03001234567',shopId:north.id};
    assert.throws(()=>management.save('admin',{...profile,shopId:undefined}));
    assert.throws(()=>management.save('admin',{...profile,shopId:'missing'}));
    management.save('admin',profile);
    const cashier=management.list('admin','cashier','')[0];
    const actor={...admin,id:cashier.id,role:'cashier' as const};
    assert.throws(()=>management.remove('admin','shop',north.id),/cashiers/);
    management.save('admin',{...base,kind:'menu',name:'Meal',pricePaisa:1000});
    const item=management.list('admin','menu','')[0];
    management.save('admin',{...item,shopId:north.id});
    const order={operationId:randomUUID(),customerType:'walk-in' as const,creditorId:null,
      lines:[{itemId:item.id,unitPrice:1000,quantity:1}],receivedMinor:1000,shopId:'main-shop'};
    const first=sales.save(actor,order);assert.ok(first.ok);
    assert.equal(first.sale.shopId,north.id);assert.equal(first.sale.shopName,'North shop');
    management.save('admin',{...cashier,shopId:'main-shop'});
    management.save('admin',{...north,name:'North renamed'});
    const retry=sales.save(actor,order);assert.ok(retry.ok);
    assert.equal(retry.sale.shopId,north.id);assert.equal(retry.sale.shopName,'North shop');
    management.save('admin',{...item,shopId:'main-shop'});
    const second=sales.save(actor,{...order,operationId:randomUUID()});assert.ok(second.ok);
    assert.equal(second.sale.shopId,'main-shop');
    assert.equal(sales.history(admin,{...filter,shopId:north.id}).length,1);
    assert.equal(sales.history(admin,{...filter,shopId:'main-shop'})[0].id,second.sale.id);
    assert.equal(sales.history(admin,{...filter,shopId:north.id,type:'creditor'}).length,0);
    assert.equal(sales.history(admin,{...filter,shopId:north.id,type:'cash'})[0].total,1000);
    assert.equal(sales.history(admin,{...filter,shopId:'missing'}).length,0);
    assert.equal(sales.history(admin,filter).length,2);
    assert.throws(()=>sales.history(actor,{...filter,shopId:north.id}));
    assert.throws(()=>sales.history(admin,{...filter,shopId:42}));
    assert.throws(()=>management.remove('admin','shop',north.id),/reporting/);
    management.save('admin',{...base,name:'Unused shop'});
    const unused=management.list('admin','shop','Unused')[0];
    management.remove('admin','shop',unused.id);
    assert.throws(()=>management.save('admin',{...cashier,shopId:unused.id}));
    sales.close();sales=new SalesStore(file,path.join(dir,'recovery.sqlite'),value=>Buffer.from(value));
    assert.equal(sales.history(admin,{...filter,shopId:north.id})[0].shopName,'North shop');
    const db=new DatabaseSync(file),backup=new DatabaseSync(path.join(dir,'recovery.sqlite'));
    try {
      assert.equal(JSON.parse(String(db.prepare('SELECT payload FROM sale_outbox WHERE operation_id=?').get(first.sale.id)!.payload)).shopId,north.id);
      assert.equal(JSON.parse(Buffer.from(backup.prepare('SELECT payload FROM pending_sales WHERE operation_id=?').get(first.sale.id)!.payload as Uint8Array).toString()).shopId,north.id);
    }finally{backup.close();db.close();}
  } finally {sales.close();management.close();rmSync(dir,{recursive:true,force:true});}
});

test('shop migration preserves legacy sale details and assigns existing cashiers to Main shop',()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'pos-shop-migration-')),file=path.join(dir,'pos.sqlite');
  let management=new ManagementStore(file,true);
  let sales=new SalesStore(file,path.join(dir,'recovery.sqlite'),value=>Buffer.from(value));
  management.close();sales.close();
  const db=new DatabaseSync(file);
  const payload=JSON.stringify({id:'old-sale',total:500,cashierId:'old-cashier'});
  try {
    db.exec("DELETE FROM development_records; ALTER TABLE development_records DROP COLUMN shop_id; DROP INDEX sales_shop_date; ALTER TABLE sales DROP COLUMN shop_id;");
    db.exec("INSERT INTO development_records(id,kind,name,phone,passport,identity,pricePaisa,quantity) VALUES('old-cashier','cashier','Existing cashier','03001234567','','',0,0)");
    db.prepare("INSERT INTO sales(id,cashier_id,business_date,customer_type,request,payload) VALUES('old-sale','old-cashier','2026-01-01','walk-in','{}',?)").run(payload);
  }finally{db.close();}
  management=new ManagementStore(file,true);sales=new SalesStore(file,path.join(dir,'recovery.sqlite'),value=>Buffer.from(value));
  try {
    assert.equal(management.list('admin','cashier','')[0].shopId,'main-shop');
    const admin={id:'admin',username:'admin',displayName:'Admin',role:'admin' as const};
    const filter={start:'2026-01-01',end:'2026-01-01',type:'all' as const};
    assert.deepEqual(sales.history(admin,{...filter,shopId:'__legacy__'})[0],{...JSON.parse(payload),invoiceNumber:1001});
    assert.equal(sales.history(admin,{...filter,shopId:'main-shop'}).length,0);
    assert.equal(sales.history(admin,filter).length,1);
  } finally {sales.close();management.close();rmSync(dir,{recursive:true,force:true});}
});

test('creditor recoveries reduce only the customer balance, reject overpayment and survive retry',()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'pos-repayments-')),file=path.join(dir,'pos.sqlite'),backup=path.join(dir,'backup.sqlite');
  const management=new ManagementStore(file,true);
  const base={id:'',kind:'menu' as const,name:'Meal',phone:'',passport:'',identity:'',pricePaisa:10000,quantity:10,shopId:'main-shop',manageCreditsExpenses:true};
  management.save('admin',base);management.save('admin',{...base,kind:'creditor',name:'Customer',phone:'03001234567',pricePaisa:0});
  const item=management.list('admin','menu','')[0],customer=management.list('admin','creditor','')[0];
  management.save('admin',{...base,kind:'cashier',name:'Cashier',phone:'03001234567',pricePaisa:0,shopId:'main-shop'});
  const admin={id:'admin',username:'admin',displayName:'Administrator',role:'admin' as const},cashier={...admin,id:management.list('admin','cashier','')[0].id,role:'cashier' as const};
  let fail=false;
  let store=new SalesStore(file,backup,payload=>{if(fail)throw new Error('Recovery disk unavailable');return Buffer.from(payload);});
  try{
    const sale={operationId:randomUUID(),customerType:'creditor' as const,creditorId:customer.id,lines:[{itemId:item.id,unitPrice:10000,quantity:2}],receivedMinor:5000};
    assert.ok(store.save(cashier,sale).ok);
    assert.equal(store.creditorAccount(admin,customer.id).credit,15000);
    assert.throws(()=>management.remove('admin','creditor',customer.id),/outstanding/);
    const profile=management.list('admin','cashier','')[0];
    management.save('admin',{...profile,manageCreditsExpenses:false});
    assert.throws(()=>store.creditorAccount(cashier,customer.id));
    const request={operationId:randomUUID(),creditorId:customer.id,date:'2026-01-01',amountMinor:5000,shopId:'main-shop'};
    assert.equal(store.recoverCredit(cashier,request).ok,false);
    management.save('admin',{...profile,manageCreditsExpenses:true});
    for(const bad of [{...request,amountMinor:0},{...request,amountMinor:1.5},{...request,amountMinor:15001},{...request,creditorId:'missing'},{...request,date:'2026-02-30'}])assert.equal(store.recoverCredit(admin,bad).ok,false);
    fail=true;
    const pending=store.recoverCredit(admin,request);assert.equal(pending.ok,false);if(!pending.ok)assert.equal(pending.pending,true);
    assert.equal(store.creditorAccount(admin,customer.id).outstanding,10000);
    store.close();store=new SalesStore(file,backup,payload=>Buffer.from(payload));
    assert.ok(store.recoverCredit(admin,request).ok);assert.ok(store.recoverCredit(admin,request).ok);
    assert.equal(store.recoverCredit(admin,{...request,amountMinor:100}).ok,false);
    const account=store.creditorAccount(admin,customer.id);
    assert.equal(account.recovered,5000);assert.equal(account.sales[0].id,sale.operationId);assert.equal(account.repayments[0].acceptedBy,admin.id);
    assert.equal(account.sales[0].total,20000);assert.equal(account.sales[0].cashApplied,5000);
    assert.ok(store.recoverCredit(admin,{...request,operationId:randomUUID(),amountMinor:10000}).ok);
    assert.equal(store.creditorAccount(admin,customer.id).outstanding,0);
    assert.equal(store.repayments(admin,'2026-01-01','2026-01-01').length,2);
    assert.equal(store.repayments(admin,'2026-01-02','2026-01-02').length,0);
    assert.throws(()=>store.repayments(cashier,'2026-01-01','2026-01-01'));
    assert.equal(store.recoverCredit(admin,{...request,operationId:randomUUID(),amountMinor:1}).ok,false);
    management.remove('admin','creditor',customer.id);
    assert.equal(store.repayments(admin,'2026-01-01','2026-01-01').length,2);
    assert.equal(store.creditorAccount(admin,customer.id).sales.length,1);
    const db=new DatabaseSync(file),recovery=new DatabaseSync(backup);
    try{assert.equal(db.prepare('SELECT count(*) n FROM repayment_outbox').get()!.n,2);assert.equal(recovery.prepare('SELECT count(*) n FROM pending_repayments').get()!.n,2);}finally{db.close();recovery.close();}
  }finally{store.close();management.close();rmSync(dir,{recursive:true,force:true});}
});

test('expenses validate fields, preserve cashier and date, recover failed saves and reject duplicates',()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'pos-expenses-'));
  const file=path.join(dir,'pos.sqlite'),backup=path.join(dir,'backup.sqlite');
  const management=new ManagementStore(file,true);
  let fail=false;
  let store=new SalesStore(file,backup,payload=>{if(fail)throw new Error('Disk failed');return Buffer.from(payload);});
  management.save('admin',{id:'',kind:'cashier',name:'Cashier',phone:'03001234567',passport:'',identity:'',pricePaisa:0,quantity:0,shopId:'main-shop',manageCreditsExpenses:true});
  const cashier={id:management.list('admin','cashier','')[0].id,username:'cashier',displayName:'Cashier',role:'cashier' as const};
  const admin={...cashier,role:'admin' as const};
  const request={operationId:randomUUID(),date:'2026-11-06',category:'Supplies',description:'Paper bags',paidVia:'cash' as const,amountMinor:12550};
  try {
    assert.equal(store.saveExpense(null,request).ok,false);
    for(const bad of [{...request,amountMinor:0},{...request,amountMinor:1.5},{...request,date:'2026-02-30'},{...request,category:' '},{...request,description:''},{...request,paidVia:'card'}])assert.equal(store.saveExpense(cashier,bad).ok,false);
    assert.equal(store.expenses(admin,'2026-11-01','2026-11-30').length,0);
    fail=true;
    const pending=store.saveExpense(cashier,request);assert.equal(pending.ok,false);if(!pending.ok)assert.equal(pending.pending,true);
    store.close();store=new SalesStore(file,backup,payload=>Buffer.from(payload));
    const saved=store.saveExpense(cashier,request);assert.ok(saved.ok);assert.equal(saved.expense.cashierId,cashier.id);assert.equal(saved.expense.date,request.date);
    assert.ok(store.saveExpense(cashier,request).ok);
    assert.equal(store.saveExpense(cashier,{...request,amountMinor:9}).ok,false);
    assert.throws(()=>store.expenses(cashier,'2026-11-01','2026-11-30'));
    assert.ok(store.saveExpense(cashier,{...request,operationId:randomUUID(),paidVia:'online'}).ok);
    assert.equal(store.expenses(admin,'2026-11-06','2026-11-06').length,2);
    assert.equal(store.expenses(admin,'2026-11-07','2026-11-07').length,0);
    const db=new DatabaseSync(file),recovery=new DatabaseSync(backup);
    try{assert.equal(db.prepare('SELECT count(*) n FROM expense_outbox').get()!.n,2);assert.equal(recovery.prepare('SELECT count(*) n FROM pending_expenses').get()!.n,2);}finally{db.close();recovery.close();}
  }finally{store.close();management.close();rmSync(dir,{recursive:true,force:true});}
});

test('checkout validates prices, snapshots credit sales, saves recovery and retries exactly once',()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'pos-sales-'));
  const file=path.join(dir,'pos.sqlite'), backup=path.join(dir,'recovery.sqlite');
  const management=new ManagementStore(file,true);
  const profile={id:'',kind:'menu' as const,name:'Burger',phone:'',passport:'',identity:'',pricePaisa:12550,quantity:20,shopId:'main-shop',manageCreditsExpenses:true};
  management.save('admin',profile);
  management.save('admin',{...profile,kind:'creditor',name:'Customer',phone:'03001234567',pricePaisa:0,quantity:0});
  const item=management.list('admin','menu','')[0], creditor=management.list('admin','creditor','')[0];
  management.save('admin',{...profile,kind:'cashier',name:'Cashier',phone:'03001234567',pricePaisa:0,shopId:'main-shop'});
  const cashier={id:management.list('admin','cashier','')[0].id,username:'cashier',displayName:'Cashier',role:'cashier' as const};
  const admin={...cashier,id:'admin-1',role:'admin' as const};
  let failBackup=false;
  let store=new SalesStore(file,backup,payload=>{if(failBackup)throw new Error('Disk unavailable');return Buffer.from(payload);});
  const request=(): SaleRequest=>({operationId:randomUUID(),customerType:'walk-in',creditorId:null,lines:[{itemId:item.id,quantity:2,unitPrice:12550}],receivedMinor:30000});
  const filter={start:'2000-01-01',end:'2099-12-31',type:'all' as const};
  try {
    assert.throws(()=>store.menu(null,''));
    assert.throws(()=>store.history(cashier,filter));
    assert.equal(store.menu(cashier,'burg').length,1);
    store.favourite(cashier,item.id,true);
    assert.equal(store.menu(cashier,'')[0].favourite,true);
    assert.equal(store.menu(admin,'')[0].favourite,false);
    for(const bad of [{...request(),receivedMinor:1},{...request(),lines:[{itemId:item.id,quantity:0,unitPrice:12550}]},{...request(),lines:[{itemId:item.id,quantity:1,unitPrice:1}]},{...request(),receivedMinor:1.5},{...request(),customerType:'creditor',creditorId:'missing'}]) assert.equal(store.save(cashier,bad).ok,false);
    assert.equal(store.history(admin,filter).length,0);
    const cash=request(), result=store.save(cashier,cash);
    assert.ok(result.ok); assert.equal(result.sale.invoiceNumber,1001); assert.equal(result.sale.total,25100); assert.equal(result.sale.change,4900); assert.equal(result.sale.credit,0);
    const same=store.save(cashier,cash);assert.ok(same.ok);assert.equal(same.sale.invoiceNumber,1001);
    assert.equal(store.save(admin,cash).ok,false);
    assert.equal(store.save(cashier,{...cash,receivedMinor:40000}).ok,false);
    const credit={...request(),customerType:'creditor' as const,creditorId:creditor.id,receivedMinor:5000};
    failBackup=true;
    const failed=store.save(cashier,credit); assert.equal(failed.ok,false); if(!failed.ok)assert.equal(failed.pending,true);
    assert.equal(store.history(admin,filter).length,2);
    store.close();store=new SalesStore(file,backup,payload=>Buffer.from(payload));
    assert.ok(store.save(cashier,credit).ok);
    assert.ok(store.save(cashier,credit).ok);
    management.save('admin',{...item,name:'Renamed',pricePaisa:999});
    const saved=store.history(admin,{...filter,type:'creditor'})[0];
    assert.equal(saved.invoiceNumber,1002); assert.equal(saved.credit,20100); assert.equal(saved.lines[0].name,'Burger'); assert.equal(saved.lines[0].unitPrice,12550);
    assert.equal(saved.creditor?.name,'Customer'); assert.equal(saved.cashierId,cashier.id);
    assert.equal(store.history(admin,{...filter,type:'cash'}).length,1);
    assert.equal(store.history(admin,filter).length,2);
    const db=new DatabaseSync(file); const recovery=new DatabaseSync(backup);
    try {
      assert.equal(db.prepare('SELECT count(*) AS n FROM sale_outbox').get()!.n,2);
      assert.equal(db.prepare('SELECT amount_minor FROM customer_credit_entries').get()!.amount_minor,20100);
      assert.equal(recovery.prepare('SELECT count(*) AS n FROM pending_sales').get()!.n,2);
      const recovered=JSON.parse(Buffer.from(recovery.prepare('SELECT payload FROM pending_sales WHERE operation_id=?').get(credit.operationId)!.payload as Uint8Array).toString());
      assert.equal(recovered.id,credit.operationId); assert.equal(recovered.creditor.id,creditor.id);
      assert.equal(db.prepare('SELECT count(*) AS n FROM sales WHERE recovery_ready=0').get()!.n,0);
    } finally {db.close(); recovery.close();}
    const delivery=store.save(cashier,{...request(),customerType:'delivery',lines:[{itemId:item.id,quantity:2,unitPrice:999}],receivedMinor:2000});
    assert.ok(delivery.ok); assert.equal(delivery.sale.invoiceNumber,1003); assert.equal(delivery.sale.change,2); assert.equal(delivery.sale.credit,0);
    const fullCredit=store.save(cashier,{...request(),customerType:'creditor',creditorId:creditor.id,lines:[{itemId:item.id,quantity:1,unitPrice:999}],receivedMinor:0});
    assert.ok(fullCredit.ok); assert.equal(fullCredit.sale.credit,999); assert.equal(fullCredit.sale.cashApplied,0);
    management.remove('admin','menu',item.id);
    assert.equal(store.save(cashier,request()).ok,false);
  } finally {store.close();management.close();rmSync(dir,{recursive:true,force:true});}
});

test('expense reports include recurring installments once, on payment date and within shop filters',()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'pos-recurring-report-')),file=path.join(dir,'pos.sqlite');
  const management=new ManagementStore(file,true),sales=new SalesStore(file,path.join(dir,'recovery.sqlite'),value=>Buffer.from(value));
  const admin={id:'admin',username:'admin',displayName:'Admin',role:'admin' as const};
  try{
    management.save(admin,{id:'',kind:'recurring',name:'Rent',phone:'',passport:'',identity:'',pricePaisa:10000,quantity:0,shopId:'main-shop',expenseType:'Rent',startMonth:'2026-01'});
    const row=management.monthly(admin,'2026-01')[0];
    assert.equal(sales.expenses(admin,'2000-01-01','2099-12-31').length,0);
    management.recordPayment(admin,row.id,'2026-01',3000,'first');
    management.recordPayment(admin,row.id,'2026-01',3000,'first');
    management.recordPayment(admin,row.id,'2026-01',2000,'second');
    const report=sales.expenses(admin,'2000-01-01','2099-12-31','main-shop');
    assert.equal(report.length,2);assert.equal(report.reduce((sum,r)=>sum+r.amountMinor,0),5000);
    assert.equal(report[0].category,'Rent');assert.equal(report[0].cashierName,'Admin');
    assert.equal(report[0].paidVia,'Not recorded');
    assert.equal(sales.expenses(admin,report[0].date,report[0].date,'main-shop').length,2);
    assert.equal(sales.expenses(admin,'2000-01-01','2000-01-01').length,0);
    assert.equal(sales.expenses(admin,'2000-01-01','2099-12-31','other-shop').length,0);
  }finally{sales.close();management.close();rmSync(dir,{recursive:true,force:true});}
});

test('all-shops menu items can be sold by cashiers in different shops',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'pos-shared-menu-')),file=path.join(dir,'pos.sqlite');
 const management=new ManagementStore(file,true),sales=new SalesStore(file,path.join(dir,'recovery.sqlite'),v=>Buffer.from(v));
 const base={id:'',kind:'shop' as const,name:'Branch',phone:'',passport:'',identity:'',pricePaisa:0,quantity:0,shopId:'main-shop'};
 try{
  management.save('admin',base);const branch=management.list('admin','shop','Branch')[0];
  management.save('admin',{...base,kind:'menu',name:'Aloo Keema',pricePaisa:1000,shopId:'__all__'});
  const item=management.list('admin','menu','Aloo')[0];
  management.save('admin',{...base,kind:'floor',name:'Ground Floor',tables:[1,2]});
  const floor=management.list('admin','floor','')[0];
  for(const shopId of ['main-shop',branch.id]){
   management.save('admin',{...base,kind:'cashier',name:shopId,phone:'03001234567',shopId});
   const profile=management.list('admin','cashier','').find(r=>r.name===shopId)!;
   const actor={id:profile.id,username:shopId,displayName:shopId,role:'cashier' as const};
   assert.ok(sales.menu(actor,'Aloo').some(r=>r.id===item.id));
   const result=sales.save(actor,{operationId:randomUUID(),customerType:'walk-in',creditorId:null,lines:[{itemId:item.id,unitPrice:1000,quantity:1}],receivedMinor:1000});
   assert.ok(result.ok);if(result.ok)assert.equal(result.sale.shopId,shopId);
   const discounted=sales.save(actor,{operationId:randomUUID(),customerType:'walk-in',creditorId:null,lines:[{itemId:item.id,unitPrice:1000,quantity:1}],receivedMinor:1000,discount:{type:'percent',value:1250}});
   assert.ok(discounted.ok);if(discounted.ok){assert.equal(discounted.sale.total,875);assert.equal(discounted.sale.discountMinor,125);assert.equal(discounted.sale.change,125);assert.equal(discounted.sale.cashApplied,875);}

   const request={operationId:randomUUID(),customerType:'walk-in' as const,creditorId:null,lines:[{itemId:item.id,unitPrice:1000,quantity:1}],receivedMinor:1000,table:{floorId:floor.id,number:1}};
   assert.equal(sales.save(actor,{...request,table:{floorId:floor.id,number:99}}).ok,false);
   const seated=sales.save(actor,request);assert.ok(seated.ok);
   if(seated.ok){assert.equal(seated.sale.table?.number,1);assert.equal(seated.sale.table?.floorId,floor.id);}
   management.save('admin',{...floor,name:'Renamed Floor'});
   const retry=sales.save(actor,request);assert.ok(retry.ok);
   if(retry.ok&&seated.ok)assert.deepEqual(retry.sale.table,seated.sale.table);

  }
  assert.throws(()=>management.save('admin',{...base,kind:'employee',shopId:'__all__',pricePaisa:1000,employeeCategory:'Driver',startMonth:'2026-11'}));
 }finally{sales.close();management.close();rmSync(dir,{recursive:true,force:true});}
});

test('discounts use integer minor units, round percentages and reject invalid values',()=>{
 assert.equal(discountAmount(999,{type:'percent',value:1250}),125);
 assert.equal(discountAmount(1000,{type:'cash',value:200}),200);
 assert.equal(discountAmount(1000,{type:'percent',value:10000}),1000);
 assert.equal(discountAmount(1000),0);
 for(const discount of [{type:'cash' as const,value:1001},{type:'percent' as const,value:10001},{type:'cash' as const,value:-1},{type:'cash' as const,value:0.5}])assert.throws(()=>discountAmount(1000,discount));
});
