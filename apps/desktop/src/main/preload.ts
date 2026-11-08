import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopAuth } from './auth-contract';
import type { DesktopManagement } from './management-contract';
import type { DesktopSales } from './sales-contract';

const auth: DesktopAuth = {
  state: () => ipcRenderer.invoke('auth:state'),
  login: (username, password) => ipcRenderer.invoke('auth:login', username, password),
  logout: () => ipcRenderer.invoke('auth:logout'),
  changePassword: (current, next) => ipcRenderer.invoke('auth:change-password', current, next),
};
contextBridge.exposeInMainWorld('posAuth', auth);
const management: DesktopManagement = {
  monthly: month => ipcRenderer.invoke('management:monthly',month),
  recordPayment: (id,month,amount,operationId) => ipcRenderer.invoke('management:record-payment',id,month,amount,operationId),
  setPaid: (id,month,paid) => ipcRenderer.invoke('management:set-paid',id,month,paid),
  list: (kind, search) => ipcRenderer.invoke('management:list', kind, search),
  save: record => ipcRenderer.invoke('management:save', record),
  remove: (kind, id) => ipcRenderer.invoke('management:remove', kind, id),
};
contextBridge.exposeInMainWorld('posManagement', management);
const sales: DesktopSales = {
  paymentMethods: () => ipcRenderer.invoke('sales:payment-methods'),
  menu: search => ipcRenderer.invoke('sales:menu',search),
  favourite: (id,enabled) => ipcRenderer.invoke('sales:favourite',id,enabled),
  creditors: search => ipcRenderer.invoke('sales:creditors',search),
  save: request => ipcRenderer.invoke('sales:save',request),
  history: filter => ipcRenderer.invoke('sales:history',filter),
  saveExpense: request => ipcRenderer.invoke('expenses:save',request),
  expenses: (start,end,shopId) => ipcRenderer.invoke('expenses:list',start,end,shopId),
  creditorAccount: id => ipcRenderer.invoke('creditors:account',id),
  recoverCredit: request => ipcRenderer.invoke('creditors:recover',request),
  repayments: (start,end,shopId) => ipcRenderer.invoke('creditors:repayments',start,end,shopId),
};
contextBridge.exposeInMainWorld('posSales',sales);

contextBridge.exposeInMainWorld('posPrinter', { printReceipt: () => ipcRenderer.invoke('receipt:print') });

contextBridge.exposeInMainWorld('posSync', {
  status: () => ipcRenderer.invoke('sync:status'),
  retry: () => ipcRenderer.invoke('sync:retry'),
});
