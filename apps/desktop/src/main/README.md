# Local storage boundary

SQLite, filesystem access, and privileged operations belong in this main-process directory.
No database driver, file, business table, migration, or renderer storage is created yet.
At the local-storage milestone, open SQLite under an app-owned directory from
`app.getPath('userData')`, never the installation directory. Verify the chosen driver
in the packaged Electron runtime and preserve data across updates and uninstall.

Before accepting financial writes, implement the PRD's atomic transaction + outbox
and a separate durable recovery copy; saved success requires both. The recovery
location and access protection need to be resolved before release.
