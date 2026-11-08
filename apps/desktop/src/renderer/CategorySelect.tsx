import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { managementErrorMessage } from '../main/management-contract';
import { LoadingSkeleton } from './LoadingSkeleton';
import { cachedExpenseCategories, clearCatalogCache, peekCatalog } from './catalog-cache';

export function CategorySelect({ kind, label, value, onChange, extra = [] }: {
  kind: 'employee-category' | 'expense-category'; label: string; value: string;
  onChange: (value: string) => void; extra?: string[];
}) {
  const [categories,setCategories] = useState<string[]>(kind==='expense-category'?(peekCatalog('expenseCategories')||[]).map(row=>row.name):[]), [open,setOpen] = useState(false);
  const [loading,setLoading] = useState(kind!=='expense-category'||!peekCatalog('expenseCategories'));
  const [name,setName] = useState(''), [busy,setBusy] = useState(false), [error,setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null), select = useRef<HTMLSelectElement>(null), title = useId();
  useEffect(() => {
    let active = true;
    setLoading(kind!=='expense-category'||!peekCatalog('expenseCategories'));
    (kind==='expense-category'?cachedExpenseCategories():window.posManagement.list(kind,'')).then(rows => { if(active)setCategories(rows.map(row=>row.name)); })
      .catch(e => { if(active)setError(managementErrorMessage(e)); })
      .finally(()=>{if(active)setLoading(false);});
    return () => { active=false; };
  },[kind]);
  useEffect(() => { if(open)dialog.current?.showModal(); },[open]);
  function close() { dialog.current?.close(); setOpen(false); select.current?.focus(); }
  async function save() {
    if(busy)return;
    setBusy(true);setError('');
    try {
      const category=name.trim();
      await window.posManagement.save({id:'',kind,name:category,phone:'',passport:'',identity:'',pricePaisa:0,quantity:0});
      if(kind==='expense-category')clearCatalogCache('expenseCategories');
      setCategories(rows=>[...rows,category]);onChange(category);close();
    } catch(e) {setError(managementErrorMessage(e));} finally {setBusy(false);}
  }
  const options=[...new Set([...categories,...extra,...(value?[value]:[])])].sort((a,b)=>a.localeCompare(b));
  return <>
    <label className="grid gap-2 text-sm font-medium">{label}
      {loading?<LoadingSkeleton label={`Loading ${label.toLowerCase()}`} variant="field"/>:<select ref={select} className="login-input" required value={value?`category:${value}`:""} onChange={e=>{
        if(e.target.value==='__add__'){setName('');setError('');setOpen(true);}else onChange(e.target.value.slice(9));
      }}><option value="">Choose a category</option>{options.map(category=><option key={category} value={`category:${category}`}>{category}</option>)}<option value="__add__">Add New Category</option></select>}
    </label>
    {error&&!open&&<p role="alert" className="text-sm text-red-700">{error}</p>}
    {open&&createPortal(<dialog ref={dialog} aria-labelledby={title} onCancel={e=>{e.preventDefault();e.stopPropagation();if(!busy)close();}} className="management-panel m-auto w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl backdrop:bg-slate-950/40">
      <h2 id={title} className="mb-5 text-lg font-semibold">Add New Category</h2>
      <form onSubmit={e=>{e.preventDefault();e.stopPropagation();void save();}}>
        <label className="grid gap-2 text-sm font-medium">Category name<input autoFocus className="login-input" required maxLength={80} value={name} disabled={busy} onChange={e=>setName(e.target.value)}/></label>
        {error&&<p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
        <div className="mt-5 flex gap-3"><button type="button" disabled={busy} onClick={close} className="rounded-lg border border-slate-300 px-4 py-2">Cancel</button><button disabled={busy||!name.trim()} className="primary-button">{busy?'Saving…':'Add category'}</button></div>
      </form>
    </dialog>,document.body)}
  </>;
}
