import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ManagementStore } from './management-store';
import { restaurantMenu } from './restaurant-menu';
import { DatabaseSync } from 'node:sqlite';
import { managementErrorMessage } from './management-contract';

test('recurring expenses use registered employee IDs and share the employee salary', () => {
  const dir=mkdtempSync(path.join(tmpdir(),'pos-employee-picker-')),file=path.join(dir,'test.sqlite');
  let store=new ManagementStore(file,true);
  const admin={id:'admin',username:'admin',displayName:'Admin',role:'admin' as const};
  const base={id:'',name:'Ali',phone:'',passport:'',identity:'',quantity:0,pricePaisa:100000,shopId:'main-shop',employeeCategory:'Driver',startMonth:'2026-11'};
  try {
    store.save(admin,{...base,kind:'employee'});
    store.save(admin,{...base,kind:'employee',employeeCategory:'Waiter'});
    const [employee,other]=store.list(admin,'employee','');
    const salary={...base,kind:'recurring' as const,name:'Salary',expenseType:'Salary',employeeId:employee.id,employee:'Typo',pricePaisa:125000};
    assert.throws(()=>store.save(admin,{...salary,employeeId:''}),/registered employee/);
    assert.throws(()=>store.save(admin,{...salary,employeeId:'missing'}),/registered employee/);
    assert.throws(()=>store.save(admin,{...salary,shopId:'missing'}),/active shop/);
    store.save(admin,{...base,kind:'shop',name:'Other shop'});
    const shop=store.list(admin,'shop','Other shop')[0];
    assert.throws(()=>store.save(admin,{...salary,shopId:shop.id}),/assigned to this shop/);
    store.save(admin,salary);
    assert.equal(store.list(admin,'employee','').find(row=>row.id===employee.id)!.pricePaisa,125000);
    assert.equal(store.list(admin,'recurring','').length,2);
    assert.equal(store.list(admin,'recurring','').find(row=>row.employeeId===employee.id)!.employee,'Ali');
    let month=store.monthly(admin,'2026-11');
    assert.equal(month.length,2);assert.notEqual(month[0].employeeId,month[1].employeeId);
    store.recordPayment(admin,employee.id,'2026-11',25000,'first');
    store.save(admin,{...salary,id:employee.id,pricePaisa:150000});
    month=store.monthly(admin,'2026-11');
    assert.equal(month.length,2);
    assert.equal(month.find(row=>row.id===employee.id)!.pricePaisa,125000);
    assert.equal(month.find(row=>row.id===employee.id)!.paidMinor,25000);
    store.save(admin,{...employee,name:'Ali Renamed',pricePaisa:150000});
    const allowance={...salary,name:'Transport allowance',expenseType:'Transport',pricePaisa:5000};
    store.save(admin,allowance);
    const linked=store.list(admin,'recurring','Transport')[0];
    assert.equal(linked.employee,'Ali Renamed');assert.equal(linked.employeeId,employee.id);
    assert.equal(store.monthly(admin,'2026-12').find(row=>row.id===employee.id)!.pricePaisa,150000);
    assert.throws(()=>store.remove(admin,'recurring',employee.id),/Manage Employees/);
    store.close();store=new ManagementStore(file,true);
    assert.equal(store.list(admin,'recurring','Transport')[0].employeeId,employee.id);
    store.remove(admin,'employee',other.id);
    assert.throws(()=>store.save(admin,{...allowance,employeeId:other.id}),/active registered employee/);
    assert.throws(()=>store.save({...admin,role:'cashier'},salary),/Administrator/);
  } finally {store.close();rmSync(dir,{recursive:true,force:true});}
});

