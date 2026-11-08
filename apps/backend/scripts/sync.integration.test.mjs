import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes, randomUUID, createCipheriv, createDecipheriv } from 'node:crypto';
import { PosModel } from '../src/models/pos-model.ts';
import { createApp } from '../src/app.ts';
import { AuthStore } from '../../desktop/src/main/auth-store.ts';
import { ManagementStore } from '../../desktop/src/main/management-store.ts';
import { SalesStore, businessDate } from '../../desktop/src/main/sales-store.ts';
import { SyncStore } from '../../desktop/src/main/sync-store.ts';
import { SyncEngine } from '../../desktop/src/main/sync-engine.ts';
const {fetch}=globalThis;

test('default superadmin can change password and create admins without bootstrap resetting it',async()=>{
  const model=new PosModel(':memory:');
  try {
    await model.bootstrap();
    const deviceId=randomUUID();
    const login=await model.login({username:'superadmin',password:'PosSuperAdmin123!',deviceId});
    assert.equal(login.user.role,'superuser');
    await model.password(login.user,{current:'PosSuperAdmin123!',next:'ChangedSuperAdmin123!'});
    await model.bootstrap();
    await assert.rejects(model.login({username:'superadmin',password:'PosSuperAdmin123!',deviceId,deviceToken:login.deviceToken}),/incorrect/);
    const changed=await model.login({username:'superadmin',password:'ChangedSuperAdmin123!',deviceId,deviceToken:login.deviceToken});
    const admin=await model.createUser({username:'branch.admin',password:'BranchAdmin123!',displayName:'Branch Admin',role:'admin',shopId:'main-shop'},changed.user.role==='superuser');
    assert.equal(admin.role,'admin');
    await model.bootstrap();
    assert.equal(model.db.prepare('SELECT COUNT(*) n FROM users').get().n,2);
  } finally {model.close();}
});

