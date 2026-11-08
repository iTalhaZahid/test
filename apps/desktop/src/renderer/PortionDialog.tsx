import { useEffect, useRef } from 'react';
import type { MealPortion, MenuItem } from '../main/sales-contract';

export function PortionDialog({ item, onSelect, onClose }: { item: MenuItem; onSelect: (portion: MealPortion) => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  function close() { ref.current?.close(); onClose(); }
  return <dialog ref={ref} onCancel={close} aria-labelledby="portion-title" aria-describedby="portion-dish" className="management-panel m-auto w-[calc(100%-32px)] max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl backdrop:bg-slate-950/40">
    <h2 id="portion-title" className="text-xl font-semibold">Choose a portion</h2>
    <p id="portion-dish" className="mt-2 text-slate-600">{item.name}</p>
    <div role="group" aria-label="Serving size" className="my-6 grid grid-cols-2 gap-3">
      {(['half','full'] as const).map(portion => <button key={portion} type="button" autoFocus={portion==='half'} onClick={()=>{ref.current?.close();onSelect(portion);}} className="min-h-28 rounded-xl border-2 border-blue-200 bg-blue-50 p-4 text-left hover:border-blue-600 hover:bg-blue-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700">
        <span className="block text-lg font-semibold">{portion==='half'?'Half':'Full'}</span>
        <span className="mt-2 block text-blue-800">QAR {((portion==='half'?item.halfPriceMinor!:item.priceMinor)/100).toFixed(2)}</span>
      </button>)}
    </div>
    <button type="button" onClick={close} className="min-h-11 rounded-lg border border-slate-300 px-4 font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700">Cancel</button>
  </dialog>;
}
