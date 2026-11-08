import { salesInvoiceNumber } from './sales-invoice';
import { ChevronDown } from 'lucide-react';
import { reportDate } from './report-chart-data';
import { ReportPagination } from './ReportPagination';
import { useEffect,useRef,useState,type FormEvent } from 'react';
import type { CreditorAccount,RepaymentRequest } from '../main/sales-contract';
import { money } from './SalesScreen';
import { dateString } from './SalesHistory';
import { SavedDialog } from './SavedDialog';
import { ShopSelect } from './ShopSelect';

export function CreditorAccountPanel({id,recoveryOnly=false,onClose,fixedShopId}:{id:string;recoveryOnly?:boolean;onClose?:()=>void;fixedShopId?:string}) {
  const [account,setAccount]=useState<CreditorAccount|null>(null),[error,setError]=useState('');
  const [page,setPage]=useState(1);
  const [view,setView]=useState<'invoices'|'recoveries'>('invoices');
  const [revision,setRevision]=useState(0),[open,setOpen]=useState(recoveryOnly),[busy,setBusy]=useState(false);
  const [date,setDate]=useState(dateString(new Date())),[amount,setAmount]=useState(''),[saved,setSaved]=useState('');
  const [pending,setPending]=useState<RepaymentRequest|null>(null),[blocked,setBlocked]=useState(false);
  const [shopId,setShopId]=useState(fixedShopId||'');
  const dialog=useRef<HTMLDialogElement>(null),key=`pos-credit-recovery:${id}`;
  useEffect(()=>{let active=true;window.posSales.creditorAccount(id).then(value=>{if(active){setAccount(value);setPage(1);}}).catch(()=>{if(active)setError('Could not load creditor account.');});return()=>{active=false;};},[id,revision]);
  useEffect(()=>{try{const stored=localStorage.getItem(key);if(stored){const request=JSON.parse(stored) as RepaymentRequest;if(!request||request.creditorId!==id||!Number.isSafeInteger(request.amountMinor))throw new Error('Invalid attempt');setPending(request);setDate(request.date);setAmount((request.amountMinor/100).toFixed(2));}}catch{setBlocked(true);setError('Unable to read a previous recovery attempt. Resolve local storage before recording another payment.');}},[id,key]);
  useEffect(()=>{if(open)dialog.current?.showModal();},[open]);
  async function save(event:FormEvent){
    event.preventDefault();if(busy||blocked||(!account&&!pending))return;
    if(!pending&&!/^\d+(\.\d{1,2})?$/.test(amount)){setError('Enter an amount with up to two decimals.');return;}
    const [whole,fraction='']=amount.split('.');
    if(!pending&&!shopId){setError('Choose the shop where this payment was collected.');return;}
    const request=pending||{operationId:crypto.randomUUID(),creditorId:id,date,amountMinor:Number(whole)*100+Number(fraction.padEnd(2,'0')),shopId};
    setBusy(true);setError('');
    try{
      localStorage.setItem(key,JSON.stringify(request));setPending(request);
      const result=await window.posSales.recoverCredit(request);
      if(!result.ok){setError(result.message);if(!result.pending){localStorage.removeItem(key);setPending(null);}setRevision(v=>v+1);return;}
      localStorage.removeItem(key);setPending(null);setOpen(false);setAmount('');setRevision(v=>v+1);setSaved(money(result.repayment.amountMinor));
    }catch{setError('Payment confirmation unavailable. Retry this same recovery; do not collect it again.');}
    finally{setBusy(false);}
  }
  function closeRecovery(){setOpen(false);if(recoveryOnly)onClose?.();}
  return <><section hidden={recoveryOnly} className="min-w-0 rounded-2xl border border-slate-300 bg-slate-100 p-5" aria-label="Creditor credit account">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Credit account</h2><button disabled={!account||blocked||(!pending&&account.outstanding<=0)} onClick={()=>{setOpen(true);setError('');}} className="rounded-lg bg-blue-700 px-4 py-2 text-sm text-white disabled:opacity-40">{pending?'Retry recovery':'Add Recovery'}</button></div>
    {error&&!open&&<p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}
    {!account?<p>Loading account…</p>:<><div className="grid gap-3 sm:grid-cols-3">{[['Availed credit',account.credit],['Recovered',account.recovered],['Outstanding',account.outstanding]].map(([label,value])=><div key={label} className="rounded-xl bg-blue-50 p-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 break-words font-semibold">{money(Number(value))}</p></div>)}</div>
      <div className="my-5 flex gap-1 rounded-lg bg-slate-100 p-1" role="group" aria-label="Credit account history filter">{(['invoices','recoveries'] as const).map(value=><button key={value} type="button" aria-pressed={view===value} onClick={()=>{setView(value);setPage(1);}} className={`flex-1 rounded-md px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-blue-600 ${view===value?'bg-white text-blue-700 shadow-sm':'text-slate-600 hover:bg-slate-200'}`}>{value==='invoices'?'Linked sales invoices':'Recovery history'}</button>)}</div>
      {view==='invoices' && <><h3 className="mb-3 font-medium">Linked sales invoices</h3>{!account.sales.length&&<p className="text-sm text-slate-500">No credit sales yet.</p>}
      {account.sales.slice((page-1)*5,page*5).map(sale=><details key={sale.id} className="group mb-3 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <summary className="cursor-pointer list-none p-4 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-blue-600 [&::-webkit-details-marker]:hidden">
          <span className="flex items-baseline justify-between gap-3"><span className="font-semibold text-slate-900">Total Credit <span className="text-blue-700">{money(sale.credit)}</span></span><span className="shrink-0 text-sm text-slate-600">{reportDate(sale.businessDate)}</span></span>
          <span className="mt-2 flex items-center justify-between gap-3"><span className="text-sm text-slate-500">Credited by <span className="font-medium text-slate-700">{sale.cashierName}</span></span><span className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 text-xs font-semibold text-blue-700"><span className="group-open:hidden">Expand</span><span className="hidden group-open:inline">Collapse</span><ChevronDown size={16} aria-hidden="true" className="group-open:rotate-180"/></span></span>
        </summary>
        <div className="border-t border-slate-100 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Invoice number</p><p className="mt-1 break-all font-mono text-xs text-slate-700">{salesInvoiceNumber(sale)}</p>
          <h4 className="mt-5 mb-2 text-sm font-semibold text-slate-900">Order details</h4>
          <div className="divide-y divide-slate-100">{sale.lines.map(line=><div key={line.itemId} className="flex items-start justify-between gap-4 py-3"><div className="min-w-0"><p className="break-words text-sm font-medium text-slate-800">{line.name}</p><p className="mt-1 text-xs text-slate-500">{line.quantity} &times; {money(line.unitPrice)} each</p></div><strong className="shrink-0 text-sm text-slate-900">{money(line.total)}</strong></div>)}</div>
          <div className="mt-4 grid grid-cols-2 gap-3"><div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="text-xs font-medium text-slate-500">Total Bill</p><p className="mt-1 break-words text-lg font-semibold text-slate-900">{money(sale.total)}</p></div><div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3"><p className="text-xs font-medium text-emerald-700">Paid at Checkout</p><p className="mt-1 break-words text-lg font-semibold text-emerald-800">{money(sale.cashApplied)}</p></div></div>
        </div>
      </details>)}
      </>}
      {view==='recoveries' && <><h3 className="mb-3 font-medium">Recovery history</h3>{!account.repayments.length&&<p className="text-sm text-slate-500">No recoveries recorded.</p>}{account.repayments.slice((page-1)*5,page*5).map(payment=><article key={payment.id} className="mb-3 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="p-4"><div className="flex items-baseline justify-between gap-3"><h4 className="font-semibold text-slate-900">Recovered <span className="text-emerald-700">{money(payment.amountMinor)}</span></h4><span className="shrink-0 text-sm text-slate-600">{reportDate(payment.date)}</span></div><p className="mt-2 text-sm text-slate-500">Accepted by <span className="font-medium text-slate-700">{payment.acceptedByName}</span></p></div>
        <div className="grid gap-3 border-t border-slate-100 p-4"><div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3"><p className="text-xs font-medium text-emerald-700">Collection shop</p><p className="mt-1 break-words text-sm font-semibold text-emerald-900">{payment.shopName||'Unassigned (legacy)'}</p></div><div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Recovery reference</p><p className="mt-1 break-all font-mono text-xs text-slate-700">{payment.id}</p></div></div>
      </article>)}</>}

      <ReportPagination page={page} pageSize={5} total={view==='invoices'?account.sales.length:account.repayments.length} onChange={setPage} disabled={busy}/>
      <p className="mt-4 text-xs text-slate-500">Local balance · Server sync is not configured. Recoveries reduce the customer balance, not sales totals.</p>
    </>}
    </section>
    {open&&<dialog ref={dialog} onCancel={event=>{event.preventDefault();if(!busy)closeRecovery();}} aria-labelledby="recovery-title" className="management-panel m-auto w-full max-w-md rounded-2xl bg-white p-6 shadow-xl backdrop:bg-slate-950/40"><div className="mb-4 flex justify-between"><h2 id="recovery-title" className="text-lg font-semibold">Add Recovery</h2><button disabled={busy} onClick={closeRecovery}>Close</button></div><p className="mb-4 font-semibold">{account?.creditor.name||'Loading creditor...'}</p>{account&&<div className="mb-5 grid grid-cols-3 gap-2">{[['Total credit',account.credit],['Paid',account.recovered],['Remaining',account.outstanding]].map(([label,value])=><div key={label} className="rounded-xl border border-blue-100 bg-blue-50 p-3"><p className="text-xs text-slate-500">{label}</p><strong className="mt-1 block break-words text-sm">{money(Number(value))}</strong></div>)}</div>}<form onSubmit={save}><div className="mb-4"><ShopSelect value={pending?.shopId || shopId} onChange={setShopId} disabled={busy || !!pending || !!fixedShopId} /></div><fieldset disabled={busy||!!pending||!account||blocked} className="grid gap-4"><label className="grid gap-1 text-sm">Collection date<input className="login-input" type="date" required max={dateString(new Date())} value={date} onChange={e=>setDate(e.target.value)}/></label><label className="grid gap-1 text-sm">Receive new amount (QAR)<input className="login-input" type="number" min="0.01" max={(account?.outstanding||0)/100} step="0.01" required value={amount} onChange={e=>setAmount(e.target.value)}/></label></fieldset><p className="mt-4 text-xs text-slate-500">Record only money already received. This is a customer-level payment; no invoice selection is required.</p>{error&&<p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}<button disabled={busy||blocked||!account||(!pending&&account.outstanding<=0)} className="primary-button mt-5">{busy?'Saving…':pending?'Retry Save Recovery':'Save Recovery'}</button></form></dialog>}
    {saved&&<SavedDialog title="Recovery Saved" message={`${saved} received and deducted from the creditor balance.`} onClose={()=>{setSaved('');if(recoveryOnly)onClose?.();}}/>}
  </>;
}