test('linking a legacy salary retains its history and retires its old recurring entry', () => {
  const dir=mkdtempSync(path.join(tmpdir(),'pos-salary-link-')),file=path.join(dir,'test.sqlite');
  const store=new ManagementStore(file,true),db=new DatabaseSync(file);
  try {
    db.exec("INSERT INTO development_records(id,kind,name,phone,passport,identity,pricePaisa,quantity,expense_type,employee,start_month) VALUES('legacy','recurring','Old salary','','','',10000,0,'Salary','Misspelled name','2026-10')");
    const old=store.monthly('admin','2026-10')[0];
    store.monthly('admin','2026-11');
    store.save('admin',{id:'',kind:'employee',name:'Correct name',phone:'',passport:'',identity:'',pricePaisa:20000,quantity:0,employeeCategory:'Driver',shopId:'main-shop',startMonth:'2026-11'});
    const employee=store.list('admin','employee','')[0];
    store.save('admin',{...old,employeeId:employee.id,startMonth:'2026-11',pricePaisa:20000});
    assert.equal(store.list('admin','recurring','').length,1);
    assert.equal(store.monthly('admin','2026-10').find(row=>row.id==='legacy')!.employee,'Misspelled name');
    assert.equal(store.monthly('admin','2026-11').length,1);
    assert.equal(store.monthly('admin','2026-11')[0].employeeId,employee.id);
    assert.equal(store.monthly('admin','2026-11')[0].id,'legacy');
    assert.equal(store.monthly('admin','2026-11')[0].pricePaisa,10000);
    assert.equal(store.monthly('admin','2026-12')[0].id,employee.id);
    db.exec("INSERT INTO development_records(id,kind,name,phone,passport,identity,pricePaisa,quantity,expense_type,employee,start_month) VALUES('duplicate','recurring','Duplicate salary','','','',10000,0,'Salary','Old name','2026-12')");
    const duplicate=store.monthly('admin','2026-12').find(row=>row.id==='duplicate')!;
    assert.throws(()=>store.save('admin',{...duplicate,employeeId:employee.id}),/another salary record/);
    assert.ok(store.list('admin','recurring','').some(row=>row.id==='duplicate'),'failed linking must roll back archival');
  } finally {db.close();store.close();rmSync(dir,{recursive:true,force:true});}
});

test('employees have no login and salaries preserve monthly amounts and payments', () => {
  const dir=mkdtempSync(path.join(tmpdir(),'pos-employees-')),file=path.join(dir,'test.sqlite');
  let store=new ManagementStore(file,true);
  const admin={id:'admin',username:'admin',displayName:'Admin',role:'admin' as const};
  const employee={id:'',kind:'employee' as const,name:'Ali',phone:'',passport:'AB123',identity:'ID123',pricePaisa:125000,quantity:0,shopId:'main-shop',employeeCategory:'Driver',startMonth:'2026-11'};
  try {
    assert.throws(()=>store.save({...admin,role:'cashier'},employee),/Administrator/);
    for(const invalid of [{pricePaisa:0},{pricePaisa:1.5},{employeeCategory:''},{employeeCategory:'Unknown'},{startMonth:'2026-13'},{shopId:'missing'},{phone:'bad'}]) assert.throws(()=>store.save(admin,{...employee,...invalid}));
    store.save(admin,{...employee,username:'should-not-exist',password:'ignored'});
    const row=store.list(admin,'employee','')[0];
    assert.equal(row.username,'');
    assert.equal(row.passport,'AB123');
    assert.equal(row.employeeCategory,'Driver');
    assert.equal(store.list(admin,'cashier','').length,0);
    assert.equal(store.monthly(admin,'2026-10').length,0);
    let salary=store.monthly(admin,'2026-11')[0];
    assert.equal(salary.id,row.id);assert.equal(salary.expenseType,'Salary');assert.equal(salary.employee,'Ali');
    assert.equal(salary.passport,'');assert.equal(salary.identity,'');
    assert.equal(store.monthly(admin,'2026-11').length,1);
    store.recordPayment(admin,row.id,'2026-11',25000,'salary-payment');
    store.save(admin,{...row,name:'Ali Updated',pricePaisa:150000});
    salary=store.monthly(admin,'2026-11')[0];
    assert.equal(salary.pricePaisa,125000);assert.equal(salary.paidMinor,25000);
    assert.equal(store.monthly(admin,'2026-12')[0].pricePaisa,150000);
    assert.throws(()=>store.remove(admin,'shop','main-shop'),/Reassign/);
    store.close();store=new ManagementStore(file,true);
    assert.equal(store.list(admin,'employee','')[0].name,'Ali Updated');
    store.remove(admin,'employee',row.id);
    assert.equal(store.list(admin,'employee','').length,0);
    assert.equal(store.monthly(admin,'2027-01').length,0);
    assert.equal(store.monthly(admin,'2026-11')[0].payments.length,1);
    store.recordPayment(admin,row.id,'2026-11',100000,'salary-final');
    assert.equal(store.monthly(admin,'2026-11')[0].paid,true);
  } finally {store.close();rmSync(dir,{recursive:true,force:true});}
});

