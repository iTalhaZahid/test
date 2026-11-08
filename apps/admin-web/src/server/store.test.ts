import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { WebStore, getStore } from './store';
import { POST } from '../app/api/pos/route';
import { businessDate } from '../../../desktop/src/main/sales-store';

test('Vercel forwards sessions to persistent storage and fails closed without it', async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.POS_WEB_SERVER_URL;
  const originalVercel = process.env.VERCEL;
  const request = (origin = 'https://pos.example.com') => new NextRequest('https://pos.example.com/api/pos', {
    method: 'POST', headers: { origin, 'content-type': 'application/json', cookie: 'pos-web-session=token' },
    body: JSON.stringify({ operation: 'auth:state', args: [] }),
  });
  try {
    process.env.VERCEL = '1';
    delete process.env.POS_WEB_SERVER_URL;
    assert.equal((await POST(request())).status, 503);
    process.env.POS_WEB_SERVER_URL = 'https://data.example.com';
    let calls = 0;
    globalThis.fetch = async (url, options) => {
      calls++;
      assert.equal(String(url), 'https://data.example.com/api/pos');
      const headers = new Headers(options?.headers);
      assert.equal(headers.get('origin'), 'https://data.example.com');
      assert.equal(headers.get('cookie'), 'pos-web-session=token');
      assert.equal(options?.redirect, 'error');
      return new Response('{"data":null}', { headers: { 'Set-Cookie': 'pos-web-session=new; Path=/; HttpOnly; Secure; SameSite=Strict' } });
    };
    assert.equal((await POST(request('https://attacker.example'))).status, 403);
    assert.equal(calls, 0);
    const response = await POST(request());
    assert.equal(response.status, 200);
    assert.match(response.headers.get('set-cookie')!, /HttpOnly; Secure/);
    assert.deepEqual(await response.json(), { data: null });
    globalThis.fetch = async () => { throw new Error('offline'); };
    assert.equal((await POST(request())).status, 502);
    process.env.POS_WEB_SERVER_URL = 'http://data.example.com';
    assert.equal((await POST(request())).status, 502);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.POS_WEB_SERVER_URL;
    else process.env.POS_WEB_SERVER_URL = originalUrl;
    if (originalVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = originalVercel;
  }
});

test('web bridge enforces superuser and cashier permissions and stores monthly status',async()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'pos-web-permissions-'));
  const store=new WebStore(directory,true);
  try{
    await store.ready;
    const root=await store.auth.login('superuser','PosSuper123!'),admin=await store.auth.login('admin','PosAdmin123!'),cashier=await store.auth.login('demo','PosDemo123!');
    assert.ok(root.ok);assert.ok(admin.ok);assert.ok(cashier.ok);
    const rootToken=store.session(root.user),adminToken=store.session(admin.user),cashierToken=store.session(cashier.user);
    const base={id:'',kind:'admin',name:'Managed admin',phone:'03001234567',passport:'',identity:'',pricePaisa:0,quantity:0,username:'managed.admin',password:'Managed123!'};
    await assert.rejects(store.execute(adminToken,'management:save',[base]),/Superuser/);
    await store.execute(rootToken,'management:save',[base]);
    const managed=await store.auth.login(base.username,base.password);assert.ok(managed.ok);
    const managedToken=store.session(managed.user);
    await store.execute(managedToken,'auth:change-password',[base.password,'Changed123!']);
    await store.execute(rootToken,'management:remove',['admin',managed.user.id]);
    await assert.rejects(store.execute(managedToken,'management:list',['shop','']),/Sign in/);
    await assert.rejects(store.execute(cashierToken,'management:list',['creditor','']));
    const profile=store.management.list(admin.user,'cashier','Demo cashier')[0];
    await store.execute(adminToken,'management:save',[{...profile,phone:base.phone,manageCreditsExpenses:true}]);
    assert.equal(store.user(cashierToken)?.manageCreditsExpenses,true);
    assert.ok((await store.execute(cashierToken,'management:list',['creditor','']) as unknown[]).length);
    await store.execute(adminToken,'management:save',[{...profile,phone:base.phone,manageCreditsExpenses:false}]);
    await assert.rejects(store.execute(cashierToken,'management:list',['creditor','']));
    await store.execute(adminToken,'management:save',[{...base,kind:'recurring',name:'Rent',shopId:'main-shop',expenseType:'Rent',startMonth:'2026-11',pricePaisa:100000}]);
    const row=store.management.monthly(admin.user,'2026-11')[0];
    await assert.rejects(store.execute(cashierToken,'management:set-paid',[row.id,'2026-11',true]));
    await assert.rejects(store.execute(cashierToken,'management:record-payment',[row.id,'2026-11',25000,'partial-one']));
    await store.execute(adminToken,'management:record-payment',[row.id,'2026-11',25000,'partial-one']);
    await store.execute(adminToken,'management:record-payment',[row.id,'2026-11',25000,'partial-one']);
    assert.equal(store.management.monthly(admin.user,'2026-11')[0].paidMinor,25000);
    await store.execute(adminToken,'management:record-payment',[row.id,'2026-11',75000,'partial-two']);
    const monthly=await store.execute(adminToken,'management:monthly',['2026-11']);
    assert.ok(Array.isArray(monthly) && 'paid' in monthly[0]);
    assert.equal(monthly[0].paid,true);
    assert.equal((await store.execute(cashierToken,'sales:payment-methods',[]) as unknown[]).length,3);
  }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});

