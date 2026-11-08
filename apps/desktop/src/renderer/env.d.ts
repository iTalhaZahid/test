import type { DesktopSync } from '../main/sync-contract';
import type { DesktopAuth } from '../main/auth-contract';
import type { DesktopManagement } from '../main/management-contract';
import type { DesktopSales } from '../main/sales-contract';

declare global {
  interface Window { posSync?: DesktopSync; posPrinter?: { printReceipt(): Promise<void> }; posAuth: DesktopAuth; posManagement: DesktopManagement; posSales: DesktopSales }
}
