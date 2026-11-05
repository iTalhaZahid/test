# POS v1 Product Requirements Document

## 1. Product objective

Give a single business one Windows POS terminal that can record sales, customer credit, repayments, and expenses during internet outages. Administrators can review the day's local sales and expenses on the terminal and manage the business remotely through an online dashboard. Locally saved transactions must be recoverable while awaiting server confirmation.

## 2. Scope and permissions

| Capability | Cashier | Administrator | Availability |
| --- | --- | --- | --- |
| Sign in to the Windows POS | Yes | Yes | Offline after online provisioning |
| Save sales, expenses, and repayments | Yes | Yes | Windows POS, online or offline |
| View own transactions | Yes | Yes | Windows POS using local records |
| Find customers, view balances and repayment history, and add a customer at checkout | Yes | Yes | Windows POS, online or offline |
| View daily sales and expenses for all cashiers | No | Yes | Windows POS using local records |
| Correct saved bills | No | Yes | Online through the API after the original bill syncs |
| Manage menu, cashier accounts, and customer profiles | No | Yes | Online through the API |
| View consolidated daily, weekly, and monthly reports | No | Yes | Online through the API |

The web dashboard is admin-only. The Windows POS is the entry point for new financial transactions. One active terminal may be provisioned per business. Multiple cashiers can use that terminal with individual accounts.

Out of scope for v1 are receipt generation and printing, multiple terminals or branches, inventory, kitchen displays, table management, loyalty, payroll, accounting integrations, mobile apps, and advance customer credit.

## 3. Functional requirements

### AUTH — Access and account management

- Use username and password authentication. An administrator can create, deactivate, and reactivate cashier accounts. Keep each cashier's identity on historical records.
- Require an online connection for device provisioning, new account activation on the device, and password changes. Store secure password hashes on the server and a protected local verifier for previously provisioned users.
- Block deactivated users from online access immediately. Revoke their desktop access when the terminal next receives the account update, including during an active session. Keep previously saved transactions eligible for sync.
- Enforce role and device permissions in the desktop application and backend. Protect customer data, local credentials, backups, and data in transit.

### SALE — Checkout and billing

- Show active menu items. Allow adding multiple items, changing quantities, and removing items before saving. Calculate line totals and bill total from item quantities and prices. Store PKR amounts as integer paisa.
- Require at least one item, positive quantities, and a positive bill total. Store a unique bill ID, transaction date and time, cashier, customer when applicable, line items, original item names and prices, bill total, and cash received at checkout.

| Checkout type | Cash received now | Credit added | Customer required |
| --- | --- | --- | --- |
| Cash | Full bill total | Zero | No |
| Credit | Zero | Full bill total | Yes |
| Partial | More than zero and less than the bill total | Bill total minus cash received | Yes |

- For a credit or partial sale, let the cashier enter the credit amount or the amount paid now and calculate the other value. Validate that both amounts add up to the bill total. Show the saved transaction in history.
- After save, cashiers can view their bills. Only admins can correct saved bills.

### CREDIT — Customer ledger

- Require customer name. Phone, address, and notes are optional. Cashiers can search by name or phone and create a customer at checkout. Full profile management is online and admin-only.
- Show the customer's total credit taken, total repaid, current outstanding balance, credit sales with items, and dated repayments with the cashier who accepted each payment.
- Credit sales add only the unpaid part of the bill to the customer ledger. A repayment reduces the customer's balance as a standalone entry. Record customer, amount, date and time, accepting cashier, and a unique payment ID. The cashier selects the customer and enters the amount received.
- Calculate outstanding balance as credit issued minus repayments, including applicable audited adjustments. Validate that a repayment is positive and no greater than the latest locally available balance. Validate and commit the repayment in one local transaction.
- Example. A PKR 5,000 bill paid with PKR 2,000 cash adds PKR 3,000 to the customer's credit. A later PKR 1,000 repayment leaves PKR 2,000 outstanding across the customer's account.

### EXP — Expenses

- Record description, positive amount, expense date, optional remarks, and the authenticated user. Store the entry timestamp separately from the expense date.
- Include expenses in the report period based on expense date. Preserve original records and audit history for any correction.

### ADMIN — Records and corrections

- Admins can add, view, rename, reprice, and archive menu items. The terminal receives menu changes on sync. Saved bills keep the item names and prices captured at checkout.
- Admin bill corrections create a new revision with the original record, changed fields, reason, admin identity, and timestamp retained. Update the effective bill, customer ledger adjustment, and audit history atomically. Reports use the effective version and continue to attribute the original sale to its cashier.
- Apply the same audit controls to admin expense and repayment corrections. Preserve original entries. Where a correction would make a customer balance negative, block it and surface the affected records for admin resolution.
- Use record versions to reject stale corrections. If a remote correction reduces credit before an already collected offline repayment syncs, retain the full repayment, apply up to the outstanding amount, and flag the excess for admin reconciliation. Surface the unapplied amount separately and keep it out of the applied repayment balance. This protects real cash collections without introducing advance credit.

## 4. Reporting

| Report | Required measures and detail |
| --- | --- |
| Sales | Effective bill totals, number of sales, checkout cash, credit issued, partial sale count and amounts, cashier breakdown, bill details |
| Expenses | Total expenses, entry count, cashier breakdown, expense details |
| Customer credit | Credit issued and repayments received during the period, outstanding balance at period end, current outstanding by customer, individual ledger and repayment history, any unapplied collections flagged for review |

