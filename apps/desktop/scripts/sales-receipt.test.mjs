import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { createRequire } from 'node:module';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
const require=createRequire(import.meta.url);
const source=readFileSync(new URL('../src/renderer/SalesReceipt.tsx',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const {receivedAmountError}=await import('../src/renderer/received-amount.ts');
const invoices=await import('../src/renderer/sales-invoice.ts');
const module={exports:{}};
new Function('require','module','exports',compiled)(name=>name==='./sales-invoice'?invoices:name==='react-dom'?{createPortal:children=>children}:require(name),module,module.exports);
const {ReceiptContent,SalesReceipt}=module.exports;
const sale={invoiceNumber:1001,id:'3edf3a7c-229e-4aea-a407-c3170d2410cd',date:'2026-11-08T08:24:00Z',table:{floorName:'Ground Floor',label:'G1'},shopName:'Main <Shop>',businessDate:'2026-11-08',cashierName:'Cashier One',lines:[{name:'Meal & drink',quantity:2,unitPrice:1000,total:2000}],subtotal:2000,discountMinor:200,discount:{type:'percent',value:1000},total:1800,received:2000,change:200,credit:0};
test('receipt preserves saved values, escapes names and includes discount and change',()=>{
 const html=renderToStaticMarkup(createElement(ReceiptContent,{sale}));
 for(const text of ['Main &lt;Shop&gt;',invoices.salesInvoiceNumber(sale),'08-11-2026','Cashier One','Meal &amp; drink','10%','18.00','20.00','2.00','Cash Received','Cash Returned'])assert.ok(html.includes(text),text);
 assert.ok(!html.includes('Credit remaining'));
 for(const text of ['CASH RECEIPT','Table Number:','Ground Floor','G1','Thankyou for Dinning with Us!','Qty x Price','Amount'])assert.ok(html.includes(text),text);
 assert.ok(!html.includes('QAR'));assert.ok(!html.includes(sale.id));
});
test('receipt omits unused discount and labels noncash credit payments accurately',()=>{
 const html=renderToStaticMarkup(createElement(ReceiptContent,{sale:{...sale,discount:undefined,discountMinor:0,paymentMethod:{name:'Card',category:'card'},credit:500}}));
 assert.ok(!html.includes('Discount'));assert.ok(!html.includes('Cash Received'));
 assert.ok(html.includes('Amount Received'));assert.ok(html.includes('Credit remaining'));assert.ok(html.includes('5.00'));
});

test('invoice numbers have eight digits and start at 00001001',()=>{
 assert.equal(invoices.salesInvoiceNumber({invoiceNumber:1001}),'00001001');
 assert.equal(invoices.salesInvoiceNumber({invoiceNumber:1002}),'00001002');
 assert.equal(invoices.salesInvoiceNumber({invoiceNumber:99999999}),'99999999');
});

test('receipts show every customer type, payment method and table or takeaway',()=>{
 for(const [customerType,label] of [['walk-in','Walk in Customer'],['creditor','Creditor'],['delivery','Delivery']]){
  const html=renderToStaticMarkup(createElement(ReceiptContent,{sale:{...sale,customerType,table:undefined,paymentMethod:{name:'Visa',category:'card'}}}));
  for(const text of ['Customer Type:',label,'Payment Method:','Visa','Table Number:','No table / takeaway'])assert.ok(html.includes(text),text);
 }
 const html=renderToStaticMarkup(createElement(ReceiptContent,{sale}));
 assert.ok(html.includes('Payment Method:</b> Cash'));
 assert.ok(html.includes('Ground Floor - G1'));
});
test('received amount rejects missing or invalid payment while retaining full-credit sales',()=>{
 assert.equal(receivedAmountError('',0,500,'walk-in','cash'),'Enter the amount received.');
 assert.equal(receivedAmountError('',0,500,'delivery','cash'),'Enter the amount received.');
 assert.equal(receivedAmountError('',0,500,'creditor','cash'),'');
 assert.equal(receivedAmountError('0',0,0,'walk-in','cash'),'');
 assert.ok(receivedAmountError('1.111',111,500,'walk-in','cash'));
 assert.ok(receivedAmountError('1',100,500,'walk-in','cash'));
 assert.ok(receivedAmountError('6',600,500,'walk-in','card'));
 assert.equal(receivedAmountError('6',600,500,'walk-in','cash'),'');
 assert.equal(receivedAmountError('5',500,500,'walk-in','card'),'');
});

test('automatic printing renders only a hidden receipt without a preview dialog or controls',()=>{
 globalThis.document={body:{}};
 try{
  const html=renderToStaticMarkup(createElement(SalesReceipt,{sale,autoPrint:true,onClose:()=>{}}));
  assert.ok(html.includes('receipt-auto'));
  assert.ok(html.includes('00001001'));
  assert.ok(!html.includes('<dialog'));
  assert.ok(!html.includes('Print receipt'));
  assert.ok(!html.includes('receipt-controls'));
 }finally{delete globalThis.document;}
});

test('Save & Print uses the browser dialog on web and the native printer on desktop',async()=>{
 for(const target of ['web','desktop','failed-desktop']){
  const previous={window:globalThis.window,document:globalThis.document,frame:globalThis.requestAnimationFrame};
  const effects=[];
  let browserCalls=0,nativeCalls=0;
  globalThis.document={body:{},fonts:{ready:Promise.resolve()}};
  globalThis.requestAnimationFrame=callback=>{globalThis.queueMicrotask(callback);return 1;};
  globalThis.window={print:()=>{browserCalls++;}};
  if(target!=='web')globalThis.window.posPrinter={printReceipt:async()=>{nativeCalls++;if(target==='failed-desktop')throw new Error('Printer unavailable.');}};
  try{
   const hooks={useRef:value=>({current:value}),useState:value=>[value,()=>{}],useEffect:effect=>effects.push(effect)};
   const instance={exports:{}};
   new Function('require','module','exports',compiled)(name=>name==='react'?hooks:name==='./sales-invoice'?invoices:name==='react-dom'?{createPortal:children=>children}:require(name),instance,instance.exports);
   let completed;
   const done=new Promise(resolve=>{completed=resolve;});
   instance.exports.SalesReceipt({sale,autoPrint:true,onClose:()=>{},onPrinted:completed});
   effects.forEach(effect=>effect());
   const error=await done;
   assert.equal(browserCalls,target==='web'?1:0);
   assert.equal(nativeCalls,target==='web'?0:1);
   if(target==='failed-desktop')assert.match(error,/Order is saved.*Printer unavailable/);
   else assert.equal(error,undefined);
  }finally{
   if(previous.window===undefined)delete globalThis.window;else globalThis.window=previous.window;
   if(previous.document===undefined)delete globalThis.document;else globalThis.document=previous.document;
   if(previous.frame===undefined)delete globalThis.requestAnimationFrame;else globalThis.requestAnimationFrame=previous.frame;
  }
 }
});
