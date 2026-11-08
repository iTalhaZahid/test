import type { DesktopAuth } from '../../desktop/src/main/auth-contract';
import type { DesktopManagement } from '../../desktop/src/main/management-contract';
import type { DesktopSales } from '../../desktop/src/main/sales-contract';
import { endCatalogSession, peekCatalog } from '../../desktop/src/renderer/catalog-cache';

declare global {
  interface Window { posAuth: DesktopAuth; posManagement: DesktopManagement; posSales: DesktopSales }
}

async function call<T>(operation: string, ...args: unknown[]): Promise<T> {
  const key = operation === 'sales:menu' && !args[0] ? 'menu' : operation === 'sales:payment-methods' ? 'payments' : operation === 'management:list' && !args[1] ? args[0] === 'floor' ? 'floors' : args[0] === 'expense-category' ? 'expenseCategories' : undefined : undefined;
  const cached = key ? peekCatalog(key) : undefined;
  const version = cached && crypto.subtle ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(cached)))), byte => byte.toString(16).padStart(2, '0')).join('') : '';
  const response = await fetch('/api/pos', {
    method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...(version ? { 'X-POS-Catalog-Version': version } : {}) },
    body: JSON.stringify({ operation, args }),
  });
  const result = await response.json();
  if(response.status===401)endCatalogSession();
  if (!response.ok) throw new Error(result.error || 'POS is unavailable. Please try again.');
  return (result.unchanged && cached ? cached : result.data) as T;
}

export function installWebBridge() {
  window.posAuth = {
    state: () => call('auth:state'),
    login: (username, password) => call('auth:login', username, password),
    logout: () => call('auth:logout'),
    changePassword: (current, next) => call('auth:change-password', current, next),
  };
  window.posManagement = {
    monthly: month => call('management:monthly',month),
    recordPayment: (id,month,amount,operationId) => call('management:record-payment',id,month,amount,operationId),
    setPaid: (id,month,paid) => call('management:set-paid',id,month,paid),
    list: (kind, search) => call('management:list', kind, search),
    save: record => call('management:save', record),
    remove: (kind, id) => call('management:remove', kind, id),
  };
  window.posSales = {
    paymentMethods: () => call('sales:payment-methods'),
    menu: search => call('sales:menu', search),
    favourite: (id, enabled) => call('sales:favourite', id, enabled),
    creditors: search => call('sales:creditors', search),
    save: request => call('sales:save', request),
    history: filter => call('sales:history', filter),
    saveExpense: request => call('expenses:save', request),
    expenses: (start, end, shopId = '') => call('expenses:list', start, end, shopId),
    creditorAccount: id => call('creditors:account', id),
    recoverCredit: request => call('creditors:recover', request),
    repayments: (start, end, shopId = '') => call('creditors:repayments', start, end, shopId),
  };
}
