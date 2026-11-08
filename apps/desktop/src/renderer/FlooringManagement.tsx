import { useEffect, useRef, useState } from 'react';
import { Plus, Pencil } from 'lucide-react';
import { managementErrorMessage, type ManagementRecord } from '../main/management-contract';
import { SavedDialog } from './SavedDialog';

export function FlooringManagement() {
  const [floors,setFloors]=useState<ManagementRecord[]>([]);
  const [name,setName]=useState('');
  const [editing,setEditing]=useState<ManagementRecord|null>(null),[editName,setEditName]=useState('');
  const editDialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{if(editing)editDialog.current?.showModal();},[editing]);
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  useEffect(()=>{let active=true;window.posManagement.list('floor','').then(rows=>{if(active){setFloors(rows);}}).catch(e=>{if(active)setError(managementErrorMessage(e));}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[]);
  async function save(floor?:ManagementRecord){
    if(busy)return;
    const tableNumber=Math.max(0,...(floor?.tables||[]))+1;
    if(floor&&((floor.tables?.length||0)>=500||tableNumber>9999)){setError('This floor has reached its table limit.');return;}
    setBusy(true);
    try{
      await window.posManagement.save(!floor?{id:'',kind:'floor',name:name.trim(),phone:'',passport:'',identity:'',pricePaisa:0,quantity:0,tables:[]}:{...floor,tables:[...(floor.tables||[]),tableNumber]});
      const rows=await window.posManagement.list('floor','');setFloors(rows);
      if(!floor)setName('');
      setNotice(!floor?'Your floor has been added.':'Your table has been added.');
    }catch(e){setError(managementErrorMessage(e));}finally{setBusy(false);}
  }
  async function rename(){
    if(!editing||busy||!editName.trim()||editName.trim()===editing.name)return;
    setBusy(true);
    try{
      const updated={...editing,name:editName.trim()};
      await window.posManagement.save(updated);
      setFloors(rows=>rows.map(row=>row.id===updated.id?updated:row));
      setEditing(null);setNotice('Your floor name has been updated.');
    }catch(e){setError(managementErrorMessage(e));}finally{setBusy(false);}
  }
  return <div className="management-panel space-y-5">
    <form onSubmit={e=>{e.preventDefault();void save();}} className="max-w-xl"><fieldset disabled={busy||loading} className="flex items-end gap-3"><label className="grid min-w-0 flex-1 gap-2 text-sm font-medium">Floor name<input required maxLength={120} className="login-input" placeholder="Ground Floor" value={name} onChange={e=>setName(e.target.value)}/></label><button disabled={!name.trim()} className="flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 text-sm font-semibold text-white hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-50"><Plus size={18} aria-hidden="true"/>Add Floor</button></fieldset></form>
    {loading?<p role="status">Loading floors...</p>:!floors.length?<p className="text-sm text-slate-500">Add your first floor to start assigning tables.</p>:floors.map(floor=><section key={floor.id} className="rounded-2xl border border-blue-100 bg-white p-6 shadow-sm"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-2"><h2 className="break-words text-lg font-semibold">{floor.name}:</h2><button type="button" disabled={busy} aria-label={`Rename ${floor.name}`} title="Rename floor" onClick={()=>{setEditing(floor);setEditName(floor.name);}} className="flex size-11 shrink-0 items-center justify-center rounded-lg text-blue-700 hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-blue-700 disabled:opacity-50"><Pencil size={18} aria-hidden="true"/></button></div><button type="button" disabled={busy} aria-label={`Add table to ${floor.name}`} onClick={()=>void save(floor)} className="flex min-h-11 items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:opacity-50"><Plus size={18} aria-hidden="true"/>Add Table</button></div><div className="flex flex-wrap gap-3">{floor.tables?.map(table=><span key={table} className="flex min-h-14 min-w-16 items-center justify-center rounded-xl border border-blue-200 bg-blue-50 px-4 font-semibold text-blue-800">{floor.name.trim().charAt(0).toUpperCase()}{table}</span>)}{!floor.tables?.length&&<p className="text-sm text-slate-500">No tables added yet.</p>}</div></section>)}
    {editing&&<dialog ref={editDialog} onCancel={e=>{e.preventDefault();if(!busy)setEditing(null);}} aria-labelledby="rename-floor-title" className="management-panel m-auto w-full max-w-md rounded-2xl bg-white p-6 shadow-xl backdrop:bg-slate-950/40"><h2 id="rename-floor-title" className="mb-5 text-lg font-semibold">Rename floor</h2><form onSubmit={e=>{e.preventDefault();void rename();}}><fieldset disabled={busy} className="grid gap-4"><label className="grid gap-2 text-sm font-medium">Floor name<input autoFocus required maxLength={120} className="login-input" value={editName} onChange={e=>setEditName(e.target.value)}/></label><div className="flex gap-3"><button type="button" className="rounded-lg border px-4 py-2" onClick={()=>setEditing(null)}>Cancel</button><button disabled={!editName.trim()||editName.trim()===editing.name} className="primary-button">{busy?'Saving...':'Save changes'}</button></div></fieldset></form></dialog>}
    {error&&<SavedDialog error title="Unable to complete action" message={error} onClose={()=>setError('')}/>}
    {notice&&<SavedDialog title="Success" message={notice} onClose={()=>setNotice('')}/>}
  </div>;
}
