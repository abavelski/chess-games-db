# PS-04 — Explicit offline index builder, rebuild, resume and invalidation

Status: **planned**. Depends on: PS-02, PS-03. Technical/CLI task.

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
