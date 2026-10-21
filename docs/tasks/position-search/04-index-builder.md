# PS-04 — Explicit offline index builder, rebuild, resume and invalidation

Status: **implemented** (2026-10-21). Depends on: PS-02, PS-03. Technical/CLI task.

## Deliver

- Add an offline `npm run positions -- …` command with **explicit database path** and documented `init`/ `build`/ `status`/ `rebuild` modes (exact flag syntax defined here during implementation). Support dry-run, progress, bounded batches, interrupt/resume, and no network.
- Verify PGN SHA-256 when decoding compressed `games.pgn_zstd`. Stream/batch game replay; index every valid mainline into the derived tables, deduplicate position keys, store occurrences and per-game status. No engine/model dependency.
- Publish each game's new occurrences + matching input SHA and algorithm version in **one transaction**. On retry, skip unchanged complete rows, replace only stale game data, and never advertise partially written game rows as complete. Report complete/invalid/stale/unindexed counts and size/time metrics. Clean orphaned distinct positions safely.
- Integrate `lib/game-writer.mjs` so changed PGN or deletion invalidates/removes existing derived occurrences **in the same transaction** without breaking archives lacking the extension. Unchanged reimports preserve valid indexes; renamed source metadata does not require replay.
- Keep the interactive Electron app read-only for index construction; no automatic work or schema upgrade when opening an archive.

## Acceptance / tests

- Offline seeded v7 archive indexes successfully; `status` distinguishes 0 hits from no index; a second run does not create duplicate rows or change source data.
- Interrupted indexing resumes with no false complete rows; `--rebuild` is deterministic. Aborted batch leaves a valid old per-game result or safely not-ready state.
- Changed-PGN upsert and deleted game invalidate/cascade; unchanged-PGN reimport retains results; test changed hash while importer/CLI are run sequentially.
- Corrupt checksum, malformed PGN, hidden game, alternate annotated edition, large comments/variation-heavy scores have explicit tested behavior and diagnostics.
- Index builder never touches the real test-user archive; `npm test`, `npm run build`, archive fixture checks.

## Implementation

`lib/position-builder.mjs` implements bounded, resumable, offline game replay; `scripts/positions.mjs` exposes `npm run positions -- init|build|status|rebuild --database PATH`. `init` runs the existing opt-in schema installer; `build` skips current complete states and replays stale/unindexed/failed games; `rebuild` or `build --rebuild` replays even complete ones. `--batch-size N` (1–1000), `--max-games N`, and `--dry-run` are supported on builds. `status` never installs schema or builds data. SIGINT/SIGTERM are handled between bounded batches; rerun to resume.

Each input is decompressed with strict SHA-256/UTF-8 verification, then passed to PS-03's mainline extractor. The complete root/mainline occurrence set and checksum, Polyglot algorithm ID, builder version/scope and diagnostic are committed atomically per game. Input hashes are checked again under SQLite's write lock before publication. Failed PGNs have no occurrences and retain a bounded diagnostic. Incomplete/corrupt rows can never appear through the authoritative view. The builder reuses hash+exact-key unique positions and removes only unreferenced keys after a successful run. No original PGN/source data, schema version, GUI or network activity is changed.

Migration 009's already installed update trigger and foreign-key cascades integrate `lib/game-writer.mjs` PGN changes and deletions transactionally; matching-hash metadata-only updates retain valid rows. Hidden games are indexed as separate archival records (PS-05 must filter visibility); independently annotated editions are also kept separate. Regression fixtures in `tests/position-builder.check.mjs` exercise interruption, dry run, rebuild, corruption, nested annotation, rollback, changed-PGN import and deletion. Run `npm test` and `npm run build` in an environment with project dependencies to verify.
