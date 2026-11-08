import { useEffect, useRef, useState } from 'react';
import { Utensils } from 'lucide-react';
import { salesInvoiceNumber } from './sales-invoice';
import { createPortal } from 'react-dom';
import type { Sale } from '../main/sales-contract';

const amount = (value:number) => (value/100).toFixed(2);
export function ReceiptContent({sale}:{sale:Sale}) {
  const cash = !sale.paymentMethod || sale.paymentMethod.category==='cash';
  return <article className="thermal-receipt">
    <Utensils className="receipt-icon" aria-hidden="true"/><h1>{sale.shopName || 'Shop name unavailable'}</h1>
    <h2>CASH RECEIPT</h2>
    <p><b>Sales Invoice #:</b> {salesInvoiceNumber(sale)}</p>
    <p><b>Date:</b> {new Date(sale.date).toLocaleString('en-GB',{timeZone:'Asia/Karachi',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:true}).replaceAll('/','-')}</p>
    <p><b>Cashier:</b> {sale.cashierName}</p>
    <p><b>Customer Type:</b> {sale.customerType==='creditor'?'Creditor':sale.customerType==='delivery'?'Delivery':'Walk in Customer'}</p>
    <p><b>Payment Method:</b> {sale.paymentMethod?.name || 'Cash'}</p>
    <p><b>Table Number:</b> {sale.table?`${sale.table.floorName} - ${sale.table.label}`:'No table / takeaway'}</p>
    <table><thead><tr><th>Item</th><th>Qty x Price</th><th>Amount</th></tr></thead><tbody>{sale.lines.map((line,index)=><tr key={index}><td>{line.name}</td><td>{line.quantity} x {amount(line.unitPrice)}</td><td>{amount(line.total)}</td></tr>)}</tbody></table>
    {!!sale.discountMinor&&<><p className="receipt-row receipt-subtotal"><span>Subtotal</span><span>{amount(sale.subtotal ?? sale.total+sale.discountMinor)}</span></p><p className="receipt-row"><span>Discount{sale.discount?.type==='percent'?` (${sale.discount.value/100}%)`:''}</span><span>-{amount(sale.discountMinor)}</span></p></>}
    <p className="receipt-row receipt-total"><b>Total</b><b>{amount(sale.total)}</b></p>
    <p className="receipt-row"><span>{cash?'Cash Received':'Amount Received'}</span><span>{amount(sale.received)}</span></p>
    <p className="receipt-row"><span>Cash Returned</span><span>{amount(sale.change)}</span></p>
    {sale.credit>0&&<p className="receipt-row"><b>Credit remaining</b><b>{amount(sale.credit)}</b></p>}
    <footer>Thankyou for Dinning with Us!</footer>
  </article>;
}
export function SalesReceipt({sale,onClose,autoPrint=false,onPrinted}:{sale:Sale;onClose:()=>void;autoPrint?:boolean;onPrinted?:(error?:string)=>void}) {
  const ref=useRef<HTMLDialogElement>(null),started=useRef(false);
  const [status,setStatus]=useState(''),[printing,setPrinting]=useState(false);
  async function print() {
    setPrinting(true);setStatus('');
    try {
      await document.fonts.ready;
      await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
      if(window.posPrinter){await window.posPrinter.printReceipt();setStatus('Receipt sent to printer.');}
      else if(autoPrint)throw new Error('Automatic printing requires the desktop POS app. Use Print last receipt to print from your browser.');
      else window.print();
      if(autoPrint)onPrinted?.();
    } catch(error){const message=`Order is saved. ${error instanceof Error?error.message:'Printing failed.'} Retry Print last receipt.`;setStatus(message);if(autoPrint)onPrinted?.(message);}
    finally{setPrinting(false);}
  }
  useEffect(()=>{if(!autoPrint)ref.current?.showModal();if(autoPrint&&!started.current){started.current=true;void print();}},[autoPrint]);
  if(autoPrint)return createPortal(<div className="receipt-dialog receipt-auto" aria-hidden="true"><ReceiptContent sale={sale}/></div>,document.body);
  return createPortal(<dialog ref={ref} onCancel={event=>{if(printing)event.preventDefault();else onClose();}} aria-label="Sales receipt preview" className="receipt-dialog"><div className="receipt-controls"><p>{window.posPrinter?'Automatically uses your default installed printer, or the only available printer.':'Select your 80mm thermal printer, 80mm paper, 100% scale, and turn off headers and footers.'}</p>{status&&<p role="status">{status}</p>}<div><button autoFocus disabled={printing} onClick={()=>void print()}>{printing?'Printing...':'Print receipt'}</button><button disabled={printing} onClick={onClose}>Close</button></div></div><ReceiptContent sale={sale}/></dialog>,document.body);
}
