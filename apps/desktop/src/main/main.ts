import { app, BrowserWindow, dialog, session } from 'electron';
import path from 'node:path';

async function createWindow() {
  const window = new BrowserWindow({
    width: 1100, height: 760, minWidth: 720, minHeight: 500,
    backgroundColor: '#f6f5f0',
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
  await window.loadFile(path.join(__dirname, '../renderer/index.html'));
}

app.whenReady().then(async () => {
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
