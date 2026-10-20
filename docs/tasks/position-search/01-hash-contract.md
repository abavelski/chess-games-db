# PS-01 — Standard Zobrist and pawn-signature contract

Status: **planned**. Depends on: none. No database/UI changes.

## Deliver

- Implement a reusable **pure** helper for standard-chess positions, shared by index builder and query layer. Input is a validated `chessops` position (or canonicalized FEN); output is exact 64-bit **Polyglot Zobrist** hash, normalized four-field verification key, pawn-only 64-bit Zobrist hash and exact two-color pawn-square signature.
- Select pinned Polyglot constants implementation (small dependency vs vendored table), record package version/license and hash algorithm ID. No key generation at runtime. Verify the Polyglot en-passant rule (adjacent pawn able to capture, even if a pin makes it illegal), castling, side to move, promoted pieces, and custom initial FEN. Compare normalization with `electron/openings.mjs`; avoid conflating the two contracts.
- Use `bigint` internally and explicit unsigned → signed SQLite mapping via `BigInt.asIntN(64, value)`; optionally document fixed-size hexadecimal rendering for logs. No `Number` or lossy JSON conversions. Pawn hash ignores all pieces except white/black pawns and is independent of turn/rights.
- State exact semantics for invalid and impossible FEN: reject invalid search positions; the offline indexer will report invalid PGNs separately.

## Acceptance / tests

- Known Polyglot reference vectors, including standard start (`0x463b96181691fc9c`), verified independently; full sequence vectors for turn/castling/en-passant.
- Same resulting position via transposition hashes identically; different side-to-move or castling rights changes exact key/hash; EP convention tested including a pinned pawn.
- Pawn hashes/signatures match when only other pieces, castling, turn or move counters differ, and differ when one pawn moves.
- Round-trip both positive and negative signed-64-bit values through isolated `better-sqlite3`; read as `bigint`. Collision-verification key distinguishes deliberately forced equal-hash fixtures.
- `npm test`, `npm run build`.
