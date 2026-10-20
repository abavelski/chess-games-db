# PS-02 — Additive storage for positions, occurrences and status

Status: **planned**. Depends on: PS-01. Pure database task; no new UI.

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