test('web sessions preserve desktop rules, financial records and persistence', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'pos-web-'));
  let store = new WebStore(directory, true);
  try {
    await store.ready;
    const admin = await store.auth.login('admin', 'PosAdmin123!');
    const cashier = await store.auth.login('demo', 'PosDemo123!');
    assert.ok(admin.ok); assert.ok(cashier.ok);
    const adminToken = store.session(admin.user), cashierToken = store.session(cashier.user);
    assert.equal(store.user(adminToken)?.role, 'admin');
    assert.equal(store.user(cashierToken)?.role, 'cashier');
    await assert.rejects(store.execute(undefined, 'sales:menu', ['']));
    await assert.rejects(store.execute(cashierToken, 'management:list', ['menu', '']));
    const shopRecord = { id: '', kind: 'shop', name: 'Web branch', phone: '', passport: '', identity: '', pricePaisa: 0, quantity: 0 };
    await assert.rejects(store.execute(cashierToken, 'management:save', [shopRecord]));
    await store.execute(adminToken, 'management:save', [shopRecord]);
    const shop = store.management.list('admin', 'shop', 'Web branch')[0];
    const demoProfile = store.management.list('admin', 'cashier', 'Demo cashier')[0];
    await store.execute(adminToken, 'management:save', [{ ...demoProfile, phone: '03001234567', shopId: shop.id, manageCreditsExpenses: true }]);
    await store.execute(adminToken, 'management:save', [{...shopRecord,kind:'menu',name:'Branch meal',shopId:shop.id,pricePaisa:1000}]);
    const item = store.sales.menu(cashier.user, '')[0];
    const creditor = store.sales.creditors(cashier.user, '')[0];
    const order = { operationId: randomUUID(), customerType: 'creditor', creditorId: creditor.id,
      lines: [{ itemId: item.id, quantity: 2, unitPrice: item.priceMinor }], receivedMinor: 0 };
    const sale = await store.execute(cashierToken, 'sales:save', [order]);
    assert.ok(sale && 'ok' in sale && sale.ok);
    assert.equal(store.sales.history(admin.user, { start: '2000-01-01', end: '2099-12-31', type: 'all', shopId: shop.id }).length, 1);
    assert.equal(store.sales.history(admin.user, { start: '2000-01-01', end: '2099-12-31', type: 'all', shopId: 'main-shop' }).length, 0);
    assert.equal(JSON.stringify(await store.execute(cashierToken, 'sales:save', [order])), JSON.stringify(sale));
    const date = businessDate(new Date());
    const expense = await store.execute(cashierToken, 'expenses:save', [{ operationId: randomUUID(), date,
      category: 'Supplies', description: 'Web test', paidVia: 'cash', amountMinor: 100 }]);
    assert.ok(expense && 'ok' in expense && expense.ok);
    const repayment = await store.execute(adminToken, 'creditors:recover', [{ operationId: randomUUID(),
      creditorId: creditor.id, date, amountMinor: item.priceMinor, shopId: shop.id }]);
    assert.ok(repayment && 'ok' in repayment && repayment.ok);
    assert.equal((await store.execute(adminToken, 'expenses:list', [date, date, shop.id]) as unknown[]).length, 1);
    assert.equal((await store.execute(adminToken, 'expenses:list', [date, date, 'main-shop']) as unknown[]).length, 0);
    assert.equal((await store.execute(adminToken, 'creditors:repayments', [date, date, shop.id]) as unknown[]).length, 1);
    assert.equal((await store.execute(adminToken, 'creditors:repayments', [date, date, 'main-shop']) as unknown[]).length, 0);
    assert.equal(store.sales.creditorAccount(admin.user, creditor.id).outstanding, item.priceMinor);
    await store.execute(cashierToken, 'auth:change-password', ['PosDemo123!', 'NewPassword123!']);
    store.close(); store = new WebStore(directory, true); await store.ready;
    assert.equal(store.user(adminToken)?.id, admin.user.id);
    assert.equal(store.sales.history(admin.user, { start: date, end: date, type: 'all' }).length, 1);
    assert.equal(store.sales.expenses(admin.user, date, date).length, 1);
    assert.equal(store.sales.repayments(admin.user, date, date).length, 1);
    assert.equal((await store.auth.login('demo', 'PosDemo123!')).ok, false);
    assert.equal((await store.auth.login('demo', 'NewPassword123!')).ok, true);
    const profile = store.management.list('admin', 'cashier', 'Sample Ayesha')[0];
    const sample = await store.auth.login(profile.username, 'PosCashier123!'); assert.ok(sample.ok);
    const sampleToken = store.session(sample.user);
    await store.execute(adminToken, 'management:remove', ['cashier', profile.id]);
    assert.equal(store.user(sampleToken), null);
    store.logout(adminToken);
    assert.equal(store.user(adminToken), null);
    assert.equal(store.user(cashierToken)?.id, cashier.user.id);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('HTTP boundary rejects foreign origins and anonymous writes; cookie login/logout works', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'pos-web-http-'));
  process.env.POS_WEB_DATA_DIR = directory;
  process.env.POS_WEB_DEMO = '1';
  const request = (operation: string, args: unknown[] = [], cookie = '', origin = 'http://localhost:3000') => POST(new NextRequest('http://localhost:3000/api/pos', {
    method: 'POST', headers: { origin, 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ operation, args }),
  }));
  try {
    const loopback = await POST(new NextRequest('http://127.0.0.1:3000/api/pos', {
      method: 'POST', headers: { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000', 'Content-Type': 'application/json' },
      body: JSON.stringify({ operation: 'auth:state', args: [] }),
    }));
    assert.equal(loopback.status, 200);
    assert.equal((await request('auth:login', ['admin', 'PosAdmin123!'], '', 'https://foreign.example')).status, 403);
    assert.equal((await request('management:save', [{}])).status, 401);
    const login = await request('auth:login', ['admin', 'PosAdmin123!']);
    assert.equal((await login.json()).data.ok, true);
    const setCookie = login.headers.get('set-cookie')!;
    assert.match(setCookie, /HttpOnly/i); assert.match(setCookie, /SameSite=strict/i);
    const cookie = setCookie.split(';')[0];
    assert.equal((await (await request('auth:state', [], cookie)).json()).data.user.role, 'admin');
    const menu = await (await request('management:list', ['menu', ''], cookie)).json();
    assert.ok(menu.data.length > 0);
    assert.equal((await request('expenses:list', ['2000-01-01', '2099-12-31', 'main-shop'], cookie)).status, 200);
    assert.equal((await request('creditors:repayments', ['2000-01-01', '2099-12-31', 'main-shop'], cookie)).status, 200);
    assert.equal((await request('management:save', [{}], cookie)).status, 400);
    await request('auth:logout', [], cookie);
    assert.equal((await (await request('auth:state', [], cookie)).json()).data.user, null);
    assert.equal((await request('sales:menu', [''], cookie)).status, 401);
  } finally {
    (await getStore()).close();
    delete (globalThis as typeof globalThis & { posWebStore?: WebStore }).posWebStore;
    delete process.env.POS_WEB_DATA_DIR; delete process.env.POS_WEB_DEMO;
    rmSync(directory, { recursive: true, force: true });
  }
});

