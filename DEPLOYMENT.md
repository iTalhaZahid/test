# Neon and Vercel deployment

## Architecture

The root `vercel.json` defines `admin-web` (Next.js) and `backend` (Express).
Both web and sync data are now normal PostgreSQL rows in Neon. The running backend
uses `src/postgres`, not the old SQLite stores. Electron retains its own SQLite
stores for offline checkout and sync; browser and desktop server records remain
separate, matching the existing application behavior.

| Public path | Service | Behavior |
| --- | --- | --- |
| `/api/v1/*` | `backend` | Desktop authentication and synchronization |
| `/health` | `backend` | Process liveness, not database readiness |
| `/api/pos` | `admin-web` | Same-origin validation and proxy through binding |
| All other paths | `admin-web` | Next.js pages and assets |

`admin-web` binds to `backend` as `BACKEND_URL`. Vercel injects it at runtime;
never set it manually or expose it through a `NEXT_PUBLIC_` variable. The backend
web endpoint has no direct public rewrite. Both services retain application
permission checks. Session cookies remain HttpOnly/SameSite, and HTTPS browser
sessions receive Secure cookies even when internal transport uses HTTP.

The backend uses an explicit ESM entry (`src/server.mts`) with
`outputDirectory: "."` to avoid the Vercel Services workspace dependency-path
issue. Standalone builds produce `dist/server.mjs` for ordinary Node hosting.

## Neon setup and migration

Neon is linked locally through the ignored `.neon` file. `neon.ts` declares only
Postgres; it does not replace the existing application's authentication provider.
The configured project is `old-shadow-38945301`, production branch `production`.

```sh
npx neon@latest init -y --org-id org-crimson-glade-80625709 --project-id old-shadow-38945301 --branch production --services postgres
npx neon@latest deploy
```

The CLI pulls `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` (direct) into the
root `.env.local`, or `.env` if that already exists. Those files are ignored.
Generate a 32-byte hexadecimal `POS_WEB_ENCRYPTION_KEY` once and save it there;
keep the same secret in Vercel and preserve it when restoring the database.
Do not regenerate it for an existing database: it protects account verifiers and
financial recovery records. For a private demo, also set `POS_WEB_DEMO=1`.

```sh
npm run db:migrate
npm run build
npm run dev:backend
```

In another terminal: `npm run dev:admin`, then visit `http://127.0.0.1:3000`.
The backend dev/start/migration commands load the root `.env` and `.env.local`.
Migrations use the direct URL; runtime requests reuse a small `pg` pool with the
pooled URL and Vercel's `attachDatabasePool` lifecycle integration.

The migrations create versioned `pos_web` and `pos_sync` schemas and indexes.
The migration command records a checksum, seeds only missing bootstrap/demo
accounts, and never resets existing passwords. Financial writes, outbox/recovery
rows, recurring payments, and sync receipts use database transactions. Per-business
transaction advisory locks preserve the existing one-business/one-terminal
invoice ordering and prevent lost updates across instances. Recovery copies now
live in encrypted PostgreSQL rows, not local files. Keep Neon backups/restore
history; those rows are not an independent backup against deleting the database.

Old SQLite files are neither deleted nor automatically imported. This setup
initializes a new PostgreSQL database. If historical records must be retained,
stop old writes and plan a verified import before switching that installation.
Do not delete its SQLite databases or `protection.key`.

## Vercel settings

1. Import this repository with Root Directory `.` and Node 24.x. Leave project-wide
   build/output overrides unset; use the settings in `vercel.json`.
2. Add `DATABASE_URL`, `POS_WEB_ENCRYPTION_KEY`, and `POS_WEB_DEMO=1` to the backend
   deployment environment (shared project variables also work). Copy actual values
   from the ignored root environment file. Do not use the example placeholders.
3. Run migrations with `DATABASE_URL_UNPOOLED` from a trusted local/CI environment
   before redeploying. That direct URL need not be exposed to the running app.
4. Remove `POS_DATA_DIR`, `POS_WEB_DATA_DIR`, and `POS_WEB_SERVER_URL` from Vercel.
   There are no runtime SQLite files or local encryption keys in the backend.
5. Redeploy the latest source. Vercel supplies `BACKEND_URL` itself.

For Electron set `POS_API_URL` to the deployed public origin, without `/api/v1`.
The terminal app adds that prefix. Do not point preview deployments at production
records; use a separate Neon branch and its matching encryption key.

## Verification

For local Docker development, copy `.env.example` to `.env` and replace its
encryption-key placeholder with a generated 64-hex-character key before running
Compose. The backend connects to the Compose PostgreSQL service and migrates it
before startup. The old `backend-data` volume is retained for recovery only;
new records live in `postgres-data`. Docker was not exercised in the Neon checks.

The opt-in `test:neon` suite starts the built frontend and backend, verifies their
real API/binding path, roles, password changes, menu search, financial writes,
retries, concurrent duplicates, sync receipts, and persistence across backend
restarts. It requires a disposable branch named `pos-pg-migration-*` and refuses
production. Pull that branch's Postgres env to `.env.neon-test`, append the same
key and demo flag, run its migration, then run `npm run test:neon`.

Legacy SQLite tests remain as regression coverage for desktop/offline behavior.
No Vercel preview/production deployment is performed by `neon deploy` itself.

## First login

| API | Username | Initial password | Role |
| --- | --- | --- | --- |
| Web demo | `superuser` | `PosSuper123!` | Superuser |
| Web demo | `admin` | `PosAdmin123!` | Administrator |
| Web demo | `demo` | `PosDemo123!` | Cashier |
| Desktop sync | `superadmin` | `PosSuperAdmin123!` | Bootstrap superuser |

Web demo accounts require `POS_WEB_DEMO=1`. Change initial passwords, then use
Manage Admins to create administrators. These public demo credentials require
private demo hosting; a public production account-provisioning flow is not added.
