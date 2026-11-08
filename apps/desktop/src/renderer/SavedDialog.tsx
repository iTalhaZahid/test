import { useEffect, useRef, type ReactNode } from 'react';
import { CircleCheck, CircleAlert } from 'lucide-react';
export function SavedDialog({ title, message, onClose, error = false, actions }: { title: string; message: string; onClose: () => void; error?: boolean; actions?: ReactNode }) {
  const ref=useRef<HTMLDialogElement>(null);
  const Icon = error ? CircleAlert : CircleCheck;
  useEffect(()=>{ref.current?.showModal();},[]);
  return <dialog ref={ref} onCancel={onClose} aria-labelledby="saved-title" aria-describedby="saved-message" className="m-auto w-full max-w-sm rounded-2xl bg-white p-7 text-center shadow-xl backdrop:bg-slate-950/40"><Icon className={`mx-auto mb-4 ${error?'text-red-600':'text-emerald-600'}`} size={44} aria-hidden="true"/><h2 id="saved-title" className="text-xl font-semibold">{title}</h2><p id="saved-message" className="my-4 text-sm leading-6 text-slate-600">{message}</p>{actions}<button autoFocus onClick={onClose} className="primary-button">{error?'OK':'Done'}</button></dialog>;
}
