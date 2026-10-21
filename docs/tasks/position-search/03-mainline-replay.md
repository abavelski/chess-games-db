# PS-03 — Mainline position extraction with stable review paths

Status: **completed** (2026-10-21). Depends on: PS-01. No DB write or GUI.

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

## Implementation and verification (2026-10-21)

**Status: completed.** Pure implementation: `lib/position-mainline.mjs`; export `extractMainlinePositions(pgn)` and `MAINLINE_EXTRACTOR_VERSION = 'position-mainline-v1'`. Regression tests: `tests/position-mainline.test.mjs`. Verified `npm test` (unit + archive) and `npm run build` in [GitHub Actions run 39551559546](https://github.com/abavelski/chess-games-db/actions/runs/39551559546).

- **Result shape:** `{ status: 'complete', diagnostic: null, occurrences }` or `{ status: 'invalid', diagnostic: string, occurrences: [] }`. Each occurrence holds `{ ply, path, is_mainline: 1, hash, sqliteHash, verificationKey, pawnHash, sqlitePawnHash, pawnSignature }`, matching PS-01 `positionFingerprint` output. Hashes are native `bigint` and cannot be passed through JSON/JS `Number`. The PS-04 builder will own DB binding, indexing state and PGN checksum verification. No partial occurrences are authoritative: **any** input/parse/position/move/path error drops the entire extraction.
- **Root and numbering:** the actual initial standard-chess board, including custom `FEN`, is always indexed with `path: ''`, `ply: 0`. After each legal SAN move, `ply` is the viewer's **absolute** ply (e.g. from `24... Kh2`, `ply: 48`, not relative ply 1); path appends `scalachessCharPair(move)` to the previous path. Paths are 2-character segments and are independently verified against real `@lichess-org/pgn-viewer` `makeGame`/`Path` plus the project's `reviewPgn` tokens. Storage migration 009 enforces a 4096-character maximum path; exceeding it rejects the score rather than silently truncating it. There is **no opening-depth cutoff**.
- **Source:** one complete PGN game per input; preserve its original string/bytes, comments, source headers, and variations. Replay only `game.moves.mainlineNodes()` via `parseSan` + `position.play`. Nested, properly delimited author variations and comments can have different or illegal SAN; they are never indexed in PS-03. PS-09 will implement variations separately.
- **Validation:** a strict lexical pass detects unknown movetext that chessops' tolerant `PgnParser` would skip, unbalanced variations/comments, broken headers, unexpected result/extra tokens, and NUL input. Then require exactly one parser game, strict start metadata and legal SAN at every node. `SetUp "1"` requires a FEN; explicit `SetUp "0"` with FEN is invalid. As in the existing reviewer, FEN **without** a SetUp header is accepted unless explicitly contradictory. Standard-chess variant only (Chess960 and other variants excluded), including PS-01 FEN validation for impossible initial positions.
- **En-passant distinction:** hash the actual `chessops` position with PS-01's **Polyglot** EP rule, including pinned adjacent pawns. The reviewer exports *legal*-EP FEN; do not compute hashes by reparsing the viewer's FEN in pinned-EP cases. This difference is covered by a dedicated regression fixture.
- **Failure contract:** `invalid` includes a bounded diagnostic (up to 1000 characters) and **zero** occurrences even if some earlier mainline plies were playable. Invalid PGNs will be counted/reported by PS-04; neither this helper nor the desktop app writes or auto-indexes user archives.
- **Coverage:** standard start and published reference vectors, custom black-to-move and nonstandard move numbers, castling, en passant, promotion, transpositions, 120 plies with repeated positions, annotated/nested sideline PGNs, malformed input, invalid SetUp/variant/FEN, and real viewer-path/board parity.

**Out of scope:** no archive writes or migrations, no search queries, no IPC, and no GUI change; those remain PS-04 onward.
