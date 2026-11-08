# Local storage and sync boundary

SQLite, filesystem access, network credentials and privileged operations belong in the Electron main process. Local data lives under app.getPath('userData'), never in the installation directory.

AuthStore encrypts salted password verifiers with safeStorage. SyncStore stores encrypted pairing/session tokens and exact in-flight batches, captures management changes with transactional triggers, and acknowledges the existing financial outboxes only after server commit. SyncEngine handles first online login, previously verified offline login, catalog pulls, health checks and background retries. The renderer receives only narrow preload methods and public connection status.

SalesStore retains atomic local writes and separate encrypted recovery copies before reporting success. Sync does not run inside a checkout transaction or remove recovery copies.

See [online/offline setup and deployment](../../../backend/README.md) for environment variables, MVC API routes, pairing, cache expiry, the single-terminal boundary and verification.
