# Website-connected desktop with offline saving (Windows x64)

POS Terminal Online now bundles the POS screens and uses a durable local SQLite
database. It downloads website records and synchronizes through `/api/v1/web/*`
into the website's `pos_web` tables. It does not use the legacy `pos_sync` feed,
and database credentials stay in the backend environment.

Install this build over the earlier online edition. First connect to the internet
and sign in as a website administrator to pair the terminal. Each cashier must
sign in online once on this terminal before using cached offline sign-in. That
verification lasts 30 days; expired verification requires another online login.
Existing financial entries never expire or get deleted.

Sales, expenses, credit recoveries, monthly payments and management edits save
locally while disconnected. Receipt printing remains local. Cached credentials
are encrypted using Windows account protection; the durable outbox survives
app closure, restart and logout. Background sync retries failed requests and
marks entries synced only after server acknowledgement. Operation IDs prevent
duplicate entries when a reply is lost. Each cashier's uploads use their own
cached server session and are checked against current server permissions.

The website and each terminal reserve separate invoice-number ranges. Receipts
retain their numbers after sync; gaps are expected. Reconnect after exhausting
the reserved numbers. Historical menu prices and original transaction times
are retained for offline bills. The server checks money and creditor balances.
Catalog changes download incrementally and remain available after logout.

Conflicting catalog edits or recoveries exceeding the website's current balance
remain locally with a sync error. Do not record or collect them again. Resolve
the conflict before considering the terminal synchronized. Disabled pairing
owners require an administrator to reconnect the terminal.

Build from the repository root:

```powershell
$env:POS_API_URL = 'https://test-brown-eight-79.vercel.app'
corepack pnpm package:online
```

The build also reads `POS_API_URL` from root `.env.local` and verifies a real
database-backed request before producing:
`apps/desktop/release/online/POS-Terminal-Online-0.1.0-Setup.exe`.
Apply all pending migrations through the existing database migration command
before deploying this backend version. `DATABASE_URL` and
`DATABASE_URL_UNPOOLED` stay in the backend/migration environment. No database
passwords or `.env` files are bundled in the installer.

The executable reads `POS_API_URL` from the process environment, a `.env` beside
the executable, `%APPDATA%\POS Terminal Online\pos-config.json`, or its bundled
configuration (in that order). Configuration files use:

```json
{"POS_API_URL":"https://test-brown-eight-79.vercel.app"}
```

A paired local database cannot be redirected to a different backend. Data lives
in `%APPDATA%\POS Terminal Online\pos.sqlite`, with encrypted recovery copies in
`%APPDATA%\POS Online Recovery\pending.sqlite`. Close the app before backing up
both directories. Do not remove them while entries are pending. The old
standalone edition's data stays separate and is not silently merged. The
installer is unsigned.
