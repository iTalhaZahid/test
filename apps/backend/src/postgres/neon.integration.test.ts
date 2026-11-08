import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { createPool } from './database.js';
import { businessDate } from './sales-store.js';
import type { LoginResult } from '../../../desktop/src/main/auth-contract';
import type { ManagementRecord, MonthlyExpense } from '../../../desktop/src/main/management-contract';
import type { MenuItem, Creditor, CreditorAccount, Sale, Expense, Repayment } from '../../../desktop/src/main/sales-contract';

async function freePort() {
  const server = net.createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise<void>(resolve => server.close(() => resolve()));
  return address.port;
}

async function launch(cwd: string, args: string[], env: NodeJS.ProcessEnv, ready: string) {
  const child = spawn(process.execPath, args, { cwd, env, stdio: ['ignore','pipe','pipe'], windowsHide: true });
  const exited = once(child, 'exit');
  let output = '';
  let errors = '';
  child.stderr.on('data', data => { errors = (errors + data).slice(-4000); });
  let timer: ReturnType<typeof setTimeout>;
  try {
    await Promise.race([
      new Promise<void>(resolve => child.stdout.on('data', data => { output += data; if (output.includes(ready)) resolve(); })),
      exited.then(() => { throw new Error(`Server exited before startup: ${errors}`); }),
      new Promise<void>((_, reject) => { timer = setTimeout(() => reject(new Error('Server startup timed out.')), 30000); }),
    ]);
  } catch (error) { child.kill(); throw error; }
  finally { clearTimeout(timer!); }
  return async () => { child.kill(); await exited; };
}

