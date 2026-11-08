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
