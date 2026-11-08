import { app, BrowserWindow, dialog, ipcMain, net, session } from 'electron';
import path from 'node:path';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseEnv } from 'node:util';
import { backendConfig } from './backend-config';
import { printReceipt } from './receipt-printer';
import { verifyOnlineConnection } from './online-connection';
import type { SyncStatus } from './sync-contract';

const dataDirectory = path.join(app.getPath('appData'), 'POS Terminal Online');
let status: SyncStatus = { state: 'syncing', pending: 0, message: 'Verifying the online backend and database.' };
let timer: ReturnType<typeof setInterval> | undefined;
let checking: Promise<void> | undefined;
let window: BrowserWindow | undefined;

function failStartup() {
  dialog.showErrorBox('POS Online could not start', 'Check your internet connection and POS_API_URL in .env or pos-config.json, then restart POS.');
  app.exit(1);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  try {
    const envFile = path.join(app.isPackaged ? path.dirname(app.getPath('exe')) : path.resolve(__dirname, '../../../..'), '.env');
    const environment = existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')) : {};
    const endpoint = backendConfig(process.env.POS_API_URL || environment.POS_API_URL, [
      path.join(dataDirectory, 'pos-config.json'), path.join(app.getAppPath(), 'pos-config.json'),
    ]);
    if (!endpoint) throw new Error('POS_API_URL is required.');
    // Each backend has its own cookies and catalogs; switching servers cannot mix data.
    const profile = path.join(dataDirectory, createHash('sha256').update(endpoint).digest('hex').slice(0, 16));
    mkdirSync(profile, { recursive: true });
    app.setPath('userData', profile);
    app.setPath('sessionData', profile);

    const verify = () => checking ??= verifyOnlineConnection(endpoint, net.fetch).then(value => { status = value; }).finally(() => { checking = undefined; });
    const trusted = (event: Electron.IpcMainInvokeEvent) => {
      if (!window || event.sender !== window.webContents || event.senderFrame !== event.sender.mainFrame || new URL(event.senderFrame.url).origin !== endpoint) {
        throw new Error('Untrusted desktop request.');
      }
    };

    app.whenReady().then(async () => {
      session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      session.defaultSession.setPermissionCheckHandler(() => false);
      ipcMain.handle('sync:status', event => { trusted(event); return status; });
      ipcMain.handle('sync:retry', async event => { trusted(event); await verify(); });
      ipcMain.handle('receipt:print', async event => { trusted(event); await printReceipt(event.sender); });
      window = new BrowserWindow({
        title: 'POS Terminal Online', width: 1280, height: 820, minWidth: 720, minHeight: 600,
        backgroundColor: '#ffffff',
        webPreferences: { preload: path.join(__dirname, 'online-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
      });
      window.removeMenu();
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== endpoint) event.preventDefault(); });
      window.webContents.on('will-attach-webview', event => event.preventDefault());
      await Promise.all([verify(), window.loadURL(endpoint)]);
      timer = setInterval(() => { void verify(); }, 30000);
    }).catch(failStartup);
  } catch { app.whenReady().then(failStartup); }
}
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => { if (timer) clearInterval(timer); });
app.on('second-instance', () => { if (window?.isMinimized()) window.restore(); window?.focus(); });
