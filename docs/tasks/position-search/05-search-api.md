# PS-05 — Fast position search with existing filters and paging

Status: **planned**. Depends on: PS-02. Use seeded index fixture; full CLI not required.

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
