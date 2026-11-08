import { useEffect, useRef } from 'react';

export function ConfirmDialog({ title, message, onConfirm, onCancel, destructive=false, confirmLabel='Confirm' }: { title: string; message: string; destructive?: boolean; confirmLabel?: string; onConfirm: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} onCancel={onCancel} aria-labelledby="confirmation-title" aria-describedby="confirmation-message" className="m-auto w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl backdrop:bg-slate-950/40">
    <h2 id="confirmation-title" className={`text-lg font-semibold ${destructive?'text-red-800':''}`}>{title}</h2><p id="confirmation-message" className="my-4 text-sm text-slate-600">{message}</p>
    <div className="flex justify-end gap-3"><button autoFocus onClick={onCancel} className="min-h-11 rounded-lg border px-4 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-600">Cancel</button><button onClick={onConfirm} className={`min-h-11 rounded-lg px-4 py-2 font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 ${destructive?'bg-red-700 hover:bg-red-800 focus-visible:outline-red-700':'bg-blue-700 hover:bg-blue-800 focus-visible:outline-blue-700'}`}>{confirmLabel}</button></div>
  </dialog>;
}
