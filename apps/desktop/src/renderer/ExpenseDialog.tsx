import { ShopSelect } from './ShopSelect';
import { CategorySelect } from './CategorySelect';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { X, Wallet } from 'lucide-react';
import type { ExpenseRequest } from '../main/sales-contract';
import { SavedDialog } from './SavedDialog';
import { money } from './SalesScreen';
import { dateString } from './SalesHistory';

export function ExpenseDialog({ cashierId,onClose,selectShop=false }: {cashierId:string;onClose:()=>void;selectShop?:boolean}) {
  const ref=useRef<HTMLDialogElement>(null);
  const [shopId,setShopId]=useState('');
  const [date,setDate]=useState(dateString(new Date()));
  const [category,setCategory]=useState('');
  const [description,setDescription]=useState('');
  const [paidVia,setPaidVia]=useState<'cash'|'online'>('cash');
  const [amount,setAmount]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [saved,setSaved]=useState('');
  const [pending,setPending]=useState<ExpenseRequest|null>(null);
  const [blocked,setBlocked]=useState(false);
  const key=`pos-expense-attempt:${cashierId}`;
  useEffect(()=>{
    ref.current?.showModal();
    try {
      const value=localStorage.getItem(key);
      if(value){const request=JSON.parse(value) as ExpenseRequest;if(!request||typeof request.operationId!=='string'||!Number.isSafeInteger(request.amountMinor))throw new Error('Invalid attempt');setPending(request);setShopId(request.shopId||'');setDate(request.date);setCategory(request.category);setDescription(request.description);setPaidVia(request.paidVia);setAmount((request.amountMinor/100).toFixed(2));setError('Previous save needs confirmation. Retry this same expense.');}
    }catch{setBlocked(true);setError('Unable to read previous save. Local storage must be available before saving.');}
  },[key]);
  async function submit(event:FormEvent){
    event.preventDefault(); if(busy||blocked)return;
    if(!pending&&!/^\d+(\.\d{1,2})?$/.test(amount)){setError('Enter a positive amount with at most two decimal places.');return;}
    const [whole,fraction='']=amount.split('.');
    const request=pending||{operationId:crypto.randomUUID(),date,category,description,paidVia,...(selectShop?{shopId}:{}),amountMinor:Number(whole)*100+Number(fraction.padEnd(2,'0'))};
    setBusy(true);setError('');
    try{
      localStorage.setItem(key,JSON.stringify(request));setPending(request);
      const result=await window.posSales.saveExpense(request);
      if(!result.ok){setError(result.message);if(!result.pending){localStorage.removeItem(key);setPending(null);}return;}
      localStorage.removeItem(key);setPending(null);setSaved(`${money(result.expense.amountMinor)} · ${result.expense.category}`);
    }catch{setError('Save confirmation unavailable. Retry this same expense.');}
    finally{setBusy(false);}
  }
  return <><dialog ref={ref} onCancel={event=>{event.preventDefault();if(!busy)onClose();}} aria-labelledby="expense-title" className="management-panel m-auto max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-xl backdrop:bg-slate-950/40"><div className="mb-5 flex items-center justify-between"><h2 id="expense-title" className="flex items-center gap-2 text-xl font-semibold"><Wallet size={22}/>Record Expense</h2><button disabled={busy} onClick={onClose} aria-label="Close expense dialog"><X size={20}/></button></div>
    <form onSubmit={submit}><fieldset disabled={busy||!!pending||blocked} className="grid gap-4">
      <label className="grid gap-1 text-sm font-medium">Date<input type="date" required value={date} onChange={e=>setDate(e.target.value)} className="login-input"/></label>
      {selectShop&&<ShopSelect value={shopId} onChange={setShopId}/>}
      <CategorySelect kind="expense-category" label="Expense category" value={category} onChange={setCategory}/>
      <label className="grid gap-1 text-sm font-medium">Description<textarea required maxLength={500} rows={3} value={description} onChange={e=>setDescription(e.target.value)} className="resize-y rounded-lg border border-slate-200 p-3 outline-blue-600"/></label>
      <label className="grid gap-1 text-sm font-medium">Paid via<select value={paidVia} onChange={e=>setPaidVia(e.target.value as 'cash'|'online')} className="login-input"><option value="cash">Cash</option><option value="online">Online</option></select></label>
      <label className="grid gap-1 text-sm font-medium">Amount (QAR)<input type="number" min="0.01" max="999999999.99" step="0.01" required value={amount} onChange={e=>setAmount(e.target.value)} placeholder="0.00" className="login-input"/></label>
    </fieldset>{error&&<p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}<button disabled={busy||blocked} className="primary-button mt-5">{busy?'Saving…':pending?'Retry Save Expense':'Save Expense'}</button></form>
  </dialog>{saved&&<SavedDialog title="Expense Saved" message={saved} onClose={onClose}/>}</>;
}
