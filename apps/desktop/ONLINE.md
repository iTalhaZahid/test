# POS Terminal Online (Windows x64)

This edition opens the deployed POS inside a secured Electron window. It uses
the same backend, database, accounts and browser catalog cache as the website.
It does not use the separate desktop sync database. Receipt printing uses the
installed physical printer through the existing native print handler.

Build from the repository root:

```powershell
$env:POS_API_URL = 'https://test-brown-eight-79.vercel.app'
corepack pnpm package:online
```

The build also reads `POS_API_URL` from the root `.env.local`. It verifies a real
database-backed `/api/pos` session request before producing the installer:
`apps/desktop/release/online/POS-Terminal-Online-0.1.0-Setup.exe`.

The backend reads its PostgreSQL connection string from `DATABASE_URL` in its
server environment, as it does for the website. Do not place `DATABASE_URL` in
the installer or renderer. Only the public `POS_API_URL` is bundled.

To change the backend after installation, set the `POS_API_URL` process
environment variable, put it in a `.env` beside the executable, or create
`%APPDATA%\POS Terminal Online\pos-config.json`:

```json
{"POS_API_URL":"https://test-brown-eight-79.vercel.app"}
```

Restart after changing the address. Every backend gets a separate browser
profile under `%APPDATA%\POS Terminal Online`, preserving cookies and cached
catalogs across restarts and preventing catalogs mixing between servers.
Menu items, expense categories, payments, floors and tables stay cached after
logout and are revalidated by the website. No credentials or environment files
are copied into the package.

Internet is required to load the application, sign in and save transactions.
The connection pill checks the database-backed API at startup and every 30
seconds. Offline status does not mean sales can be saved offline in this edition.
The installer is unsigned. Frontend updates, including layout changes, become
visible when the website deployment is updated; rebuilding the installer is
unnecessary for website changes.
