export interface SaleDiscount { type:'percent'|'cash'; value:number }
export function discountAmount(subtotal:number,discount?:SaleDiscount):number {
  if(!discount)return 0;
  if(!['percent','cash'].includes(discount.type)||!Number.isSafeInteger(discount.value)||discount.value<0)throw new Error('Enter a valid discount.');
  if(discount.type==='percent'&&discount.value>10000)throw new Error('Discount cannot exceed 100%.');
  const amount=discount.type==='percent'?Math.round(subtotal*discount.value/10000):discount.value;
  if(amount>subtotal)throw new Error('Discount cannot exceed the bill.');
  return amount;
}
export type CustomerType = 'walk-in' | 'creditor' | 'delivery';
export interface MenuItem { id: string; name: string; priceMinor: number; favourite: boolean; image?: string }
export interface PaymentMethod { id: string; name: string; category: 'cash' | 'card' | 'online' }
export interface Creditor { id: string; name: string; phone: string }
export interface SaleRequest {
  operationId: string; customerType: CustomerType; creditorId: string | null;
  discount?: SaleDiscount;
  paymentMethodId?: string;
  table?: {floorId:string; number:number};
  lines: { itemId: string; quantity: number; unitPrice: number }[]; receivedMinor: number;
}
export interface Sale {
  invoiceNumber?: number;
  subtotal?:number; discountMinor?:number; discount?:SaleDiscount;
  paymentMethod?: PaymentMethod;
  table?: {floorId:string; floorName:string; number:number; label:string};
  shopId?: string; shopName?: string;
  id: string; date: string; businessDate: string; currency: 'QAR'; cashierId: string; cashierName: string;
  customerType: CustomerType; creditor: Creditor | null;
  lines: { itemId: string; name: string; quantity: number; unitPrice: number; total: number }[];
  total: number; received: number; cashApplied: number; change: number; credit: number;
}
export interface SaleFilter { start: string; end: string; type: 'all' | 'cash' | 'creditor'; shopId?: string }
export interface ExpenseRequest { shopId?: string; operationId: string; date: string; category: string; description: string; paidVia: 'cash' | 'online'; amountMinor: number }
export interface Expense extends Omit<ExpenseRequest, 'paidVia'> { paidVia: ExpenseRequest['paidVia'] | 'Not recorded'; id: string; createdAt: string; cashierId: string; cashierName: string; currency: 'QAR'; shopId?: string; shopName?: string }
export interface RepaymentRequest { operationId:string; creditorId:string; date:string; amountMinor:number; shopId?:string }
export interface Repayment extends RepaymentRequest { id:string; createdAt:string; acceptedBy:string; acceptedByName:string; creditor:Creditor; currency:'QAR'; shopName?:string }
export interface CreditorAccount { creditor:Creditor; credit:number; recovered:number; outstanding:number; sales:Sale[]; repayments:Repayment[] }
export interface DesktopSales {
  paymentMethods(): Promise<PaymentMethod[]>;
  menu(search: string): Promise<MenuItem[]>;
  favourite(itemId: string, enabled: boolean): Promise<void>;
  creditors(search: string): Promise<Creditor[]>;
  save(request: SaleRequest): Promise<{ ok: true; sale: Sale } | { ok: false; pending: boolean; message: string }>;
  history(filter: SaleFilter): Promise<Sale[]>;
  saveExpense(request: ExpenseRequest): Promise<{ ok: true; expense: Expense } | { ok: false; pending: boolean; message: string }>;
  expenses(start: string, end: string, shopId?: string): Promise<Expense[]>;
  creditorAccount(id:string):Promise<CreditorAccount>;
  recoverCredit(request:RepaymentRequest):Promise<{ok:true;repayment:Repayment}|{ok:false;pending:boolean;message:string}>;
  repayments(start:string,end:string,shopId?:string):Promise<Repayment[]>;
}
