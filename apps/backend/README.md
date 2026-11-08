# Online POS API

The deployed API uses native PostgreSQL stores under `src/postgres`; `src/models` retains the original SQLite implementation only for offline regression tests. The API uses MVC folders: `src/models` owns validation and persistent data, `src/controllers` handles HTTP requests and JSON responses, and `src/routes` maps endpoints. `app.ts` configures Express; `server.mts` opens storage and starts the process. Its standalone ESM build is `dist/server.mjs`.

## Start locally

From the repository root, run Neon setup in [DEPLOYMENT.md](../../DEPLOYMENT.md),
then `npm run db:migrate`, `npm run build`, and `npm run dev:backend`.
The backend commands load root `.env`/`.env.local`. Runtime uses `DATABASE_URL`;
migrations use `DATABASE_URL_UNPOOLED`. `POS_WEB_ENCRYPTION_KEY` is a persistent
64-hex-character secret, and private browser demos need `POS_WEB_DEMO=1`.
No local data directory is used by the deployed backend.

The migration creates missing sync `superadmin` / `PosSuperAdmin123!` and, when
demo mode is enabled, web `superuser` / `PosSuper123!`, `admin` / `PosAdmin123!`,
and `demo` / `PosDemo123!`. Change passwords immediately. Running migrations
again never resets existing accounts. Accounts and financial records for the
browser and the one paired Electron terminal remain separate schemas.

## Browser web API

`POST /api/pos` belongs to this backend. Next.js validates browser requests and
calls it through the generated `BACKEND_URL` binding. The endpoint has no direct
public rewrite. Native PostgreSQL web stores preserve the existing API, roles,
financial validation and operation IDs. Sales, outboxes and encrypted recovery
entries persist transactionally in PostgreSQL instead of SQLite files.

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

See [Neon and Vercel deployment](../../DEPLOYMENT.md). The runtime has no SQLite
or local-file storage dependency. SQL migrations are versioned; run them before
deploying application changes that require new schema. Keep the encryption key
with a database restore and retain Neon backup/restore history.

The original one-business, one-paired-terminal scope remains. Transaction-scoped
advisory locks serialize financial and sync decisions across server instances.
Web and desktop server records are separate; this migration does not merge them.
Old SQLite records are not automatically imported or deleted.

`npm run test:neon` exercises the built frontend/backend and real Neon on a guarded
disposable branch, including concurrency, retries and restart persistence.
The existing SQLite tests retain coverage for offline desktop behavior.
