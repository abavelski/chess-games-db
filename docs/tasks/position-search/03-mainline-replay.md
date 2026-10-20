# PS-03 — Mainline position extraction with stable review paths

Status: **planned**. Depends on: PS-01. No DB write or GUI.

## Deliver

- Write a pure replay/extraction function for **every valid mainline node and the initial position** of one source PGN. Use `chessops`, `SetUp/FEN` headers, and exact per-position/ pawn hashes from PS-01; no arbitrary opening-move cutoff.
- Return `{ply, path, is_mainline, hashes, exact_keys}` records, deterministic for the same PGN. Generate/validate paths against `@lichess-org/pgn-viewer` / existing `scalachessCharPair` review encoding (see `src/pgn.mjs`, `src/PgnBoard.tsx`). Path `''` refers to the actual starting position.
- Reject multiple/malformed scores, illegal moves, mismatched setup and corrupt input with **explicit status and diagnostic**. Define whether a partially replayable mainline is entirely excluded from authoritative exact-match searches (default: yes); never invent a path for a failed move.
- Keep original PGN and annotations byte-for-byte unchanged; source analysis branches are out of scope until PS-09.

## Acceptance / tests

- Orthodox start, black-to-move `SetUp/FEN`, nonstandard starting move count, castling, en passant, promotion and transposed move orders.
- Replayed position at each recorded path equals what the existing review board displays at that path; root and final nodes included.
- Repeated positions in one game remain separately addressable, while later search can collapse to one result row per game.
- Commented PGNs containing nested variations ignore their sidelines in this task; malformed/unreachable mainline gets a diagnostic, not a silent false result.
- Unit fixtures, `npm test`, `npm run build`.
