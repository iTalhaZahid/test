# POS v1 foundation

Development skeleton for the [product requirements](POS_V1_PRD.md). The PRD is
the source of truth; this foundation does not implement financial workflows.

## Workspace

| Path | Responsibility |
| --- | --- |
| `apps/desktop` | Electron main/preload and React + Tailwind shell; Windows NSIS installer |
| `apps/admin-web` | Next.js + Tailwind online admin landing page |
| `apps/backend` | Express API with `GET /health` and an HTTP smoke test |
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

The desktop requires no backend, internet, Docker, or PostgreSQL after installing
dependencies. Its development command intentionally builds and loads local files,
matching packaged startup; restart it to pick up edits. Backend watch and Next.js
development reload are enabled. The shell makes no network requests.
If launching from a tool that sets `ELECTRON_RUN_AS_NODE=1`, first run
`Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue` in PowerShell.

The backend defaults to port 4000 (`$env:PORT='4001'` overrides it). `/health`
returns `{"status":"ok"}` and measures process liveness only. There is no readiness
endpoint or database connection yet. Environment examples contain local-only dummy
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
`down --volumes` deletes database data. The API's future database connection uses
the Compose `postgres` hostname; native development uses `localhost`.
Use URL-safe local database credentials in this example Compose setup.
The image builds are development infrastructure, not production deployment.

Both interfaces use Tailwind CSS 4, compiled locally through its Vite plugin on
desktop and PostCSS plugin in Next.js. There is no runtime CSS CDN dependency.

## Windows installer

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
preload currently exposes nothing. New windows, navigation, and permissions are
denied. Assets and fonts are bundled/local. SQLite bootstrap, driver selection,
and migrations are deferred; the later storage milestone must use an app-owned
`app.getPath('userData')` location and verify its driver in the packaged runtime.

## Constraints for subsequent milestones

- One active Windows terminal per business; each cashier has an individual
  account. New financial entries originate on that terminal. Web is online admin
  management and reporting only.
- PKR amounts are integer paisa. Customer repayments are dated customer-level
  ledger entries with the accepting cashier; no bill ID is required.
- Saved bills are read-only for cashiers. Admin corrections create audited
  revisions. V1 stores bills and excludes receipt generation and printing.
- The future offline write must commit the transaction and outbox atomically,
  then make a separate local recovery copy durable before reporting success.
  Retain recovery copies until the server confirms durable commit. Recovery and
  retries preserve original operation IDs. Resolve backup location/protection
  before release; no saving or recovery guarantee exists in this skeleton.
- Initial business time zone is Asia/Karachi; reporting weeks start Monday.

Authentication, provisioning, checkout, customer ledger, expenses, reports,
corrections, sync, and backup/restore implementation remain later milestones.
There are no domain contracts or unused validation abstractions yet. No CI
convention existed in this workspace; the root checks are ready for a later CI job.

See `VERIFICATION.md` for checks performed on the setup host and limitations.
