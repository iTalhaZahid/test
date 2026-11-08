import { SyncStatusPill } from './SyncStatusPill';
import { CreditRecoveryDialog } from './CreditRecoveryDialog';
import { PasswordInput } from './PasswordInput';
import { useState, useEffect, useRef, type FormEvent } from 'react';
import { UserRound, ShoppingBasket, Wallet, ArrowLeft, Store, ArrowUpRight, ChartNoAxesCombined, History, ContactRound } from 'lucide-react';
import type { LocalUser } from '../main/auth-contract';
import { SalesHistory } from './SalesHistory';
import { ExpenseHistory } from './ExpenseHistory';
import { ManagementPanel } from './ManagementPanel';
import { ExpenseDialog } from './ExpenseDialog';
import { SalesScreen } from './SalesScreen';
import { ConfirmDialog } from './ConfirmDialog';

export function CashierHome({ user, onLogout, error }: { user: LocalUser; onLogout: () => Promise<void>; error: string }) {
  const account = useRef<HTMLDivElement>(null);
  const passwordDialog = useRef<HTMLDialogElement>(null);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [recoveryOpen,setRecoveryOpen]=useState(false);
  const [expenseOpen,setExpenseOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [screen, setScreen] = useState('');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (!menu) return;
    const dismiss = (event: PointerEvent) => { if (!account.current?.contains(event.target as Node)) setMenu(false); };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [menu]);
  useEffect(() => { if (passwordOpen) passwordDialog.current?.showModal(); }, [passwordOpen]);
  function closePassword() {
    if (busy) return;
    setPasswordOpen(false); setCurrent(''); setNext(''); setRepeat(''); setMessage('');
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (next !== repeat) { setMessage('The new passwords do not match.'); return; }
    setConfirm(true);
  }
  async function change() {
    setConfirm(false); setBusy(true); setMessage('');
    try { await window.posAuth.changePassword(current,next); setCurrent(''); setNext(''); setRepeat(''); setMessage('Password updated. Use your new password next time you sign in.'); }
    catch { setMessage('Unable to change password. Check your current password; after repeated failures, wait 30 seconds.'); }
    finally { setBusy(false); }
  }
  return <main className="flex min-h-dvh flex-col bg-slate-50 text-slate-900">
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 bg-white px-8 py-4"><div className="flex min-w-0 flex-wrap items-center gap-3">{screen&&<button disabled={busy} className="header-back-button" onClick={()=>{setScreen('');setMenu(false);setCurrent('');setNext('');setRepeat('');setMessage('');}}><ArrowLeft size={18} aria-hidden="true"/>Back</button>}<span className="flex items-center gap-3 text-xl font-semibold"><Store aria-hidden="true"/>POS</span><h1 className="border-l border-slate-200 pl-3 text-xl font-semibold">{screen||'Cashier Dashboard'}</h1></div><div className="ml-auto flex flex-wrap items-center justify-end gap-3"><SyncStatusPill/><div ref={account} className="relative"><button aria-label="Account options" aria-expanded={menu} onClick={() => setMenu(v => !v)} className="flex items-center gap-3 rounded-full p-2 hover:bg-blue-50"><span className="text-sm">{user.displayName}</span><UserRound className="size-10 rounded-full bg-blue-100 p-2 text-blue-700" /></button>{menu && <div onKeyDown={e => { if (e.key === 'Escape') setMenu(false); }} className="absolute right-0 z-10 w-48 rounded-xl border border-slate-200 bg-white p-2 shadow-lg"><button className="w-full rounded-lg p-3 text-left hover:bg-blue-50" onClick={() => { setPasswordOpen(true); setMenu(false); setMessage(''); }}>Change password</button><button className="w-full rounded-lg p-3 text-left hover:bg-blue-50" onClick={() => { setMenu(false); void onLogout(); }}>Sign out</button></div>}</div></div></header>
    <div className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col px-4 py-6 sm:px-8 lg:py-8">
      {error && <p role="alert" className="mb-4 text-red-700">{error}</p>}
      {!screen ? <div className="space-y-8">
        <section aria-labelledby="counter-actions"><h2 id="counter-actions" className="mb-4 text-lg font-semibold">Counter actions</h2><div className="grid gap-4 sm:grid-cols-2">
          <button onClick={()=>setScreen('Record Sales')} className="group rounded-2xl border border-slate-300 bg-slate-200 p-6 text-left text-slate-900 shadow-sm hover:border-slate-400 hover:bg-slate-300/70 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600"><span className="mb-6 flex items-start justify-between"><span className="flex size-12 items-center justify-center rounded-xl bg-white/80 text-blue-700"><ShoppingBasket size={26} aria-hidden="true"/></span><ArrowUpRight size={20} aria-hidden="true" className="text-slate-600"/></span><span className="block text-xl font-semibold">Record Sales</span><span className="mt-2 block text-sm text-slate-600">Create an invoice and take payment.</span></button>
          <button onClick={()=>setExpenseOpen(true)} className="rounded-2xl border border-slate-300 bg-slate-100 p-6 text-left shadow-sm hover:border-slate-400 hover:bg-slate-200 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600"><span className="mb-6 flex items-start justify-between"><span className="flex size-12 items-center justify-center rounded-xl bg-amber-50 text-amber-700"><Wallet size={26} aria-hidden="true"/></span><ArrowUpRight size={20} aria-hidden="true" className="text-slate-400"/></span><span className="block text-xl font-semibold">Record Expenses</span><span className="mt-2 block text-sm text-slate-600">Record a payment made by your shop.</span></button>
        </div></section>
        {user.manageCreditsExpenses&&<><section aria-labelledby="cashier-reports"><h2 id="cashier-reports" className="mb-4 border-b border-slate-200 pb-3 text-lg font-semibold">Reports</h2><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[{title:'View Sales',description:'Sales, collections, and invoices.',icon:ChartNoAxesCombined},{title:'View Expenses',description:'Expense records and category totals.',icon:Wallet},{title:'Credit History',description:'Credit issued and payments recovered.',icon:History}].map(({title,description,icon:Icon})=><button key={title} onClick={()=>setScreen(title)} className="rounded-2xl border border-slate-300 bg-slate-100 p-5 text-left shadow-sm hover:border-slate-400 hover:bg-slate-200 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600"><span className="mb-5 flex items-center justify-between"><span className="flex size-11 items-center justify-center rounded-xl bg-blue-50 text-blue-700"><Icon size={24} aria-hidden="true"/></span><ArrowUpRight size={18} aria-hidden="true" className="text-slate-400"/></span><span className="block font-semibold">{title}</span><span className="mt-2 block text-sm text-slate-600">{description}</span></button>)}</div></section>
        <section aria-labelledby="cashier-customers"><h2 id="cashier-customers" className="mb-4 border-b border-slate-200 pb-3 text-lg font-semibold">Customers</h2><div className="grid gap-4 sm:grid-cols-2">{[{title:'Record Credit Recovery',description:'Receive a payment from a creditor.',icon:Wallet,action:()=>setRecoveryOpen(true)},{title:'Manage Creditors',description:'Customer details, credit accounts, and recoveries.',icon:ContactRound,action:()=>setScreen('Manage Creditors')}].map(({title,description,icon:Icon,action})=><button key={title} onClick={action} className="rounded-2xl border border-slate-300 bg-slate-100 p-5 text-left shadow-sm hover:border-slate-400 hover:bg-slate-200 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600"><span className="mb-5 flex items-center justify-between"><span className="flex size-11 items-center justify-center rounded-xl bg-blue-50 text-blue-700"><Icon size={24} aria-hidden="true"/></span><ArrowUpRight size={18} aria-hidden="true" className="text-slate-400"/></span><span className="block font-semibold">{title}</span><span className="mt-2 block text-sm text-slate-600">{description}</span></button>)}</div></section></>}
      </div> : screen === 'Record Sales' ? <SalesScreen cashierId={user.id} manageFinance={!!user.manageCreditsExpenses} /> : screen==='View Expenses' && user.manageCreditsExpenses ? <ExpenseHistory period="Monthly" fixedShopId={user.shopId}/> : ['View Sales','Credit History'].includes(screen) && user.manageCreditsExpenses ? <SalesHistory key={screen} period="Monthly" fixedShopId={user.shopId} creditorsOnly={screen==='Credit History'}/> : screen==='Manage Creditors' && user.manageCreditsExpenses ? <ManagementPanel kind="creditor"/> : null}
    </div>{recoveryOpen&&<CreditRecoveryDialog fixedShopId={user.shopId} onClose={()=>setRecoveryOpen(false)}/>} {expenseOpen && <ExpenseDialog cashierId={user.id} onClose={()=>setExpenseOpen(false)} />}{passwordOpen && <dialog ref={passwordDialog} aria-labelledby="password-title" onCancel={event => { event.preventDefault(); closePassword(); }} className="m-auto w-full max-w-md rounded-2xl bg-white p-6 shadow-xl backdrop:bg-slate-950/40"><div className="mb-4 flex items-center justify-between"><h2 id="password-title" className="text-lg font-semibold">Change password</h2><button disabled={busy} onClick={closePassword} aria-label="Close password dialog">Close</button></div><form onSubmit={submit} className="management-panel "><fieldset disabled={busy} className="grid gap-4">{[{label:'Current password',value:current,set:setCurrent},{label:'New password',value:next,set:setNext},{label:'Confirm new password',value:repeat,set:setRepeat}].map(({label,value,set}) => <label key={label} className="grid gap-2 text-sm font-medium">{label}<PasswordInput required minLength={label === 'Current password' ? 1 : 8} maxLength={128} autoComplete={label === 'Current password' ? 'current-password' : 'new-password'} placeholder="••••••••" className="login-input" value={value} onChange={e => set(e.target.value)} /></label>)}<button className="primary-button">{busy ? 'Saving…' : 'Update password'}</button></fieldset>{message && <p role="status" className="mt-4 text-sm">{message}</p>}</form></dialog>}{confirm && <ConfirmDialog title="Change password?" message="Your new password will replace your current sign-in password." onCancel={() => setConfirm(false)} onConfirm={() => void change()} />}
  </main>;
}
