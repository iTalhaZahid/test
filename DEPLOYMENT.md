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

## Vercel frontend project

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

The Vite SPA rewrite, legacy `server.js` build configuration and combined-service
root configuration do not apply here: this frontend is Next.js and storage is
intentionally hosted on a persistent server. Electron is packaged separately.