test('categories persist, reject duplicates and restrict employee categories to admins', () => {
  const dir=mkdtempSync(path.join(tmpdir(),'pos-categories-')),file=path.join(dir,'test.sqlite');
  let store=new ManagementStore(file,true);
  const cashier={id:'cashier',username:'cashier',displayName:'Cashier',role:'cashier' as const};
  const category={id:'',kind:'expense-category' as const,name:'Equipment',phone:'',passport:'',identity:'',pricePaisa:0,quantity:0};
  try {
    assert.deepEqual(store.list('admin','employee-category','').map(row=>row.name),['Driver','Kitchen Staff','Waiter']);
    store.save(cashier,category);
    assert.throws(()=>store.save(cashier,{...category,name:' equipment '}),/already exists/);
    assert.throws(()=>store.save(cashier,{...category,name:' '}));
    assert.throws(()=>store.save(cashier,{...category,name:'x'.repeat(81)}));
    assert.throws(()=>store.save(cashier,{...category,kind:'employee-category'}),/Administrator/);
    assert.throws(()=>store.list(cashier,'employee',''),/Administrator/);
    store.save('admin',{...category,kind:'employee-category',name:'Cleaner'});
    store.close();store=new ManagementStore(file,true);
    assert.equal(store.list(cashier,'expense-category','Equipment').length,1);
    assert.equal(store.list('admin','employee-category','Cleaner').length,1);
  } finally {store.close();rmSync(dir,{recursive:true,force:true});}
});

test('management errors explain validation without exposing database or IPC details', () => {
  assert.equal(managementErrorMessage(new Error("Error invoking remote method 'management:save': Error: Choose an active shop.")), 'Choose an active shop.');
  assert.equal(managementErrorMessage(new Error('UNIQUE constraint failed: local_users.username')), 'This username is already in use. Choose another username.');
  assert.match(managementErrorMessage(new Error('SQLITE_BUSY: database is locked')), /Please try again/);
  assert.match(managementErrorMessage(null), /Please try again/);
});

test('restaurant menu imports exact prices, archives dummy items and preserves later edits',()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'pos-menu-')),file=path.join(dir,'test.sqlite');
  const store=new ManagementStore(file,true);
  const db=new DatabaseSync(file);
  try{
    db.prepare("INSERT INTO development_records(id,kind,name,phone,passport,identity,pricePaisa,quantity) VALUES('sample-menu-1','menu','Chicken Burger','','','',45000,25)").run();
    store.installRestaurantMenu();store.installRestaurantMenu();
    const rows=store.list('admin','menu','');
    assert.equal(rows.length,57);assert.equal(restaurantMenu.length,57);
    for(const [name,price] of restaurantMenu){const row=rows.find(r=>r.name===name);assert.ok(row);assert.equal(row.pricePaisa,price);assert.equal(row.quantity,0);}
    assert.equal(db.prepare("SELECT archived FROM development_records WHERE id='sample-menu-1'").get()!.archived,1);
    assert.equal(store.list('admin','menu','karahi').length,5);
    store.save('admin',{...rows[0],pricePaisa:333,quantity:12});
    store.remove('admin','menu',rows[1].id);store.installRestaurantMenu();
    assert.equal(store.list('admin','menu','').find(r=>r.id===rows[0].id)!.pricePaisa,333);
    assert.equal(store.list('admin','menu','').some(r=>r.id===rows[1].id),false);
  }finally{db.close();store.close();rmSync(dir,{recursive:true,force:true});}
});

