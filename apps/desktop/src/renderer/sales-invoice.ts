import type { Sale } from '../main/sales-contract';

export function salesInvoiceNumber(sale: Pick<Sale, 'invoiceNumber'>): string {
  return sale.invoiceNumber === undefined ? 'Unavailable' : String(sale.invoiceNumber).padStart(8, '0');
}
