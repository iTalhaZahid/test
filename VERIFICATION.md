# Neon migration verification ? 2026-11-08

- Linked Neon project `old-shadow-38945301`, branch `production`, using CLI OAuth.
- `neon deploy`: `No changes ? branch production already matches the policy.`
  Utilized services: Postgres. Pulled database variables into ignored `.env.local`.
- Installed and consulted local `neon` and `neon-postgres` agent skills.
- Added native PostgreSQL tables and stores for web accounts, catalog, sessions,
  sales, expenses, recoveries, recurring payments, and desktop sync/receipts.
  The production backend no longer opens SQLite or local key/data files.
- Migration tested on `pos-pg-migration-20261108` before production. The temporary
  branch has an expiry; it contains test fixtures, not production transactions.
- `npm run db:migrate` on production: exit 0, migration applied/current and
  bootstrap users initialized without resetting existing accounts.
- `npm run build`: exit 0; backend, Next.js and Electron/Vite builds succeeded.
- `npm test`: exit 0; 45 existing backend/web/desktop regression tests passed.
- `node --env-file=../../.env.neon-test --import tsx --test src/postgres/neon.integration.test.ts`
  from the backend directory: exit 0, one real end-to-end test passed in ~228 s.
  Output: `PASS: frontend -> backend -> Neon; login, roles, password changes,
  search, sale/expense/recovery, monthly payments, sync deduplication, concurrency,
  restart persistence.` The test starts the built Next.js and Express servers.
- Final integration also verifies that a sale and expense sharing an operation ID
  retain separate encrypted recovery rows.
- Production smoke test: built backend startup, superuser login, catalog read and
  logout passed against the specified Neon production branch. No financial test
  transactions were created in production.
- Backend typecheck and lint of changed TypeScript passed.

## Resolved setup failures and remaining limits

The global Neon install ran out of disk space. The requested npx fallback worked
with a workspace cache. Initial global plugin/skill setup failed; installing the
Neon skills project-locally succeeded. CLI init initially could not find pnpm;
Corepack installed its config dependencies, and a final init completed with agent
setup skipped (the local skills were already installed).

The first parallel build exhausted host memory. Sequential builds pass. The first
live API run found a PostgreSQL case-sensitive alias issue, which was fixed before
the full successful run. Desktop builds still emit existing chunk/directive warnings;
Electron tests emit non-fatal Crashpad permission and module-type warnings.

Vercel deployment was not run. Copy the actual `DATABASE_URL`,
`POS_WEB_ENCRYPTION_KEY` and demo flag from the ignored environment file to Vercel,
then redeploy. Keys/URLs were not committed. Historical SQLite records were not
imported or deleted. Demo credentials are public; keep the demo private. Docker
configuration was updated but not run. Earlier verification below is historical.

---

# Foundation verification

For the subsequent SQLite/login and React Bits milestone, see
[desktop verification notes](apps/desktop/DESKTOP.md). The checks below describe
the original foundation before that milestone.

Verified on Windows 10 x64 on 2026-11-06. The host has Node 24.15.0; the
repository and Dockerfile pin Node 24.22.2 LTS. pnpm 10.34.9 was invoked through
`npx --yes pnpm@10.34.9` because pnpm was not globally installed.

| Check | Result |
| --- | --- |
| Dependency installation | Passed, including frozen lockfile and Electron binary installation |
| `pnpm lint` | Passed |
| `pnpm typecheck` | Passed for all three apps, including Next route generation |
| `pnpm test` | Passed: backend HTTP health smoke test without PostgreSQL |
| `pnpm build` | Passed: Express, Next.js, Electron/React with Tailwind |
| Backend production startup | Passed: `/health` returned HTTP 200 and `{"status":"ok"}` |
| Admin production startup | Passed: HTTP 200 with expected landing page; generated Tailwind stylesheet served successfully |
| Development desktop | Launched on Windows, local assets rendered without server stack |
| `pnpm package:win` | Passed: unsigned x64 NSIS installer |
| Windows installation | Passed: silent per-user installation into `apps/desktop/release/installed-smoke` |
| Installed desktop launch | Passed: packaged `app.asar` loaded and Tailwind styles applied with server stack stopped |
| Renderer boundary | Runtime `process` and `require` both undefined; zero HTTP(S) resources loaded |
| Compose | Earlier configuration passed; subsequent backend/PostgreSQL-only validation was declined, so not rerun |
| Container service smoke test | Blocked: Docker Desktop Linux engine was not running |

Installer: `apps/desktop/release/POS-Terminal-0.1.0-Setup.exe`.
Build outputs and the test installation are ignored by Git. The test installation
also registers an uninstaller and shortcuts for the current Windows user.

Argent's project launcher failed on Windows. Launching the Electron executable
with the host's `ELECTRON_RUN_AS_NODE=1` removed allowed Argent to attach and
inspect the development and installed renderer. Debugging was enabled only by
test command-line arguments, not in application configuration.

Not verified: interactive installer wizard, upgrade/data preservation, clean-machine
installation, PostgreSQL container startup, exact pinned Node patch execution,
or publishing/deployment. There is no SQLite bootstrap or financial write path
to test yet. Network was not disabled at OS level; the server stack was stopped,
the desktop loaded file URLs, and its renderer reported zero remote resources.

The PRD is unchanged. SHA-256:
`359934285F3A92FD9892CBD9D0286ED2E5CB40626F523BC1E61CF975BC5EBC3A`.

Tooling references used during setup:
[Tailwind Vite integration](https://tailwindcss.com/docs/installation/using-vite),
[Tailwind Next.js integration](https://tailwindcss.com/docs/installation/framework-guides/nextjs),
[Electron releases](https://releases.electronjs.org/?channel=stable).


## Offline-first online sync (2026-11-08)

Backend HTTP and desktop-storage integration tests pass for initial online pairing/login, encrypted cached offline login, cache expiry, legacy staff provisioning, local menu access after restart, offline sales/expenses/credit recoveries/monthly payments, reconnect uploads, server-committed lost responses, duplicate prevention, edits made during upload, rejected credentials and conflict retention. Backend validation rejects anonymous sync and invalid money, and catalog feeds exclude password verifiers. Connection-pill labels are checked by server rendering. Existing desktop and admin-web tests pass.

Desktop, backend and admin-web type checks pass. Backend and desktop production builds pass; existing Vite bundle/directive warnings remain. Lint passes for the files changed for sync.

No public deployment, live GUI walkthrough, physical network disconnection or printer test was performed for this change. Integration tests use a real local HTTP server and simulate transport failures. Server SQLite requires a persistent disk and one API instance/business with one paired POS terminal. The separate Next.js web store is not migrated to the central sync API. See apps/backend/README.md for setup and deployment boundaries.
