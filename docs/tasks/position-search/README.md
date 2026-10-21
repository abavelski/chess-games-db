# Position search — implementation phase

Status: **in progress** (2026-10-21). PS-01–PS-03 are complete; PS-04 onward are proposed, not completed features. Source baseline: schema 7, `master` on 2026-10-20. Keep this folder as the implementation/review checklist and record completed task verification here.

## Goal

Let the student construct an opening position by playing legal moves from the initial board, find **all library games that reached the position** (including transpositions and unnamed opening sublines), combine this with existing game filters, and enter each game at its matching move. Index **exact pawn structures from the beginning**, but defer the pawn-structure search UI.

PS-03 supplies a pure, validated mainline extractor in [`lib/position-mainline.mjs`](../../../lib/position-mainline.mjs): root + every legal mainline position with exact PS-01 keys and PGN Viewer-compatible paths. Invalid scores return diagnostics and no partial search hits. See [PS-03](03-mainline-replay.md) for validation and tests; PS-04 will add the actual index builder.

The PS-02 schema is available by explicit `npm run position-index -- install --database PATH` only; the installer does not build a search index and archives without it remain supported. See [PS-02](02-position-storage.md) for its verification and status.

The PS-01 hash contract is implemented in [`lib/position-hash.mjs`](../../../lib/position-hash.mjs); this does **not** yet make position search available in the app. See [PS-01](01-hash-contract.md) for its test coverage, pinned constants and FEN/EP semantics.

## Technical decisions / invariants

- **No new database stack.** Use `chessops`, `better-sqlite3`, SQLite indexed lookups, and the current Electron preload/IPC boundary. Avoid engine processes and network calls.
- **64-bit Zobrist keys from day one.** Choose and pin the **Polyglot standard** for standard-chess position hashing (pieces, turn, castling, Polyglot en-passant convention), and verify published test vectors. Implement with an audited dependency or pinned constants, recording the decision/license. Do **not** silently combine Polyglot hashing with a different en-passant normalization from the current `electron/openings.mjs`; normalize and test the exact-match semantics as one contract.
- **No JavaScript `Number` for hashes.** Use `bigint` throughout hashing/binding; convert unsigned 64-bit values with `BigInt.asIntN(64, hash)` for SQLite signed `INTEGER` (and enable `safeIntegers` on reads). Never round through JSON or JS floating point. Pass a validated position/FEN, not raw hash values, across IPC.
- **Collision safety.** Hashes narrow indexed candidates; compare a separately stored, normalized 4-field position key before returning matches. Store **pawn-only 64-bit Zobrist keys** (XOR the Polyglot pawn/piece-square keys; no turn, castling or en passant) **and an exact white+black pawn-square signature**, so future pawn-search results can also be collision-checked.
- **Occurrence semantics.** Persist `game_id`, matching position reference, half-move/ply, a stable path compatible with the existing Lichess PGN Viewer, and whether it is mainline or author variation. Include initial positions (path `''`, ply 0 for normal starts) and games starting from `SetUp/FEN`. Multiple annotated editions remain separate games. Deduplicate game-list rows while retaining occurrence(s).
- **Derived-only extension of schema 7.** The current repository keeps optional personal analysis in additive migration `008`; position indexes should likewise be an explicit, additive extension unless tests demonstrate a compelling need to bump the archive version. Never automatically migrate/enrich a selected user's archive or change original PGN/source records. Archives without the extension must still open.
- **Index freshness and safety.** Track each game's original PGN SHA-256, indexer version/scope, status and diagnostic. Query only matching-hash, supported-version, complete entries for the requested scope. Reimports invalidate index data transactionally. Distinguish absent, building, partial, failed and stale coverage from a genuine zero-match result. No silent fallback to PGN scanning.
- **Performance and compatibility.** Keep SQL bound/parameterized; preserve all existing filter, opening, favourites, paging, keyboard and Back/return behavior. Test with offline fixtures; never write to the real archive in tests.

## Backlog and deliverables

Tasks are small independently reviewable increments. **MVP:** PS-01–PS-08. **Follow-up:** PS-09–PS-12. No task needs external chess databases, engines, models or a live service.

| ID | Task | Dependencies | Demonstrable result |
| --- | --- | --- | --- |
| [PS-01 — completed](01-hash-contract.md) | Zobrist/position/pawn signatures | None | Published vector + transposition tests |
| [PS-02 — completed](02-position-storage.md) | Additive derived schema and capability | PS-01 | Fixture DB accepts/queries indexed rows; old DB opens |
| [PS-03 — completed](03-mainline-replay.md) | Mainline extractor, reviewer paths, diagnostics | PS-01 | Mainline occurrences from fixture PGNs |
| [PS-04](04-index-builder.md) | Offline CLI build/rebuild/resume and write invalidation | PS-02, PS-03 | Safe repeated build and changed-PGN rebuild |
| [PS-05](05-search-api.md) | Search API + existing filters and paging | PS-02 | Indexed exact-position hits, proper no-index states |
| [PS-06](06-search-board.md) | Search board and filter integration | PS-05 | Play moves, undo, search, see filtered results |
| [PS-07](07-review-navigation.md) | Open game at matching mainline path | PS-03, PS-05 | Result click lands at matching position |
| [PS-08](08-mvp-verification.md) | MVP regression, benchmarks, user guide | PS-04–PS-07 | End-to-end verified first release |
| [PS-09](09-variation-indexing.md) | Index author PGN variations | PS-03, PS-04 | Indexed mainlines + valid nested sidelines |
| [PS-10](10-variation-search.md) | Mainline/all-lines mode in API and browser | PS-05, PS-09 | Mode-dependent correct results |
| [PS-11](11-search-from-review.md) | Search from currently selected review position | PS-07, PS-10 | One-click cross-game lookup and return |
| [PS-12](12-final-verification.md) | Follow-up verification, benchmarking, documentation | PS-09–PS-11 | Verified release with variation search |

## Definition of done for *each* task

- Acceptance checks in its task file are automated (unit/archive/desktop as applicable) and pass on an isolated fixture.
- Existing behavior, original PGN bytes/hashes, provenance, personal notes, schema-version checks and opening enrichment remain intact.
- Relevant user-facing and technical docs are updated; no stale feature is described as implemented.
- The task leaves the app usable and is suitable for one small PR/commit, even if not yet visible in the GUI.
- Run targeted tests plus `npm test` and `npm run build`; any relevant desktop smoke. PS-08/PS-12 run full `npm run test:desktop`.

## Suggested manual acceptance journeys

1. Search for a position reached by two different legal move orders; both games appear, even without an opening name.
2. Apply year/source/opening filters and a favourite flag; totals, pages and results stay consistent, with no duplicate game cards.
3. Open a hit and find the board **already showing that occurrence**; Back returns to the same search position and list state.
4. Open an unindexed archive: the app still works and explains how to build the index. A stale index never reports a misleading zero.
5. After follow-up: enable **Include annotations' variations** and find a position present only in a sideline; distinguish it from the historical game.

References: [DB model](../../database.md), [opening replay](../../../electron/openings.mjs), [opening enrichment](../../../electron/opening-enrichment.mjs), [existing filter queries](../../../electron/queries.mjs), [viewer path integration](../../../src/PgnBoard.tsx), [PGN replay](../../../src/pgn.mjs).
