import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Search, X } from 'lucide-react';
import { managementErrorMessage, type ManagementRecord } from '../main/management-contract';
import { ManagementPanel } from './ManagementPanel';

export function EmployeePicker({ employeeId, name, category, shopId, required, onChange }: {
  employeeId?: string; name?: string; category?: string; shopId?: string; required: boolean;
  onChange: (employee: ManagementRecord | null) => void;
}) {
  const [open,setOpen]=useState(false),[adding,setAdding]=useState(false),[addingBusy,setAddingBusy]=useState(false);
  const [rows,setRows]=useState<ManagementRecord[]>([]),[categories,setCategories]=useState<string[]>([]);
  const [selectedCategory,setSelectedCategory]=useState(category||'Driver'),[query,setQuery]=useState('');
  const [loading,setLoading]=useState(false),[error,setError]=useState(''),[revision,setRevision]=useState(0);
  const dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null),title=useId();
  useEffect(()=>{if(open)dialog.current?.showModal();},[open]);
  useEffect(()=>{
    if(!open)return;
    let active=true;setLoading(true);setError('');
    Promise.all([window.posManagement.list('employee',''),window.posManagement.list('cashier',''),window.posManagement.list('employee-category','')])
      .then(([employees,cashiers,groups])=>{if(active){setRows([...employees,...cashiers.map(row=>({...row,employeeCategory:'Cashier'}))]);setCategories([...new Set([...groups.map(row=>row.name),'Cashier'])]);}})
      .catch(e=>{if(active)setError(managementErrorMessage(e));})
      .finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[open,revision]);
  function close(){dialog.current?.close();setOpen(false);trigger.current?.focus();}
  const filtered=rows.filter(row=>(!selectedCategory||row.employeeCategory===selectedCategory)&&(!shopId||row.shopId===shopId)&&`${row.name} ${row.phone} ${row.id}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <div className="grid gap-2">
    <span className="text-sm font-medium">Employee {required?'(required for Salary)':'(optional)'}</span>
    <button ref={trigger} type="button" aria-haspopup="dialog" onClick={()=>{setAdding(false);setQuery('');setSelectedCategory(category||'Driver');setOpen(true);}} className="flex min-h-10 items-center justify-between gap-3 rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-sm hover:border-blue-600">
      <span>{employeeId?name||'Selected employee':'Choose registered employee'}</span><Search size={18} aria-hidden="true"/>
    </button>
    {name&&!employeeId&&<p className="text-xs text-amber-800">Previously entered: {name}. Choose the registered employee to link this entry.</p>}
    {!required&&(employeeId||name)&&<button type="button" onClick={()=>onChange(null)} className="justify-self-start text-sm text-blue-700 underline">Clear employee</button>}
    {open&&createPortal(<dialog ref={dialog} aria-labelledby={title} onSubmit={e=>e.stopPropagation()} onCancel={e=>{e.preventDefault();e.stopPropagation();if(!addingBusy)close();}} className="management-panel m-auto max-h-[90dvh] w-[min(1100px,95vw)] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl backdrop:bg-slate-950/40">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 id={title} className="text-xl font-semibold">{adding?'Register employee':'Choose employee'}</h2>
        <div className="flex items-center gap-3">
          <button type="button" disabled={addingBusy} onClick={()=>setAdding(v=>!v)} className="flex items-center gap-2 rounded-lg border-2 border-blue-800 bg-blue-700 px-4 py-2 font-semibold text-white hover:bg-blue-800 disabled:opacity-50"><Plus size={18} aria-hidden="true"/>{adding?'Back to employees':'Add New Employee'}</button>
          <button type="button" disabled={addingBusy} aria-label="Close employee picker" onClick={close} className="rounded-lg border border-slate-300 p-2"><X size={20} aria-hidden="true"/></button>
        </div>
      </div>
      {adding?<ManagementPanel kind={selectedCategory==='Cashier'?'cashier':'employee'} adding initialShopId={shopId} initialCategory={selectedCategory||'Driver'} onBusyChange={setAddingBusy} onSaved={()=>{setAdding(false);setSelectedCategory('');setRevision(v=>v+1);}}/>:<>
        <div className="mb-5 grid gap-4 sm:grid-cols-2">
          <label className="grid gap-2 text-sm font-medium">Employee category<select autoFocus className="login-input" value={selectedCategory} onChange={e=>setSelectedCategory(e.target.value)}><option value="">All categories</option>{[...new Set([...categories,...(selectedCategory?[selectedCategory]:[])])].map(value=><option key={value}>{value}</option>)}</select></label>
          <label className="grid gap-2 text-sm font-medium">Search employees<input className="login-input" type="search" value={query} maxLength={120} onChange={e=>setQuery(e.target.value)}/></label>
        </div>
        {shopId&&<p className="mb-4 text-sm text-slate-500">Showing employees assigned to the expense's shop.</p>}
        {loading?<p role="status">Loading employees...</p>:error?<div role="alert"><p className="text-red-700">{error}</p><button type="button" className="mt-3 rounded-lg border px-4 py-2" onClick={()=>setRevision(v=>v+1)}>Retry</button></div>:<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map(row=><button key={row.id} type="button" aria-pressed={employeeId===row.id} onClick={()=>{onChange(row);close();}} className="rounded-xl border border-blue-200 p-4 text-left hover:border-blue-600 hover:bg-blue-50">
            <span className="block font-semibold">{row.name}</span><span className="mt-1 block text-sm text-slate-600">{row.employeeCategory}{row.phone?` / ${row.phone}`:''}</span><span className="mt-1 block break-all text-xs text-slate-500">Employee ref: {row.id}</span>
          </button>)}
          {!filtered.length&&<p className="text-sm text-slate-600">No employees match this category and shop. Use Add New Employee to register one.</p>}
        </div>}
      </>}
    </dialog>,document.body)}
  </div>;
}
