# PS-05 — Fast position search with existing filters and paging

Status: **implemented** (2026-10-21). Depends on: PS-02 and PS-04. Read-only archive query; no GUI.

## Deliver

- Add a typed `searchByPosition` query to `ChessArchive` (through validated Electron preload/IPC), taking a normalized FEN/position **not a client-provided hash** plus the existing `SearchFilters`. Mainline-only in this task. Compute hash via PS-01 and compare the **exact key** in SQL so a collision cannot create a false match.
- Extend/reuse the existing whitelisted query predicates and sort/pagination logic (`electron/queries.mjs`), including opening hierarchy, source, metadata, year, search text, favourites, personal analysis and hidden records. Use `EXISTS`/grouped matching to avoid multiplying one game across repeated occurrences or sources.
- Return page and total plus a deterministic **preferred occurrence** per game (mainline, earliest ply, stable path tie-breaker). Keep a stable sort under pagination and output the occurrence path/ply to the review screen.
- Surface index capability and coverage: absent, building/partial, stale/unsupported algorithm, complete and invalid games. Reject/diagnose malformed FEN, unsupported variants or overly large requests; distinguish valid zero hits from unavailable/incomplete indexes.
- Favor indexed lookup for selective positions, and reasonable bounded work/queries for extremely common positions such as start position. Do not decompress PGN per search.

## Acceptance / tests

- Two different move orders reach one key; exact match returned; turn/castling/EP distinctions respected; a forced hash collision does not match wrongly.
- Same game visiting position twice returns **one row** at deterministic path; two distinct annotated editions remain two rows.
- All existing filters combine as AND where appropriate; correct total/page counts, zero-result and last-page behavior; stable order and no hidden rows.
- Unindexed/partially indexed/stale archive reports coverage rather than fabricating complete results; arbitrary SQL/FEN input rejected.
- Test `EXPLAIN QUERY PLAN` and an indexed fixture without PGN decompression; `npm test`, `npm run build`.

## Implementation

`ChessArchive.searchByPosition(fen, filters = {})` in `electron/database.mjs` reuses the shared `predicate()` (all game properties, opening-descendant and transposition matches, year, text, favourites, personal analysis and hidden=0), plus the same `GAME_FROM`, labels, whitelisted sorts and bounded pages. `electron/position-search.mjs` supplies a strict request validator, read-only visible-game coverage report and indexed occurrence query CTE. The query first derives a validated PS-01 Polyglot fingerprint from a four- or six-field standard-chess FEN; it **never accepts caller-provided numeric hashes**. The `position_keys(zobrist_hash,exact_key)` unique index verifies collision safety before seeking `game_position_occurrences_position`. The CTE ranks only current, complete, supported-version, mainline occurrences by `(ply,path)`, choosing one deterministic preferred path per game before counting, filtering or paging.

Return shape: `{rows,total,page,pageSize,coverage}`. Each row contains the same game metadata/opening labels as `searchGames`, plus `match:{path,ply,isMainline:true}`. `coverage` describes **all visible games**: `status: 'unavailable'|'incompatible'|'partial'|'complete'`, `isComplete` and numeric `total,complete,invalid,building,partial,stale,unsupported,unindexed` counts. In partial coverage, `total` is the number of currently indexed matches only; a zero is **not** a claim of no library matches. Hidden games are excluded, and no source PGNs are decompressed or replayed at query time.

The Electron main process registers `archive:position-search`; the context-isolated preload exposes `searchByPosition` with a typed `PositionSearchResult` in `src/types.ts`. FEN and request sizes are bounded, dynamic filters use the existing validated/whitelisted parameters, and IPC receives no database handle or raw SQL. Neither app startup nor search performs schema writes or extension installation. Mainline search only; variations and interactive UI remain PS-09/PS-06.

Tests in `tests/position-search.check.mjs` use disposable schema-7 archives and cover transpositions/editions, repeated game visits and preferred paths, real opening hierarchy plus all existing filters, stable paging, visible coverage and stale/invalid/unsupported states, forced hash collisions, legal and pinned en-passant, SQL planner indexes, malformed input, and search without PGN decompression. Run `npm test` and `npm run build` via the project CI.
