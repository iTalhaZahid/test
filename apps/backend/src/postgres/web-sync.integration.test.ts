import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createPool } from './database.js';
import { createPostgresApp } from './app.js';
import { AuthStore } from '../../../desktop/src/main/auth-store';
import { ManagementStore } from '../../../desktop/src/main/management-store';
import { SalesStore, businessDate } from '../../../desktop/src/main/sales-store';
import { SyncStore } from '../../../desktop/src/main/sync-store';
import { SyncEngine } from '../../../desktop/src/main/sync-engine';
import type { ManagementRecord } from '../../../desktop/src/main/management-contract';

test('website sync: offline persistence, exact retry, historical prices, payments and website changes', {timeout:300000}, async()=>{
  assert.match(process.env.NEON_BRANCH||'',/^pos-pg-migration-/,'Use the isolated migration test database.');
  assert.equal(process.env.POS_WEB_DEMO,'1');
  const pool=createPool(),server=createPostgresApp(pool).listen(0,'127.0.0.1');
  await once(server,'listening');
  const address=server.address();assert.ok(address&&typeof address!=='string');
  const endpoint=`http://127.0.0.1:${address.port}`,folder=mkdtempSync(path.join(tmpdir(),'pos-web-offline-'));
  const protect={encrypt:(s:string)=>Buffer.from(s),decrypt:(b:Uint8Array)=>Buffer.from(b).toString()};
  let offline=false,dropReply=false,pushes=0;
  const fetcher:typeof fetch=async(url,options)=>{
    if(offline)throw new Error('Simulated disconnected network');
    const response=await fetch(url,options);
    if(String(url).endsWith('/sync/push')){pushes++;if(dropReply){dropReply=false;await response.text();throw new Error('Response lost after commit');}}
    return response;
  };
  let auth:AuthStore,management:ManagementStore,sales:SalesStore,sync:SyncStore,engine:SyncEngine;
  const open=async()=>{
    auth=new AuthStore(path.join(folder,'pos.sqlite'),{encrypt:async v=>Buffer.from(v),decrypt:async b=>b.toString()},false);await auth.initialize();
    management=new ManagementStore(path.join(folder,'pos.sqlite'),true,true);
    sales=new SalesStore(path.join(folder,'pos.sqlite'),path.join(folder,'recovery.sqlite'),protect.encrypt);
    sync=new SyncStore(path.join(folder,'pos.sqlite'),protect,endpoint,true);engine=new SyncEngine(sync,auth,fetcher);
  };
  const close=async()=>{await engine.stop();sync.close();sales.close();management.close();auth.close();};
  const web=async(operation:string,args:unknown[]=[],cookie='')=>{
    const response=await fetch(`${endpoint}/api/pos`,{method:'POST',headers:{Origin:endpoint,'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({operation,args})});
    const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));return {data:result.data,cookie:response.headers.get('set-cookie')?.split(';')[0]||''};
  };
  try {
    const adminLogin=await web('auth:login',['admin','PosAdmin123!']);assert.ok(adminLogin.data.ok);const cookie=adminLogin.cookie;
    const tag=randomUUID().slice(0,8),base={id:'',phone:'',passport:'',identity:'',pricePaisa:0,quantity:0};
    await web('management:save',[{...base,kind:'menu',name:`Sync meal ${tag}`,pricePaisa:1000,shopId:'main-shop'}],cookie);
    await web('management:save',[{...base,kind:'creditor',name:`Sync creditor ${tag}`,phone:'03000000001'}],cookie);
    const meal=(await web('management:list',['menu',`Sync meal ${tag}`],cookie)).data[0] as ManagementRecord;
    const creditor=(await web('management:list',['creditor',`Sync creditor ${tag}`],cookie)).data[0] as ManagementRecord;
    const cashier=(await web('management:list',['cashier','Demo cashier'],cookie)).data[0];
    await web('management:save',[{...cashier,phone:'03000000002',manageCreditsExpenses:true}],cookie);
    const unpaired=await fetch(`${endpoint}/api/v1/web/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'demo',password:'PosDemo123!',deviceId:randomUUID()})});
    assert.equal(unpaired.status,403,'A cashier cannot authorize a new terminal.');
    await open();
    assert.equal(sync!.pending(),0,'Local defaults must never overwrite website catalogs.');
    assert.equal((await engine!.login('admin','PosAdmin123!')).ok,true);await engine!.retry();
    const admin=auth!.user(adminLogin.data.user.id)!;assert.ok(admin);
    const cashierLogin=await engine!.login('demo','PosDemo123!');assert.ok(cashierLogin.ok);await engine!.retry();
    const cashierUser=cashierLogin.user;
    assert.ok(sales!.menu(cashierUser,'').some(item=>item.id===meal.id));
    assert.ok(sync!.invoiceStatus().remaining>=1000);
    offline=true;await engine!.retry();assert.equal(engine!.status().state,'offline');
    sync!.setActor(cashierUser.id);
    const order={operationId:randomUUID(),customerType:'creditor' as const,creditorId:creditor.id,lines:[{itemId:meal.id,quantity:2,unitPrice:1000}],receivedMinor:0};
    const saved=sales!.save(cashierUser,order);assert.ok(saved.ok);const invoice=saved.sale.invoiceNumber;
    const expense={operationId:randomUUID(),date:businessDate(new Date()),category:'Supplies',description:`Offline ${tag}`,amountMinor:500,paidVia:'cash' as const};
    assert.ok(sales!.saveExpense(cashierUser,expense).ok);
    const recovery={operationId:randomUUID(),creditorId:creditor.id,date:businessDate(new Date()),amountMinor:300,shopId:'main-shop'};
    assert.ok(sales!.recoverCredit(cashierUser,recovery).ok);
    sync!.setActor(admin.id);
    const month=businessDate(new Date()).slice(0,7);
    management!.save(admin,{...base,kind:'recurring',name:`Offline bill ${tag}`,pricePaisa:1000,shopId:'main-shop',expenseType:'Rent',startMonth:month});
    const monthlyId=management!.list(admin,'recurring',`Offline bill ${tag}`)[0].id;
    const installment=randomUUID();management!.recordPayment(admin,monthlyId,month,400,installment);
    const newUsername=`offline.${tag}`;
    management!.save(admin,{...base,kind:'cashier',name:`Offline cashier ${tag}`,phone:'03000000003',username:newUsername,shopId:'main-shop'},await auth!.cashierVerifier('OfflineStaff123!'));
    const pending=sync!.pending();assert.ok(pending>=5);
    await close();await open();
    assert.equal(sync!.pending(),pending,'Outbox survives process restart.');
    assert.equal((await engine!.login('demo','PosDemo123!')).ok,true,'Previously verified account can log in offline.');
    await engine!.retry();
    assert.equal(sales!.history(cashierUser,{start:expense.date,end:expense.date,type:'all',shopId:'main-shop'}).find(s=>s.id===order.operationId)?.invoiceNumber,invoice);
    await web('management:save',[{...meal,pricePaisa:1500}],cookie);
    offline=false;dropReply=true;await engine!.retry();assert.ok(sync!.pending()>0,'A lost reply cannot delete the outbox.');
    await engine!.retry();assert.equal(sync!.pending(),0,engine!.status().message);
    assert.equal(engine!.status().state,'online');assert.ok(pushes>=2);
    assert.equal((await web('auth:login',[newUsername,'OfflineStaff123!'])).data.ok,true,'Offline staff creation uses website authentication.');
    const cashierCookie=(await web('auth:login',['demo','PosDemo123!'])).cookie;
    const history=(await web('sales:history',[{start:expense.date,end:expense.date,type:'all',shopId:'main-shop'}],cookie)).data;
    const uploaded=history.filter((sale:{id:string})=>sale.id===order.operationId);assert.equal(uploaded.length,1);assert.equal(uploaded[0].invoiceNumber,invoice);assert.equal(uploaded[0].total,2000);assert.equal(uploaded[0].date,saved.sale.date);
    assert.equal((await web('expenses:list',[expense.date,expense.date,'main-shop'],cookie)).data.filter((e:{id:string})=>e.id===expense.operationId).length,1);
    const account=(await web('creditors:account',[creditor.id],cashierCookie)).data;assert.equal(account.outstanding,1700);assert.equal(account.repayments.filter((r:{id:string})=>r.id===recovery.operationId).length,1);
    const monthRow=(await web('management:monthly',[month],cookie)).data.find((r:{id:string})=>r.id===monthlyId);assert.equal(monthRow.paidMinor,400);assert.equal(monthRow.payments.filter((p:{operationId:string})=>p.operationId===installment).length,1);
    assert.equal(sales!.menu(cashierUser,'').find(item=>item.id===meal.id)?.priceMinor,1500,'Website edits flow back to the offline catalog.');
    // A second terminal must reserve different numbers and must download the website history.
    const other=await fetch(`${endpoint}/api/v1/web/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'PosAdmin123!',deviceId:randomUUID()})});
    const otherLogin=await other.json();assert.ok(otherLogin.deviceToken);
    const otherPull=await (await fetch(`${endpoint}/api/v1/web/sync/pull?after=0&invoiceLast=0&invoiceRemaining=0`,{headers:{Authorization:`Bearer ${otherLogin.deviceToken}`}})).json();
    assert.ok(otherPull.invoiceRanges.every((r:{first:number;last:number})=>Number(invoice)<r.first||Number(invoice)>r.last));
    assert.doesNotMatch(JSON.stringify(otherPull),/verifier|PosAdmin123!/,'Change feeds must never include password verifiers.');
    const client=await pool.connect();try{assert.equal(Number((await client.query('SELECT COUNT(*) AS n FROM pos_web.sales WHERE id=$1',[order.operationId])).rows[0].n),1);}finally{client.release();}
    // Another terminal may collect against the same balance while this one is offline.
    offline=true;await engine!.retry();sync!.setActor(cashierUser.id);
    const conflicting={...recovery,operationId:randomUUID(),amountMinor:1000};assert.ok(sales!.recoverCredit(cashierUser,conflicting).ok);
    assert.ok((await web('creditors:recover',[{...conflicting,operationId:randomUUID()}],cashierCookie)).data.ok);
    offline=false;await engine!.retry();assert.ok(sync!.pending()>0);assert.equal(engine!.status().state,'error');
    assert.match(engine!.status().message||'',/exceed.*outstanding balance/);
    assert.equal((await web('creditors:account',[creditor.id],cashierCookie)).data.outstanding,700,'Conflicting offline recovery cannot overdraw website credit.');
  } finally {
    if(engine!)await close();
    await new Promise<void>(resolve=>server.close(()=>resolve()));await pool.end();rmSync(folder,{recursive:true,force:true});
  }
});
