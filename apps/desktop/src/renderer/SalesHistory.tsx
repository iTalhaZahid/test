import { salesInvoiceNumber } from './sales-invoice';
import { SalesReceipt } from './SalesReceipt';
import { reportDate, reportPeriod } from './report-chart-data';
import { ReportDownload } from './ReportDownload';
import { ReportPagination } from './ReportPagination';
import { X, Coins, FileText, CalendarDays, Layers, List } from 'lucide-react';
import { ReportBarChart } from './ReportBarChart';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Sale, SaleFilter, Repayment, Expense } from '../main/sales-contract';
import { ShopSelect } from './ShopSelect';
import { money } from './SalesScreen';

export function dateString(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Karachi',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
  return ['year','month','day'].map(key=>parts.find(p=>p.type===key)!.value).join('-');
}
export function SalesHistory({ period: initialPeriod, creditorsOnly=false, expensesOnly=false, fixedShopId, revision=0, children }: { period:string; creditorsOnly?:boolean; expensesOnly?:boolean; fixedShopId?:string; revision?:number; children?:ReactNode }) {
  const [receipt,setReceipt]=useState<Sale|null>(null);
  const [page,setPage]=useState(1);
  const [period,setPeriod]=useState(initialPeriod);
  const today=dateString(new Date());
  const startDate=new Date(`${today}T12:00:00+05:00`);
  if(period==='Weekly') startDate.setUTCDate(startDate.getUTCDate()-((startDate.getUTCDay()+6)%7));
  if(period==='Monthly') startDate.setUTCDate(1);
  const [view,setView]=useState<'credits'|'recoveries'>('credits');
  const dialog=useRef<HTMLDialogElement>(null);
  const [customOpen,setCustomOpen]=useState(period==='Custom');
  const [draftStart,setDraftStart]=useState(dateString(startDate)),[draftEnd,setDraftEnd]=useState(today);
  useEffect(()=>{if(customOpen)dialog.current?.showModal();},[customOpen]);
  const [start,setStart]=useState(dateString(startDate));
  const [end,setEnd]=useState(today);
  const [type,setType]=useState<SaleFilter['type']>(creditorsOnly?'creditor':'all');
  const [sales,setSales]=useState<Sale[]>([]);
  const [shopLabel,setShopLabel]=useState('All shops');
  const [shopId,setShopId]=useState(fixedShopId||'');
  const [allExpenses,setExpenses]=useState<Expense[]>([]);
  const [expenseCategory,setExpenseCategory]=useState('');
  const [expenseCategories,setExpenseCategories]=useState<string[]>([]);
  const [categoryError,setCategoryError]=useState('');
  const expenses=allExpenses.filter(row=>!expenseCategory||row.category===expenseCategory);
  useEffect(()=>{if(!expensesOnly)return;let active=true;window.posManagement.list('expense-category','').then(rows=>{if(active){setExpenseCategories(rows.map(row=>row.name));setCategoryError('');}}).catch(()=>{if(active)setCategoryError('Could not load expense categories. Reopen this screen to retry.');});return()=>{active=false;};},[expensesOnly,revision]);
  const [recoveries,setRecoveries]=useState<Repayment[]>([]);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  useEffect(()=>{
    let active=true; setLoading(true); setError('');
    Promise.all([expensesOnly?Promise.resolve([]):window.posSales.history({start,end,type,shopId}),creditorsOnly?window.posSales.repayments(start,end,shopId):Promise.resolve([]),expensesOnly?window.posSales.expenses(start,end,shopId):Promise.resolve([])]).then(([rows,payments,costs])=>{if(active){setSales(rows);setRecoveries(payments);setExpenses(costs);setLoading(false);}}).catch(()=>{if(active){setSales([]);setRecoveries([]);setExpenses([]);setError('Could not load records. Check the dates and try again.');setLoading(false);}});
    return()=>{active=false;};
  },[start,end,type,shopId,creditorsOnly,expensesOnly,revision]);
  useEffect(()=>setPage(1),[start,end,type,shopId,view,expenseCategory,revision]);
  function choosePeriod(value:string){
    if(value==='Custom'){setDraftStart(start);setDraftEnd(end);setCustomOpen(true);return;}
    const date=new Date(`${today}T12:00:00+05:00`);
    if(value==='Weekly')date.setUTCDate(date.getUTCDate()-((date.getUTCDay()+6)%7));
    if(value==='Monthly')date.setUTCDate(1);
    setPeriod(value);setStart(dateString(date));setEnd(today);
  }
  const subject=expensesOnly?'expenses':creditorsOnly?'credit activity':'sales';
  const count=expensesOnly?expenses.length:view==='recoveries'?recoveries.length:sales.length;
  const total=expensesOnly?expenses.reduce((sum,r)=>sum+r.amountMinor,0):view==='recoveries'?recoveries.reduce((sum,r)=>sum+r.amountMinor,0):sales.reduce((sum,r)=>sum+r.total,0);
  return <section className="report-history space-y-5" aria-busy={loading}>
    <div className="report-stats">
      <div className="report-stat report-stat-blue"><span className="report-stat-icon"><Coins aria-hidden="true"/></span><div><p className="text-sm font-medium">{expensesOnly?'Total Expenses':view==='recoveries'?'Total Recoveries':'Total Sales'}</p><strong className="text-2xl font-bold">{loading?'Loading?':error?'Unavailable':money(total)}</strong></div></div>
      <div className="report-stat report-stat-purple"><span className="report-stat-icon"><FileText aria-hidden="true"/></span><div><p className="text-sm font-medium">Total Records</p><strong className="text-2xl font-bold">{loading?'Loading?':error?'Unavailable':count}</strong></div></div>
      <button className="report-stat report-stat-period text-left" onClick={()=>choosePeriod('Custom')}><span className="report-stat-icon"><CalendarDays aria-hidden="true"/></span><span><span className="block text-sm font-medium">Period</span><strong className="text-base">{reportPeriod(start,end)}</strong></span></button>
    </div>
    <div className="grid items-stretch gap-5 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.3fr)]">
      <div className="report-panel flex flex-col justify-between gap-6 p-6">
        <div className="flex items-start gap-3"><Layers className="mt-1 text-blue-600" aria-hidden="true"/><div><h2 className="text-lg font-bold">{expensesOnly?'Expense Overview':creditorsOnly?'Credit Overview':'Sales Overview'}</h2><p className="mt-1 text-sm text-slate-600">Filter, export, and download your {subject} data.</p></div></div>
        <div className="report-periods" role="group" aria-label="Report period">{['Daily','Weekly','Monthly','Custom'].map(value=><button key={value} aria-pressed={period===value} onClick={()=>choosePeriod(value)}>{value}</button>)}</div>
        {period==='Custom'&&<button onClick={()=>choosePeriod('Monthly')} className="flex items-center gap-2 text-sm text-blue-700"><X size={16} aria-hidden="true"/>Clear custom date range</button>}
        <div className="grid gap-4"><ShopSelect onLabelChange={setShopLabel} value={shopId} onChange={setShopId} includeAll={!fixedShopId} disabled={!!fixedShopId}/>
        {expensesOnly&&<label className="grid gap-1 text-sm">Expense category<select className="min-w-0 rounded-lg border border-slate-300 p-2" value={expenseCategory} onChange={e=>setExpenseCategory(e.target.value)}><option value="">All categories</option>{[...new Set([...expenseCategories,...allExpenses.map(row=>row.category),expenseCategory].filter(Boolean))].sort((a,b)=>a.localeCompare(b)).map(category=><option key={category}>{category}</option>)}</select>{categoryError&&<span role="alert" className="text-red-700">{categoryError}</span>}</label>}
        {!expensesOnly&&<label className="grid gap-1 text-sm">Sales type<select className="min-w-0 rounded-lg border border-slate-300 p-2" value={type} onChange={e=>setType(e.target.value as SaleFilter['type'])}><option value="all">All sales</option><option value="cash">Cash sales</option><option value="creditor">Creditor sales</option></select></label>}</div>
        <ReportDownload actions={children} disabled={loading||!!error} report={{title:expensesOnly?'Expense History':creditorsOnly?(view==='recoveries'?'Credit Recovery History':'Credit History'):'Sales History',shopName:shopLabel,period:reportPeriod(start,end),category:expensesOnly?(expenseCategory||'All expense categories'):view==='recoveries'?'Recoveries':type==='all'?'All sales':type==='cash'?'Cash sales':'Creditor sales',headers:expensesOnly?['Date','Category','Description','Shop','Cashier','Paid via','Amount (QAR)','Reference']:view==='recoveries'?['Date','Customer','Shop','Accepted by','Amount (QAR)','Reference']:['Date','Customer','Shop','Cashier','Sales (QAR)','Collected (QAR)','Credit (QAR)','Invoice','Floor','Table','Subtotal (QAR)','Discount (QAR)'],rows:expensesOnly?expenses.map(r=>[reportDate(r.date),r.category,r.description,r.shopName||'Unassigned',r.cashierName,r.paidVia,r.amountMinor/100,r.id]):view==='recoveries'?recoveries.map(r=>[reportDate(r.date),r.creditor.name,r.shopName||'Unassigned',r.acceptedByName,r.amountMinor/100,r.id]):sales.map(r=>[reportDate(r.businessDate),r.creditor?.name||r.customerType,r.shopName||'Unassigned',r.cashierName,r.total/100,r.cashApplied/100,r.credit/100,salesInvoiceNumber(r),r.table?.floorName||'',r.table?.label||'',(r.subtotal??r.total)/100,(r.discountMinor??0)/100])}}/>
        {creditorsOnly&&<p className="text-xs text-slate-500">Credits use the selling shop; recoveries use the collection shop. Sales type applies to sales only.</p>}
      </div>
      <div className="relative min-w-0 rounded-2xl bg-white"><div aria-hidden={loading} className={loading?'invisible':''}><ReportBarChart tall context={`${reportPeriod(start,end)} | ${shopLabel}${expensesOnly||view==='recoveries'?'':` | ${type==='all'?'All sales':type==='cash'?'Cash sales':'Creditor sales'}`}`} title={expensesOnly?'Expenses':view==='recoveries'?'Credit recoveries':'Sales'} color={expensesOnly?'#ea580c':view==='recoveries'?'#059669':'#2563eb'} rows={expensesOnly?expenses.map(r=>({date:r.date,amountMinor:r.amountMinor})):view==='recoveries'?recoveries.map(payment=>({date:payment.date,amountMinor:payment.amountMinor})):sales.map(sale=>({date:sale.businessDate,amountMinor:sale.total}))}/></div>{loading&&<div role="status" className="absolute inset-0 flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4"><span className="sr-only">Loading chart</span><div aria-hidden="true" className="h-5 w-40 rounded bg-slate-200 motion-safe:animate-pulse"/><div aria-hidden="true" className="h-3 w-3/4 rounded bg-slate-100 motion-safe:animate-pulse"/><div aria-hidden="true" className="flex-1 rounded-lg bg-slate-100 motion-safe:animate-pulse"/></div>}</div>
    </div>
    {!expensesOnly&&<div className="flex flex-wrap gap-x-8 gap-y-2 px-2 text-sm text-slate-600"><span>Payments collected: <strong>{money(sales.reduce((sum,r)=>sum+r.cashApplied,0))}</strong></span><span>Credit issued: <strong>{money(sales.reduce((sum,r)=>sum+r.credit,0))}</strong></span></div>}
    <div className="report-panel p-5">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-4"><h2 className="flex items-center gap-3 text-lg font-bold"><List className="text-blue-600" aria-hidden="true"/>{expensesOnly?'Expense Records':creditorsOnly?'Credit History':'Sales Records'}</h2>{creditorsOnly&&<div role="group" aria-label="Record type" className="report-periods">{(['credits','recoveries'] as const).map(value=><button key={value} aria-pressed={view===value} onClick={()=>setView(value)}>{value==='credits'?'Credits':'Recoveries'}</button>)}</div>}</div>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    <div className="relative min-h-64"><div aria-hidden={loading} className={loading?'invisible':''}>

      {expensesOnly&&<div className="overflow-x-auto"><table className="report-table"><thead><tr><th scope="col">#</th><th scope="col">Date</th><th scope="col">Shop</th><th scope="col">Description</th><th scope="col">Cashier / Paid via</th><th scope="col" className="text-right">Amount (QAR)</th></tr></thead><tbody>{expenses.slice((page-1)*10,page*10).map((row,index)=><tr key={row.id}><td>{(page-1)*10+index+1}</td><td className="whitespace-nowrap">{reportDate(row.date)}</td><td>{row.shopName||'Unassigned'}</td><td><span className="block font-medium">{row.category}</span><span className="whitespace-pre-wrap break-words">{row.description}</span></td><td>{row.cashierName}<span className="block text-xs text-slate-500">{row.paidVia}</span></td><td className="text-right font-bold">{money(row.amountMinor)}</td></tr>)}</tbody></table>{!expenses.length&&<p className="py-8 text-center text-slate-500">No expenses in this period.</p>}</div>}
      {receipt&&<SalesReceipt sale={receipt} onClose={()=>setReceipt(null)}/>}
      {!expensesOnly&&view==='credits'&&<div className="overflow-x-auto"><table className="report-table report-orders-table"><colgroup><col style={{width:'19%'}}/><col style={{width:'14%'}}/><col style={{width:'40%'}}/><col style={{width:'13%'}}/><col style={{width:'14%'}}/></colgroup><thead><tr><th scope="col">Date</th><th scope="col">Shop</th><th scope="col">Customer / Order details</th><th scope="col">Cashier</th><th scope="col" className="text-right">Amount (QAR)</th></tr></thead><tbody>{!sales.length&&<tr><td colSpan={5}><p className="py-8 text-center text-slate-500">No sales in this period.</p></td></tr>}{sales.slice((page-1)*10,page*10).map(sale=><tr key={sale.id}><td className="whitespace-nowrap">{new Date(sale.date).toLocaleString('en-GB',{timeZone:'Asia/Karachi'}).replaceAll('/','-')}</td><td>{sale.shopName||'Unassigned (legacy)'}</td><td><details className="rounded-lg p-2"><summary className="cursor-pointer"><span className="font-medium">{sale.creditor?.name || (sale.customerType==='delivery'?'Delivery':'Walk in Customer')}</span></summary>{sale.discountMinor!==undefined&&sale.discountMinor>0&&<p className="mt-3 text-sm text-emerald-700">Subtotal {money(sale.subtotal!)} / Discount {money(sale.discountMinor)}</p>}{sale.table&&<p className="mt-3 text-sm font-medium text-slate-700">{sale.table.floorName} / Table {sale.table.label}</p>}<p className="mt-4 break-all text-xs text-slate-500">Invoice {salesInvoiceNumber(sale)} · {sale.customerType} · Payment: {sale.paymentMethod?.name || 'Cash'} · Read-only</p><div className="mt-3 space-y-2">{sale.lines.map(line=><div key={line.itemId} className="grid grid-cols-[minmax(0,1fr)_80px_100px] gap-3 text-sm"><span className="break-words">{line.name} · {money(line.unitPrice)}</span><span>× {line.quantity}</span><span className="text-right">{money(line.total)}</span></div>)}</div><button className="mt-3 rounded-lg border border-blue-200 bg-white px-3 py-2 font-semibold text-blue-700" onClick={()=>setReceipt(sale)}>Print receipt</button><p className="mt-4 text-sm">Received {money(sale.received)} · Returned {money(sale.change)} · Credit {money(sale.credit)}</p></details></td><td>{sale.cashierName}</td><td className="text-right font-bold">{money(sale.total)}</td></tr>)}</tbody></table></div>}
      {creditorsOnly&&view==='recoveries'&&<div className="overflow-x-auto"><p className="mb-4 text-sm text-slate-600">Recoveries are separate from sales and checkout cash.</p><table className="report-table"><thead><tr><th scope="col">Date</th><th scope="col">Shop</th><th scope="col">Customer / Reference</th><th scope="col">Accepted by</th><th scope="col" className="text-right">Amount (QAR)</th></tr></thead><tbody>{recoveries.slice((page-1)*10,page*10).map(payment=><tr key={payment.id}><td>{reportDate(payment.date)}</td><td>{payment.shopName||'Unassigned (legacy)'}</td><td>{payment.creditor.name}<span className="block break-all text-xs text-slate-500">{payment.id}</span></td><td>{payment.acceptedByName}</td><td className="text-right font-bold">{money(payment.amountMinor)}</td></tr>)}</tbody></table>{!recoveries.length&&<p className="py-8 text-center text-slate-500">No recoveries in this period.</p>}</div>}
    </div>{loading&&<div role="status" className="absolute inset-0 space-y-3 bg-white"><span className="sr-only">Loading records</span>{[0,1,2].map(row=><div key={row} aria-hidden="true" className="h-16 rounded-xl bg-slate-100 motion-safe:animate-pulse"/>)}</div>}</div>
    </div>
    <ReportPagination page={page} total={expensesOnly?expenses.length:view==='recoveries'?recoveries.length:sales.length} onChange={setPage} disabled={loading}/>
    {customOpen&&<dialog ref={dialog} onCancel={()=>setCustomOpen(false)} aria-labelledby="history-date-title" className="m-auto w-full max-w-md rounded-2xl bg-white p-6 shadow-xl backdrop:bg-slate-950/40"><h2 id="history-date-title" className="text-xl font-semibold">Custom date range</h2><form className="mt-5 grid gap-4" onSubmit={e=>{e.preventDefault();setStart(draftStart);setEnd(draftEnd);setPeriod('Custom');setCustomOpen(false);}}><label className="grid gap-1 text-sm">Starting date<input autoFocus required className="rounded-lg border p-2" type="date" max={draftEnd} value={draftStart} onChange={e=>setDraftStart(e.target.value)}/></label><label className="grid gap-1 text-sm">Ending date<input required className="rounded-lg border p-2" type="date" min={draftStart} value={draftEnd} onChange={e=>setDraftEnd(e.target.value)}/></label><div className="flex justify-end gap-3"><button type="button" className="rounded-lg border px-4 py-2" onClick={()=>setCustomOpen(false)}>Cancel</button><button className="rounded-lg bg-blue-700 px-4 py-2 text-white">Apply dates</button></div></form></dialog>}
  </section>;
}
