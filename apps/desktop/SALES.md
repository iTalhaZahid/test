# Local checkout milestone

## Creditor accounts and recoveries

In Admin → Manage Creditors → Manage creditor, select a customer to view availed
credit, total recovered, and outstanding balance. Expand each linked invoice to
see original items, prices, checkout payment, timestamp, and cashier. Add Recovery
records a customer-level QAR repayment with collection date, unique operation ID,
creation timestamp, and the authenticated accepting admin. No bill ID is required.
The date defaults to today; future dates, nonpositive amounts, and overpayments
are rejected. Balance validation and repayment/outbox insertion share one SQLite
transaction. Encrypted `pending_repayments` recovery copies are retained before
reporting success; interrupted saves reuse the original ID. Recovery history stays
separate from sales, and sales totals and checkout cash are not rewritten.
These local records now upload in the background; see [sync setup](../backend/README.md). Audited corrections remain separate work.

Order completion now opens an **Order Saved** dialog after durable save confirmation.
**Record Expenses** opens a modal over the cashier home: date defaults to today in
Asia/Karachi, category accepts suggestions or custom text, description is required,
Paid via defaults to Cash with Online available, and amount is positive QAR.
Online records the payment method only; it does not initiate a payment.
Expenses preserve the expense date separately from creation time and authenticated
cashier. `expenses` and `expense_outbox` commit atomically, then an encrypted
`pending_expenses` recovery copy is written before success. Retries reuse the same ID.
Admin View Expenses supports daily, weekly, monthly, and custom expense-date ranges.

Cashiers open **Record Sales** after signing in. Search uses the SQLite FTS5 menu
index; stars persist favourites per cashier. The menu occupies the larger left
pane and the invoice has its own conditional scrollbar. Each item retains fixed
columns for name, unit price, quantity, and total. Long names wrap. No taxes,
service charges, receipt generation, or printing are added.

Prices and received amounts use QAR integer dirhams. The main process loads current
active items, checks the displayed prices, validates quantities and customer IDs,
and calculates all totals. Walk-in and delivery require full payment; excess cash
is returned as change. Creditor sales allow zero or partial payment; only the unpaid
amount becomes credit. A fully paid creditor order remains classified as a creditor
sale. Stock quantities remain manually maintained; no stock deduction is implemented.

Admin **View Sales** supports daily, Monday-start weekly, monthly, and inclusive
custom date ranges in Asia/Karachi. All sales counts every bill at full value.
Cash-only excludes every creditor-mode sale; creditor-only shows those sales.
Cash collected and credit issued are shown separately. Expand a bill to view its
immutable item/price snapshots, customer, timestamp, and cashier. **Credits History**
opens this view with the creditor filter selected; repayment history is available
on each selected customer's account in Manage Creditors.

## Storage and recovery

- `sales`, `sale_outbox`, and `customer_credit_entries` commit in one SQLite
  transaction using WAL and FULL synchronous writes. The cashier comes from the
  authenticated main-process session, never a renderer-provided ID.
- Before reporting success, a complete snapshot (original operation ID, line
  items, cashier and creditor dependencies) is encrypted with Windows safeStorage
  and committed to `%APPDATA%/POS Development Recovery/pending.sqlite`, separately
  from the primary database. Packaged builds use `%APPDATA%/POS Recovery`.
- Recovery records are retained. No server acknowledgement or deletion path exists
  until sync is implemented. This protects against primary database loss, not loss
  of the entire Windows drive or OS encryption keys.
- A failed recovery write reports an unconfirmed save. The renderer retains the
  original save request/ID in per-user local storage before invoking IPC, freezes
  editing, and offers retry, including after restart. Replaying that ID repairs the
  recovery copy and returns the existing sale without duplicating the ledger or outbox.
- Recovery restore tooling and server sync remain later milestones. Do not use this
  development build for live financial operations until those acceptance checks pass.

## Verification

`pnpm --filter @pos/desktop test` includes Electron-runtime checkout checks for
cash, delivery, full/partial credit, change, stale prices, invalid inputs, archived
items, cashier permissions, favourites, snapshots, atomic ledger/outbox writes,
recovery failure, restart, and duplicate retries. Desktop typecheck, lint, and build
also pass. Live Electron verification saved one sample QAR 300 creditor sale for
Sample Ahmed under Sample Ayesha: QAR 100 cash and QAR 200 credit. That development
record is intentionally retained and appears in admin Sales; cash-only excludes it.
The Windows installer was not rebuilt for this milestone.
