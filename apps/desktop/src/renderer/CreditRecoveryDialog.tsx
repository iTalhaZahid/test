import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import type { Creditor } from '../main/sales-contract';
import { CreditorAccountPanel } from './CreditorAccountPanel';

export function CreditRecoveryDialog({onClose,fixedShopId}:{onClose:()=>void;fixedShopId?:string}){
  const dialog=useRef<HTMLDialogElement>(null);
  const [query,setQuery]=useState(''),[selected,setSelected]=useState('');
  const [rows,setRows]=useState<Creditor[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState('');
  useEffect(()=>{dialog.current?.showModal();},[]);
  useEffect(()=>{let active=true;setLoading(true);setError('');const timer=setTimeout(()=>{window.posSales.creditors(query).then(value=>{if(active)setRows(value);}).catch(()=>{if(active)setError('Could not load creditors. Change the search to retry.');}).finally(()=>{if(active)setLoading(false);});},150);return()=>{active=false;clearTimeout(timer);};},[query]);
  if(selected)return <CreditorAccountPanel key={selected} id={selected} recoveryOnly fixedShopId={fixedShopId} onClose={onClose}/>;
  return <dialog ref={dialog} onCancel={onClose} aria-labelledby="recovery-search-title" className="management-panel m-auto w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl backdrop:bg-slate-950/40"><div className="mb-5 flex items-center justify-between gap-3"><h2 id="recovery-search-title" className="text-xl font-semibold">Record Credit Recovery</h2><button aria-label="Close recovery dialog" onClick={onClose} className="flex size-11 items-center justify-center rounded-lg hover:bg-slate-100"><X size={20}/></button></div><label className="grid gap-2 text-sm font-medium">Search creditor<span className="relative"><Search size={18} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input autoFocus type="search" maxLength={120} className="login-input pl-10" placeholder="Name or phone number" value={query} onChange={e=>setQuery(e.target.value)}/></span></label><div className="mt-4 max-h-80 overflow-y-auto" aria-busy={loading}>{loading?<p role="status" className="p-3 text-sm text-slate-500">Loading creditors...</p>:error?<p role="alert" className="p-3 text-sm text-red-700">{error}</p>:rows.length?rows.map(row=><button key={row.id} onClick={()=>setSelected(row.id)} className="mb-2 block w-full rounded-xl border border-slate-200 p-3 text-left hover:border-blue-300 hover:bg-blue-50"><span className="block font-semibold">{row.name}</span><span className="text-sm text-slate-500">{row.phone}</span></button>):<p className="p-3 text-sm text-slate-500">No matching creditors.</p>}</div></dialog>;
}
