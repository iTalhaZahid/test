# Desktop implementation notes

Current authentication and synchronization are described in [online/offline setup](../backend/README.md). Every user needs one online login before encrypted cached offline login. Background sync, local financial workflows and receipts are implemented; references below to development-only login or deferred sync describe earlier milestones.


Packaged demo exception: `pnpm package:demo` builds **POS Terminal Demo** with
the existing sample accounts enabled and separate local storage. See
[demo instructions](DEMO.md). References below to disabled packaged credentials
describe the standard production package, not this explicitly named demo build.

Checkout, creditor sales, admin sales filtering, and durable save/retry behavior
are now implemented in the subsequent [local checkout milestone](SALES.md).
That document supersedes the earlier notes below about financial tables and
sales entry still being placeholders.

Run `pnpm dev:desktop` after following the online setup linked above. Use the bootstrap administrator for pairing; subsequent verified logins and normal operations work offline.
This account exists only in development; it is not a production credential.
The development administrator is **admin / PosAdmin123!**. Its role is stored
in SQLite and returned by the main process. Existing accounts migrate to cashier
without losing their credentials. Both demo accounts are rejected in releases.

Admin sign-in opens six navigation cards with hover/click options. Custom report
periods offer native calendar pickers for starting and ending dates. This remains
a development milestone: cashier/creditor profiles and menu records can now be
added, searched, updated, and removed locally. Report data remains unimplemented.
Online-only production management requirements in the PRD remain unchanged.
Sign-out clears the main-process session. Relaunch requires sign-in again.

## Local data

- Electron's bundled `node:sqlite` opens `%APPDATA%/POS Terminal Development/pos.sqlite`
  in development and `%APPDATA%/POS Terminal/pos.sqlite` in packaged builds.
- WAL, FULL synchronous writes, foreign keys, and a busy timeout are enabled.
- Login accounts use `local_users`. Password verifiers use salted scrypt and are
  encrypted through Electron safeStorage (Windows DPAPI). Passwords are not stored.
- Five failed attempts lock the account for 30 seconds, persisted across restarts.
- A single application instance owns the local session. The preload exposes only
  authentication and narrowly scoped management methods; handlers validate the
  sending frame, current admin role, development mode, and input.
- Packaged builds neither seed nor accept demo users, even if a development database
  is copied. The packaged login displays an online-setup notice until provisioning
  is implemented. No registration or production account creation is provided yet.
- This is an explicitly approved development exception to the PRD's online
  provisioning flow. No financial tables, outbox, backups, or sync are implemented.

## Development management

Cashier and creditor forms collect name, phone number, optional passport number,
and optional ID. Search matches name, phone, or ID; selecting a record opens its
update and removal controls. Development admins can create cashier-only login
accounts and change their usernames/passwords. Password inputs show placeholder
dots, never the stored password. Leaving an existing password blank preserves it.
Removal disables that cashier's next sign-in. Passwords use the existing protected
scrypt verifier, and account/profile changes commit together.
Sample cashiers `cashier.ayesha` and `cashier.bilal` use `PosCashier123!` initially;
sample creditors and menu items are seeded once without overwriting changes.
Lists use pagination and forms use a vertical layout. Back sits beside
each selected screen's title. Small windows or increased text scaling may still
need page scrolling to keep every control accessible.
Use fictional personal information in this development database.

Menu forms collect item name, QAR price (stored as integer dirhams), and available
stock as a non-negative whole number, as requested for this prototype. This is
manual stock entry only: checkout deductions and inventory history are not built.
Production inventory remains outside the unchanged PRD pending a later scope decision.

`development_records` retains removed records using an archive flag. SQLite FTS5
indexes names and supports multi-word prefix menu search offline. Database triggers
keep the index current with inserts and edits; archived items are excluded. These
records are development-only and do not fetch from or sync to a server yet. The
production server menu cache will be integrated with sync in its own milestone.

Verified for this change: lint, desktop typecheck/build, and Electron-runtime tests
covering profile CRUD, FTS5 rename/removal, persistence, money/stock validation,
and rejection of cashier and release-mode access. Installer not rebuilt for this change.

## Login visuals

The login form is on the right; the left panel uses the official React Bits
Aurora TypeScript/Tailwind component, locally vendored from commit
`4dc7b5b7772e1217c8fb8d2a7aa074302180e5b4`:
https://github.com/DavidHDev/react-bits/tree/4dc7b5b7772e1217c8fb8d2a7aa074302180e5b4/src/ts-tailwind/Backgrounds/Aurora

The original source is retained; its license ships in
`public/third-party/react-bits-LICENSE.md`. The panel has a pause control,
respects reduced motion, uses a bounded rendering resolution, and falls back
to its solid background when WebGL is unavailable. Logo and business-image
placeholders use Lucide icons. All assets are local; there are no CDN calls.

## Checks

`pnpm --filter @pos/desktop test` runs SQLite tests in Electron's own runtime:
initialization, persistence after reopen, correct/incorrect credentials, input
validation, SQL injection rejection, persistent lockout, and no demo access in
release mode. `pnpm --filter @pos/desktop typecheck` and `pnpm lint` check types
and source. `pnpm package:win` rebuilds the Windows installer.

OS encryption and the UI are checked separately in the actual desktop app.
Verified on Windows: development sign-in and sign-out through the visible form;
React Bits rendering; both SQLite files pass integrity checks; packaged app starts
from app.asar, creates an empty local database, and rejects demo credentials.
Desktop typecheck, lint, Electron SQLite tests, build, and NSIS packaging passed.
The rebuilt installer was not reinstalled for this milestone; its packaged
executable was launched directly. Vite reports harmless upstream `use client`
directive warnings for Aurora/Lucide in this client-only renderer.
Production provisioning, user revocation, permission enforcement for future
business operations, backup/recovery, and real-account lifecycle remain later work.

## Cashier workspace update

Cashier login opens Record Sales and Record Expenses navigation; transaction entry remains a later milestone. The header avatar offers Change password and Sign out. Self-service password changes verify the current password and remain development-only. Updates, removal, password changes, and sign-out use confirmation dialogs. Add forms stay open after saving.

The requested desktop currency is now QAR. Existing development amounts retain their numeric values; no foreign-exchange conversion is performed. The legacy pricePaisa column stores integer dirhams for this prototype. The original PRD remains intact; production currency migration must incorporate this requested change before financial features ship.
