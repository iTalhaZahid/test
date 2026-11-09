import { app, BrowserWindow, dialog, ipcMain, safeStorage, session } from 'electron';
import path from 'node:path';
import { mkdirSync,existsSync,readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { pathToFileURL } from 'node:url';
import { AuthStore } from './auth-store';
import { ManagementStore } from './management-store';
import { SalesStore } from './sales-store';
import { SyncStore } from './sync-store';
import { SyncEngine } from './sync-engine';
import { printReceipt } from './receipt-printer';
import type { LocalUser } from './auth-contract';
import { allowsDemo } from './runtime-mode';
import { backendConfig } from './backend-config';

const rendererPath = path.join(__dirname, '../renderer/index.html');
const standalone = app.isPackaged && app.getName() === 'POS Terminal Standalone';
const website = app.getName() === 'POS Terminal Online' || process.env.POS_WEB_OFFLINE === '1';
let demo = allowsDemo(app.isPackaged, app.getName());
if(website)demo=false;
const dataDirectory = path.join(app.getPath('appData'), website?'POS Terminal Online':app.isPackaged ? (standalone ? 'POS Terminal Standalone' : demo ? 'POS Terminal Demo' : 'POS Terminal') : 'POS Terminal Development');
const sessionDirectory = path.join(dataDirectory, 'chromium');
// Chromium chooses its cache during startup, before the ready event.
mkdirSync(sessionDirectory, { recursive: true });
app.setPath('userData', dataDirectory);
app.setPath('sessionData', sessionDirectory);
let store: AuthStore | undefined;
let management: ManagementStore | undefined;
let sales: SalesStore | undefined;
let sync: SyncEngine | undefined;
let syncStore: SyncStore | undefined;
let currentUser: LocalUser | null = null;
let sessionVersion = 0;

function actor() { const user=currentUser ? store!.user(currentUser.id) : null;syncStore?.setActor(user?.id||'');return user; }

function assertLocalSender(event: Electron.IpcMainInvokeEvent) {
  if (event.senderFrame !== event.sender.mainFrame || event.senderFrame?.url !== pathToFileURL(rendererPath).href) {
    throw new Error('Untrusted authentication request');
  }
}

async function createWindow() {
  const window = new BrowserWindow({
    width: 1280, height: 820, minWidth: 720, minHeight: 600,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.removeMenu();
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  await window.loadFile(rendererPath);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else app.whenReady().then(async () => {
  const envFile=path.join(app.isPackaged?path.dirname(app.getPath('exe')):path.resolve(__dirname,'../../../..'),'.env');
  const environment=website&&existsSync(envFile)?parseEnv(readFileSync(envFile,'utf8')):{};
  const backend = backendConfig(process.env.POS_API_URL||environment.POS_API_URL, [path.join(dataDirectory, 'pos-config.json'), path.join(app.getAppPath(), 'pos-config.json')], standalone||website ? undefined : 'http://127.0.0.1:4000');
  if(website&&!backend)throw new Error('POS_API_URL is required for website sync.');
  if (standalone && backend) demo = false;
  if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error('OS credential protection is unavailable');
  store = new AuthStore(path.join(dataDirectory, 'pos.sqlite'), {
    encrypt: value => safeStorage.encryptStringAsync(value),
    decrypt: async value => (await safeStorage.decryptStringAsync(value)).result,
  }, demo);
  await store.initialize();
  management = new ManagementStore(path.join(dataDirectory, 'pos.sqlite'), true, true);
  if (demo) management.seed(await store.cashierVerifier('PosCashier123!'));
  const recoveryDirectory = path.join(app.getPath('appData'), website?'POS Online Recovery':app.isPackaged ? (standalone ? 'POS Standalone Recovery' : demo ? 'POS Demo Recovery' : 'POS Recovery') : 'POS Development Recovery');
  mkdirSync(recoveryDirectory, { recursive:true });
  sales = new SalesStore(path.join(dataDirectory,'pos.sqlite'),path.join(recoveryDirectory,'pending.sqlite'),payload => safeStorage.encryptString(payload));
  if (backend) {
    syncStore=new SyncStore(path.join(dataDirectory,'pos.sqlite'),{
      encrypt:value=>safeStorage.encryptString(value),
      decrypt:value=>safeStorage.decryptString(Buffer.from(value)),
    },backend,website);
    sync=new SyncEngine(syncStore,store);
    sync.start();
  }
  ipcMain.handle('sync:status',event=>{assertLocalSender(event);return sync?.status() ?? {state:'offline',pending:0,message:'No POS server configured. Set POS_API_URL in pos-config.json and restart. Sales remain saved locally.'};});
  ipcMain.handle('sync:retry',event=>{assertLocalSender(event);void sync?.retry();});
  ipcMain.handle('management:monthly', (event, month: unknown) => { assertLocalSender(event); return management!.monthly(actor(),month); });
  ipcMain.handle('management:record-payment', (event, id: unknown, month: unknown, amount: unknown, operationId: unknown) => { assertLocalSender(event); const user=actor(); if(!user) throw new Error('Sign in.'); return management!.recordPayment(user,id,month,amount,operationId); });
  ipcMain.handle('management:set-paid', (event, id: unknown, month: unknown, paid: unknown) => { assertLocalSender(event); const user=actor(); if(!user) throw new Error('Sign in.'); return management!.setPaid(user,id,month,paid); });
  ipcMain.handle('sales:payment-methods', event => { assertLocalSender(event); return sales!.paymentMethods(actor()); });
  ipcMain.handle('sales:menu', (event, search: unknown) => { assertLocalSender(event); return sales!.menu(actor(),search); });
  ipcMain.handle('sales:favourite', (event, id: unknown, enabled: unknown) => { assertLocalSender(event); return sales!.favourite(actor(),id,enabled); });
  ipcMain.handle('sales:creditors', (event, search: unknown) => { assertLocalSender(event); return sales!.creditors(actor(),search); });
  ipcMain.handle('sales:save', (event, request: unknown) => { assertLocalSender(event); return sales!.save(actor(),request); });
  ipcMain.handle('receipt:print', async event => {
    assertLocalSender(event);
    if (!actor()) throw new Error('Sign in to print a receipt.');
    await printReceipt(event.sender);
  });
  ipcMain.handle('sales:history', (event, filter: unknown) => { assertLocalSender(event); return sales!.history(actor(),filter); });
  ipcMain.handle('expenses:save', (event, request: unknown) => { assertLocalSender(event); return sales!.saveExpense(actor(),request); });
  ipcMain.handle('expenses:list', (event, start: unknown, end: unknown, shopId: unknown) => { assertLocalSender(event); return sales!.expenses(actor(),start,end,shopId); });
  ipcMain.handle('creditors:account',(event,id:unknown)=>{assertLocalSender(event);return sales!.creditorAccount(actor(),id);});
  ipcMain.handle('creditors:recover',(event,request:unknown)=>{assertLocalSender(event);return sales!.recoverCredit(actor(),request);});
  ipcMain.handle('creditors:repayments',(event,start:unknown,end:unknown,shopId:unknown)=>{assertLocalSender(event);return sales!.repayments(actor(),start,end,shopId);});
  ipcMain.handle('management:list', (event, kind: unknown, search: unknown) => {
    assertLocalSender(event);
    return management!.list(actor(), kind, search);
  });
  ipcMain.handle('management:save', async (event, record: unknown) => {
    assertLocalSender(event);
    if (!actor()) throw new Error('Sign in to continue.');
    const version = sessionVersion;
    const candidate = record as { kind?: string; password?: unknown; username?: unknown } | null;
    if ((candidate?.kind === 'cashier' || candidate?.kind === 'admin') && (typeof candidate.username !== 'string' || !candidate.username.trim())) throw new Error('Username required.');
    const verifier = (candidate?.kind === 'cashier' || candidate?.kind === 'admin') && candidate.password ? await store!.cashierVerifier(candidate.password) : undefined;
    if (version !== sessionVersion) throw new Error('Session changed.');
    management!.save(actor(), record, verifier);
  });
  ipcMain.handle('management:remove', (event, kind: unknown, id: unknown) => {
    assertLocalSender(event);
    management!.remove(actor(), kind, id);
  });
  ipcMain.handle('auth:state', event => {
    assertLocalSender(event);
    return { user: actor(), demo };
  });
  ipcMain.handle('auth:login', async (event, username: unknown, password: unknown) => {
    assertLocalSender(event);
    const version = ++sessionVersion;
    currentUser = null;
    try {
      const result = await (sync ? sync.login(username, password) : store!.login(username, password));
      if (version !== sessionVersion) return { ok: false, message: 'Sign-in cancelled. Please try again.' };
      if (result.ok) currentUser = result.user;
      return result;
    } catch (error) {
      console.error('Local sign-in failed:', error instanceof Error ? error.name : 'Unknown error');
      return { ok: false, message: 'Local sign-in is unavailable. Restart POS and try again.' };
    }
  });
  ipcMain.handle('auth:logout', event => {
    assertLocalSender(event);
    sessionVersion++;
    currentUser = null;
  });
  ipcMain.handle('auth:change-password', async (event, current: unknown, next: unknown) => {
    assertLocalSender(event);
    if (!currentUser || !actor()) throw new Error('Sign in to continue.');
    if (!sync) {
      const version = sessionVersion;
      await store!.changePassword(actor()!.id,current,next,()=>version===sessionVersion);
    } else await sync!.changePassword(actor()!,current,next);
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  await createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow().catch(failStartup);
  });
}).catch(failStartup);

function failStartup(error: unknown) {
  console.error(error);
  dialog.showErrorBox('POS could not start', 'Please restart the terminal. If this continues, contact support.');
  app.exit(1);
}

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => { sync?.stop(); syncStore?.close(); sales?.close(); management?.close(); store?.close(); });
app.on('second-instance', () => {
  const window = BrowserWindow.getAllWindows()[0];
  if (window?.isMinimized()) window.restore();
  window?.focus();
});