test('online provisioning, encrypted offline login, durable local tasks, reconnect and exactly-once sync',async()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'pos-sync-')),file=path.join(directory,'local.sqlite');
  const serverModel=new PosModel(path.join(directory,'server.sqlite'));
  await serverModel.bootstrap();
  const server=createApp(serverModel).listen(0,'127.0.0.1');
  await once(server,'listening');
  const endpoint=`http://127.0.0.1:${server.address().port}`;
  const key=randomBytes(32);
  const protection={
    encrypt(value){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);const data=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),data]);},
    decrypt(value){const data=Buffer.from(value),cipher=createDecipheriv('aes-256-gcm',key,data.subarray(0,12));cipher.setAuthTag(data.subarray(12,28));return Buffer.concat([cipher.update(data.subarray(28)),cipher.final()]).toString();},
  };
  let auth,management,sales,local,engine,offline=false,loseResponse=false;
  const open=()=>{
    auth=new AuthStore(file,{encrypt:async value=>protection.encrypt(value),decrypt:async value=>protection.decrypt(value)},false);
    management=new ManagementStore(file,true,true);
    sales=new SalesStore(file,path.join(directory,'recovery.sqlite'),protection.encrypt);
    local=new SyncStore(file,protection,endpoint);
    engine=new SyncEngine(local,auth,async(...args)=>{
      if(offline)throw new TypeError('Network offline');
      const response=await fetch(...args);
      if(loseResponse&&String(args[0]).endsWith('/sync/push')){loseResponse=false;await response.json();throw new TypeError('Response lost after commit');}
      return response;
    });
  };
  const close=()=>{engine?.stop();local?.close();sales?.close();management?.close();auth?.close();};
  const record={id:'',kind:'menu',name:'Offline Meal',phone:'',passport:'',identity:'',pricePaisa:500,quantity:0,shopId:'main-shop'};
  try {
    open();
    offline=true;
    assert.equal((await engine.login('superadmin','PosSuperAdmin123!')).ok,false);
    offline=false;
    const login=await engine.login('superadmin','PosSuperAdmin123!');assert.ok(login.ok,JSON.stringify(login));
    const owner=login.user;
    await engine.retry();
    assert.equal(local.pending(),0,JSON.stringify(engine.status()));
    assert.equal(engine.status().state,'online');
    const credentials=local.credentials();
    const encrypted=Buffer.from(local.db.prepare("SELECT value FROM sync_meta WHERE key='credentials'").get().value);
    assert.ok(!encrypted.includes(Buffer.from(credentials.deviceToken)));
    assert.ok(!Buffer.from(local.db.prepare('SELECT verifier FROM local_users WHERE id=?').get(owner.id).verifier).includes(Buffer.from('PosSuperAdmin123!')));

    offline=true;
    management.save(owner,record);
    const item=management.list(owner,'menu','Offline Meal')[0];
    management.save(owner,{...record,kind:'cashier',name:'Offline Cashier',username:'offline.cashier',phone:'03001234567',pricePaisa:0,manageCreditsExpenses:true},await auth.cashierVerifier('CashierPassword123!'));
    const profile=management.list(owner,'cashier','Offline Cashier')[0],cashier=auth.user(profile.id);
    const oldManagement=new ManagementStore(file,true);
    try { oldManagement.save(owner,{...record,kind:'cashier',name:'Legacy Staff',username:'legacy.staff',phone:'03001234568',pricePaisa:0},await auth.cashierVerifier('LegacyPassword123!')); }
    finally { oldManagement.close(); }
    assert.equal((await engine.login('offline.cashier','CashierPassword123!')).ok,false,'new account must first log in online');
    management.save(owner,{...record,kind:'creditor',name:'Customer',phone:'03001234567',pricePaisa:0});
    const creditor=management.list(owner,'creditor','Customer')[0];
    const order={operationId:randomUUID(),customerType:'walk-in',creditorId:null,receivedMinor:1000,lines:[{itemId:item.id,unitPrice:500,quantity:1}]};
    const sale=sales.save(cashier,order);assert.ok(sale.ok);assert.equal(sale.sale.invoiceNumber,1001);
    assert.ok(sales.save(cashier,{...order,operationId:randomUUID(),customerType:'creditor',creditorId:creditor.id,receivedMinor:0}).ok);
    assert.ok(sales.saveExpense(cashier,{operationId:randomUUID(),date:businessDate(new Date()),category:'Supplies',description:'Paper',paidVia:'cash',amountMinor:100}).ok);
    assert.ok(sales.recoverCredit(cashier,{operationId:randomUUID(),date:businessDate(new Date()),creditorId:creditor.id,amountMinor:200,shopId:'main-shop'}).ok);
    management.save(owner,{...record,kind:'recurring',name:'Rent',pricePaisa:1000,expenseType:'Rent',startMonth:'2026-01'});
    const rent=management.monthly(owner,'2026-01')[0];
    management.recordPayment(owner,rent.id,'2026-01',200,'rent-payment');
    await engine.retry();assert.equal(engine.status().state,'offline');assert.ok(local.pending()>0);
    assert.equal(sales.menu(cashier,'Offline Meal')[0].priceMinor,500);
    assert.equal(local.db.prepare("SELECT COUNT(*) n FROM sale_outbox WHERE state='pending'").get().n,2);
    assert.throws(()=>local.acknowledge(local.batch(),[]),/acknowledge/);

    close();open();
    assert.ok(local.pending()>0);
    const cached=await engine.login('superadmin','PosSuperAdmin123!');assert.ok(cached.ok);
    assert.equal(sales.menu(auth.user(profile.id),'Offline Meal').length,1);
    offline=false;loseResponse=true;
    await engine.retry();assert.ok(local.pending()>0,'lost acknowledgement must retain local changes');
    await engine.retry();assert.equal(local.pending(),0,JSON.stringify(engine.status()));
    assert.equal(engine.status().state,'online');
    assert.ok(serverModel.db.prepare("SELECT id FROM users WHERE username='legacy.staff'").get(),'legacy staff credentials are retained and provisioned');
    assert.equal(serverModel.db.prepare('SELECT COUNT(*) n FROM events').get().n,4);
    assert.equal(serverModel.db.prepare("SELECT COUNT(*) n FROM documents WHERE entity='recurring'").get().n,1);
    await engine.retry();assert.equal(serverModel.db.prepare('SELECT COUNT(*) n FROM events').get().n,4);
    assert.equal((await engine.login('superadmin','wrong-password')).ok,false,'a rejected online login cannot fall back to cache');
    const cashierLogin=await engine.login('offline.cashier','CashierPassword123!');assert.ok(cashierLogin.ok,JSON.stringify(cashierLogin));
    await engine.retry();
    offline=true;assert.ok((await engine.login('offline.cashier','CashierPassword123!')).ok);
    local.rememberLogin('offline.cashier',Date.now()-1);
    assert.equal((await engine.login('offline.cashier','CashierPassword123!')).ok,false,'expired offline verification requires online login');
    local.rememberLogin('offline.cashier',Date.now()+86400000);
    await assert.rejects(engine.changePassword(cashierLogin.user,'CashierPassword123!','NewCashierPassword123!'));
    offline=false;
    await engine.changePassword(cashierLogin.user,'CashierPassword123!','NewCashierPassword123!');
    offline=true;
    assert.ok((await engine.login('offline.cashier','NewCashierPassword123!')).ok);
    assert.equal((await engine.login('offline.cashier','CashierPassword123!')).ok,false);
    offline=false;

    // A newer local edit made while a request is in flight survives acknowledgement of the older one.
    management.save(owner,{...item,name:'First edit'});
    const sent=local.batch();
    management.save(owner,{...item,name:'Latest edit'});
    const accepted=serverModel.push(credentials.deviceId,sent);
    local.acknowledge(sent,accepted.acknowledgements);
    assert.ok(local.pending()>0);
    await engine.retry();assert.equal(local.pending(),0,JSON.stringify(engine.status()));
    assert.equal(JSON.parse(serverModel.db.prepare("SELECT payload FROM documents WHERE entity='record' AND key=?").get(item.id).payload).name,'Latest edit');

    // Server conflicts never silently overwrite offline work.
    const remote=serverModel.db.prepare("SELECT * FROM documents WHERE entity='record' AND key=?").get(item.id);
    serverModel.push(credentials.deviceId,[{entity:'record',key:item.id,revision:999999,baseVersion:remote.version,payload:{...JSON.parse(remote.payload),name:'Server edit'}}]);
    management.save(owner,{...item,name:'Local conflict'});
    await engine.retry();
    assert.equal(engine.status().state,'error');assert.ok(local.pending()>0);
    assert.equal(management.list(owner,'menu','Local conflict').length,1);
    assert.equal(JSON.parse(serverModel.db.prepare("SELECT payload FROM documents WHERE entity='record' AND key=?").get(item.id).payload).name,'Server edit');
  } finally {
    close();
    await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    serverModel.close();rmSync(directory,{recursive:true,force:true});
  }
});

