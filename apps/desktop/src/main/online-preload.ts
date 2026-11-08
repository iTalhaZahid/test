import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('posOnline', true);
contextBridge.exposeInMainWorld('posPrinter', { printReceipt: () => ipcRenderer.invoke('receipt:print') });
contextBridge.exposeInMainWorld('posSync', {
  status: () => ipcRenderer.invoke('sync:status'),
  retry: () => ipcRenderer.invoke('sync:retry'),
});
