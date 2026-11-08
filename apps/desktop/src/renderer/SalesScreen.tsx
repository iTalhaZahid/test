import { LoadingCard } from './LoadingCard';
import { cachedMenu, cachedPaymentMethods, cachedFloors, clearCatalogCache, peekCatalog } from './catalog-cache';
import { LoadingSkeleton } from './LoadingSkeleton';
import { salesInvoiceNumber } from './sales-invoice';
import { SavedDialog } from './SavedDialog';
import { receivedAmountError } from './received-amount';
import { PortionDialog } from './PortionDialog';
import { SalesReceipt } from './SalesReceipt';
import { ReportPagination } from './ReportPagination';
import { discountAmount, menuPortionPrice, type MealPortion, type SaleDiscount } from '../main/sales-contract';
import type { ManagementRecord } from '../main/management-contract';
import { useEffect, useRef, useState } from 'react';
import { Search, Star, Minus, Plus, ShoppingBasket, X } from 'lucide-react';
import type { Sale, Creditor, CustomerType, MenuItem, PaymentMethod, SaleRequest } from '../main/sales-contract';

export const money = (minor: number) => `QAR ${(minor / 100).toFixed(2)}`;
type CartLine = MenuItem & { quantity: number; cartKey: string; portion?: MealPortion };

