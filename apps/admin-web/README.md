# POS web

For Vercel, follow [the monorepo deployment guide](../../DEPLOYMENT.md).
Set `POS_WEB_SERVER_URL` on Vercel to forward API operations to this app running
on a persistent Node server; local storage remains on that server.

Shop management, cashier assignments, and sales/expense/credit shop filters are
available. See [shop demo data and credentials](../desktop/SHOPS.md).

Run `pnpm dev:admin` from the repository root, then open http://127.0.0.1:3000.
With dependencies already installed, `npm --prefix apps/admin-web run dev` also works.
Requires Node 24 and the workspace dependencies. The web app imports the desktop
React screens, Tailwind styles, contracts, and SQLite stores directly. Login,
role permissions, management, checkout, expenses, credit recovery, report filters,
QAR amounts, business dates, validation, and duplicate-operation handling follow
the desktop implementation. No Electron runtime is loaded in the browser.

Development accounts match the desktop demo:

| Role | Username | Initial password |
| --- | --- | --- |
| Administrator | `admin` | `PosAdmin123!` |
| Cashier | `demo` | `PosDemo123!` |
| Sample cashier | `cashier.ayesha` / `cashier.bilal` | `PosCashier123!` |

The server stores records in `apps/admin-web/.data` when started through pnpm.
Set `POS_WEB_DATA_DIR` to an absolute directory to override it. Keep the entire
directory, including `protection.key`, together when backing up or restoring.
Credentials and recovery payloads use AES-GCM protection; protect filesystem
access to the key and databases. Recovery on the same disk is not a disk backup.
Browser sessions use HttpOnly, SameSite cookies, expire after eight hours, and
survive server restarts. HTTPS requests receive Secure cookies. Every operation
checks authentication and uses the desktop's server-side permission/validation rules.

This is the desktop **local prototype** available through a browser. Web records
are separate from desktop records; there is no cloud sync. The browser needs its
Node server running and reachable. Use one persistent Node server, not an edge,
serverless, or multi-host deployment. The server needs the workspace desktop
source at build time. Production builds disable demo access unless
`POS_WEB_DEMO=1` is explicitly set for a private demonstration. Shared demo
credentials are not suitable for a public production service. Behind a proxy,
preserve the public request origin/host so same-origin request checks succeed.

Checks: `pnpm --filter @pos/admin-web test`,
`pnpm --filter @pos/admin-web typecheck`, and
`pnpm --filter @pos/admin-web build`.

## Replace local records with demo data

Stop the web server, then run from the repository root:

```sh
corepack pnpm --filter @pos/admin-web test
node apps/admin-web/scripts/replace-demo-data.mjs --replace
```

This replaces `apps/admin-web/.data` with three shops, registered employees and
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
