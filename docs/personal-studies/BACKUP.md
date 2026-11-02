# Backup and restore

Use **Local storage and help → Back up entire studies database** to create a verified SQLite online backup while the app is running. It contains every saved study, PGN, local title, kind, provenance, revision and tag. It excludes unsaved drafts. Existing destinations are refused: choose a new filename. Cancellation changes nothing.

**Export chapter PGN** transports one game tree, without the local collection metadata. It is not a full collection backup. Do not copy only a live `personal-studies.sqlite3`: committed data may still be in its WAL.

To restore:

1. Close every app window and ensure the app has exited.
2. Find the exact userData path shown under Local storage and help. Preserve the existing database and its sidecars as a recovery copy before replacement.
3. Replace `personal-studies.sqlite3` with your verified full database backup. Remove stale `personal-studies.sqlite3-wal` and `personal-studies.sqlite3-shm` sidecars only after preserving the old collection and while the app is closed.
4. Reopen My Studies. App ID, schema version and database integrity are validated. A future/foreign/corrupt database is refused with recovery guidance.

**Restoring replaces newer local studies, metadata and tags; there is no merge.** Archive and opening databases must not be replaced or migrated. Automated restore tests use disposable profiles only.
