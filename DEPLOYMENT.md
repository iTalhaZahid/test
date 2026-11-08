# Vercel monorepo deployment

The root `vercel.json` defines two services: `admin-web` (Next.js) and `backend`
(Express). Electron stays a separately packaged desktop application.

The backend entry is explicitly ESM (`src/server.mts`), and its standalone build
is `dist/server.mjs`. These extensions preserve the module format when a hosting
runtime relocates the entry outside the backend package's `type: module` scope.

For Vercel, the backend service runs type checking and uses `outputDirectory: "."`
with its source entry. Do not change that to `dist`: the Services builder can
flatten the compiled entry while retaining pnpm dependencies at workspace paths,
causing module-format and missing-package startup errors. The standalone build
command remains available for Docker and persistent Node hosting.

## Services and routing

| Public path | Service | Behavior |
| --- | --- | --- |
| `/api/v1/*` | `backend` | Existing desktop login and synchronization API |
| `/health` | `backend` | Process liveness, not storage readiness |
| `/api/pos` | `admin-web` | Same-origin validation and proxy to backend |
| All other paths | `admin-web` | Next.js pages and assets |

`admin-web` declares a service binding to `backend`, injected as `BACKEND_URL`.
Do not set this variable manually in Vercel. Only the Next.js server route reads
it at runtime; it is not a browser variable or a build-time setting. Its request
calls the backend's `/api/pos`, which has no direct public rewrite. The backend
still authenticates every operation using the existing web session cookie.
Both services have public routes, but the web data endpoint is reached internally.

The frontend validates the browser Origin and request format before forwarding.
It forwards only the cookie and JSON body to the backend, rejects redirects,
sets a timeout, relays session cookies, and ensures HTTPS browser sessions have
Secure cookies even when the internal transport is HTTP. A backend outage returns
502; a missing Vercel binding returns 503. There is no local database fallback.
The obsolete `POS_WEB_SERVER_URL` setting is no longer used and should be removed.

## Local development

From the repository root, install the workspace with Node 24 and pnpm 10.34.9:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm dev:backend
```

In a second terminal run `corepack pnpm dev:admin`, then open
`http://127.0.0.1:3000`. The standalone frontend defaults to backend port 4000.
For another port, set `BACKEND_URL` in the frontend process environment.
For Vercel service routing and generated bindings, run `vercel dev` at the root.

## Preserve existing records

Stop the old web server before changing storage ownership. Set
`POS_WEB_DATA_DIR` in the backend process to the absolute path of the old
`apps/admin-web/.data` directory, or copy that entire directory to persistent
backend storage and point the setting there. Keep `pos.sqlite`, `recovery.sqlite`
and `protection.key` together. Back up before moving; do not delete the old data.
The default for new deployments is `POS_DATA_DIR/web` (or `.data/web`).

Web records and sessions retain their existing schema and passwords. The desktop
sync database (`POS_DATA_DIR/online.sqlite`) stays separate. This change does not
merge desktop and browser financial records or their user accounts.

## Vercel deployment

1. Import the repository with Root Directory `.` and Node 24.x. Leave project-wide
   build and output overrides unset; those settings belong to each service.
2. Vercel injects `BACKEND_URL` through the binding. No external web data server
   or manually configured backend hostname is required by the frontend.
3. Migrate backend storage to a hosted database before using this on Vercel.
   Both the web and sync stores still use local SQLite and the web encryption key
   is still a local file. Vercel runtime storage is not a durable database.
   Neither `/tmp` nor the service binding fixes this limitation.
4. For a private demo on a persistent backend, set `POS_WEB_DEMO=1` there.
   Public production provisioning for the web API is not implemented.
5. After storage migration, verify login/logout, secure cookies, a saved financial
   operation, and restart persistence in the actual deployed environment.

## First login

| API | Username | Initial password | Role |
| --- | --- | --- | --- |
| Web demo | `superuser` | `PosSuper123!` | Superuser |
| Web demo | `admin` | `PosAdmin123!` | Administrator |
| Web demo | `demo` | `PosDemo123!` | Cashier |
| Desktop sync | `superadmin` | `PosSuperAdmin123!` | Bootstrap superuser |

Web demo accounts are seeded in development or when `POS_WEB_DEMO=1`.
The sync superuser is created only when its database is empty. Change initial
passwords immediately, then use Manage Admins to create administrators.
Keep demo deployments private; these credentials are public.
