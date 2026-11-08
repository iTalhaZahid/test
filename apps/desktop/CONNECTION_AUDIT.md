# Desktop connection audit — 2026-11-06

Scope: current local desktop cashier/admin functionality, not completion of every PRD milestone.

| Entry point | Connection |
| --- | --- |
| Admin cashier setup | Profile and protected login verifier saved together; role fixed to cashier; login, password updates, and removal tested |
| Admin menu | Active SQLite menu feeds cashier FTS5 search and per-cashier favourites; archived items cannot be sold |
| Admin creditors | Active profiles feed checkout picker; selected account shows invoice snapshots, recoveries, and outstanding balance |
| Cashier Record Sales | Main-process price/quantity validation → sale, creditor ledger when applicable, outbox → encrypted recovery copy → Order Saved |
| Cashier Record Expenses | Modal → validated expense and accepting user → outbox and recovery copy → admin expense-date report |
| Cashier account menu | Password dialog verifies current password; sign-out clears the main-process session after confirmation |
| Admin View Sales | All/cash/creditor filters, inclusive date ranges, immutable line snapshots and cashier attribution |
| Admin View Expenses | Daily/weekly/monthly/custom expense-date report, payment method and cashier attribution |
| Admin Credits History | Credit sales plus recoveries by collection date; recovery amounts do not inflate sales or checkout cash |
| Creditor Add Recovery | Balance checked inside write transaction; repayment and outbox commit together; duplicate retries preserve original ID |

## Fixes from this audit

- Connected recovery records to the top-level Credits History report; they were previously visible only in individual creditor accounts.
- Prevented removing creditors with an outstanding balance or an unconfirmed recovery backup, avoiding an inaccessible account needing collection/retry.
- Removed unreachable placeholder screens and obsolete date-picker state; report screens own their actual filters.

## Evidence and limits

Types, lint, build, and Electron-runtime tests cover the storage/API paths. The
`desktop-flow.test.ts` integration test creates a cashier, menu item and creditor
as admin, signs in as the new cashier, saves a sale and expense, collects a recovery,
reopens storage, and verifies admin reports and attribution. It also checks removal
revokes cashier access without losing history. Tests use isolated temporary databases.
Live UI rechecking in this audit was blocked by the user's running non-debug desktop
instance; it was left untouched. Prior turns verified individual UI flows.

## Still outside the connected local implementation

- Production provisioning and real-account activation: packaged login remains disabled until implemented; local administration is development-only.
- Backend business APIs, server sync/acknowledgements, and the admin website: backend currently provides health only; admin web is a landing page.
- Backup restore UI/tooling and audited financial corrections. Durable local copies exist; end-to-end restoration and server durability are not complete.
- Stock deduction: quantity is manually maintained; checkout does not decrement it.
- Cashier own-transaction history and cashier recovery entry are not exposed; admin transaction entry is also not exposed. These PRD capabilities are not part of the current two-option cashier/six-option admin UI.
- Unsaved form/cart edits are not durable drafts. Financial save attempts retain original IDs for retry; navigating away before starting a save can discard edits.
- Installer packaging/installation was not repeated during this audit.

The local flows above are connected; this does not make the application production-ready.