test('demo-disabled storage rejects demo accounts', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'pos-web-disabled-'));
  const store = new WebStore(directory, false);
  try {
    await store.ready;
    assert.equal((await store.auth.login('admin', 'PosAdmin123!')).ok, false);
    assert.equal(store.user('invalid'), null);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('hot reload replaces stale management services and preserves saved data',async()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'pos-web-reload-'));
  process.env.POS_WEB_DATA_DIR=directory;
  process.env.POS_WEB_DEMO='1';
  const globalStore=globalThis as typeof globalThis & {posWebStore?:WebStore};
  try {
    const original=await getStore();
    original.management.save('admin',{id:'',kind:'menu',name:'Reload test',phone:'',passport:'',identity:'',pricePaisa:100,quantity:1,shopId:'main-shop'});
    // Preserve old methods while simulating a prototype from a previous module load.
    Object.setPrototypeOf(original.management,Object.create(null,Object.getOwnPropertyDescriptors(Object.getPrototypeOf(original.management))));
    const refreshed=await getStore();
    assert.notEqual(refreshed,original);
    assert.equal(refreshed.management.list('admin','menu','Reload test').length,1);
    assert.equal(await getStore(),refreshed);
  }finally{
    globalStore.posWebStore?.close();delete globalStore.posWebStore;
    delete process.env.POS_WEB_DATA_DIR;delete process.env.POS_WEB_DEMO;
    rmSync(directory,{recursive:true,force:true});
  }
});
