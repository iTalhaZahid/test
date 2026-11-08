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
React screens, Tailwind styles, and contracts. The backend ports the same rules to PostgreSQL. Login,
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

Storage, authentication and operations live in `apps/backend/src/postgres`.
The backend uses `DATABASE_URL` and `POS_WEB_ENCRYPTION_KEY`; no external web
server or SQLite directory is needed. Existing SQLite files remain untouched and
require a separate verified import if their records must be retained.
See [deployment instructions](../../DEPLOYMENT.md). Browser and desktop sync
records still remain separate PostgreSQL schemas.

Checks: `pnpm --filter @pos/admin-web test`,
`pnpm --filter @pos/admin-web typecheck`, and
`pnpm --filter @pos/admin-web build`.

## Demo data

`npm run db:migrate` initializes missing demo users and catalog when the backend
has `POS_WEB_DEMO=1`. It does not reset changed passwords. The old
`replace-demo-data.mjs` utility applies only to legacy SQLite files and must not
be used to reset the Neon database.

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
