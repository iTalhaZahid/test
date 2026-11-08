# POS web

For Vercel, follow [the monorepo deployment guide](../../DEPLOYMENT.md).
Vercel injects `BACKEND_URL` through the service binding so API operations run
in Express. The frontend no longer opens local storage.

Shop management, cashier assignments, and sales/expense/credit shop filters are
available. See [shop demo data and credentials](../desktop/SHOPS.md).

Run `pnpm dev:backend` and `pnpm dev:admin` in separate terminals from the
repository root, then open http://127.0.0.1:3000.
With dependencies already installed, `npm --prefix apps/admin-web run dev` also works.
Requires Node 24 and the workspace dependencies. The web app imports the desktop
React screens, Tailwind styles, and contracts. The backend reuses its SQLite stores. Login,
role permissions, management, checkout, expenses, credit recovery, report filters,
QAR amounts, business dates, validation, and duplicate-operation handling follow
the desktop implementation. No Electron runtime is loaded in the browser.

Development accounts match the desktop demo:

| Role | Username | Initial password |
| --- | --- | --- |
| Administrator | `admin` | `PosAdmin123!` |
| Cashier | `demo` | `PosDemo123!` |
| Sample cashier | `cashier.ayesha` / `cashier.bilal` | `PosCashier123!` |

The browser calls the same-origin `/api/pos` Next.js route. It validates requests
and forwards them through the runtime `BACKEND_URL` binding to Express. The
frontend owns no SQLite databases or encryption keys. Run `pnpm dev:backend`
alongside this app locally; standalone development defaults to port 4000.
On Vercel do not set `BACKEND_URL` yourself; the root service binding injects it.

Storage, authentication, and operations now live in `apps/backend`. Existing web
records must be retained by pointing the backend's `POS_WEB_DATA_DIR` to their
absolute directory or copying the complete directory, including `protection.key`.
See [deployment and data-preservation instructions](../../DEPLOYMENT.md).
Web and desktop sync records remain separate. Both backend stores still require
persistent storage; the binding does not migrate SQLite to a hosted database.

Checks: `pnpm --filter @pos/admin-web test`,
`pnpm --filter @pos/admin-web typecheck`, and
`pnpm --filter @pos/admin-web build`.

## Replace local records with demo data

Stop the backend, then run from the repository root:

```sh
corepack pnpm --filter @pos/admin-web test
corepack pnpm --filter @pos/backend exec tsx ../admin-web/scripts/replace-demo-data.mjs --replace
```

This replaces `apps/backend/.data/web` with three shops, registered employees and
linked salaries, monthly payments, and 30 days of sales, expenses and credit
recoveries. It retains the entire previous database directory in an ignored
`.data-backup-<timestamp>` folder. Keep that folder private: it includes the old
records and protection key. Desktop data and `POS_WEB_DATA_DIR` overrides are
not changed. The date range and totals are recorded in `.data/DEMO-DATA.json`.
Development login credentials above remain available. Select the last 30 days
in reports to see the complete demo range; chart axes adapt to filtered totals.

## Earlier verification (2026-11-06)

Production build, lint, admin-web and desktop type checks passed. Three web
regression tests cover persistence, role isolation, password changes, financial
operations and retries, archival, login/logout cookies, cross-origin rejection,
loopback hosts, and disabled demo access. All nine desktop tests passed too.

Argent/Chrome checks exercised visible admin and cashier sign-in, the admin
dashboard, menu search and editor loading, logout confirmation, and the cashier
sales screen. Financial writes were verified by automated tests rather than
entering real transactions in the browser. Runtime data/key files were absent
from the build's file traces. No public deployment, multi-host operation, or
desktop-to-web synchronization was tested or added.