export function SalesScreen({ cashierId, manageFinance = false }: { cashierId: string; manageFinance?: boolean }) {
  const [floors,setFloors]=useState<ManagementRecord[]>(peekCatalog('floors')||[]),[floorId,setFloorId]=useState(''),[tableNumber,setTableNumber]=useState('');
  const [floorError,setFloorError]=useState('');
  const [floorsLoading,setFloorsLoading]=useState(!peekCatalog('floors'));
  useEffect(()=>{let active=true;cachedFloors().then(rows=>{if(active)setFloors(rows);}).catch(()=>{if(active)setFloorError('Could not load tables. Reopen sales to retry.');}).finally(()=>{if(active)setFloorsLoading(false);});return()=>{active=false;};},[]);
  const [methods,setMethods] = useState<PaymentMethod[]>(peekCatalog('payments')||[]);
  const [paymentMethodId,setPaymentMethodId] = useState('payment-cash');
  const [methodsLoading,setMethodsLoading] = useState(!peekCatalog('payments'));
  const [methodsError,setMethodsError] = useState('');
  const [methodsRetry,setMethodsRetry] = useState(0);
  const [items,setItems] = useState<MenuItem[]>(peekCatalog('menu')||[]);
  const [search,setSearch] = useState('');
  const [menuPage,setMenuPage] = useState(1);
  const [cart,setCart] = useState<CartLine[]>([]);
  const [portionItem,setPortionItem] = useState<MenuItem|null>(null);
  const portionTrigger = useRef<HTMLButtonElement|null>(null);
  const [type,setType] = useState<CustomerType>('walk-in');
  const [creditor,setCreditor] = useState<Creditor | null>(null);
  const [appliedDiscount,setAppliedDiscount]=useState<SaleDiscount>();
  const [discountDraftError,setDiscountDraftError]=useState('');
  const discountDialog=useRef<HTMLDialogElement>(null);
  const discountTrigger=useRef<HTMLButtonElement>(null);
  const [discountOpen,setDiscountOpen]=useState(false),[discountType,setDiscountType]=useState<SaleDiscount['type']>('percent'),[discountValue,setDiscountValue]=useState('');
  const [received,setReceived] = useState('');
  const [amountAttempted,setAmountAttempted]=useState(false);
  const receivedInput=useRef<HTMLInputElement>(null);
  const [picker,setPicker] = useState(false);
  const [creditorSearch,setCreditorSearch] = useState('');
  const [creditors,setCreditors] = useState<Creditor[]>([]);
  const [creditorsLoading,setCreditorsLoading] = useState(true);
  const [creditorsError,setCreditorsError] = useState('');
  const [creditorsRetry,setCreditorsRetry] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState('');
  const [autoPrint,setAutoPrint]=useState(false),[printed,setPrinted]=useState(false);
  const [lastSale,setLastSale]=useState<Sale|null>(null),[receiptOpen,setReceiptOpen]=useState(false);
  const [loading,setLoading] = useState(!peekCatalog('menu'));
  const [menuError,setMenuError] = useState('');
  const [pending,setPending] = useState<SaleRequest | null>(null);
  const [refresh,setRefresh] = useState(0);
  const [draftUnreadable,setDraftUnreadable] = useState(false);
  const draftKey = `pos-sale-attempt:${cashierId}`;
  useEffect(()=>{
    let active=true,reading=false;
    const load=async()=>{
      if(reading)return;
      reading=true;setMethodsLoading(!peekCatalog('payments'));
      try {
        const rows=await cachedPaymentMethods();
        if(active){setMethods(rows);setMethodsError('');setPaymentMethodId(previous=>rows.some(row=>row.id===previous)?previous:rows.find(row=>row.id==='payment-cash')?.id||rows[0]?.id||'');}
      } catch { if(active)setMethodsError('Could not load payment methods. Check your connection and retry.'); }
      finally { reading=false;if(active)setMethodsLoading(false); }
    };
    void load();
    window.addEventListener('online',load);
    return()=>{active=false;window.removeEventListener('online',load);};
  },[methodsRetry]);
  useEffect(() => {
    try {
      const stored = localStorage.getItem(draftKey);
      if (stored) {
        const request = JSON.parse(stored) as SaleRequest;
        if (!request || typeof request.operationId !== 'string' || !Array.isArray(request.lines) || request.lines.some(line=>!line || !Number.isSafeInteger(line.quantity) || !Number.isSafeInteger(line.unitPrice))) throw new Error('Invalid saved attempt');
        setPending(request);setFloorId(request.table?.floorId||'');setTableNumber(request.table?String(request.table.number):''); setType(request.customerType); setReceived((request.receivedMinor/100).toFixed(2));
        setMessage('An earlier save needs confirmation. Retry Save & Print to recover its original result.');
      }
    }
    catch { setDraftUnreadable(true); setMessage('Cannot read the previous save attempt. Do not save another order until local storage is available.'); }
  }, [draftKey]);
  useEffect(() => {
    let active = true; setLoading(!!search||!peekCatalog('menu'));
    let reading=false;
    const load=async()=>{
      if(reading)return;
      reading=true;
      try { const rows=await cachedMenu(search);if(active){setItems(rows);setMenuError('');} }
      catch(error) { if(active)setMenuError(error instanceof Error?error.message:'Could not load menu. Check your connection and retry.'); }
      finally { reading=false;if(active)setLoading(false); }
    };
    const timer=setTimeout(()=>void load(),150);
    window.addEventListener('online',load);
    return () => { active=false; clearTimeout(timer);window.removeEventListener('online',load); };
  },[search,refresh]);
  useEffect(() => { if (picker) dialog.current?.showModal(); },[picker]);
  useEffect(() => {
    if (!picker) return;
    let active=true;
    setCreditorsLoading(true);setCreditorsError('');
    window.posSales.creditors(creditorSearch).then(rows => { if(active) setCreditors(rows); })
      .catch(()=>{if(active)setCreditorsError('Could not load creditors. Check your connection and retry.');})
      .finally(()=>{if(active)setCreditorsLoading(false);});
    return () => { active=false; };
  },[picker,creditorSearch,creditorsRetry]);
  function openCreditors(){setCreditorsLoading(true);setCreditorSearch('');setPicker(true);}
  const subtotal = pending ? pending.lines.reduce((sum,line)=>sum+line.unitPrice*line.quantity,0) : cart.reduce((sum,line) => sum+line.priceMinor*line.quantity,0);
  useEffect(()=>{if(discountOpen)discountDialog.current?.showModal();},[discountOpen]);
  function closeDiscount(){setDiscountOpen(false);discountTrigger.current?.focus();}
  function applyDiscount(){
    try{
      if(!/^\d+(\.\d{1,2})?$/.test(discountValue))throw new Error('Enter a discount with up to two decimals.');
      const next={type:discountType,value:Math.round(Number(discountValue)*100)};
      discountAmount(subtotal,next);setAppliedDiscount(next);closeDiscount();
    }catch(e){setDiscountDraftError(e instanceof Error?e.message:'Invalid discount.');}
  }
  const discount=pending?pending.discount:appliedDiscount;
  let discountMinor=0,discountError='';
  try{discountMinor=discountAmount(subtotal,discount);}catch(e){discountError=e instanceof Error?e.message:'Invalid discount.';}
  const total=subtotal-discountMinor;
  const validAmount = received === '' || /^\d+(\.\d{1,2})?$/.test(received);
  const [whole,fraction=''] = received.split('.');
  const amount = pending ? pending.receivedMinor : validAmount ? Number(whole || 0)*100+Number(fraction.padEnd(2,'0')) : 0;
  const amountError=receivedAmountError(received,amount,total,type,methods.find(method=>method.id===paymentMethodId)?.category);
  const showAmountError=amountAttempted&&!pending&&!!amountError;
  const locked = busy || autoPrint || !!pending || draftUnreadable;
  function add(item: MenuItem, portion?: MealPortion) {
    if (locked) return;
    const cartKey = `${item.id}:${portion||'regular'}`;
    const priceMinor = menuPortionPrice(item.priceMinor,item.halfPriceMinor,portion);
    setCart(rows => rows.some(row=>row.cartKey===cartKey) ? rows.map(row=>row.cartKey===cartKey?{...row,quantity:Math.min(9999,row.quantity+1)}:row) :
      [...rows,{...item,cartKey,portion,priceMinor,name:item.name+(portion?` (${portion==='half'?'Half':'Full'})`:''),quantity:1}]);
  }
  function selectItem(item: MenuItem, trigger: HTMLButtonElement) {
    if (locked) return;
    if (item.halfPriceMinor) { portionTrigger.current=trigger; setPortionItem(item); }
    else add(item);
  }
  function closePortion() { setPortionItem(null); portionTrigger.current?.focus(); }
  function quantity(key: string, delta: number) { setCart(rows => rows.map(row => row.cartKey===key ? {...row,quantity:Math.min(9999,row.quantity+delta)} : row).filter(row => row.quantity>0)); }
  async function favourite(item: MenuItem) {
    try { await window.posSales.favourite(item.id,!item.favourite); clearCatalogCache('menu');setRefresh(v => v+1); }
    catch { setMessage('Unable to change favourite.'); }
  }
  async function save() {
    if (busy || draftUnreadable) return;
    if(!pending){setAmountAttempted(true);if(amountError){setMessage(amountError);receivedInput.current?.focus();return;}}
    if(discountError){setMessage(discountError);return;}
    if (!pending && (!cart.length || !paymentMethodId || !validAmount || (type==='creditor' && !creditor))) { setMessage('Add items, enter a valid amount, and select a creditor when required.'); return; }
    if(!pending&&floorId&&!tableNumber){setMessage('Choose a table for the selected floor.');return;}
    const request: SaleRequest = pending || { operationId:crypto.randomUUID(), customerType:type, creditorId:type==='creditor' ? creditor!.id : null, paymentMethodId, ...(discount?{discount}:{}), ...(floorId&&tableNumber?{table:{floorId,number:Number(tableNumber)}}:{}), receivedMinor:amount, lines:cart.map(row => ({itemId:row.id,quantity:row.quantity,unitPrice:row.priceMinor,...(row.portion?{portion:row.portion}:{})})) };
    setBusy(true); setMessage('');
    try {
      // Keep the original ID across a lost response or app restart; never generate a second save attempt.
      localStorage.setItem(draftKey,JSON.stringify(request)); setPending(request);
      const result = await window.posSales.save(request);
      if (!result.ok) {
        setMessage(result.message);
        if (!result.pending) { localStorage.removeItem(draftKey); setPending(null);clearCatalogCache('menu'); setRefresh(v=>v+1); }
        return;
      }
      localStorage.removeItem(draftKey); setPending(null); setCart([]); setReceived(''); setAmountAttempted(false); setCreditor(null); setType('walk-in');setDiscountOpen(false);setAppliedDiscount(undefined);setDiscountValue('');setFloorId('');setTableNumber('');
      setMessage(`Order saved · ${money(result.sale.total)} · Change ${money(result.sale.change)}${result.sale.credit ? ` · Credit ${money(result.sale.credit)}` : ''}`);
      setLastSale(result.sale); setAutoPrint(true); setReceiptOpen(true);
    } catch { setMessage('Save confirmation unavailable. Retry Save & Print with this same order.'); }
    finally { setBusy(false); }
  }
  const currentMenuPage=Math.min(menuPage,Math.max(1,Math.ceil(items.length/21)));
  const pageItems=[...items.filter(item=>item.favourite),...items.filter(item=>!item.favourite)].slice((currentMenuPage-1)*21,currentMenuPage*21);
  function pills(rows: MenuItem[]) {
    return <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 2xl:grid-cols-3">{rows.map(item => <div key={item.id} className="relative overflow-hidden rounded-xl border border-slate-200 bg-white">
      <button disabled={locked} onClick={event=>selectItem(item,event.currentTarget)} className="flex min-h-24 w-full items-center gap-3 p-3 pr-11 text-left hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-blue-700 disabled:opacity-50">
        {item.image ? <img src={item.image} alt="" loading="lazy" className="h-16 w-20 shrink-0 rounded-lg object-cover"/> : <span className="grid size-12 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-500"><ShoppingBasket size={24} aria-hidden="true"/></span>}
        <span className="min-w-0"><span className="block break-words text-sm font-semibold">{item.name}</span><span className="mt-1 block text-xs leading-5 text-slate-600">{item.halfPriceMinor?<><span className="block whitespace-nowrap">Half {money(item.halfPriceMinor)}</span><span className="block whitespace-nowrap">Full {money(item.priceMinor)}</span></>:money(item.priceMinor)}</span></span>
      </button><button onClick={() => void favourite(item)} aria-label={`${item.favourite ? 'Remove' : 'Add'} ${item.name} ${item.favourite ? 'from' : 'to'} favourites`} aria-pressed={item.favourite} className="absolute right-0 top-0 flex size-11 items-center justify-center rounded-full text-amber-700 hover:bg-amber-50 focus-visible:outline-2 focus-visible:outline-blue-700"><Star size={18} fill={item.favourite ? 'currentColor' : 'none'} /></button>
    </div>)}</div>;
  }
  return <div className="grid min-h-0 flex-1 items-start gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(400px,1fr)]">
    {portionItem&&<PortionDialog item={portionItem} onClose={closePortion} onSelect={portion=>{add(portionItem,portion);closePortion();}}/>}
    {receiptOpen&&lastSale&&<SalesReceipt autoPrint={autoPrint} sale={lastSale} onClose={()=>setReceiptOpen(false)} onPrinted={error=>{setReceiptOpen(false);setAutoPrint(false);if(error)setMessage(error);else setPrinted(true);}}/>}
    {printed&&<SavedDialog title="Order Saved" message={`Invoice ${salesInvoiceNumber(lastSale!)} saved and sent to printer.`} onClose={()=>setPrinted(false)}/>}
    <LoadingCard loading={loading} label="Loading menu"><section aria-label="Menu items" className="min-w-0">
      <label className="relative mb-5 block"><span className="sr-only">Search menu items</span><Search className="pointer-events-none absolute top-3.5 left-3 text-slate-400" size={18} aria-hidden="true" /><input className="login-input" type="search" maxLength={120} placeholder="Search menu items…" value={search} onChange={e => {setSearch(e.target.value);setMenuPage(1);}} /></label>
      {menuError&&<div role="alert" className="mb-4 text-sm text-red-700">{menuError} <button type="button" disabled={loading} className="underline" onClick={()=>setRefresh(value=>value+1)}>Retry menu</button></div>}
      {loading ? <LoadingSkeleton label="Loading menu" variant="cards" rows={6}/> : <><h2 className="mb-3 flex items-center gap-2 font-semibold"><Star size={18} className="text-amber-600" />Favourites</h2>{pageItems.some(item=>item.favourite) ? pills(pageItems.filter(item=>item.favourite)) : <p className="mb-4 text-sm text-slate-500">Use the star to pin your favourite items here.</p>}<h2 className="mt-6 mb-3 font-semibold">Other items</h2>{pills(pageItems.filter(item=>!item.favourite))}{!items.length&&!menuError && <p className="text-sm text-slate-500">No matching menu items.</p>}<ReportPagination page={currentMenuPage} total={items.length} pageSize={21} onChange={setMenuPage} disabled={locked} ariaLabel="Menu pages"/></>}
    </section></LoadingCard>
    <LoadingCard loading={methodsLoading||floorsLoading} label="Loading sales invoice"><section aria-label="Sales invoice" className="management-panel flex min-w-0 flex-col rounded-2xl border border-slate-200 bg-white p-5">
      <div className="shrink-0">
      <h2 className="mb-4 flex items-center gap-2 text-xl font-semibold"><ShoppingBasket size={22} />Sales Invoice</h2>
      <div className="grid grid-cols-2 gap-3">
      <label className="grid min-w-0 gap-2 text-sm font-medium">Customer type<select disabled={locked} className="login-input min-w-0" value={type} onChange={e => { const next=e.target.value as CustomerType; if(next==='creditor') { openCreditors(); } else { setType(next); setCreditor(null); } }}><option value="walk-in">Walk in Customer</option>{manageFinance&&<option value="creditor">Creditor</option>}<option value="delivery">Delivery</option></select></label>
      <label className="grid min-w-0 gap-2 text-sm font-medium">Payment method{methodsLoading?<LoadingSkeleton label="Loading payment methods" variant="field"/>:<select disabled={locked||methodsLoading||!!methodsError} className="login-input min-w-0" value={pending?.paymentMethodId||paymentMethodId} onChange={e=>setPaymentMethodId(e.target.value)}>{!methods.length&&<option value="">{methodsError?'Payment methods unavailable':'No active payment methods'}</option>}{methods.map(method=><option key={method.id} value={method.id}>{method.category==='online'?'Online · ':''}{method.name}</option>)}</select>}</label>
      {methodsError&&<div role="alert" className="col-span-2 text-sm text-red-700">{methodsError} <button type="button" disabled={methodsLoading} className="underline" onClick={()=>setMethodsRetry(value=>value+1)}>Retry payment methods</button></div>}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3"><label className="grid min-w-0 gap-2 text-sm font-medium">Floor{floorsLoading?<LoadingSkeleton label="Loading floors" variant="field"/>:<select disabled={locked||!!floorError} className="login-input min-w-0" value={floorId} onChange={e=>{setFloorId(e.target.value);setTableNumber('');}}><option value="">No table / takeaway</option>{floors.map(floor=><option key={floor.id} value={floor.id}>{floor.name}</option>)}</select>}</label><label className="grid min-w-0 gap-2 text-sm font-medium">Table{floorsLoading?<LoadingSkeleton label="Loading tables" variant="field"/>:<select disabled={locked||!floorId} className="login-input min-w-0" value={tableNumber} onChange={e=>setTableNumber(e.target.value)}><option value="">Choose table</option>{floors.find(floor=>floor.id===floorId)?.tables?.map(number=><option key={number} value={number}>{floors.find(floor=>floor.id===floorId)!.name.charAt(0).toUpperCase()}{number}</option>)}</select>}</label></div>
      {floorError&&<p role="alert" className="mt-2 text-sm text-red-700">{floorError}</p>}
      {creditor && <button disabled={locked} onClick={openCreditors} className="my-3 text-sm text-blue-700">Creditor: {creditor.name} · Change</button>}
      <div className="mt-5 grid grid-cols-[minmax(0,1fr)_65px_98px_75px] gap-2 border-b pb-2 text-xs text-slate-500"><span>Item name</span><span>Unit price</span><span className="text-center">Quantity</span><span className="text-right">Total</span></div>
      </div>
      <div role="region" aria-label="Invoice items">
      {cart.map(line => <div key={line.cartKey} className="grid grid-cols-[minmax(0,1fr)_65px_98px_75px] items-center gap-2 border-b border-slate-100 py-4 text-sm"><span className="break-words font-medium">{line.name}</span><span>{(line.priceMinor/100).toFixed(2)}</span><div className="flex items-center justify-between rounded-lg border border-slate-200"><button disabled={locked} aria-label={`Decrease ${line.name}`} onClick={()=>quantity(line.cartKey,-1)} className="p-1.5"><Minus size={14}/></button><span>{line.quantity}</span><button disabled={locked || line.quantity>=9999} aria-label={`Increase ${line.name}`} onClick={()=>quantity(line.cartKey,1)} className="p-1.5"><Plus size={14}/></button></div><span className="break-all text-right">{(line.priceMinor*line.quantity/100).toFixed(2)}</span></div>)}
      {!cart.length && <p className="py-8 text-center text-sm text-slate-500">{pending ? 'Previous save awaiting confirmation.' : 'Select menu items to start your order.'}</p>}
      </div>
      <div className="shrink-0 border-t border-slate-200">
      <div className="mt-3 flex items-center justify-between text-sm"><span>Subtotal</span><strong>{money(subtotal)}</strong></div>
      <button ref={discountTrigger} type="button" disabled={locked} aria-haspopup="dialog" onClick={()=>{setDiscountType(appliedDiscount?.type||'percent');setDiscountValue(appliedDiscount?String(appliedDiscount.value/100):'');setDiscountDraftError('');setDiscountOpen(true);}} className="mt-3 rounded-lg border border-blue-200 px-3 py-2 text-sm font-semibold text-blue-700">{discount?'Edit discount':'Discount'}</button>
      {discountError&&<p role="alert" className="mt-2 text-sm text-red-700">{discountError}</p>}
      {discount&&<div className="mt-3 flex items-center justify-between gap-3 text-sm text-emerald-700"><span>Discount{discount.type==='percent'?` (${discount.value/100}%)`:''}</span><span className="flex items-center gap-2"><strong>-{money(discountMinor)}</strong><button type="button" disabled={locked} aria-label="Remove discount" title="Remove discount" onClick={()=>setAppliedDiscount(undefined)} className="flex size-11 items-center justify-center rounded-lg text-red-700 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-red-700 disabled:opacity-40"><X size={16} aria-hidden="true"/></button></span></div>}
      <div className="my-5 flex justify-between gap-4 text-lg font-semibold"><span>Total bill</span><span>{money(total)}</span></div>
      <label className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-3 text-sm font-medium">Amount received (QAR)<input ref={receivedInput} disabled={locked} aria-invalid={showAmountError} aria-describedby={showAmountError?"received-amount-error":undefined} className="login-input min-w-0" type="number" min="0" step="0.01" value={received} onChange={e=>setReceived(e.target.value)} placeholder={type==='creditor' ? '0.00 — full credit' : '0.00'} /></label>
      {showAmountError&&<p id="received-amount-error" role="alert" className="mt-2 text-sm text-red-700">{amountError}</p>}
      <div className="mt-3 flex justify-between text-sm"><span>Amount to return</span><strong>{money(Math.max(0,amount-total))}</strong></div>
      {type==='creditor' && <div className="mt-2 flex justify-between text-sm text-amber-700"><span>Add to creditor balance</span><strong>{money(Math.max(0,total-amount))}</strong></div>}
      <button disabled={busy || autoPrint || (!pending && (!cart.length || !methods.length || methodsLoading || !!methodsError))} onClick={()=>void save()} className="primary-button mt-5">{busy ? 'Saving…' : pending ? 'Retry Save & Print' : 'Save & Print'}</button>
      {lastSale&&<button className="mt-3 rounded-lg border border-blue-200 px-4 py-2 text-sm font-semibold text-blue-700" onClick={()=>setReceiptOpen(true)}>Print last receipt</button>}
      {message && <p role="status" className="mt-4 text-sm leading-6">{message}</p>}
      <p className="mt-3 text-xs text-slate-400">QAR · Saved locally · Synced in the background</p>
      </div>
    </section></LoadingCard>
    {discountOpen&&<dialog ref={discountDialog} onCancel={closeDiscount} aria-labelledby="discount-title" className="management-panel m-auto w-full max-w-md rounded-2xl bg-white p-6 shadow-xl backdrop:bg-slate-950/40"><h2 id="discount-title" className="text-xl font-semibold">Invoice discount</h2><p className="mt-2 text-sm text-slate-500">Subtotal: {money(subtotal)}</p><form className="mt-5 grid gap-4" onSubmit={e=>{e.preventDefault();applyDiscount();}}><div><p className="mb-2 text-sm font-medium">Discount type</p><div role="group" aria-label="Discount type" className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">{(['percent','cash'] as const).map(type=><button key={type} type="button" autoFocus={type===discountType} aria-pressed={discountType===type} onClick={()=>{if(type!==discountType){setDiscountType(type);setDiscountValue('');setDiscountDraftError('');}}} className={`min-h-11 rounded-lg px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${discountType===type?'bg-blue-700 text-white shadow-sm':'text-slate-600 hover:bg-white'}`}>{type==='percent'?'Percentage (%)':'Cash (QAR)'}</button>)}</div></div><label className="grid gap-2 text-sm font-medium">{discountType==='percent'?'Percentage':'Amount (QAR)'}<input required type="number" min="0" max={discountType==='percent'?100:subtotal/100} step="0.01" className="login-input" value={discountValue} onChange={e=>{setDiscountValue(e.target.value);setDiscountDraftError('');}}/></label>{discountDraftError&&<p role="alert" className="text-sm text-red-700">{discountDraftError}</p>}<div className="flex flex-wrap justify-end gap-3"><button type="button" className="min-h-11 rounded-lg border px-4" onClick={closeDiscount}>Cancel</button><button className="min-h-11 rounded-lg bg-blue-700 px-4 font-semibold text-white hover:bg-blue-800">Apply</button></div></form></dialog>}
    {picker && <dialog ref={dialog} onCancel={()=>setPicker(false)} aria-labelledby="creditor-picker-title" className="m-auto w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl backdrop:bg-slate-950/40"><div className="mb-4 flex items-center justify-between"><h2 id="creditor-picker-title" className="text-lg font-semibold">Select creditor</h2><button onClick={()=>setPicker(false)} aria-label="Close creditor picker"><X size={20}/></button></div><label className="relative block"><span className="sr-only">Search creditors</span><Search size={18} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input autoFocus className="login-input" type="search" maxLength={120} placeholder="Search name or phone…" value={creditorSearch} onChange={e=>{setCreditorsLoading(true);setCreditorSearch(e.target.value);}} /></label><div className="mt-4 max-h-80 overflow-y-auto" aria-busy={creditorsLoading}>{creditorsLoading?<LoadingSkeleton label="Loading creditors"/>:creditorsError?<div role="alert" className="p-4 text-sm text-red-700">{creditorsError} <button type="button" className="underline" onClick={()=>setCreditorsRetry(value=>value+1)}>Retry creditors</button></div>:<>{creditors.map(row=><button key={row.id} onClick={()=>{setCreditor(row);setType('creditor');setPicker(false);}} className="block w-full rounded-lg p-3 text-left hover:bg-blue-50"><span className="block font-medium">{row.name}</span><span className="text-sm text-slate-500">{row.phone}</span></button>)}{!creditors.length && <p className="p-4 text-sm text-slate-500">No creditors found. Ask an administrator to add one.</p>}</>}</div></dialog>}
  </div>;
}
