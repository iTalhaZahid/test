# Online POS API

The API uses MVC folders: `src/models` owns validation and persistent data, `src/controllers` handles HTTP requests and JSON responses, and `src/routes` maps endpoints. `app.ts` configures Express; `server.ts` opens storage and starts the process. No Redis or new dependency is needed.

## Start locally

From the repository root in PowerShell:

```powershell
$env:POS_DATA_DIR="$PWD/apps/backend/.data"
npm run build --prefix apps/backend
npm start --prefix apps/backend
```

On an empty database, startup creates **superadmin** with password **PosSuperAdmin123!** and the superuser role. No environment variables are needed for the first administrator. After signing in, use **Change Password**, then **Manage Admins** to create administrator accounts. Startup never resets changed passwords or replaces existing users. Environment files only configure server settings; native startup reads process environment variables. Node 24 is required.

In another PowerShell window:

```powershell
$env:POS_API_URL='http://127.0.0.1:4000'
npm run build --prefix apps/desktop
npm start --prefix apps/desktop
```

Sign in with the bootstrap administrator first to pair the terminal, then create staff and manage menus in POS. Staff accounts created offline upload automatically; each staff member must complete one online login before offline login is enabled for them. Built-in demo credentials are not automatically provisioned as online identities. Staff created through the older local management screen are retained and uploaded after administrator pairing; they still need a first online login.

For Docker, use the existing Compose commands; no administrator credentials are read from `.env`. The existing PostgreSQL service still uses the root `.env` for its database settings. The `backend-data` volume stores the API database. Back up that volume; container replacement alone must not remove it. The existing PostgreSQL service is retained for compatibility with the earlier scaffold but is not used by this sync implementation.

## Endpoints

All paths below are under `/api/v1`:

| Method | Path | Authentication / behavior |
| --- | --- | --- |
| POST | `/auth/login` | Username/password, `deviceId` and existing `deviceToken`; returns user, user token, terminal token and expiry |
| POST | `/auth/password` | User bearer token; `{current,next}`; changes password and revokes user sessions |
| POST | `/users` | Administrator bearer token; `{username,password,displayName,role,shopId,manageCreditsExpenses}`; only superusers create administrators |
| POST | `/sync/push` | Terminal bearer token; `{changes:[{entity,key,revision,baseVersion,payload}]}`; at most 50 changes, atomic acknowledgements |
| GET | `/sync/pull?after=0` | Terminal bearer token; ordered catalog, account metadata and recurring-payment changes with a durable cursor |
| GET | `/reports/events?after=0` | Administrator bearer token; up to 100 uploaded financial entries per page |

`GET /health` is unauthenticated process liveness. Sync uses real requests to this backend rather than assuming browser connectivity means the backend works. Login/password endpoints have an in-process rate limit and account lockouts; there is no Redis.

## Offline-first behavior

- Sales, expenses and credit recoveries still commit to local SQLite and their existing outboxes before returning success. The recovery copy remains required. Network requests never run inside checkout or its local transaction.
- Management records, account changes and monthly payments are queued by SQLite triggers in the same transaction as the local edit. Deletions use the existing archive flag. Favourites stay device-local.
- The worker checks the server every 5 seconds when healthy, backing off to at most 60 seconds on failure. A browser reconnect event also requests a retry. It runs independently of the visible screen and continues after logout while the desktop application is open.
- The exact in-flight request is encrypted and saved before upload. A lost response or restart replays it. The server commits the data and its deduplication receipt in one transaction; the terminal marks items synced only after validating every acknowledgement. An edit made during upload remains queued for the next batch.
- Record versions detect conflicting edits. A conflict stops acknowledgement and keeps local work intact; the header says **Sync needs attention** with the reason in its tooltip. Resolve the differing record deliberately; no automatic last-write-wins deletion is performed.
- The first login downloads available catalog pages before enabling offline login. Menu data and embedded images stay in SQLite, including across restarts and outages. Pulls never clear pending local edits or empty the menu on network failure.
- Successful online login caches a salted scrypt password verifier encrypted with Electron safeStorage, plus encrypted device/session tokens. Plaintext passwords are not persisted. Cached offline login remains available for 30 days after an online verification; reconnect and sign in online to renew it. A rejected online login never falls back to an old local credential. Changing a login password requires the server.
- Header states are **Working in offline Mode**, **Syncing**, **Synced**, **Sync needs attention**, and **Online sign-in required**. A server/network outage does not sign out an active session or prevent ordinary local tasks.

## Deployment boundary

For the Vercel frontend and persistent-server monorepo setup, see
[DEPLOYMENT.md](../../DEPLOYMENT.md). Keep this SQLite-backed sync API on a
persistent Node host; the web frontend forwards to the separate web data server,
not to these `/api/v1` endpoints.

Deploy one API instance with persistent SQLite storage behind HTTPS, and set `POS_API_URL` to its HTTPS origin before launching the desktop. HTTP is permitted only for localhost development; redirects are rejected. Only one paired POS terminal is accepted per backend/business, matching this project's original scope and preserving its sequential invoice numbers. Pairing tokens authorize that trusted terminal to upload its validated offline work, including work by other locally authorized staff.

This is not a multi-tenant service or a multi-terminal invoice allocator. Do not put unrelated businesses in one database. Offline permission revocations cannot take effect until the terminal reconnects. The separate Next.js admin-web application's existing store remains independent; `/reports/events` exposes central uploaded records for its later integration. This change does not migrate that web store or deploy a public server.

Verification: `npm test --prefix apps/backend` runs HTTP authentication/validation checks and an end-to-end desktop-storage → offline → restart → reconnect integration test, including lost responses, duplicate prevention, cached login, monthly payments and conflicts.
