# POS restaurant terminal and online sync API

Restaurant POS with local SQLite checkout, receipts, management, encrypted cached login and background synchronization. See [online API and offline-first setup](apps/backend/README.md) for current authentication, endpoints, deployment and sync behavior.

## Next steps for this test repository

The root `vercel.json` now declares the `admin-web` and `backend` services.
See [the multi-service setup and storage blocker](DEPLOYMENT.md#vercel-multi-service-project)
before importing the repository root into Vercel. Express still needs a hosted
database migration for Vercel; the persistent-server deployment below remains
the working option for SQLite.

1. Clone this repository and install Node 24 and pnpm 10.34.9.
2. Run `corepack pnpm install --frozen-lockfile` from the repository root.
3. For a local browser test, run `corepack pnpm dev:admin` and open
   `http://127.0.0.1:3000`. Use the web credentials below.
4. Follow [DEPLOYMENT.md](DEPLOYMENT.md) to run the persistent web data server
   and deploy `apps/admin-web` on Vercel. Set `POS_WEB_SERVER_URL` to the HTTPS
   origin of that web data server, not the Express sync API.
5. For the Electron terminal, run `corepack pnpm dev:backend`, then in another
   PowerShell window set `$env:POS_API_URL='http://127.0.0.1:4000'` and run
   `corepack pnpm dev:desktop`. Use the backend credentials below.

### First login and first superuser

These are built-in bootstrap/demo credentials, not private deployment secrets.
Change the initial password immediately and keep test deployments private.
Web and desktop-sync records are separate databases; their accounts do not sync
with each other.

| Where to sign in | Role | Username | Initial password |
| --- | --- | --- | --- |
| Browser web demo | Superuser | `superuser` | `PosSuper123!` |
| Browser web demo | Administrator | `admin` | `PosAdmin123!` |
| Browser web demo | Cashier | `demo` | `PosDemo123!` |
| Electron terminal / Express API | Bootstrap superuser | `superadmin` | `PosSuperAdmin123!` |

**Web:** development automatically seeds the demo superuser on first startup.
For a private production-mode demonstration, set `POS_WEB_DEMO=1` on the
persistent web data server. Sign in as `superuser`, use **Change Password**,
then **Manage Admins** to create your administrator. Restarting does not reset
the password. Without demo mode the current web prototype has no production
account provisioning flow; deploying the frontend does not add one.

**Backend/Electron:** starting the backend with an empty database automatically
creates `superadmin` with the superuser role. There is no separate registration
step. Sign in from the first terminal to pair it, change the password, and use
**Manage Admins** to create an administrator. An existing database is never reset
or given another bootstrap user. Keep `POS_DATA_DIR` on persistent storage and
back it up; do not delete it to recover a login. This backend accepts one paired
terminal per business.

The Vercel frontend forwards browser sessions to the persistent web data server.
SQLite databases, encryption keys, local environment files, recordings and the
unfinished `.deployment` copy are not part of this test-repository publication.

## Workspace

See [Vercel monorepo deployment](DEPLOYMENT.md) to deploy the Next.js frontend
on Vercel with a persistent Node data server.

| Path | Responsibility |
| --- | --- |
| `apps/desktop` | Electron main/preload and React + Tailwind shell; Windows NSIS installer |
| `apps/admin-web` | Next.js + Tailwind online admin landing page |
| `apps/backend` | MVC Express API with authentication, durable sync and reports |
| `packages/shared` | Strict TypeScript settings consumed by all three apps |

## Prerequisites and setup

Use Node 24.22.2 LTS (`.node-version` / `.nvmrc`) and pnpm 10.34.9.
Windows x64 is required for the documented installer verification. Docker Desktop
with Linux containers is optional and used only for the server stack.

```powershell
npm install --global pnpm@10.34.9
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

`pnpm install:deps` is an alias for the frozen-lockfile install. Commit
`pnpm-lock.yaml` with dependency changes; do not create per-app lockfiles.

```powershell
pnpm dev                 # all three apps
pnpm dev:desktop         # desktop alone: builds local assets, then launches
pnpm dev:admin           # http://127.0.0.1:3000
pnpm dev:backend         # http://127.0.0.1:4000/health
```

The desktop requires a reachable backend for each user?s first login. After online verification, cached login and normal operations work offline; encrypted cached login is valid for 30 days. Its development command intentionally builds and loads local files,
matching packaged startup; restart it to pick up edits. Backend watch and Next.js
development reload are enabled. A main-process worker syncs local changes in the background; checkout never waits for it.
If launching from a tool that sets `ELECTRON_RUN_AS_NODE=1`, first run
`Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue` in PowerShell.

The backend defaults to port 4000 (`$env:PORT='4001'` overrides it). `/health`
returns `{"status":"ok"}` and measures process liveness only. It is not a storage readiness check. The API uses persistent SQLite storage for accounts and synchronized records. Environment examples contain local-only dummy
values; `.env` files are ignored. No environment loader is needed by this scaffold.

## Local server stack

```powershell
Copy-Item .env.example .env
docker compose config --quiet
docker compose up --build --wait
Invoke-RestMethod http://127.0.0.1:4000/health
docker compose exec postgres pg_isready -U pos -d pos
docker compose down
```

Do not run native and container services on the same ports simultaneously.
Docker includes only the backend and PostgreSQL. The desktop is distributed as a
Windows installer; admin is a separate Next.js app suitable for Vercel (project
root `apps/admin-web`, with workspace packages available). The backend container
can later be hosted on Render, AWS, or Oracle Cloud. No hosting is configured or
deployed here. Run `pnpm dev:admin` separately for the admin app on port 3000.

Docker ports bind to loopback: API 4000, PostgreSQL 5432. PostgreSQL uses the
`postgres-data` named volume and a health check. `down` preserves that volume;
`down --volumes` deletes database data. The API stores sync data in the `backend-data` volume. The existing PostgreSQL service is retained but not used by this implementation.
Use URL-safe local database credentials in this example Compose setup.
The image builds are development infrastructure, not production deployment.

Both interfaces use Tailwind CSS 4, compiled locally through its Vite plugin on
desktop and PostCSS plugin in Next.js. There is no runtime CSS CDN dependency.

## Windows installer

For the separately named demo installer, run `pnpm package:demo`. It follows the same first-online-login requirement.
See [demo installer instructions](apps/desktop/DEMO.md) for the output file,
bundled dependencies, credentials, and separate demo data directories.
The release restrictions below refer to the standard `package:win` build.

```powershell
pnpm package:win
Get-FileHash apps/desktop/release/POS-Terminal-0.1.0-Setup.exe -Algorithm SHA256
Start-Process apps/desktop/release/POS-Terminal-0.1.0-Setup.exe -Wait
```

The NSIS wizard installs per user and creates desktop and Start Menu shortcuts.
Launch **POS Terminal** with the server stack stopped; confirm the shell renders.
Close and reopen it, then install the same build again and check launch. Packaging
success alone does not prove installation or launch. The package is unsigned;
Windows may show an unknown-publisher/SmartScreen prompt. Signing and publishing
are outside this task. App data is not deleted by the installer configuration.

SQLite and filesystem access belong exclusively in the Electron main process.
The renderer is sandboxed, context-isolated, and has Node integration disabled;
preload exposes narrow authentication, local management, financial, printing and sync-status methods. New windows,
navigation, and permissions are denied. Assets and fonts are bundled/local.
SQLite now initializes in the app-owned user data directory using Electron's
built-in driver. Online users are provisioned by the backend; demo credentials are not automatically online identities. See [desktop notes](apps/desktop/DESKTOP.md) for storage,
the React Bits visual panel, and the production provisioning boundary.

## Constraints for subsequent milestones

- One active Windows terminal per business; each cashier has an individual
  account. New financial entries originate on that terminal. Web is online admin
  management and reporting only.
- Current QAR amounts use integer minor units. Customer repayments are dated customer-level
  ledger entries with the accepting cashier; no bill ID is required.
- Saved bills are read-only for cashiers. Admin corrections create audited
  revisions when implemented. Restaurant receipts and printing are implemented.
- Offline financial writes commit the transaction and outbox atomically,
  then make a separate local recovery copy durable before reporting success.
  Retain recovery copies until the server confirms durable commit. Recovery and
  retries preserve original operation IDs. Local recovery copies do not protect against failure of the entire disk.
- Initial business time zone is Asia/Karachi; reporting weeks start Monday.

Online login, cached offline login, local financial workflows, receipts and background sync are implemented. See [backend documentation](apps/backend/README.md) for the one-terminal deployment boundary, conflict handling and remaining admin-web integration boundary. No CI
convention existed in this workspace; the root checks are ready for a later CI job.

See `VERIFICATION.md` for checks performed on the setup host and limitations.
