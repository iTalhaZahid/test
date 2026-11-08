import { SyncStatusPill } from './SyncStatusPill';
import { CreditRecoveryDialog } from './CreditRecoveryDialog';
import { FlooringManagement } from './FlooringManagement';
import { useEffect, useRef, useState } from 'react';
import { UsersRound, UtensilsCrossed, ChartNoAxesCombined, Wallet, ContactRound, History, ArrowLeft, Store, UserRound, CalendarDays, ShieldCheck, Layers } from 'lucide-react';
import type { LocalUser } from '../main/auth-contract';
import type { RecordKind } from '../main/management-contract';
import { ExpenseHistory } from './ExpenseHistory';
import { SalesHistory } from './SalesHistory';
import { ManagementPanel } from './ManagementPanel';
import { MonthlyExpenses } from './MonthlyExpenses';
import { PasswordForm } from './PasswordForm';

const sections=[
  {title:'Record Credit Recovery',group:'Sales & Credit',description:'Receive a payment from a creditor.',icon:Wallet},
  {title:'Flooring Management',group:'Restaurant Setup',description:'Add floors and numbered tables.',icon:Layers},
  {title:'Manage Employees',group:'Team & Access',description:'Drivers, waiters, kitchen staff and salaries.',icon:UsersRound},
  {title:'Manage Cashier',group:'Team & Access',description:'Your team, accounts and access.',icon:UsersRound},
  {title:'Manage Menu',group:'Restaurant Setup',description:'Items, photos and prices for each shop.',icon:UtensilsCrossed},
  {title:'View Sales',group:'Sales & Credit',description:'Explore sales across a period.',icon:ChartNoAxesCombined},
  {title:'View Expenses',group:'Expenses',description:'Review everyday business expenses.',icon:Wallet},
  {title:'Manage Creditors',group:'Sales & Credit',description:'Customers, balances and recoveries.',icon:ContactRound},
  {title:'Credits History',group:'Sales & Credit',description:'Review customer credit and repayments.',icon:History},
  {title:'Monthly Recurring Expenses',group:'Expenses',description:'Salaries, bills and payment status.',icon:CalendarDays},
];
const kinds:Record<string,RecordKind>={'Manage Employees':'employee','Manage Shops':'shop','Manage Cashier':'cashier','Manage Menu':'menu','Manage Creditors':'creditor','Manage Payment Methods':'payment','Manage Admins':'admin'};
export function AdminHome({user,onLogout,busy,error}:{user:LocalUser;onLogout:()=>Promise<void>;busy:boolean;error:string}){
  const [recoveryOpen,setRecoveryOpen]=useState(false);
  const [selection,setSelection]=useState(''),[period,setPeriod]=useState('Monthly'),[menu,setMenu]=useState(false);
  const account=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null);
  useEffect(()=>{if(!menu)return;const dismiss=(event:PointerEvent)=>{if(!account.current?.contains(event.target as Node))setMenu(false);};document.addEventListener('pointerdown',dismiss);return()=>document.removeEventListener('pointerdown',dismiss);},[menu]);
  function select(title:string){if(title==='Record Credit Recovery'){setRecoveryOpen(true);setMenu(false);return;}setSelection(title);setMenu(false);setPeriod('Monthly');}
  const cards=user.role==='superuser'?[...sections,{title:'Manage Admins',group:'Team & Access',description:'Add and manage administrator accounts.',icon:ShieldCheck}]:sections;
  const report=['View Sales','View Expenses','Credits History'].includes(selection);
  return <main className="min-h-dvh bg-slate-50 font-sans text-slate-900">
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 bg-white px-6 py-4 lg:px-12"><div className="flex min-w-0 flex-wrap items-center gap-3">{selection&&<button className="header-back-button" onClick={()=>select('')}><ArrowLeft size={18} aria-hidden="true"/>Back</button>}<Store className="text-blue-700" aria-hidden="true"/><span className="text-xl font-semibold">POS</span><h1 className="border-l border-slate-200 pl-3 text-xl font-semibold">{selection||(user.role==='superuser'?'Superuser':'Administration')}</h1></div>
      <div className="ml-auto flex flex-wrap items-center justify-end gap-3"><SyncStatusPill/><div ref={account} className="relative" onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))setMenu(false);}} onKeyDown={e=>{if(e.key==='Escape'){setMenu(false);trigger.current?.focus();}}}>
        <button ref={trigger} aria-label="Account options" aria-expanded={menu} aria-controls="admin-account-options" onClick={()=>setMenu(v=>!v)} className="flex items-center gap-3 rounded-full p-2 hover:bg-blue-50"><span className="text-sm font-medium">{user.displayName}</span><UserRound className="size-11 rounded-full bg-blue-100 p-2 text-blue-700" aria-hidden="true"/></button>
        {menu&&<div id="admin-account-options" className="absolute right-0 z-20 w-64 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">{['Manage Shops','Manage Payment Methods','Change Password'].map(title=><button key={title} className="block w-full rounded-lg px-4 py-3 text-left text-sm hover:bg-blue-50" onClick={()=>select(title)}>{title}</button>)}<button disabled={busy} className="block w-full rounded-lg px-4 py-3 text-left text-sm text-red-700 hover:bg-red-50" onClick={()=>{setMenu(false);void onLogout();}}>Logout</button></div>}
      </div></div>
    </header>
    <div className="mx-auto max-w-[1600px] p-6 lg:px-12">{error&&<p role="alert" className="mb-4 text-red-700">{error}</p>}
      {!selection?<div className="space-y-8">{['Restaurant Setup','Team & Access','Sales & Credit','Expenses'].map(group=><section key={group} aria-label={group}><h2 className="mb-4 border-b border-slate-200 pb-3 text-lg font-semibold text-slate-800">{group}</h2><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{cards.filter(card=>card.group===group).map(({title,description,icon:Icon})=><button key={title} onClick={()=>select(title)} className="rounded-xl border border-blue-200 bg-blue-100 p-5 text-left hover:border-blue-400 focus-visible:outline-2 focus-visible:outline-blue-600"><span className="mb-4 flex h-12 items-center rounded-lg bg-blue-800 px-3 text-white"><Icon size={28} strokeWidth={1.5} aria-hidden="true"/></span><span className="block text-base font-semibold">{title}</span><span className="mt-2 block text-sm leading-5 text-slate-700">{description}</span></button>)}</div></section>)}</div>:<>
        {selection==='Flooring Management'?<FlooringManagement/>:kinds[selection]?<ManagementPanel key={selection} kind={kinds[selection]}/>:selection==='Monthly Recurring Expenses'?<MonthlyExpenses/>:selection==='Change Password'?<PasswordForm/>:selection==='View Expenses'?<ExpenseHistory key={selection} period={period} adminId={user.id}/>:report?<SalesHistory key={selection+period} period={period} creditorsOnly={selection==='Credits History'}/>:null}
      </>}
    </div>
    {recoveryOpen&&<CreditRecoveryDialog onClose={()=>setRecoveryOpen(false)}/>}
  </main>;
}