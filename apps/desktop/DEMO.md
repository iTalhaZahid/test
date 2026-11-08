# Windows demo installer

Build with `pnpm package:demo` from the repository root. Send
`apps/desktop/release/demo/POS-Terminal-Demo-0.1.0-Setup.exe`.
The installer targets Windows x64 and bundles Electron, Chromium, Node, SQLite,
and the local application assets. Recipients do not need to install Node, pnpm,
Docker or PostgreSQL on the recipient device. Installation is offline, but the first login requires a reachable configured POS backend. Set POS_API_URL before launching; see [online setup](../backend/README.md).

Run the installer, finish the wizard, and open **POS Terminal Demo** from the
desktop or Start Menu. The installer is unsigned, so Windows may show an
unknown-publisher or SmartScreen prompt.

First sign in with the online bootstrap administrator to pair this terminal, then create or provision staff. Each user must log in online once before cached offline login is enabled. Built-in development/sample passwords are not seeded on the online server. Sample menu records remain bundled and stored locally.

Changed local records survive restarts and reinstalls; initialization does not overwrite menus. Existing development data and accounts are not copied into this distributable. Credential encryption is bound to the recipient's Windows account.

The demo stores its database in `%APPDATA%/POS Terminal Demo/pos.sqlite` and
local recovery data in `%APPDATA%/POS Demo Recovery/pending.sqlite`.
These are separate from development and standard release data. Uninstalling
preserves data. Recovery on the same disk does not protect against disk failure.

Use fictional data for demonstrations. This is the current local prototype,
with shared demo credentials; it is not a production deployment or a cloud-synced
system. The standard `pnpm package:win` build still disables demo access.

## Shop menus and administration

Restart the updated application after rebuilding to apply the additive database changes.
The existing demo installer must be rebuilt to include these features.

- Sign in as **superuser** to add, update, reset passwords for, or remove admins from **Manage Admins**. Admins cannot manage other admins. All roles can change their own password.
- In **Manage Menu**, select a shop filter, then add items. The shop stays selected for subsequent items. Existing menu items belong to **Main shop**; assign them to another shop as needed. Cashiers can only sell items assigned to their current shop.
- Menu photos are optional PNG, JPEG or WebP files up to 500 KB, saved locally and displayed on item cards.
- In **Manage Cashier**, use **Manage Credits and Expense** to allow creditor management, credit sales, collections and expense history. All active cashiers can record expenses without this permission. It defaults to off, including migrated cashier profiles. Server-side revocation takes effect immediately; sign in again to refresh the cashier's visible options.
- The avatar menu contains **Manage Shops**, **Manage Payment Methods**, **Change Password**, and **Logout**. Add Card, Cash or Online methods; use an Online method's name for delivery partners such as FoodPanda, PandaMart or Cheetah. Checkout saves the method with each sale. Cash reports exclude card/online sales.
- **Monthly Recurring Expenses** supports salaries, bills and other expense types, with month, employee, type and Paid/Pending filters. Enter an employee name or ID for salaries. Each month's amount is saved when first opened; editing a recurring entry affects unopened months. Removing an entry retains months already opened. Marking Paid records payment status only; it neither transfers money nor duplicates daily expenses.

These additions use the existing local/demo storage. They do not introduce server sync or production account provisioning.

## Feature verification (2026-11-07)

All 18 automated tests passed (13 desktop, 4 web, 1 backend), as did workspace
type checking and production builds. Browser checks covered superuser sign-in,
direct management navigation, the two-column cashier form, avatar options,
adding an Online payment partner, creating a monthly salary and marking it Paid,
and adding a menu item while retaining the selected shop. The financial tests
cover shop isolation, permission revocation, retry safety, payment snapshots,
and monthly status persistence. The Windows installer was not rebuilt for this change.

## Build verification (2026-11-06)

Desktop tests (9), type checking, lint, and NSIS packaging passed. Silent
installation into a workspace test folder succeeded. The installed executable
accepted admin sign-in through the visible form and cashier sign-in through its
preload API, and returned 57 menu items. All four initial accounts were also
verified in the unpacked demo executable. The renderer loaded from app.asar,
exposed no Node require, and loaded zero HTTP(S) resources.

Not checked on a clean second computer; the interactive installer wizard and
upgrade behavior were not exercised. The test installation remains in
`release/demo/installed-smoke` and registers local demo shortcuts/uninstaller.
