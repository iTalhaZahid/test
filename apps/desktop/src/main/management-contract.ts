export type RecordKind = 'cashier' | 'employee' | 'employee-category' | 'expense-category' | 'creditor' | 'menu' | 'shop' | 'admin' | 'payment' | 'recurring' | 'floor';

export function managementErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : '';
  if (/UNIQUE constraint failed: local_users.username/i.test(message)) return 'This username is already in use. Choose another username.';
  if (!message || /SQLITE|constraint failed|SQL|\bat .+\.(?:js|ts):\d/i.test(message)) return 'Could not complete this action. Please try again. If the problem continues, contact your administrator.';
  return message;
}
export interface ManagementRecord {
  id: string; kind: RecordKind; name: string; phone: string; passport: string; identity: string;
  // shortcut: legacy column name holds QAR dirhams; rename with the production currency migration.
  pricePaisa: number; quantity: number;
  tables?: number[];
  username?: string; password?: string;
  shopId?: string;
  manageCreditsExpenses?: boolean;
  image?: string;
  paymentCategory?: 'cash' | 'card' | 'online';
  employee?: string;
  employeeId?: string;
  employeeCategory?: string;
  expenseType?: string;
  startMonth?: string;
}
export interface RecurringPayment { operationId: string; amountMinor: number; paidAt: string; paidBy: string }
export interface MonthlyExpense extends ManagementRecord { month: string; paid: boolean; paidAt?: string; paidBy?: string; paidMinor: number; payments: RecurringPayment[] }
export interface DesktopManagement {
  list(kind: RecordKind, search: string): Promise<ManagementRecord[]>;
  save(record: ManagementRecord): Promise<void>;
  remove(kind: RecordKind, id: string): Promise<void>;
  monthly(month: string): Promise<MonthlyExpense[]>;
  recordPayment(id: string, month: string, amountMinor: number, operationId: string): Promise<void>;
  setPaid(id: string, month: string, paid: boolean): Promise<void>;
}
