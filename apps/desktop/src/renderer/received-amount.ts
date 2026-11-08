import type { CustomerType, PaymentMethod } from '../main/sales-contract';

export function receivedAmountError(value: string, amount: number, total: number, customer: CustomerType, payment?: PaymentMethod['category']): string {
  if (value === '' && customer !== 'creditor') return 'Enter the amount received.';
  if ((value !== '' && !/^\d+(\.\d{1,2})?$/.test(value)) || !Number.isSafeInteger(amount)) return 'Enter a valid amount with up to two decimals.';
  if (customer !== 'creditor' && amount < total) return 'Amount received must cover the total bill.';
  if (payment && payment !== 'cash' && amount > total) return 'Card and online payments cannot exceed the total bill.';
  return '';
}