test('backend rejects unauthenticated sync and invalid money and never exposes password verifiers',async()=>{
  const model=new PosModel(':memory:');await model.bootstrap();
  const server=createApp(model).listen(0,'127.0.0.1');await once(server,'listening');
  const endpoint=`http://127.0.0.1:${server.address().port}/api/v1`;
  try {
    const response=await fetch(`${endpoint}/sync/push`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{"changes":[]}'});assert.equal(response.status,401);
    const login=await model.login({username:'superadmin',password:'PosSuperAdmin123!',deviceId:randomUUID()});
    const device=model.db.prepare('SELECT id FROM devices').get().id;
    const repaired=await model.login({username:'superadmin',password:'PosSuperAdmin123!',deviceId:device});
    assert.notEqual(repaired.deviceToken,login.deviceToken);
    assert.throws(()=>model.device(login.deviceToken),/pairing/);
    const feed=model.pull(0);assert.ok(!JSON.stringify(feed).includes('hash'));assert.ok(!JSON.stringify(feed).includes('salt'));
    assert.throws(()=>model.push(model.device(repaired.deviceToken),[{entity:'expense',key:'bad',revision:1,baseVersion:0,payload:{id:'bad',cashierId:'x',shopId:'main-shop',category:'Supplies',description:'Paper',amountMinor:-1,paidVia:'cash',currency:'QAR'}}]),/Invalid amount/);
    assert.equal(model.db.prepare('SELECT COUNT(*) n FROM events').get().n,0);
    assert.throws(()=>model.device('invalid-token'),/pairing/);
  } finally {await new Promise(resolve=>server.close(resolve));model.close();}
});
