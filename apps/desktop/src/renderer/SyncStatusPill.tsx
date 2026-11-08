import { useEffect, useState } from 'react';
import { CloudCheck, RefreshCw, WifiOff, CircleAlert } from 'lucide-react';
import type { SyncStatus } from '../main/sync-contract';

export function SyncStatusPill() {
  const [status,setStatus]=useState<SyncStatus>({state:'offline',pending:0});
  useEffect(()=>{
    const bridge=window.posSync;
    if(!bridge)return;
    let active=true,reading=false;
    const read=async()=>{
      if(reading)return;
      reading=true;
      try { const next=await bridge.status();if(active)setStatus(next); }
      catch { if(active)setStatus({state:'offline',pending:0}); }
      finally { reading=false; }
    };
    const reconnect=()=>{void bridge.retry().then(read).catch(()=>{});};
    void read();
    const timer=setInterval(()=>void read(),1000);
    window.addEventListener('online',reconnect);
    return()=>{active=false;clearInterval(timer);window.removeEventListener('online',reconnect);};
  },[]);
  if(!window.posSync)return null;
  const offline=status.state==='offline',syncing=status.state==='syncing',problem=status.state==='error'||status.state==='auth-required';
  const Icon=offline?WifiOff:syncing?RefreshCw:problem?CircleAlert:CloudCheck;
  const label=window.posOnline?(offline?'Offline':syncing?'Connecting':problem?'Connection needs attention':'Online'):offline?'Working in offline Mode':syncing?'Syncing':status.state==='auth-required'?'Online sign-in required':problem?'Sync needs attention':'Synced';
  return <span role="status" aria-live="polite" title={status.message||`${status.pending} changes waiting to sync`} className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${offline?'border-amber-200 bg-amber-50 text-amber-800':problem?'border-red-200 bg-red-50 text-red-800':syncing?'border-blue-200 bg-blue-50 text-blue-800':'border-emerald-200 bg-emerald-50 text-emerald-800'}`}><Icon size={14} aria-hidden="true"/>{label}</span>;
}
