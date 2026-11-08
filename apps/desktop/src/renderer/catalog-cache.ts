import type {} from './env';
import type { MenuItem, PaymentMethod } from '../main/sales-contract';
import type { ManagementRecord } from '../main/management-contract';

interface Catalog { menu:MenuItem[];payments:PaymentMethod[];floors:ManagementRecord[];expenseCategories:ManagementRecord[] }
const pending=new Map<keyof Catalog,Promise<unknown>>();
const loaded:Partial<Catalog>={};
const keys=['menu','payments','floors','expenseCategories'] as const;
const storageKey='pos-catalog-v2';
let owner:string|undefined;

function persist() {
  try { localStorage.setItem(storageKey,JSON.stringify(loaded)); }
  catch { /* Storage may be unavailable or full; the memory cache still works. */ }
}
function validRows(key:keyof Catalog,value:unknown):boolean {
  return Array.isArray(value)&&value.every(row=>{
    if(!row||typeof row!=='object'||typeof row.id!=='string'||typeof row.name!=='string')return false;
    if(key==='menu')return Number.isSafeInteger(row.priceMinor)&&row.priceMinor>0&&typeof row.favourite==='boolean'&&(row.image===undefined||typeof row.image==='string')&&(row.halfPriceMinor===undefined||Number.isSafeInteger(row.halfPriceMinor)&&row.halfPriceMinor>=0);
    if(key==='payments')return ['cash','card','online'].includes(row.category);
    if(key==='floors')return Array.isArray(row.tables)&&row.tables.every((table:unknown)=>typeof table==='number'&&Number.isSafeInteger(table)&&table>0);
    return row.kind==='expense-category';
  });
}
// Call only after the server has confirmed the current signed-in account.
export function activateCatalogSession(userId:string) {
  if(owner===userId)return;
  pending.clear();for(const key of keys)delete loaded[key];
  owner=userId;
  try {
    const saved=JSON.parse(localStorage.getItem(storageKey)||'null');
    if(saved)for(const key of keys){
      if(validRows(key,saved[key])){Object.assign(loaded,{[key]:saved[key]});if(!window.location?.protocol.startsWith('http'))pending.set(key,Promise.resolve(saved[key]));}
    }
  } catch { /* Invalid cache data is replaced by the next successful load. */ }
  persist();
}

function cached<K extends keyof Catalog>(key:K,load:()=>Promise<Catalog[K]>):Promise<Catalog[K]> {
  const existing=pending.get(key);
  if(existing)return existing as Promise<Catalog[K]>;
  const request=Promise.resolve().then(load);
  pending.set(key,request);
  void request.then(value=>{if(pending.get(key)===request){loaded[key]=value;persist();if(window.location?.protocol.startsWith('http'))pending.delete(key);}},()=>{if(pending.get(key)===request)pending.delete(key);});
  return request;
}
export function peekCatalog<K extends keyof Catalog>(key:K):Catalog[K]|undefined { return loaded[key]; }
export function clearCatalogCache(key?:keyof Catalog) {
  for(const name of key?[key]:keys){pending.delete(name);delete loaded[name];}
  persist();
}
export function endCatalogSession(){owner=undefined;pending.clear();for(const key of keys)delete loaded[key];}
export function cachedMenu(search:string) { return search.trim()?window.posSales.menu(search):cached('menu',()=>window.posSales.menu('')); }
export function cachedPaymentMethods() { return cached('payments',()=>window.posSales.paymentMethods()); }
export function cachedFloors() { return cached('floors',()=>window.posManagement.list('floor','')); }
export function cachedExpenseCategories() { return cached('expenseCategories',()=>window.posManagement.list('expense-category','')); }
export function warmCatalog() { return Promise.allSettled([cachedMenu(''),cachedPaymentMethods(),cachedFloors(),cachedExpenseCategories()]); }
