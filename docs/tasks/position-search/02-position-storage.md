# PS-02 — Additive storage for positions, occurrences and status

Status: **completed** (2026-10-21). Depends on: PS-01. Pure database task; no new UI.

## Deliver

- Add explicit, idempotent **schema-v7 extension** SQL and archive-tool installation command, following the existing optional `008_personal_analysis.sql` pattern; do not auto-migrate on Electron launch or overwrite existing databases. Update database and CLI docs and packaging/initializer rules where necessary.
- Define `position_keys` with ID, signed-64-bit `zobrist_hash`, normalized `exact_key`, signed-64-bit `pawn_hash`, exact pawn signature; unique `(zobrist_hash,exact_key)` (allow distinct positions with a forced hash collision). Index hashes and pawn hash/signature.
- Define `game_position_occurrences` linked to game and position; include **viewer path**, ply and mainline/variation flag. Index `(position_id,is_mainline,game_id)` and reverse `(game_id,...)`; enforce one occurrence per `(game_id,path)`, including root path. Cascade when deleting a game; retain different annotated editions.
- Define `game_position_index_state` (`game_id`, input `pgn_sha256`, algorithm ID/version, scope, status, diagnostic, timestamps), with integrity constraints. Allow incomplete/stale status without exposing stale occurrences.
- Add read-only archive capability detection for optional index tables. Archives with no index remain usable, with honest `unavailable` status.

## Acceptance / tests

- Fresh v7 fixture and existing v7 fixture remain readable before and after explicit extension; `PRAGMA user_version` stays 7; rerun is idempotent.
- Forced hash collision coexists but exact-key matching remains unambiguous; duplicate path rejected; foreign keys/indexes verified with `EXPLAIN QUERY PLAN`.
- Cascade on game deletion; no change to originals, PGN bytes, personal analyses, openings or source links.
- No implicit extension/install during normal archive open; an invalid/future archive version fails as before.
- Archive unit tests, `npm test`, `npm run build`.

## Implementation and verification (2026-10-21)

**Status: completed.** Schema migration: `db/migrations/009_position_index.sql`; installer: `scripts/position-index.mjs`; read-only capability probe: `lib/position-index-storage.mjs`, also available through `ChessArchive.positionIndexCapability()` and `catalog().capabilities.positionIndex`; archive tests: `tests/position-index.check.mjs`. PS-01 hashing is reused without changing `electron/openings.mjs`.

- Explicit, transactional and repeatable install: `npm run position-index -- install --database PATH`. Refuses missing archives, any version other than 7, and partial/incompatible extensions. No automatic install during Electron launch, ordinary imports, or v7 initialization. Existing archives with/without optional 008 still open; `user_version` stays 7. `db/migrations/009_position_index.sql` is included in desktop packaging.
- `position_index_meta` pins schema format 1 and algorithm IDs `polyglot-standard-v1`, `polyglot-pawns-v1`. `position_keys` has `UNIQUE(zobrist_hash, exact_key)`, signed SQLite integers and the pawn hash/signature lookup index. SQL uses the exact four-field Polyglot verification key and 33-character white:black hex occupancy signature from PS-01.
- `game_position_occurrences` has game and position foreign keys; `UNIQUE(game_id,path)` (including root `''` at ply 0), nonnegative ply, mainline/variation flag, position-first and game-first indexes. Games with identical move orders but distinct annotations remain separate. A game deletion cascades to derived occurrences and state, without deleting a shared position key.
- `game_position_index_state` stores the input PGN SHA-256, indexer version and hashing ID, `mainline` or `all` scope, diagnostic, timestamps, and `building`, `partial`, `failed`, `complete`, `stale` status. The read-only view `searchable_game_position_occurrences` never exposes an incomplete/stale/wrong-PGN/wrong-hash-algorithm occurrence. A later search API must also enforce supported `indexer_version` and requested scope. A PGN hash update in **any** importer transaction deletes occurrences and marks the state stale atomically; a metadata-only update does not.
- `positionIndexCapability` returns `unavailable` when the optional extension is absent, `incompatible` for incomplete/unrecognized schema, or `installed` for a compatible extension. `installed` does **not** imply complete indexed game coverage or available UI search.
- Archive tests check fresh and pre-008 schema-7 fixtures, no mutation on reader open, repeat install and executable CLI, forced hash collisions, explicit signed-64-bit `bigint` reads, FK/constraint rejection, `EXPLAIN QUERY PLAN`, unfinished statuses and hash mismatches, transactional rollback/reimport invalidation, and game deletion preserving other editions.
- Verification: `npm test` and `npm run build` passed in GitHub Actions run [39545376057](https://github.com/abavelski/chess-games-db/actions/runs/39545376057) (initial implementation commit). Final task-status/CLI-regression commit is independently validated in CI.

**Out of scope:** no PGN replay/index builder (PS-03/PS-04), search API (PS-05), IPC/UI, archive-schema bump, or original PGN modifications.
