# POS restaurant terminal, web app and sync API

A pnpm monorepo with an offline Electron POS, a Next.js web interface, and an
Express backend. Both server APIs now use Neon PostgreSQL; the desktop keeps
SQLite locally so checkout and cached login continue to work offline.

| Path | Responsibility |
| --- | --- |
| `apps/admin-web` | Next.js web UI and same-origin API proxy |
| `apps/backend` | PostgreSQL web data, accounts, financial records and desktop sync |
| `apps/desktop` | Electron terminal, local SQLite, receipts and offline sync |
| `packages/shared` | Shared TypeScript configuration |

## Setup and next steps

Use Node 24 and pnpm 10.34.9. From the repository root:

```sh
corepack pnpm install --frozen-lockfile
npx neon@latest init -y --org-id org-crimson-glade-80625709 --project-id old-shadow-38945301 --branch production --services postgres
npx neon@latest deploy
```

Neon writes the database URLs into ignored `.env.local` (or `.env`). Add a
64-character hexadecimal `POS_WEB_ENCRYPTION_KEY` and `POS_WEB_DEMO=1` there
for this private demo. Preserve the encryption key; do not rotate it casually.
See [deployment instructions](DEPLOYMENT.md) for generation and Vercel settings.

```sh
npm run db:migrate
npm run build
npm run dev:backend
```

In another terminal run `npm run dev:admin` and open `http://127.0.0.1:3000`.
For Vercel import Root Directory `.` and set `DATABASE_URL`,
`POS_WEB_ENCRYPTION_KEY` and `POS_WEB_DEMO=1`. The service binding injects
`BACKEND_URL`; do not add it yourself. SQLite directory variables are no longer
used by the deployed backend.

## First login and administrators

| Interface | Role | Username | Initial password |
| --- | --- | --- | --- |
| Browser demo | Superuser | `superuser` | `PosSuper123!` |
| Browser demo | Administrator | `admin` | `PosAdmin123!` |
| Browser demo | Cashier | `demo` | `PosDemo123!` |
| Electron / sync API | Bootstrap superuser | `superadmin` | `PosSuperAdmin123!` |

The migration seeds missing accounts without resetting passwords. Browser demo
accounts require `POS_WEB_DEMO=1`. Sign in as the appropriate superuser, use
Change Password, then Manage Admins. Web and desktop-sync accounts and records
remain separate. Keep this demo private: these initial credentials are public.

For the terminal, set `POS_API_URL` to the backend's public HTTPS origin (or
`http://127.0.0.1:4000` locally), then run the desktop app. Its first online login
pairs the terminal; subsequent cached logins and normal checkout can work offline.
Only one paired terminal is supported per backend/business.

## Checks

```sh
corepack pnpm lint
corepack pnpm --filter @pos/backend test
corepack pnpm --filter @pos/admin-web test
npm run build
npm run test:neon
```

The Neon integration suite requires the disposable test branch/environment
explained in [DEPLOYMENT.md](DEPLOYMENT.md#verification). It tests the built
frontend and backend against real PostgreSQL and refuses production.
Builds run sequentially to reduce peak memory use.

Old SQLite server files are preserved locally and are not automatically imported.
Plan a verified historical import before replacing an existing installation.
Environment files, keys, databases, recordings and the unfinished `.deployment`
copy are excluded from publication.

See [backend details](apps/backend/README.md), [desktop setup](apps/desktop/DESKTOP.md),
[demo installer](apps/desktop/DEMO.md), and [verification notes](VERIFICATION.md).
