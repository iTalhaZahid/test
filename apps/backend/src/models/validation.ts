export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, 'Expected an object.');
  return value as Record<string, unknown>;
}
export function text(value: unknown, max = 120): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new ApiError(400, 'Invalid text.');
  return value.trim();
}
export function integer(value: unknown, min = 0, max = 99999999999): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new ApiError(400, 'Invalid amount or number.');
  return value;
}
export function passwordText(value: unknown): string {
  if(typeof value!=='string'||!value||value.length>128)throw new ApiError(400,'Invalid password.');
  return value;
}
export const entities = ['record', 'recurring', 'user', 'sale', 'expense', 'repayment'] as const;
export type Entity = typeof entities[number];
export interface Upload { entity: Entity; key: string; revision: number; baseVersion: number; payload: Record<string, unknown> }
export function upload(value: unknown): Upload {
  const row = object(value), entity = text(row.entity) as Entity, payload = object(row.payload);
  if (!entities.includes(entity)) throw new ApiError(400, 'Unknown sync entity.');
  const key = text(row.key, 160), revision = integer(row.revision, 1), baseVersion = integer(row.baseVersion);
  if (entity !== 'recurring' && payload.id !== key) throw new ApiError(400, 'Sync ID mismatch.');
  if (entity === 'record') {
    if (!['cashier','creditor','menu','shop','admin','payment','recurring','employee','employee-category','expense-category','floor'].includes(text(payload.kind))) throw new ApiError(400, 'Invalid record kind.');
    text(payload.name); integer(payload.pricePaisa);
    const half=integer(payload.half_price??0);
    if(half>Number(payload.pricePaisa)||(half>0&&payload.kind!=='menu'))throw new ApiError(400,'Invalid portion prices.'); integer(payload.quantity); integer(payload.archived, 0, 1);
    for (const field of ['phone','passport','identity','username','shop_id','employee_id','employee_category','employee','expense_type','start_month','payment_category']) {
      if (typeof payload[field] !== 'string' || String(payload[field]).length > 160) throw new ApiError(400, 'Invalid record field.');
    }
    integer(payload.manage_finance,0,1);
    if (!['cash','card','online'].includes(String(payload.payment_category))) throw new ApiError(400, 'Invalid payment category.');
    if (typeof payload.image !== 'string' || payload.image.length > 2700000 || (payload.image && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(payload.image))) throw new ApiError(400, 'Invalid menu image.');
    let tables: unknown;
    try { tables = JSON.parse(String(payload.floor_tables)); } catch { throw new ApiError(400, 'Invalid floor tables.'); }
    if (!Array.isArray(tables) || tables.length > 500 || tables.some(n => !Number.isSafeInteger(n) || n < 1 || n > 9999) || new Set(tables).size !== tables.length) throw new ApiError(400, 'Invalid floor tables.');
  } else if (entity === 'user') {
    text(payload.username,64); text(payload.display_name); integer(payload.is_superuser,0,1);
    if (!['admin','cashier'].includes(String(payload.role))) throw new ApiError(400, 'Invalid role.');
    const verifier = object(payload.verifier);
    if (typeof verifier.salt !== 'string' || !/^[a-f0-9]{32}$/.test(verifier.salt) || typeof verifier.hash !== 'string' || !/^[a-f0-9]{128}$/.test(verifier.hash)) throw new ApiError(400, 'Invalid password verifier.');
  } else if (entity === 'sale') {
    if (!['walk-in','creditor','delivery'].includes(String(payload.customerType)) || payload.currency !== 'QAR') throw new ApiError(400, 'Invalid sale.');
    text(payload.cashierId,64); text(payload.shopId,64); text(payload.businessDate,10);
    integer(payload.invoiceNumber,1001,99999999);
    if (!Array.isArray(payload.lines) || !payload.lines.length || payload.lines.length > 200) throw new ApiError(400, 'Invalid sale lines.');
    const subtotal = payload.lines.reduce((sum: number, value: unknown) => {
      const line = object(value); text(line.itemId,64); text(line.name);
      if(line.portion!==undefined&&!['half','full'].includes(String(line.portion)))throw new ApiError(400,'Invalid meal portion.');
      const total = integer(line.quantity,1,9999) * integer(line.unitPrice,1,999999999);
      if (integer(line.total) !== total) throw new ApiError(400, 'Invalid line total.');
      return sum + total;
    }, 0);
    const discount = integer(payload.discountMinor ?? 0), total = integer(payload.total), received = integer(payload.received);
    if (subtotal - discount !== total || (payload.subtotal !== undefined && payload.subtotal !== subtotal) || integer(payload.cashApplied) !== Math.min(total, received) || integer(payload.change) !== Math.max(0,received-total) || integer(payload.credit) !== Math.max(0,total-received)) throw new ApiError(400, 'Sale amounts do not balance.');
  } else if (entity === 'expense') {
    text(payload.cashierId,64); text(payload.shopId,64); text(payload.category); text(payload.description,500);
    integer(payload.amountMinor,1);
    if (!['cash','online'].includes(String(payload.paidVia)) || payload.currency !== 'QAR') throw new ApiError(400, 'Invalid expense.');
  } else if (entity === 'repayment') {
    text(payload.acceptedBy,64); text(payload.shopId,64); text(payload.creditorId,64); integer(payload.amountMinor,1);
    if (payload.currency !== 'QAR') throw new ApiError(400, 'Invalid recovery.');
  } else {
    if (`${text(payload.id,64)}:${text(payload.month,7)}` !== key) throw new ApiError(400, 'Invalid monthly expense ID.');
    integer(payload.pricePaisa,1);
    const payments = payload.payments ?? [];
    if (!Array.isArray(payments) || payments.length > 10000) throw new ApiError(400, 'Invalid monthly payments.');
    const seen = new Set<string>();
    const paid = payments.reduce((sum: number, item: unknown) => {
      const payment = object(item), id = text(payment.operationId,64);
      if (seen.has(id)) throw new ApiError(400,'Duplicate monthly payment.');
      seen.add(id); text(payment.paidAt,40); text(payment.paidBy);
      return sum + integer(payment.amountMinor,1);
    },0);
    if (paid > Number(payload.pricePaisa) || (payload.paidMinor !== undefined && payload.paidMinor !== paid)) throw new ApiError(400,'Invalid monthly balance.');
  }
  return { entity, key, revision, baseVersion, payload };
}
