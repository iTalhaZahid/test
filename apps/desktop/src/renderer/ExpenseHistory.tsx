import { useState } from 'react';
import { Plus } from 'lucide-react';
import { SalesHistory } from './SalesHistory';
import { ExpenseDialog } from './ExpenseDialog';
export function ExpenseHistory({period,fixedShopId,adminId}:{period:string;fixedShopId?:string;adminId?:string}) {
  const [open,setOpen]=useState(false),[revision,setRevision]=useState(0);
  return <><SalesHistory period={period} fixedShopId={fixedShopId} revision={revision} expensesOnly>{adminId&&<button className="flex min-h-11 items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 font-semibold text-white hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700" onClick={()=>setOpen(true)}><Plus size={18} aria-hidden="true"/>Add Expense</button>}</SalesHistory>{open&&adminId&&<ExpenseDialog cashierId={adminId} selectShop onClose={()=>{setOpen(false);setRevision(value=>value+1);}}/>}</>;
}