test('local administration validates access, persists records and maintains FTS5', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pos-management-'));
  const file = path.join(dir, 'test.sqlite');
  let store = new ManagementStore(file, true);
  const item = { id: '', kind: 'menu' as const, name: 'Chicken Burger', phone: '', passport: '', identity: '', pricePaisa: 12550, quantity: 8, shopId: 'main-shop' };
  try {
    assert.throws(() => store.save('cashier', item));
    assert.throws(() => store.list(undefined, 'menu', ''));
    assert.throws(() => store.save('admin', { ...item, pricePaisa: 1.1 }));
    assert.throws(() => store.save('admin', { ...item, quantity: -1 }));
    store.save('admin', item);
    let rows = store.list('admin', 'menu', 'chick burg');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].pricePaisa, 12550);
    assert.deepEqual(store.list('admin', 'menu', '" OR *'), []);
    store.save('admin', { ...rows[0], name: 'Beef Sandwich', quantity: 0 });
    assert.equal(store.list('admin', 'menu', 'chick').length, 0);
    assert.equal(store.list('admin', 'menu', 'sand').length, 1);
    for (const kind of ['cashier', 'creditor'] as const) {
      store.save('admin', { ...item, kind, name: 'Ali', phone: '+92 300 1234567', passport: 'AB123', identity: 'ID-42', pricePaisa: 0, quantity: 0, shopId: 'main-shop' });
      assert.equal(store.list('admin', kind, '1234567').length, 1);
      const person = store.list('admin', kind, 'id-42')[0];
      store.save('admin', { ...person, name: 'Updated Ali' });
      assert.equal(store.list('admin', kind, 'Updated')[0].passport, 'AB123');
      store.remove('admin', kind, person.id);
      assert.equal(store.list('admin', kind, '').length, 0);
    }
    store.close(); store = new ManagementStore(file, true);
    rows = store.list('admin', 'menu', 'beef');
    assert.equal(rows[0].quantity, 0);
    store.remove('admin', 'menu', rows[0].id);
    assert.equal(store.list('admin', 'menu', 'beef').length, 0);
    assert.throws(() => store.save('admin', rows[0]));
    store.close(); store = new ManagementStore(file, false);
    assert.throws(() => store.save('admin', item));
    assert.throws(() => store.list('admin', 'menu', ''));
    assert.throws(() => store.remove('admin', 'menu', rows[0].id));
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});


test('recurring payments retain installments, reject overpayment, and isolate months', () => {
  const dir=mkdtempSync(path.join(tmpdir(),'pos-recurring-')),file=path.join(dir,'test.sqlite');
  let store=new ManagementStore(file,true);
  const admin={id:'admin',username:'admin',displayName:'Admin',role:'admin' as const};
  try {
    store.save(admin,{id:'',kind:'recurring',name:'Rent',phone:'',passport:'',identity:'',quantity:0,pricePaisa:10000,shopId:'main-shop',expenseType:'Rent',startMonth:'2026-11'});
    const row=store.monthly(admin,'2026-11')[0];
    assert.equal(row.paidMinor,0);
    assert.equal(store.monthly(admin,'2026-11').length,1);
    assert.throws(()=>store.recordPayment({...admin,role:'cashier'},row.id,row.month,3000,'one'),/Administrator/);
    for(const amount of [0,-1,1.5,NaN,10001]) assert.throws(()=>store.recordPayment(admin,row.id,row.month,amount,'invalid'));
    store.recordPayment(admin,row.id,row.month,3000,'one');
    store.recordPayment(admin,row.id,row.month,3000,'one');
    assert.throws(()=>store.recordPayment(admin,row.id,row.month,4000,'one'),/reference/);
    let result=store.monthly(admin,row.month)[0];
    assert.equal(result.paidMinor,3000);assert.equal(result.paid,false);assert.equal(result.payments.length,1);
    assert.equal(result.payments[0].paidBy,'Admin');
    assert.throws(()=>store.recordPayment(admin,row.id,row.month,7001,'two'),/remaining/);
    assert.throws(()=>store.setPaid(admin,row.id,row.month,false),/cannot be cleared/);
    store.close();store=new ManagementStore(file,true);
    assert.equal(store.monthly(admin,row.month)[0].paidMinor,3000);
    store.recordPayment(admin,row.id,row.month,7000,'two');
    result=store.monthly(admin,row.month)[0];
    assert.equal(result.paid,true);assert.equal(result.paidMinor,10000);assert.equal(result.payments.length,2);
    assert.equal(store.monthly(admin,'2026-12')[0].paidMinor,0);
    store.setPaid(admin,row.id,'2026-12',true);
    assert.equal(store.monthly(admin,'2026-12')[0].paidMinor,10000);
  } finally {store.close();rmSync(dir,{recursive:true,force:true});}
});

