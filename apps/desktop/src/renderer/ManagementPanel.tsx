import { ReportPagination } from './ReportPagination';
import { EmployeePicker } from './EmployeePicker';
import { CategorySelect } from './CategorySelect';
import { PasswordInput } from './PasswordInput';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Plus, Search, Store, UtensilsCrossed, UserRound, ImagePlus, X } from 'lucide-react';
import { ConfirmDialog } from './ConfirmDialog';
import { SavedDialog } from './SavedDialog';
import { managementErrorMessage } from '../main/management-contract';
import { CreditorAccountPanel } from './CreditorAccountPanel';
import { dateString } from './SalesHistory';
import type { ManagementRecord, RecordKind } from '../main/management-contract';

const titles: Record<RecordKind,string> = {floor:'Floors','employee-category':'Employee categories','expense-category':'Expense categories',employee:'Employees',shop:'Shops',cashier:'Cashiers',menu:'Menu items',creditor:'Creditors',admin:'Administrators',payment:'Payment methods',recurring:'Recurring expenses'};
export function ManagementPanel({ kind, adding = false, onSaved, initialShopId = '', initialCategory = 'Driver', onBusyChange }: { kind: RecordKind; adding?: boolean; onSaved?: () => void; initialShopId?: string; initialCategory?: string; onBusyChange?: (busy: boolean) => void }) {
  const photoInput=useRef<HTMLInputElement>(null);
  const [shopId,setShopId] = useState(initialShopId);
  const [categoryFilter,setCategoryFilter]=useState('');
  const [categories,setCategories]=useState<string[]>([]); 
  const empty = (): ManagementRecord => ({id:'',kind,name:'',phone:'',passport:'',identity:'',pricePaisa:0,quantity:0,shopId:kind==='menu'?'__all__':shopId,manageCreditsExpenses:false,paymentCategory:'online',expenseType:'Salary',employee:'',employeeId:'',employeeCategory:initialCategory,startMonth:dateString(new Date()).slice(0,7)});
  const [records,setRecords] = useState<ManagementRecord[]>([]), [shops,setShops] = useState<ManagementRecord[]>([]);
  const [record,setRecord] = useState<ManagementRecord|null>(adding ? empty() : null);
  const [savedRecord,setSavedRecord]=useState<ManagementRecord|null>(null);
  const [query,setQuery] = useState(''), [price,setPrice] = useState(''), [revision,setRevision] = useState(0);
  const [portioned,setPortioned]=useState(false),[halfPrice,setHalfPrice]=useState('');
  const [busy,setBusy] = useState(false), [loading,setLoading] = useState(true), [error,setError] = useState(''), [notice,setNotice] = useState('');
  const [confirm,setConfirm] = useState<'save'|'delete'|null>(null), [page,setPage] = useState(0);
  useEffect(()=>{onBusyChange?.(busy);return()=>onBusyChange?.(false);},[busy,onBusyChange]);
  const salary = kind==='recurring'&&/^salar(y|ies)$/i.test(record?.expenseType||'');
  const employeeSalary = salary&&!!record?.employeeId&&record.id===record.employeeId;
  const hasShop = ['cashier','menu','recurring','employee'].includes(kind), account = kind==='cashier'||kind==='admin', person = account||kind==='creditor'||kind==='employee';
  const priced = kind==='menu'||kind==='recurring'||kind==='employee';
  const unchanged=!!record?.id&&!!savedRecord&&Object.keys({...savedRecord,...record}).every(field=>{
    const key=field as keyof ManagementRecord;
    if(key==='halfPricePaisa'&&kind==='menu')return (portioned?Number(halfPrice):0)===(savedRecord.halfPricePaisa||0)/100;
    if(key==='pricePaisa'&&priced)return Number(price)===savedRecord.pricePaisa/100;
    return (record[key]??'')===(savedRecord[key]??'');
  });
  const wideForm = person && kind!=='creditor';
  const noun = kind==='menu' ? 'item' : kind==='admin' ? 'administrator' : kind==='payment' ? 'payment method' : kind==='recurring' ? 'recurring expense' : kind;
  useEffect(()=>{ if(!hasShop)return; let active=true; window.posManagement.list('shop','').then(rows=>{if(active)setShops(rows);}).catch(()=>{if(active)setError('Could not load shops. Reopen this screen to retry.');}); return()=>{active=false;}; },[hasShop]);
  useEffect(()=>{let active=true;setLoading(true);const timer=setTimeout(()=>{window.posManagement.list(kind,query).then(rows=>{if(active)setRecords(rows);}).catch(()=>{if(active)setError('Could not load records. Check your access and retry.');}).finally(()=>{if(active)setLoading(false);});},150);return()=>{active=false;clearTimeout(timer);};},[kind,query,revision]);
  useEffect(()=>{if(kind!=='recurring'&&kind!=='employee')return;let active=true;window.posManagement.list(kind==='employee'?'employee-category':'recurring','').then(rows=>{if(active)setCategories([...new Set(rows.map(row=>kind==='employee'?row.name:row.expenseType||'').filter(Boolean))]);}).catch(()=>{if(active)setError('Could not load categories. Reopen this screen to retry.');});return()=>{active=false;};},[kind,revision]);
  useEffect(()=>{if(kind==='employee'&&shops.length)setRecord(current=>current&&!current.shopId?{...current,shopId:shops[0].id}:current);},[kind,shops]);
  function choose(row:ManagementRecord){setSavedRecord({...row,password:''});setRecord({...row,shopId:row.shopId||(kind==='employee'?shops[0]?.id||'':''),password:''});setPrice(row.id?(row.pricePaisa/100).toFixed(2):'');setPortioned(!!row.halfPricePaisa);setHalfPrice(row.halfPricePaisa?(row.halfPricePaisa/100).toFixed(2):'');setError('');setNotice('');}
  async function save(){
    if(!record||busy||unchanged)return;
    setConfirm(null);
    if(kind==='recurring'&&(salary||record.employee)&&!record.employeeId){setError('Choose a registered employee from the employee picker.');return;}
    if(priced&&!/^\d+(\.\d{1,2})?$/.test(price)){setError('Enter an amount with up to two decimals.');return;}
    if(kind==='menu'&&portioned&&(!/^\d+(\.\d{1,2})?$/.test(halfPrice)||Number(halfPrice)<=0||Number(halfPrice)>Number(price))){setError('Enter a positive Half price no greater than the Full price.');return;}
    setBusy(true);setError('');setConfirm(null);
    const [whole,fraction='']=price.split('.');
    const [halfWhole,halfFraction='']=halfPrice.split('.');
    const values={...record,pricePaisa:priced?Number(whole)*100+Number(fraction.padEnd(2,'0')):0,halfPricePaisa:kind==='menu'&&portioned?Number(halfWhole)*100+Number(halfFraction.padEnd(2,'0')):0};
    try{await window.posManagement.save(values);
      if(record.id){const saved={...values,password:''};setRecord(saved);setSavedRecord(saved);}else choose({...empty(),shopId:kind==='menu'?'__all__':record.shopId});
      setRevision(v=>v+1);setPage(0);setNotice(`Your ${kind==='menu'?'menu item':noun} has been ${record.id?'updated':'added'}.`);onSaved?.();
    }catch(e){setError(managementErrorMessage(e));}finally{setBusy(false);}
  }
  async function remove(){if(!record?.id||busy)return;setBusy(true);setConfirm(null);setError('');try{await window.posManagement.remove(kind,record.id);setRecord(null);setRevision(v=>v+1);setPage(0);setNotice(`Your ${kind==='menu'?'menu item':noun} has been removed from the active list.`);onSaved?.();}catch(e){setError(e instanceof Error?e.message:'Could not remove this record.');}finally{setBusy(false);}}
  function submit(e:FormEvent){e.preventDefault();if(busy||unchanged)return;if(record?.id)setConfirm('save');else void save();}
  async function photo(file:File|undefined){
    if(!file||!record)return;
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>2000000){setError('Choose a PNG, JPEG or WebP image up to 2 MB.');return;}
    setBusy(true);setError('');
    try{const image=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('Could not read image.'));reader.readAsDataURL(file);});setRecord({...record,image});}catch{setError('Could not read image. Try again.');}finally{setBusy(false);}
  }
  const pageSize=kind==='employee'?5:12;
  const filtered=records.filter(r=>(kind!=='menu'||!shopId||r.shopId===shopId||r.shopId==='__all__')&&(kind!=='employee'||!categoryFilter||r.employeeCategory===categoryFilter)), Icon=kind==='menu'?UtensilsCrossed:kind==='shop'?Store:UserRound;
  const input=(label:string,field:'name'|'phone'|'passport'|'identity'|'username'|'expenseType',required=false,maxLength=120)=><label className="grid gap-2 text-sm font-medium">{label}<input className="login-input" type={field==='phone'?'tel':'text'} required={required} readOnly={field==='name'&&employeeSalary} maxLength={maxLength} value={record?.[field]||''} onChange={e=>setRecord(record?{...record,[field]:e.target.value}:null)} autoComplete={field==='username'?'off':undefined}/></label>;
  const shopField=<label className="grid gap-2 text-sm font-medium">Shop<select className="login-input" required disabled={kind==='employee'&&!shops.length} value={record?.shopId||''} onChange={e=>{setRecord(record?{...record,shopId:e.target.value,...(kind==='recurring'?{id:employeeSalary?'':record.id,employeeId:'',employee:''}:{})}:null);if(kind==='menu'){setShopId(e.target.value==='__all__'?'':e.target.value);setPage(0);}}}>{kind!=='employee'&&kind!=='menu'&&<option value="">Choose a shop</option>}{kind==='menu'&&<option value="__all__">All shops</option>}{shops.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select>{!shops.length&&<span className="text-sm text-slate-500">Add a shop in Manage Shops first.</span>}</label>;
  return <div className="management-panel">
    {confirm&&<ConfirmDialog destructive={confirm==='delete'} confirmLabel={confirm==='delete'?`Remove ${noun}`:'Save changes'} title={confirm==='save'?'Save changes?':`Remove ${noun}?`} message={confirm==='save'?'Update this record with the entered information?':`Remove ${record?.name} from the active list? Existing financial history is retained.`} onCancel={()=>setConfirm(null)} onConfirm={()=>void(confirm==='save'?save():remove())}/>}
    {error&&<SavedDialog error title="Unable to complete action" message={managementErrorMessage(new Error(error))} onClose={()=>setError('')}/>}{notice&&<SavedDialog title="Success" message={notice} onClose={()=>setNotice('')}/>}
    <div className={`grid items-start gap-5 ${kind==='creditor'?'xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1.5fr)]':kind==='menu'?'lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_340px]':'lg:grid-cols-[minmax(230px,1fr)_minmax(0,2fr)]'}`}>
      <section className="min-w-0 rounded-2xl border border-slate-300 bg-slate-100 p-5" aria-label={`${noun} list`}>
        <div className="mb-4 flex items-center justify-between gap-3"><h2 className="font-semibold">{kind==='creditor'?'Search / Select Creditor':titles[kind]}</h2><button disabled={busy} onClick={()=>choose(empty())} className="flex items-center gap-2 rounded-lg border-2 border-blue-800 bg-blue-700 px-4 py-2 font-semibold text-white shadow-sm hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:opacity-50"><Plus size={18} aria-hidden="true"/>Add</button></div>

        {kind==='employee'&&<label className="mb-4 grid gap-2 text-sm font-medium">Employee category filter<select className="login-input" disabled={busy} value={categoryFilter} onChange={e=>{setCategoryFilter(e.target.value);setPage(0);}}><option value="">All categories</option>{[...new Set([...categories,...records.map(row=>row.employeeCategory||''),categoryFilter].filter(Boolean))].sort((a,b)=>a.localeCompare(b)).map(category=><option key={category} value={category}>{category}</option>)}</select></label>}
        <div className={kind==='menu'?'grid grid-cols-[minmax(0,1fr)_minmax(0,0.7fr)] items-end gap-4':''}>
          <label className="grid min-w-0 gap-2 text-sm font-medium">Search<span className="relative block"><Search size={18} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input className="login-input" type="search" maxLength={120} value={query} onChange={e=>{setQuery(e.target.value);setPage(0);}}/></span></label>
          {kind==='menu'&&<label className="grid min-w-0 gap-2 text-sm font-medium">Shop filter<select className="login-input" disabled={busy} value={shopId} onChange={e=>{setShopId(e.target.value);setRecord(null);setPage(0);}}><option value="">All shops</option>{shops.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
        </div>
        <div className={`mt-4 ${kind==='menu'?'grid max-h-[640px] grid-cols-2 gap-3 overflow-y-auto xl:grid-cols-3 2xl:grid-cols-4':''}`} aria-busy={loading}>
          {loading?<p role="status">Loading…</p>:!filtered.length?<p className="text-sm text-slate-500">No matching records. Try another search or filter, or add a record.</p>:filtered.slice(page*pageSize,(page+1)*pageSize).map(row=><button key={row.id} disabled={busy} aria-pressed={record?.id===row.id} onClick={()=>choose(row)} className={`mb-2 w-full overflow-hidden rounded-xl border text-left ${record?.id===row.id?'border-blue-500 bg-blue-50':'border-slate-200 hover:bg-slate-50'}`}>
            {kind==='menu'&&(row.image?<img src={row.image} alt="" className="h-28 w-full object-cover" loading="lazy"/>:<span className="grid h-28 place-items-center bg-blue-50 text-blue-600"><Icon size={32} aria-hidden="true"/></span>)}
            <span className="block p-3">{kind==='menu'?<span className="flex items-start justify-between gap-2"><span className="min-w-0 break-words font-semibold">{row.name}</span><strong className="shrink-0 rounded-md bg-blue-50 px-2 py-1 text-base text-blue-800">{row.halfPricePaisa?`Half ${(row.halfPricePaisa/100).toFixed(2)} / Full ${(row.pricePaisa/100).toFixed(2)}`:`QAR ${(row.pricePaisa/100).toFixed(2)}`}</strong></span>:<><span className="block break-words font-medium">{row.name}</span><span className="text-xs text-slate-500">{priced?`QAR ${(row.pricePaisa/100).toFixed(2)}`:kind==='payment'?row.paymentCategory:row.phone}</span></>}{kind==='employee'&&<span className="block text-xs text-slate-500">{row.employeeCategory}</span>}{kind==='menu'&&<span className="block text-xs text-slate-500">{row.shopId==='__all__'?'All shops':shops.find(s=>s.id===row.shopId)?.name} · Stock {row.quantity}</span>}</span>
          </button>)}
        </div>
        {kind==='employee'?<ReportPagination page={page+1} pageSize={pageSize} total={filtered.length} onChange={value=>setPage(value-1)} disabled={busy||loading}/>:filtered.length>12&&<div className="flex items-center justify-between text-sm"><button disabled={page===0} onClick={()=>setPage(p=>p-1)} className="p-3 text-blue-700 disabled:opacity-40">Previous</button><span>{page+1} / {Math.ceil(filtered.length/12)}</span><button disabled={(page+1)*12>=filtered.length} onClick={()=>setPage(p=>p+1)} className="p-3 text-blue-700 disabled:opacity-40">Next</button></div>}
      </section>
      <section className="min-w-0 rounded-2xl border border-slate-300 bg-slate-100 p-6">
        {!record?<div className="py-12 text-center"><Icon size={36} className="mx-auto mb-4 text-blue-600" aria-hidden="true"/><h2 className="font-semibold">Select {kind==='menu'||kind==='admin'||kind==='employee'?'an':'a'} {noun}</h2><p className="mt-2 text-sm text-slate-500">Choose a record to update, or add a new one.</p></div>:<form onSubmit={submit}>
          <h2 className="mb-5 text-lg font-semibold">{record.id?'Update':'Add'} {noun}</h2>
          <fieldset disabled={busy} className="grid gap-5">
            <div className={`grid gap-5 ${wideForm?'md:grid-cols-2':''}`}>
              <div className="grid content-start gap-4">{input('Name','name',true)}
                {person&&<>{input(kind==='employee'?'Phone number (optional)':'Phone number','phone',kind!=='employee',30)}{kind!=='creditor'&&<>{input('Passport (optional)','passport',false,40)}{input('ID (optional)','identity',false,64)}</>}</>}
                {hasShop&&!wideForm&&shopField}
                {kind==='menu'&&<label className="flex min-h-11 items-center gap-3 text-sm font-medium"><input type="checkbox" className="size-5 accent-blue-700" checked={portioned} onChange={e=>setPortioned(e.target.checked)}/>Portioned meal (Half / Full)</label>}
                {priced&&kind!=='employee'&&<label className="grid gap-2 text-sm font-medium">{kind==='recurring'?'Monthly amount':kind==='menu'&&portioned?'Full price':'Price'} (QAR)<input className="login-input" required type="number" min="0.01" max="9999999.99" step="0.01" value={price} onChange={e=>setPrice(e.target.value)}/></label>}
                {kind==='menu'&&portioned&&<label className="grid gap-2 text-sm font-medium">Half price (QAR)<input className="login-input" required type="number" min="0.01" max={price||'9999999.99'} step="0.01" value={halfPrice} onChange={e=>setHalfPrice(e.target.value)}/></label>}
                {kind==='menu'&&<><label className="grid gap-2 text-sm font-medium">Available stock quantity<input className="login-input" required type="number" min="0" max="999999999" step="1" value={record.quantity} onChange={e=>setRecord({...record,quantity:Number(e.target.value)})}/></label><div className="grid gap-3"><p className="text-sm font-medium">Photo (optional)</p><input ref={photoInput} hidden type="file" accept="image/png,image/jpeg,image/webp" aria-label="Menu item picture" onChange={e=>{void photo(e.target.files?.[0]);e.target.value='';}}/><button type="button" onClick={()=>photoInput.current?.click()} className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-blue-200 bg-white px-4 py-2 text-sm font-semibold text-blue-700 shadow-sm hover:border-blue-400 hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50"><ImagePlus size={18} aria-hidden="true"/>{record.image?'Change picture':'Choose a picture'}</button><p className="text-xs text-slate-500">PNG, JPEG or WebP, up to 2 MB.</p>{record.image&&<div className="relative w-fit"><img src={record.image} alt="Menu item preview" className="h-28 w-28 rounded-xl border border-slate-200 bg-white object-cover"/><button type="button" aria-label="Remove selected picture" title="Remove picture" className="absolute -right-2 -top-2 flex size-11 items-center justify-center rounded-full border border-red-200 bg-red-50 text-red-700 shadow-sm hover:border-red-400 hover:bg-red-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50" onClick={()=>setRecord({...record,image:''})}><X size={18} aria-hidden="true"/></button></div>}</div></>}
                {kind==='payment'&&<label className="grid gap-2 text-sm font-medium">Category<select className="login-input" value={record.paymentCategory} onChange={e=>setRecord({...record,paymentCategory:e.target.value as ManagementRecord['paymentCategory']})}><option value="cash">Cash</option><option value="card">Card</option><option value="online">Online / delivery partner</option></select><span className="font-normal text-slate-500">For Online, use the partner name, such as FoodPanda, PandaMart or Cheetah.</span></label>}
                {kind==='recurring'&&<><CategorySelect kind="expense-category" label="Expense category" value={record.expenseType||''} extra={categories} onChange={expenseType=>setRecord({...record,expenseType,id:employeeSalary?'':record.id})}/>
                  <EmployeePicker key={record.id} employeeId={record.employeeId} name={record.employee} category={record.employeeCategory} shopId={record.shopId} required={salary} onChange={employee=>{
                    if(!employee){setRecord({...record,employee:'',employeeId:''});return;}
                    setRevision(v=>v+1);
                    if(salary&&employee.kind==='employee'){
                      setRecord({...record,id:record.id&&!employeeSalary?record.id:employee.id,name:`Salary: ${employee.name}`,employee:employee.name,employeeId:employee.id,employeeCategory:employee.employeeCategory,shopId:employee.shopId,startMonth:employee.startMonth});
                      setPrice((employee.pricePaisa/100).toFixed(2));
                    }else setRecord({...record,id:employeeSalary?'':record.id,employee:employee.name,employeeId:employee.id,employeeCategory:employee.kind==='cashier'?'Cashier':employee.employeeCategory,shopId:employee.shopId});
                  }}/>
                  {salary&&record.employeeId&&record.employeeCategory!=='Cashier'&&<p className="text-sm text-slate-500">This is the employee's existing salary. Saving updates it without creating another monthly expense. Previously opened months keep their amounts and payments.</p>}
                  <label className="grid gap-2 text-sm font-medium">Starting month<input className="login-input" type="month" required value={record.startMonth} onChange={e=>setRecord({...record,startMonth:e.target.value})}/></label></>}
              </div>
              {kind==='creditor'&&<div className="grid content-start gap-4">{input('Passport (optional)','passport',false,40)}{input('ID (optional)','identity',false,64)}</div>}
              {kind==='employee'&&<div className="grid content-start gap-4">
                <CategorySelect kind="employee-category" label="Employee category" value={record.employeeCategory||''} onChange={employeeCategory=>setRecord({...record,employeeCategory})}/>
                {shopField}
                <label className="grid gap-2 text-sm font-medium">Monthly salary (QAR)<input className="login-input" required type="number" min="0.01" max="9999999.99" step="0.01" value={price} onChange={e=>setPrice(e.target.value)}/></label>
                <label className="grid gap-2 text-sm font-medium">Starting month<input className="login-input" required type="month" value={record.startMonth} onChange={e=>setRecord({...record,startMonth:e.target.value})}/></label>
                <p className="text-sm text-slate-500">Salary appears automatically in Monthly Recurring Expenses. Saved months retain their original amount and payments. This employee has no login access.</p>
              </div>}
              {account&&<div className="grid content-start gap-4">
                {kind==='cashier'&&<><label className="flex items-center justify-between gap-3 rounded-xl bg-blue-50 p-4 text-sm font-medium">Manage Credits and Expense<button type="button" role="switch" aria-label="Manage Credits and Expense" aria-checked={!!record.manageCreditsExpenses} onClick={()=>setRecord({...record,manageCreditsExpenses:!record.manageCreditsExpenses})} className={`relative h-7 w-12 shrink-0 rounded-full border-2 border-transparent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 ${record.manageCreditsExpenses?'bg-blue-700':'bg-slate-400'}`}><span className={`absolute top-0.5 size-5 rounded-full bg-white ${record.manageCreditsExpenses?'right-0.5':'left-0.5'}`}/></button></label>{shopField}</>}
                {input('Username','username',true,64)}
                <label className="grid gap-2 text-sm font-medium">Password<PasswordInput key={record.id} className="login-input" required={!record.id} minLength={8} maxLength={128} autoComplete="new-password" value={record.password||''} onChange={e=>setRecord({...record,password:e.target.value})}/><span className="text-xs font-normal text-slate-500">{record.id?'Leave blank to keep the current password.':'At least 8 characters.'}</span></label>
              </div>}
            </div>
            <button disabled={unchanged||(kind==='employee'&&!shops.some(shop=>shop.id===record.shopId))} className="primary-button">{busy?'Saving…':record.id?'Save changes':`Add ${noun}`}</button>
            {record.id&&!employeeSalary&&<button type="button" className="min-h-11 w-full rounded-lg border border-red-300 bg-white px-4 py-2 font-semibold text-red-700 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700 disabled:opacity-50" onClick={()=>setConfirm('delete')}>Remove {noun}</button>}
          </fieldset>
        </form>}
      </section>
      {kind==='creditor'&&<div className="min-w-0">{record?.id?<CreditorAccountPanel key={record.id} id={record.id}/>:<section className="rounded-2xl border border-slate-300 bg-slate-100 p-5" aria-label="Creditor credit account"><h2 className="text-lg font-semibold">Credit account</h2><p className="mt-4 py-8 text-center text-sm text-slate-500">Select an existing creditor to view their balance, invoices, and recoveries.</p></section>}</div>}
    </div>
  </div>;
}