test('Neon: real frontend binding, relational writes, retries, concurrency and restart persistence', { timeout: 300000 }, async () => {
  assert.match(process.env.NEON_BRANCH || '', /^pos-pg-migration-/, 'Run only on a disposable migration-test branch.');
  assert.equal(process.env.POS_WEB_DEMO, '1');
  const root = path.resolve('../..');
  const backendPort = await freePort(), frontendPort = await freePort();
  const backend = `http://127.0.0.1:${backendPort}`, frontend = `http://127.0.0.1:${frontendPort}`;
  const env = { ...process.env, NODE_ENV: 'production', VERCEL: '', PORT: String(backendPort), BACKEND_URL: backend };
  const pool = createPool();
  let stopBackend: (() => Promise<void>) | undefined;
  let stopFrontend: (() => Promise<void>) | undefined;
  const startBackend = () => launch(path.join(root,'apps/backend'), ['dist/server.mjs'], env, 'Backend listening');
  const tag = randomUUID().slice(0,8);

  const webResponse = (operation: string, args: unknown[] = [], cookie = '', origin = frontend) => fetch(`${frontend}/api/pos`, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ operation, args }),
  });
  const web = async <T>(operation: string, args: unknown[] = [], cookie = '') => {
    const response = await webResponse(operation,args,cookie);
    const result = await response.json();
    assert.equal(response.status,200,`${operation}: ${JSON.stringify(result)}`);
    return result.data as T;
  };
  const login = async (username: string, password: string) => {
    const response = await webResponse('auth:login',[username,password]);
    const data = (await response.json()).data as LoginResult;
    assert.ok(data.ok, JSON.stringify(data));
    assert.match(response.headers.get('set-cookie') || '', /HttpOnly/i);
    return response.headers.get('set-cookie')!.split(';')[0];
  };
  const sync = async <T>(endpoint: string, body?: unknown, token?: string, expected = 200) => {
    const response = await fetch(`${backend}/api/v1${endpoint}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json();
    assert.equal(response.status,expected,`${endpoint}: ${JSON.stringify(data)}`);
    return data as T;
  };
  try {
    stopBackend = await startBackend();
    stopFrontend = await launch(path.join(root,'apps/admin-web'), ['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(frontendPort)],env,'Ready');
    assert.equal((await fetch(`${frontend}/`)).status,200);
    assert.equal((await fetch(`${backend}/health`)).status,200);
    assert.equal((await webResponse('auth:state',[],'','https://foreign.example')).status,403);
    assert.equal((await webResponse('management:list',['shop',''])).status,401);
    const rootCookie = await login('superuser','PosSuper123!');
    const adminCookie = await login('admin','PosAdmin123!');
    const cashierCookie = await login('demo','PosDemo123!');
    const state = await web<{user:{role:string}}>('auth:state',[],rootCookie);
    assert.equal(state.user.role,'superuser');
    const base = { id:'', name:'', phone:'', passport:'', identity:'', pricePaisa:0, quantity:0 };
    const newAdmin = {...base,kind:'admin',name:`Neon admin ${tag}`,phone:'03001234567',username:`neon.${tag}`,password:'NeonAdmin123!'};
    assert.equal((await webResponse('management:save',[newAdmin],adminCookie)).status,400);
    await web('management:save',[newAdmin],rootCookie);
    const managedCookie = await login(newAdmin.username,newAdmin.password);
    await web('auth:change-password',[newAdmin.password,'ChangedNeon123!'],managedCookie);
    assert.equal((await web<LoginResult>('auth:login',[newAdmin.username,newAdmin.password])).ok,false);
    await login(newAdmin.username,'ChangedNeon123!');
    const cashier = (await web<ManagementRecord[]>('management:list',['cashier','Demo cashier'],rootCookie))[0];
    assert.ok(cashier);
    await web('management:save',[{...cashier,phone:'03001234567',manageCreditsExpenses:true}],rootCookie);
    const menu = await web<MenuItem[]>('sales:menu',[''],cashierCookie);
    assert.ok(menu.length > 0);
    const item = menu[0];
    assert.equal(typeof item.priceMinor,'number');
    assert.ok((await web<MenuItem[]>('sales:menu',[item.name.split(' ')[0]],cashierCookie)).some(row=>row.id===item.id));
    assert.ok((await web<ManagementRecord[]>('management:list',['menu',item.name.split(' ')[0]],rootCookie)).length);
    await web('sales:favourite',[item.id,true],cashierCookie);
    const creditor = (await web<Creditor[]>('sales:creditors',[''],cashierCookie))[0];
    const order = {operationId:randomUUID(),customerType:'creditor',creditorId:creditor.id,lines:[{itemId:item.id,quantity:2,unitPrice:item.priceMinor}],receivedMinor:0};
    const saved = await web<{ok:boolean;sale:Sale;message?:string}>('sales:save',[order],cashierCookie);
    assert.ok(saved.ok, saved.message);
    assert.deepEqual(await web('sales:save',[order],cashierCookie),saved);
    const concurrent = await Promise.all([1,2].map(()=>web<{ok:boolean;sale:Sale}>('sales:save',[{...order,operationId:order.operationId}],cashierCookie)));
    assert.ok(concurrent.every(result=>result.ok && result.sale.id===saved.sale.id));
    const date = businessDate(new Date()), month = date.slice(0,7);
    const expenseRequest = {operationId:saved.sale.id,date,category:'Supplies',description:`Neon ${tag}`,paidVia:'cash',amountMinor:100,shopId:'main-shop'};
    const expense = await web<{ok:boolean;expense:Expense;message?:string}>('expenses:save',[expenseRequest],cashierCookie);
    assert.ok(expense.ok,expense.message);
    assert.deepEqual(await web('expenses:save',[expenseRequest],cashierCookie),expense);
    const repaymentRequest = {operationId:randomUUID(),creditorId:creditor.id,date,amountMinor:item.priceMinor,shopId:'main-shop'};
    const repayment = await web<{ok:boolean;repayment:Repayment;message?:string}>('creditors:recover',[repaymentRequest],cashierCookie);
    assert.ok(repayment.ok,repayment.message);
    assert.deepEqual(await web('creditors:recover',[repaymentRequest],cashierCookie),repayment);
    const account = await web<CreditorAccount>('creditors:account',[creditor.id],rootCookie);
    assert.ok(account.sales.some(row=>row.id===saved.sale.id));
    assert.ok(account.repayments.some(row=>row.id===repayment.repayment.id));
    await web('management:save',[{...base,kind:'recurring',name:`Neon rent ${tag}`,pricePaisa:1000,shopId:'main-shop',expenseType:'Rent',startMonth:month}],rootCookie);
    const rent = (await web<MonthlyExpense[]>('management:monthly',[month],rootCookie)).find(row=>row.name===`Neon rent ${tag}`)!;
    assert.ok(rent);
    const monthlyArgs = [rent.id,month,250,`neon-payment-${tag}`];
    await web('management:record-payment',monthlyArgs,rootCookie);
    await web('management:record-payment',monthlyArgs,rootCookie);
    assert.equal((await web<MonthlyExpense[]>('management:monthly',[month],rootCookie)).find(row=>row.id===rent.id)?.paidMinor,250);
    const history = await web<Sale[]>('sales:history',[{start:date,end:date,type:'all',shopId:'main-shop'}],rootCookie);
    assert.equal(history.filter(row=>row.id===saved.sale.id).length,1);
    await web('sales:history',[{start:date,end:date,type:'cash',shopId:'main-shop'}],rootCookie);
    assert.ok((await web<Expense[]>('expenses:list',[date,date,'main-shop'],rootCookie)).some(row=>row.id===expense.expense.id));
    assert.ok((await web<Repayment[]>('creditors:repayments',[date,date,'main-shop'],rootCookie)).some(row=>row.id===repayment.repayment.id));

    const paired = await pool.query('SELECT id FROM pos_sync.devices LIMIT 1');
    const deviceId = paired.rows[0]?.id || randomUUID();
    const online = await sync<{token:string;deviceToken:string;user:{role:string}}>('/auth/login',{username:'superadmin',password:'PosSuperAdmin123!',deviceId});
    assert.equal(online.user.role,'superuser');
    await sync('/users',{username:`sync.${tag}`,password:'SyncAdmin123!',displayName:'Neon sync admin',role:'admin',shopId:'main-shop'},online.token,201);
    await sync('/sync/pull?after=0',undefined,undefined,401);
    const pull = await sync<{changes:unknown[];cursor:number}>('/sync/pull?after=0',undefined,online.deviceToken);
    assert.equal(typeof pull.cursor,'number');
    const syncId = randomUUID();
    const syncExpense = {entity:'expense',key:syncId,revision:1,baseVersion:0,payload:{id:syncId,cashierId:'bootstrap-admin',shopId:'main-shop',category:'Supplies',description:'Neon integration',amountMinor:100,paidVia:'cash',currency:'QAR'}};
    const firstPush = await sync('/sync/push',{changes:[syncExpense]},online.deviceToken);
    assert.deepEqual(await sync('/sync/push',{changes:[syncExpense]},online.deviceToken),firstPush);
    await sync('/sync/push',{changes:[{...syncExpense,payload:{...syncExpense.payload,amountMinor:101}}]},online.deviceToken,409);
    const reports = await sync<{events:{payload:{id:string}}[]}>('/reports/events?after=0',undefined,online.token);
    assert.equal(reports.events.filter(row=>row.payload.id===syncId).length,1);
    const counts = await pool.query('SELECT (SELECT count(*) FROM pos_web.sales WHERE id=$1) sales, (SELECT count(*) FROM pos_web.recovery_entries WHERE operation_id=$1) recoveries', [saved.sale.id]);
    assert.equal(counts.rows[0].sales,1);
    assert.equal(counts.rows[0].recoveries,2);

    await stopBackend();
    stopBackend = await startBackend();
    assert.equal((await web<{user:{role:string}}>('auth:state',[],rootCookie)).user.role,'superuser');
    assert.equal((await web<Sale[]>('sales:history',[{start:date,end:date,type:'all',shopId:'main-shop'}],rootCookie)).filter(row=>row.id===saved.sale.id).length,1);
    assert.deepEqual(await sync('/sync/push',{changes:[syncExpense]},online.deviceToken),firstPush);
    await web('auth:logout',[],rootCookie);
    assert.equal((await web<{user:null}>('auth:state',[],rootCookie)).user,null);
    console.log('PASS: frontend -> backend -> Neon; login, roles, password changes, search, sale/expense/recovery, monthly payments, sync deduplication, concurrency, restart persistence.');
  } finally {
    await stopFrontend?.();
    await stopBackend?.();
    await pool.end();
  }
});