- The online admin dashboard supports daily, weekly, and monthly views. Use the business time zone for period boundaries. Use sale date for checkout, expense date for expenses, and collection date for repayments.
- Count each sale once at full bill value. Report checkout cash separately from credit issued. Report later repayments separately from sales and checkout cash. A historical bill correction updates the effective figures in the original bill period.
- Offline admin views show today's available sales and expenses, including saved pending entries. Label them as local and show pending count and last successful sync. The web dashboard uses committed server records and shows the terminal's last successful sync.

## 5. Local backup and synchronisation

1. Save the complete transaction and its sync outbox entry together in SQLite. The cashier can complete checkout without waiting for a server response.
2. Maintain a separate recoverable local backup of every pending financial transaction, including line items, customer dependencies, and original operation IDs. Mark a transaction as saved only after the primary record and recovery copy are durable. If the backup write fails, show the failure and recover or retry the same operation ID before accepting a repeat submission.
3. Retain recovery copies until the server has durably committed and acknowledged the associated operations. A restart, application update, failed sync, or missing acknowledgement must preserve pending records.
4. Upload automatically when the server is reachable. Retry transient failures with backoff and resume after restart. Use stable client-generated IDs and idempotency keys so retries, including after a lost response, produce one business transaction. Submit customer dependencies before dependent transactions. Pull versioned changes for menu, accounts, customers, and financial corrections.
5. Show pending, synced, and needs-review states. Keep rejected operations and their recovery copies available until resolved. Require the server to acknowledge successful operations after the PostgreSQL commit.
6. Provide an admin recovery path to restore pending records from the local backup and resume upload using the original IDs. Validate backup integrity and protect backups from unauthorised access. Use a distinct local recovery location. Recovery before sync requires that the recovery copy survive the incident. Maintain persistent PostgreSQL storage and document how to restore a server backup.

## 6. Delivery architecture

| Layer | V1 implementation |
| --- | --- |
| Terminal | Electron and React, Chromium, SQLite, and Electron Builder Windows installer |
| Admin dashboard | Next.js |
| Backend | Express and TypeScript with PostgreSQL |
| Sync | Persistent outbox and REST push/pull. Socket.IO can notify online clients to pull changes. |
| Deployment | Monorepo with shared types and validation, Docker Compose for server components, and persistent database storage |

The desktop installer initialises SQLite and creates shortcuts. It runs independently of Docker and PostgreSQL and preserves data during app updates.

Keep separate records for users, terminal, menu items, customers, bills and line snapshots, customer ledger entries, expenses, audit events, and the sync outbox. Bill credit issuance references its originating sale. Customer repayment records reference the customer and accepting user. Expose API modules for authentication, users, menu, customers, sales, customer repayments, expenses, reports, and sync. The repayment endpoint is customer-scoped, such as `POST /customers/:id/repayments`.

## 7. Release acceptance criteria

| ID | Scenario | Expected result |
| --- | --- | --- |
| AC-01 | Disconnect a provisioned terminal | Existing authorised users sign in. Cash, credit, and partial sales, customer creation, repayments, and expenses save locally. |
| AC-02 | Save a PKR 5,000 sale with PKR 2,000 paid now | Sales increase by PKR 5,000, checkout cash by PKR 2,000, and credit by PKR 3,000. |
| AC-03 | Repay PKR 1,000 on a PKR 3,000 balance across multiple bills | Save one dated customer entry with the accepting cashier. Balance is PKR 2,000, and sales totals stay the same. Reject a new repayment over PKR 2,000. |
| AC-04 | Cashier attempts to change a saved bill and admin then corrects it online | Cashier is denied. Admin correction is audited, reflected in reports and the ledger, and pulled to the terminal. |
| AC-05 | Quit during an outage, reopen, then reconnect | Locally saved entries survive and sync. Lost acknowledgements and retries create zero duplicates. |
| AC-06 | Restore from backup with a damaged primary database before sync | Recover pending transactions and their dependencies from the surviving copy. Replay with original IDs and verify server totals. |
| AC-07 | Make local backup storage unavailable during save | The app surfaces a save failure and reconciles the attempted operation without creating a duplicate on retry. |
| AC-08 | Update a menu price and deactivate a cashier online | The terminal picks up the changes. Historical prices and cashier attribution are preserved. Online access is revoked immediately and offline access ends after sync. |
| AC-09 | Compare offline daily and online period reports | Offline admin views show available sales and expenses with sync status. Online daily, weekly, and monthly totals match the synced records and agreed date boundaries. |
| AC-10 | Correct credit remotely before a previously collected offline repayment syncs | Full cash collection is preserved. The customer balance stays at or above zero and any excess is visible for admin resolution. |

## 8. Milestones

1. Provisioning, authentication, Windows installer baseline, and local storage.
2. Checkout, customer ledger, expenses, and offline daily views.
3. Local backup, restore, and sync recovery.
4. Admin web, audited corrections, and consolidated reports.
5. End-to-end release tests and deployment. Review milestone progress weekly.

## 9. Drafting decisions

- Audited admin corrections apply to bills, expenses, and repayments. Admin corrections are online so the terminal and server use the same revision history.
- Treat the admin website as a management and reporting interface. Keep new financial entry on the single terminal.
- Use Asia/Karachi as the initial business time zone and Monday as the start of the reporting week.
- Before release, confirm the terminal's backup destination and the operational handling of flagged excess collections. The product must retain the full collection and make the discrepancy visible until resolved.
