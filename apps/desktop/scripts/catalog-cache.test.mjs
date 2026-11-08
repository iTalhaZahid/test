import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cachedMenu,cachedPaymentMethods,cachedFloors,cachedExpenseCategories,clearCatalogCache,peekCatalog,warmCatalog,activateCatalogSession,endCatalogSession } from '../src/renderer/catalog-cache.ts';

test('login preload shares in-flight reads, caches catalogs and floor tables, and retries failures',async()=>{
  const previous=globalThis.window;
  const calls={menu:0,payments:0,floors:0,categories:0};
  let finishMenu,failPayment=false;
  const menu=[{id:'meal',name:'Meal',priceMinor:500}],floors=[{id:'ground',tables:[1,2]}];
  globalThis.window={posSales:{
    menu:search=>{calls.menu++;return search?Promise.resolve([]):new Promise(resolve=>{finishMenu=resolve;});},
    paymentMethods:async()=>{calls.payments++;if(failPayment){failPayment=false;throw new Error('Offline');}return [{id:'cash'}];},
  },posManagement:{list:async kind=>{if(kind==='floor'){calls.floors++;return floors;}calls.categories++;return [{id:'salary',name:'Salary'}];}}};
  clearCatalogCache();
  try {
    const preload=warmCatalog(),firstScreen=cachedMenu('');
    await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(calls,{menu:1,payments:1,floors:1,categories:1});
    finishMenu(menu);
    await preload;
    assert.equal(await firstScreen,menu);
    assert.equal(await cachedMenu(''),menu);
    assert.equal(peekCatalog('menu'),menu);
    assert.deepEqual((await cachedFloors())[0].tables,[1,2]);
    await cachedPaymentMethods();await cachedExpenseCategories();
    assert.deepEqual(calls,{menu:1,payments:1,floors:1,categories:1});
    clearCatalogCache('payments');failPayment=true;
    await assert.rejects(cachedPaymentMethods(),/Offline/);
    await cachedPaymentMethods();assert.equal(calls.payments,3);
    await cachedMenu('meal');await cachedMenu('meal');assert.equal(calls.menu,3);
    clearCatalogCache('expenseCategories');await cachedExpenseCategories();assert.equal(calls.categories,2);
    clearCatalogCache();
    for(const key of ['menu','payments','floors','expenseCategories'])assert.equal(peekCatalog(key),undefined);
    const stale=cachedMenu('');await new Promise(resolve=>setImmediate(resolve));
    const finishStale=finishMenu;
    clearCatalogCache('menu');
    const current=cachedMenu('');await new Promise(resolve=>setImmediate(resolve));
    finishStale([{id:'old'}]);await stale;
    assert.equal(peekCatalog('menu'),undefined);
    finishMenu(menu);await current;assert.equal(peekCatalog('menu'),menu);
  } finally {clearCatalogCache();if(previous===undefined)delete globalThis.window;else globalThis.window=previous;}
});

test('shared catalogs survive reload, logout and switching verified users',async()=>{
  const previous={window:globalThis.window,storage:globalThis.localStorage};
  const disk=new Map();
  let calls=0;
  globalThis.localStorage={getItem:key=>disk.get(key)||null,setItem:(key,value)=>disk.set(key,value),removeItem:key=>disk.delete(key)};
  globalThis.window={posSales:{menu:async()=>{calls++;return [{id:'meal',name:'Meal',priceMinor:100,favourite:false}];},paymentMethods:async()=>{calls++;return [{id:'cash',name:'Cash',category:'cash'}];}},posManagement:{list:async kind=>{calls++;return kind==='floor'?[{id:'ground',name:'Ground Floor',tables:[1,2]}]:[{id:'salary',kind:'expense-category',name:'Salary'}];}}};
  endCatalogSession();
  try {
    activateCatalogSession('hamza');await warmCatalog();
    assert.equal(calls,4);
    const saved=disk.get('pos-catalog-v2');
    const reloaded=await import('../src/renderer/catalog-cache.ts?test=reload');
    assert.equal(reloaded.peekCatalog('menu'),undefined);
    reloaded.activateCatalogSession('hamza');await reloaded.warmCatalog();
    assert.equal(calls,4);
    assert.deepEqual(reloaded.peekCatalog('floors')[0].tables,[1,2]);
    reloaded.clearCatalogCache('payments');await reloaded.cachedPaymentMethods();
    assert.equal(calls,5);
    assert.ok(JSON.parse(disk.get('pos-catalog-v2')).menu);
    reloaded.endCatalogSession();
    assert.ok(disk.get('pos-catalog-v2'));assert.equal(reloaded.peekCatalog('menu'),undefined);
    disk.set('pos-catalog-v2',saved);
    const another=await import('../src/renderer/catalog-cache.ts?test=another-user');
    another.activateCatalogSession('ahmad');
    assert.ok(another.peekCatalog('menu'));
    const corrupt=JSON.parse(saved);corrupt.menu[0].priceMinor=-1;
    disk.set('pos-catalog-v2',JSON.stringify(corrupt));
    const invalid=await import('../src/renderer/catalog-cache.ts?test=invalid');
    invalid.activateCatalogSession('hamza');
    assert.equal(invalid.peekCatalog('menu'),undefined);
    assert.ok(invalid.peekCatalog('payments'));
    invalid.endCatalogSession();
  } finally {
    endCatalogSession();
    if(previous.window===undefined)delete globalThis.window;else globalThis.window=previous.window;
    if(previous.storage===undefined)delete globalThis.localStorage;else globalThis.localStorage=previous.storage;
  }
});