test('menu pictures accept 2 MB and reject larger or invalid images',()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'pos-image-limit-'));
  const store=new ManagementStore(path.join(dir,'test.sqlite'),true);
  const record={id:'',kind:'menu' as const,name:'Picture limit',phone:'',passport:'',identity:'',pricePaisa:100,quantity:1,shopId:'main-shop'};
  const image=(size:number)=>{const bytes=Buffer.alloc(size);Buffer.from('89504e470d0a1a0a','hex').copy(bytes);return `data:image/png;base64,${bytes.toString('base64')}`;};
  try {
    store.save('admin',{...record,image:image(2000000)});
    assert.equal(store.list('admin','menu','Picture limit')[0].image,image(2000000));
    assert.throws(()=>store.save('admin',{...record,image:image(2000001)}),/2 MB/);
    assert.throws(()=>store.save('admin',{...record,image:image(2100000)}),/2 MB/);
    const saved=store.list('admin','menu','Picture limit')[0];
    store.save('admin',{...saved,image:image(1500000)});
    assert.equal(store.list('admin','menu','Picture limit')[0].image,image(1500000));
    assert.throws(()=>store.save('admin',{...record,image:'data:image/png;base64,YWJj'}),/Invalid image/);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('floors persist numbered tables and require administrator access',()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'pos-floors-')),file=path.join(dir,'test.sqlite');
  let store=new ManagementStore(file,true);
  const floor={id:'',kind:'floor' as const,name:'Ground Floor',phone:'',passport:'',identity:'',pricePaisa:0,quantity:0,tables:[4,1,2,3]};
  const cashier={id:'cashier',username:'cashier',displayName:'Cashier',role:'cashier' as const};
  try{
    store.save('admin',floor);
    const saved=store.list('admin','floor','')[0];assert.deepEqual(saved.tables,[1,2,3,4]);
    assert.throws(()=>store.save('admin',{...floor,name:'ground floor'}),/already exists/);
    for(const tables of [[1,1],[0],[-1],[1.5],[10000]])assert.throws(()=>store.save('admin',{...saved,tables}),/table numbers/);
    assert.throws(()=>store.save(cashier,{...floor,name:'First Floor'}),/Administrator/);
    assert.equal(store.list(cashier,'floor','').length,1);
    store.save('admin',{...floor,name:'First Floor',tables:[1,2]});
    store.save('admin',{...saved,tables:[...saved.tables!,5]});
    store.close();store=new ManagementStore(file,true);
    assert.equal(store.list('admin','floor','').length,2);
    assert.deepEqual(store.list('admin','floor','Ground')[0].tables,[1,2,3,4,5]);
    const ground=store.list('admin','floor','Ground')[0];
    store.save('admin',{...ground,name:'Second Floor'});
    assert.deepEqual(store.list('admin','floor','Second')[0].tables,[1,2,3,4,5]);
    assert.throws(()=>store.save('admin',{...ground,name:'First Floor'}),/already exists/);
    assert.throws(()=>store.save('admin',{...ground,name:' '}),/required fields/);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
