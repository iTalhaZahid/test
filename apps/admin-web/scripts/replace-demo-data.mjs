// Explicit local backend web-store reset: build the replacement first, then retain the entire old directory as a backup.
import assert from 'node:assert/strict';
import process from 'node:process';
import console from 'node:console';
import { randomUUID } from 'node:crypto';
import { WebStore } from '../../backend/src/models/web-store.ts';
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

assert.equal(process.argv[2], '--replace', 'Run with --replace only when replacement of all local web records is authorized and the POS server is stopped.');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const target=path.resolve(root,'../backend/.data/web');
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const staging=path.join(path.dirname(target),`.data-new-${stamp}`),backup=path.join(path.dirname(target),`.data-backup-${stamp}`);
mkdirSync(staging, { recursive: true });
const store=new WebStore(staging,true);
const RealDate=Date;
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Karachi',year:'numeric',month:'2-digit',day:'2-digit'}).format(new RealDate());
const base={id:'',name:'',phone:'',passport:'',identity:'',pricePaisa:0,quantity:0};
const success=result=>assert.ok(result.ok,result.message);
// The existing sales API uses the clock for timestamps; scope a demo clock to each synchronous write.
function at(date,work){
  globalThis.Date=class extends RealDate { constructor(...args){super(...(args.length?args:[`${date}T12:00:00+05:00`]));} static now(){return new RealDate(`${date}T12:00:00+05:00`).getTime();} };
  try{return work();}finally{globalThis.Date=RealDate;}
}
let summary;
try {
  await store.ready;
  const login=await store.auth.login('admin','PosAdmin123!');success(login);
  const admin=login.user,management=store.management,sales=store.sales;
  const start=new RealDate(`${today}T12:00:00+05:00`);start.setUTCDate(start.getUTCDate()-29);
  const startDate=start.toISOString().slice(0,10),startMonth=startDate.slice(0,7);
  const shops=[management.list(admin,'shop','')[0]];
  management.save(admin,{...shops[0],name:'Al Khayber - Central'});
  shops[0]=management.list(admin,'shop','')[0];
  for(const name of ['Al Khayber - North','Al Khayber - South']){
    management.save(admin,{...base,kind:'shop',name});shops.push(management.list(admin,'shop',name)[0]);
  }
  const cashiers=management.list(admin,'cashier','');
  const creditors=management.list(admin,'creditor','');
  for(let i=0;i<creditors.length;i++)management.save(admin,{...creditors[i],name:['Hassan Trading','Omar Office Catering'][i],phone:`+974 5500200${i}`});
  const customers=management.list(admin,'creditor','');
  const menu=management.list(admin,'menu','');
  const staffNames=[['Imran Khan','Faisal Ahmed','Usman Ali'],['Bilal Hassan','Hamza Rafiq','Naveed Akhtar'],['Saad Malik','Yasir Shah','Zubair Ahmed']];
  for(let i=0;i<shops.length;i++){
    const shop=shops[i],cashier=cashiers[i];
    management.save(admin,{...cashier,name:['Ayesha Khan','Bilal Ahmed','Sara Ali'][i],phone:`+974 5500100${i}`,shopId:shop.id,manageCreditsExpenses:true});
    for(let j=0;j<3;j++)management.save(admin,{...base,kind:'employee',name:staffNames[i][j],phone:`+974 55100${i}0${j}`,shopId:shop.id,employeeCategory:['Driver','Waiter','Kitchen Staff'][j],pricePaisa:[220000,180000,320000][j]+i*10000,startMonth});
    management.save(admin,{...base,kind:'recurring',name:`Cashier salary - ${shop.name}`,shopId:shop.id,expenseType:'Salary',employeeId:cashier.id,pricePaisa:280000+i*15000,startMonth});
    management.save(admin,{...base,kind:'recurring',name:`Rent - ${shop.name}`,shopId:shop.id,expenseType:'Rent',pricePaisa:650000+i*100000,startMonth});
    if(i)for(const item of menu.slice(0,12))management.save(admin,{...item,id:'',shopId:shop.id,quantity:10000});
    const actor=store.auth.user(cashier.id);
    const items=sales.menu(actor,'');
    for(let day=0;day<30;day++){
      const cursor=new RealDate(start);cursor.setUTCDate(cursor.getUTCDate()+day);
      const date=cursor.toISOString().slice(0,10);
      at(date,()=>{
        for(let order=0;order<8+(day*7+i*3)%17;order++){
          const item=items[(day+order*3)%items.length],quantity=1+(day+order)%5,total=item.priceMinor*quantity;
          const credit=order%6===0;
          success(sales.save(actor,{operationId:randomUUID(),customerType:credit?'creditor':'walk-in',creditorId:credit?customers[order%customers.length].id:null,paymentMethodId:credit||order%3?'payment-cash':'payment-card',lines:[{itemId:item.id,quantity,unitPrice:item.priceMinor}],receivedMinor:credit?Math.floor(total/2):total}));
        }
        for(const [category,amount,description] of [['Supplies',8500+((day*31+i*17)%90)*100,'Fresh vegetables, meat and kitchen supplies'],['Transport',1500+((day+i)%7)*500,'Delivery fuel and local transport']])success(sales.saveExpense(actor,{operationId:randomUUID(),date,category,description,paidVia:'cash',amountMinor:amount}));
        if(day%5===4){const customer=customers[i%customers.length],account=sales.creditorAccount(admin,customer.id);if(account.outstanding)success(sales.recoverCredit(admin,{operationId:randomUUID(),creditorId:customer.id,date,shopId:shop.id,amountMinor:Math.floor(account.outstanding/2)}));}
      });
    }
  }
  const months=[...new Set([startMonth,today.slice(0,7)])];
  for(const month of months){const rows=management.monthly(admin,month);for(let i=0;i<rows.length;i++)if(month!==today.slice(0,7)||i%3!==2)management.recordPayment(admin,rows[i].id,month,i%3===1&&month===today.slice(0,7)?Math.floor(rows[i].pricePaisa/2):rows[i].pricePaisa,randomUUID());}
  const history=sales.history(admin,{start:startDate,end:today,type:'all'}),expenses=sales.expenses(admin,startDate,today);
  assert.ok(history.length>100);assert.equal(expenses.length,180);
  assert.equal(new Set(history.map(row=>row.businessDate)).size,30);
  assert.ok(history.every(row=>row.shopId&&row.shopName));assert.ok(expenses.every(row=>row.shopId&&row.shopName));
  assert.equal(management.list(admin,'employee','').length,9);
  assert.ok(management.list(admin,'recurring','').filter(row=>row.expenseType==='Salary').every(row=>row.employeeId));
  summary={demo:true,start:startDate,end:today,shops:3,employees:9,sales:history.length,expenses:expenses.length,recurring:management.list(admin,'recurring','').length,salesQar:history.reduce((sum,row)=>sum+row.total,0)/100,expensesQar:expenses.reduce((sum,row)=>sum+row.amountMinor,0)/100};
  writeFileSync(path.join(staging,'DEMO-DATA.json'),JSON.stringify(summary,null,2));
} finally {store.close();}
if(existsSync(target))renameSync(target,backup);
try{renameSync(staging,target);}catch(error){if(existsSync(backup))renameSync(backup,target);throw error;}
console.log(JSON.stringify({target,backup,...summary},null,2));
