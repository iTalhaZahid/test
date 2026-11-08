# Vercel monorepo deployment

This repository is a pnpm monorepo. Keep `apps/*`, `packages/*` and the root
lockfile together; no duplicate frontend/backend directories are needed.

## Persistent data server

The web application and desktop sync API use different SQLite stores. Run each
as one persistent Node 24 process with a durable disk and HTTPS in front of it.
Do not deploy their storage on Vercel or use `/tmp` for financial records.

For the web data server, install from the repository root:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm build:web
corepack pnpm start:web
```

Set `POS_WEB_DATA_DIR` to an absolute persistent directory. Preserve the entire
directory, including `protection.key`, in backups. Leave `POS_WEB_SERVER_URL`
and `VERCEL` unset on this server. Serve it at an HTTPS origin such as
`https://pos-data.example.com`; its `/api/pos` endpoint handles web requests.
The existing web implementation only enables accounts in demo mode. For a
private demonstration set `POS_WEB_DEMO=1`; its shared demo credentials make
it unsuitable for a public production service.

The Express desktop sync service still follows
[its deployment instructions](apps/backend/README.md). It is not a replacement
for the web data server: `/api/v1` and `/api/pos` have different contracts.

## Vercel multi-service project

The root `vercel.json` defines `admin-web` (Next.js) and `backend` (Express).
Import the repository with **Root Directory** set to the repository root (`.`),
select Node **24.x**, and leave project-wide build/output overrides unset.
Build and install settings belong to the individual services.

Public routing preserves the original paths:

| Path | Service |
| --- | --- |
| `/api/v1/*` | `backend` |
| `/health` | `backend` |
| All other paths, including `/api/pos` | `admin-web` |

There are no internal-only services or service bindings. The frontend's server
calls the external persistent web data server through `POS_WEB_SERVER_URL`;
it does not call the Express desktop sync API. Binding those services would not
make their incompatible APIs interchangeable. Electron is packaged separately;
the root Dockerfile is an alternative backend deployment, not another service.

**Storage blocker:** the Express service still requires persistent local SQLite.
This multi-service configuration establishes build/routing ownership but does
not make the backend production-ready on Vercel. Its startup attempts to open
the database, which can fail on a read-only filesystem; temporary storage would
lose records. Migrate that service to a hosted database before deploying it on
Vercel. Until then, use the frontend-only deployment below with persistent Node
servers. Do not point a real terminal at an ephemeral backend.

Set `POS_WEB_SERVER_URL` to the external HTTPS web data server for the frontend.
Do not set it to the public deployment origin, which would create a proxy loop.
For local service routing/bindings use `vercel dev` from the repository root;
the SQLite server requires a writable local data directory. Local standalone
development with the existing pnpm commands is also supported.

## Vercel frontend-only alternative

1. Import this repository in Vercel.
2. Set **Root Directory** to `apps/admin-web` and enable **Include source files
   outside of the Root Directory in the Build Step**. The app reuses desktop
   components and workspace TypeScript settings.
3. Select Node **24.x**. The app's `vercel.json` selects Next.js, installs with
   the pinned pnpm version, skips the Electron binary download, and builds only
   this web app. Keep the output directory as `.next`.
4. Set `POS_WEB_SERVER_URL=https://pos-data.example.com` in each intended
   deployment environment, then deploy. Do not set `POS_WEB_DEMO` or data paths
   on Vercel. Use a separate data server for previews that must not modify
   production records.
5. Verify login/logout, reload, and a saved operation in the deployed app.

Browser requests remain same-origin at `/api/pos`. The Vercel route validates
the origin and request format, forwards cookies over HTTPS to the data server,
and returns session cookies to the browser. Redirects are rejected. An upstream
failure returns 502; missing configuration on Vercel returns 503 without opening
local storage. It never silently substitutes an empty database.

The Vite SPA rewrite and legacy `server.js` build configuration do not apply
here: this frontend is Next.js. The root multi-service configuration and the
frontend-only project are alternatives; choose the matching Root Directory.
