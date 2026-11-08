# Standalone Windows installer

Build from the repository root with `npm run package:standalone`.
Before building, set `POS_API_URL=https://your-deployed-pos-origin` in the root
`.env.local` (or build environment). Use the public origin serving `/health`
and `/api/v1/*` from the root Vercel configuration. The repository contains no
deployed public URL. The build requires this setting and bundles only that URL,
never `.env.local` or database credentials.
Install `release/standalone/POS-Terminal-Standalone-0.1.0-Setup.exe`
from this desktop app directory. Windows x64 only; no Node, database server,
environment files are needed on the recipient computer. First sign-in requires
the configured POS server; subsequent cached sign-ins and checkout work offline.

Sign in with a desktop-sync server account. The initial server bootstrap account
is **superadmin / PosSuperAdmin123!** unless its password has been changed.
Change the bootstrap password. Web demo accounts are separate from sync accounts.

The installer bundles the 51-item restaurant menu, supplied dish photos and
Half/Full selection. The three unpriced dishes use temporary QAR 10 prices.
Menu edits and sales save locally and synchronize with the configured sync server
after online pairing. Browser records in `pos_web` remain separate from desktop
records in `pos_sync`; this does not merge those schemas.
Printing uses the only installed non-file printer, or shows a printer selector
when several are installed. PDF/XPS file printers are excluded from automatic
receipt printing. A printing failure does not undo the saved database invoice.

To configure an existing installation after updating its executable, close POS,
create `%APPDATA%\POS Terminal Standalone\pos-config.json` containing
`{"POS_API_URL":"https://your-deployed-pos-origin"}`, then restart and sign in
online. `POS_API_URL` in the process environment takes priority, followed by this
file, followed by the bundled configuration. A terminal already paired to a server
cannot be redirected to another server. Existing standalone data is preserved;
resolve any sync conflicts before relying on server reports. Older standalone
executables must be upgraded: they ignore this configuration and disable sync.
Without a configured URL the updated executable retains local-only operation and
its previous local accounts; it reports the missing configuration in sync status.

Data lives in `%APPDATA%\POS Terminal Standalone\pos.sqlite`, with pending-write
recovery in `%APPDATA%\POS Standalone Recovery\pending.sqlite`. Close the app
before backing up both directories. Password encryption is tied to the Windows
account; copying the database to another account does not transfer usable login
credentials. Uninstalling preserves local data. This build has separate storage
from the web, development and other desktop editions.

The installer is unsigned; Windows may display an unknown publisher warning.
