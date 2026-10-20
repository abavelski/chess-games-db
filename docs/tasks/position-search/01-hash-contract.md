# PS-01 — Standard Zobrist and pawn-signature contract

Status: **completed** (2026-10-20). Depends on: none. No database/UI changes.

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

## PS-01 implementation and verification (2026-10-20)

**Status: completed.** The pure helper is in `lib/position-hash.mjs` (shared, no Electron/DB dependency), and the pinned fixed table is in `lib/polyglot-keys.mjs`. Tests: `tests/position-hash.test.mjs` (including all nine independently published Toga II Polyglot reference keys) and `tests/position-hash.check.mjs` (in-memory `better-sqlite3`); both are picked up by the existing `npm test` scripts. `npm run build` is unchanged.

- **Algorithm IDs:** `polyglot-standard-v1` and `polyglot-pawns-v1`. 781 constants vendored (never generated at runtime) from `@echecs/zobrist` **v1.0.2**, source `src/keys.ts` (MIT; copyright Adrian de la Rosa; license reproduced in `lib/polyglot-keys.LICENSE`). Standard Polyglot piece order, square indexing (a1 = bit 0), K/Q/k/q keys, white-to-move key, and the EP-file key when a side-to-move pawn is geometrically adjacent even if pinned. Chess960 is not covered.
- **API:** `parseSearchPosition(fen)` accepts strict four-field EPD or six-field FEN and returns a validated standard `chessops` `Chess`; `positionFingerprint(fenOrChess)` returns `{ hash, sqliteHash, verificationKey, pawnHash, sqlitePawnHash, pawnSignature }`. Both hash fields are unsigned 64-bit `bigint`, SQLite fields are mapped by `BigInt.asIntN(64, hash)`; reverse maps with `BigInt.asUintN(64, signed)` and reads **must** use `better-sqlite3` `safeIntegers()`. `hex64` formats diagnostic keys as 16 hex digits; no `Number` or JSON serialization of hash values.
- **Exact match:** `verificationKey` is four normalized FEN fields `board turn castling polyglotEp`, with counters omitted and the EP field present only under Polyglot's adjacent-pawn test. The existing `electron/openings.mjs` `positionKey` keeps its different chessops *legal*-EP normalization and is **not** reused. After selecting candidates by indexed hash, always compare the verification key (`samePositionFingerprint`). This catches even a deliberately forced hash collision.
- **Pawn match:** XOR only the Polyglot black/white pawn-square constants, ignoring turn, rights, EP, non-pawns and move counters. `pawnSignature` is two lowercase, zero-padded 16-hex-digit occupancy bitboards (`white:black`), with a1 as bit 0; compare it separately after the pawn-hash candidate lookup (`samePawnFingerprint`).
- **Invalid input:** reject malformed FEN, nonstandard pockets/variant syntax, missing/illegal kings, pawns on backranks, impossible EP metadata, castling rights with missing/incorrect standard rooks/kings, locally impossible material and checks. `Chess.fromSetup` alone silently discards some invalid metadata, so the FEN path checks these before fingerprinting. A validated replayed `Chess` is trusted by the pure helper; a position's global historical reachability cannot generally be inferred from a FEN alone. **Search rejects invalid positions**; future offline indexing (PS-03/PS-04) must separately report invalid PGNs rather than coercing/skipping positions.
- **Scope:** PS-01 adds no schema, migrations, PGN index, IPC or UI, and does not modify archives. Those are later tasks. Use `npm test` and `npm run build` for verification.
