import { ReportPagination } from './ReportPagination';
import { Search } from 'lucide-react';
import { useEffect, useState, useRef } from 'react';
import type { MonthlyExpense } from '../main/management-contract';
import { ManagementPanel } from './ManagementPanel';
import { managementErrorMessage } from '../main/management-contract';
import { money } from './SalesScreen';
import { dateString } from './SalesHistory';

export function MonthlyExpenses(){
  const [page,setPage]=useState(1);
  const [month,setMonth]=useState(dateString(new Date()).slice(0,7)),[employee,setEmployee]=useState(''),[type,setType]=useState(''),[status,setStatus]=useState('');
  const [rows,setRows]=useState<MonthlyExpense[]>([]),[revision,setRevision]=useState(0),[manage,setManage]=useState(false),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const [selected,setSelected]=useState<MonthlyExpense|null>(null),[amount,setAmount]=useState(''),[operationId,setOperationId]=useState(''),[paymentError,setPaymentError]=useState(''),[attempted,setAttempted]=useState(false);
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{if(selected)dialog.current?.showModal();},[selected]);
  function openPayment(row:MonthlyExpense){setSelected(row);setAmount(((row.pricePaisa-row.paidMinor)/100).toFixed(2));setOperationId(crypto.randomUUID());setPaymentError('');setAttempted(false);}

  useEffect(()=>{let active=true;setLoading(true);setError('');window.posManagement.monthly(month).then(data=>{if(active){setRows(data);setPage(1);}}).catch(e=>{if(active)setError(e.message||'Could not load monthly expenses.');}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[month,revision]);
  async function update(){
    if(!selected||busy)return;
    if(!/^\d+(\.\d{1,2})?$/.test(amount)){setPaymentError('Enter a positive amount with up to two decimals.');return;}
    const [whole,fraction='']=amount.split('.'),minor=Number(whole)*100+Number(fraction.padEnd(2,'0'));
    if(!Number.isSafeInteger(minor)||minor<=0||minor>selected.pricePaisa-selected.paidMinor){setPaymentError('Enter an amount greater than zero and no more than the remaining balance.');return;}
    setBusy(true);setAttempted(true);setPaymentError('');
    try{await window.posManagement.recordPayment(selected.id,selected.month,minor,operationId);setSelected(null);setRevision(v=>v+1);}
    catch(e){setPaymentError(managementErrorMessage(e));}finally{setBusy(false);}
  }
  const filtered=rows.filter(r=>(!employee.trim()||`${r.employee||''} ${r.employeeId||''}`.toLowerCase().includes(employee.trim().toLowerCase()))&&(!type||r.expenseType===type)&&(!status||(status==='paid'?r.paid:status==='partial'?r.paidMinor>0&&!r.paid:r.paidMinor===0)));
  return <div className="management-panel">
    <div className="mb-5 flex flex-wrap items-center justify-end gap-3"><button className="rounded-lg bg-blue-700 px-4 py-3 text-white" onClick={()=>setManage(v=>!v)}>{manage?'Back to monthly payments':'Manage recurring entries'}</button></div>
    {manage?<ManagementPanel kind="recurring" onSaved={()=>setRevision(v=>v+1)}/>:<>
      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><label className="grid gap-2 text-sm">Status<select className="login-input" value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}><option value="">All statuses</option><option value="pending">Unpaid</option><option value="partial">Partially Paid</option><option value="paid">Paid</option></select></label>
        <label className="grid gap-2 text-sm">Employee<span className="relative block"><Search size={18} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input className="login-input" type="search" maxLength={120} placeholder="Search employees by name or ID" value={employee} onChange={e=>{setEmployee(e.target.value);setPage(1);}}/></span></label>
        <label className="grid gap-2 text-sm">Expense category<select className="login-input" value={type} onChange={e=>{setType(e.target.value);setPage(1);}}><option value="">All categories</option>{[...new Set(rows.map(r=>r.expenseType))].map(value=><option key={value}>{value}</option>)}</select></label>
        <label className="grid gap-2 text-sm">Month<input className="login-input" type="month" required value={month} onChange={e=>{if(e.target.value){setPage(1);setMonth(e.target.value);setEmployee('');setType('');}}}/></label>
      </div>
      {error&&<p role="alert" className="mb-4 text-red-700">{error}</p>}
      <div className="mb-5 flex flex-wrap gap-6 rounded-xl bg-blue-50 p-4"><p>Paid <strong>{money(filtered.reduce((sum,r)=>sum+r.paidMinor,0))}</strong></p><p>Remaining <strong>{money(filtered.reduce((sum,r)=>sum+r.pricePaisa-r.paidMinor,0))}</strong></p></div>
      {loading?<p role="status">Loading…</p>:<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{filtered.slice((page-1)*9,page*9).map(r=><section key={r.id} className="rounded-xl border border-slate-300 bg-slate-100 p-5 shadow-sm"><div className="flex items-start justify-between gap-3"><h2 className="font-semibold">{r.name}</h2></div><p className="mt-2 text-sm text-slate-500">{r.expenseType}{r.employee?` · ${r.employee}`:''}</p><div className="my-5 flex flex-wrap items-center justify-between gap-5"><p className="text-xl font-semibold">{money(r.pricePaisa)}</p><span className={`inline-flex -rotate-6 items-center justify-center rounded-md border-4 border-double px-5 py-3 text-center text-lg font-black uppercase tracking-widest ${r.paid?'border-green-200 bg-green-100 text-green-800':r.paidMinor>0?'border-amber-200 bg-amber-100 text-amber-800':'border-red-200 bg-red-100 text-red-800'}`}>{r.paid?'Paid':r.paidMinor>0?'Partially Paid':'Unpaid'}</span></div><p className="text-sm">Paid: {money(r.paidMinor)}</p><p className="mb-4 text-sm font-semibold">Remaining: {money(r.pricePaisa-r.paidMinor)}</p>{r.payments.length>0&&<details className="mb-4 text-sm"><summary className="cursor-pointer text-blue-700">Payment history ({r.payments.length})</summary><ul className="mt-2 space-y-2">{r.payments.map(p=><li key={p.operationId}>{money(p.amountMinor)} | {new Date(p.paidAt).toLocaleString()} | {p.paidBy}</li>)}</ul></details>}{r.paidAt&&<p className="mb-3 text-xs text-slate-500">Recorded by {r.paidBy} on {new Date(r.paidAt).toLocaleDateString()}</p>}<button disabled={busy||r.paid} onClick={()=>openPayment(r)} className="rounded-lg border border-blue-200 px-4 py-3 text-sm text-blue-700 disabled:opacity-50">{r.paid?'Fully paid':'Record payment'}</button></section>)}{!filtered.length&&<p>No expenses match this month and these filters.</p>}</div>}
      <ReportPagination page={page} pageSize={9} total={filtered.length} onChange={setPage} disabled={loading||busy}/>
      <p className="mt-5 text-sm text-slate-500">Each month's amount is saved when first opened; changes to recurring entries apply to unopened months. Payment status is recorded separately for each month. Record full or partial payments only after paying; this does not transfer money or duplicate an entry in daily expenses.</p>
    </>}
    {selected&&<dialog ref={dialog} onCancel={e=>{e.preventDefault();if(!busy){setSelected(null);setRevision(v=>v+1);}}} aria-labelledby="recurring-payment-title" className="m-auto w-full max-w-md rounded-2xl bg-white p-6 shadow-xl backdrop:bg-slate-950/40">
      <h2 id="recurring-payment-title" className="text-xl font-semibold">Record expense payment</h2>
      <p className="my-4">{selected.name} | {selected.month}<br/>Remaining: {money(selected.pricePaisa-selected.paidMinor)}</p>
      <form onSubmit={e=>{e.preventDefault();void update();}}><label className="grid gap-2 text-sm">Amount paid (QAR)<input autoFocus className="login-input" type="number" required min="0.01" step="0.01" max={(selected.pricePaisa-selected.paidMinor)/100} readOnly={attempted} disabled={busy} value={amount} onChange={e=>setAmount(e.target.value)}/></label>
      <p className="my-3 text-sm text-slate-500">Use the remaining balance to mark Paid, or enter a smaller amount for a partial payment.</p>
      {paymentError&&<p role="alert" className="my-3 text-sm text-red-700">{paymentError}</p>}
      <div className="flex gap-3"><button type="button" disabled={busy} className="rounded-lg border px-4 py-2" onClick={()=>{setSelected(null);setRevision(v=>v+1);}}>Close</button><button disabled={busy} className="primary-button">{busy?'Recording...':attempted?'Retry payment':'Confirm payment'}</button></div></form>
    </dialog>}
  </div>;
}
