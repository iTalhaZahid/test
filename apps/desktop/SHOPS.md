# Shops and filter demo

Available in both desktop POS and admin-web. Admin can add/rename shops, assign
cashiers, and filter sales, expenses, and credit history by shop. The dashboard
shows four compact blue cards per row at desktop widths.

Existing cashiers migrate to Main Shop. Existing financial records retain their
payloads and appear under Unassigned (legacy). New sales and expenses use the
cashier's current assignment; moving a cashier never moves previous records.
Recoveries require a collection shop. Credit history filters sales by selling
shop and repayments by collection shop; the creditor's overall balance is shared.
Shops with financial records cannot be deleted. Menu and creditors remain shared.

## Seeded local data (2026-11-06)

Seeded the normal admin-web `.data/pos.sqlite` and desktop development database
in `%APPDATA%/POS Terminal Development/pos.sqlite` through their authenticated APIs.
Existing records and accounts were preserved. The installed demo EXE has its own
database and has not been repackaged or seeded.

| Shop | Cashier | Password | Demo sales | Demo expenses | Sales QAR | Expenses QAR | Credit outstanding QAR |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Main Shop | demo | PosDemo123! | 10 | 10 | 100 | 15.50 | 15 |
| North Shop | cashier.north | PosCashier123! | 10 | 10 | 200 | 25.50 | 30 |
| South Shop | cashier.south | PosCashier123! | 10 | 10 | 300 | 35.50 | 45 |

Each shop has six cash sales, four partially paid creditor sales, one demo
creditor named `Demo creditor - <shop name>`, and one repayment. Repayments are
QAR 5, 10 and 15 respectively. Select November 6, 2026 in reports to inspect
these records; any pre-existing transactions may add to totals.

`scripts/seed-shop-demo.mjs` exports `seedShopDemo(auth, management, sales)`.
Use only with explicitly authorized local demo API adapters. It uses stable
operation IDs, skips existing records, and asserts ten demo sales and expenses
per shop. Re-running it was verified against both apps without duplicates.
The desktop demo credential was repaired to the documented password above.

Validation: 12 desktop tests and 3 web tests passed, including migrations,
shop transfers, historical attribution, authorization, filtering, retries,
and persistence. Both builds and type checks passed. Dashboard rendering was
verified in Chrome and Electron, including four columns and contrasting cards.
