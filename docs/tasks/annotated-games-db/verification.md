# Release verification — 2026-10-17

All six implementation tasks completed in order, with six local commits and no
push. Existing migrations 001–006 are unchanged. Real archives, migration reports,
benchmark copies, logs and engine assets remain local and ignored under `data/`
and `.local-engines/`. No game records or downloaded taxonomy files are committed.

## Functional verification

- `npm test`: policy/parser/review/engine/query tests and native SQLite storage checks pass.
- `npm run build`: TypeScript and Vite production build pass. Existing upstream Sass import deprecation notices remain.
- `npm run test:desktop`: browser, opening hierarchy, engine and study-marker desktop suites pass. Coverage includes multiselect OR/AND, explicit unknown, zero matches with selected chips, keyboard active options, paging, list return/focus/scroll, board resizing, nested commentary/arrows/variations, reveal boundaries, medals, Piece mode, temporary analysis and independent engine controls.
- `npm run engines:verify -- .local-engines/engines.json`: configured Stockfish and Maia verification passes, including subprocess cleanup.
- `CHESS_ENGINE_CONFIG=.local-engines/engines.json npm run test:engines:local`: real-engine desktop flow passes with HTTP blocked, MPS Maia, both colors and both castling wings. No optional configured engine coverage was unavailable.
- Fixture conversions cover v3, v4, v5, v6, malformed setup scores, corrupt hashes, existing outputs/symlinks, injected interruption/restart, committed WAL data, section/collection identity, and completed/staging/stale/excluded opening mappings. Unknown/new versions are rejected by inventory and desktop guards.
- Writer checks cover same-key reimports, conflicting mappings/transaction rollback, stable created_at, identical editions staying separate, multiple sources/credits, Unicode search collisions remaining separate identities, source renames/type changes, deferred extraction, cache rebuild equivalence and last-use deletion.

## Local migration

The original v6 database was opened read-only and converted into a separate local
file. Inventory reconciled 52,691 rows into 13,507 retained games and 39,184
excluded standalone rows. Exclusions retain explicit reasons/identities in the
local report only. All 13,507 IDs, source/local mappings, compressed frames,
decoded hashes, original header strings and timestamps were checked. Foreign-key
and integrity checks passed; rebuilding the option cache produced identical rows.
All 13,507 completeness values remain unknown without trusted source evidence.

Input size: 401,436,672 bytes; output: 143,790,080 bytes (64.2% smaller). Migration runtime: 76.9 seconds including inventory, extraction, copy and verification. The active offline opening catalogue was preserved with 13,507 matching-hash classifications; 0 staging/stale/excluded classifications were discarded.

Parser limitations are distinct from corruption. 2,561 retained scores contain an
invalid/unreachable move under the review parser and retain exact PGNs with
error/unknown feature status. No compressed-byte or checksum failures were found.
Successful extraction counts reachable variation markers using the same parser.
These diagnostic statuses are a deliberate honest unknown, not a deletion rule.

## Performance

Measured on Apple M1 Pro, 32 GiB RAM, macOS/arm64, local SQLite through Electron.
The larger fixture duplicates editions fourfold with new stable identities and
copies relations/classifications; it is a scaling fixture, not a new chess corpus.
`node scripts/run-archive-tool.mjs scripts/benchmark-games.mjs DATABASE [NEW_LARGER_DATABASE]`
reproduces the measurements. Each scenario records its first request, followed
by 20 requests with contextual memoization cleared; p95 is the conservative max
of those 20. “Cold” means first request on a fresh connection, not OS cache eviction.
Real input/output JSON and query plans remain in ignored local reports.

| Request | Games | First (ms) | Warm p50 (ms) | Warm p95 (ms) |
| --- | ---: | ---: | ---: | ---: |
| firstPage | 13,507 | 53.80 | 52.41 | 69.59 |
| filteredPage | 13,507 | 34.92 | 35.25 | 38.01 |
| openingFacets | 13,507 | 77.15 | 66.26 | 74.42 |
| dropdown | 13,507 | 1.11 | 0.22 | 0.48 |
| dropdownGlobal | 13,507 | 0.19 | 0.11 | 0.15 |
| firstPage | 54,028 | 204.21 | 202.24 | 241.30 |
| filteredPage | 54,028 | 134.17 | 131.30 | 150.73 |
| openingFacets | 54,028 | 240.79 | 240.75 | 253.83 |
| dropdown | 54,028 | 0.96 | 0.18 | 0.23 |
| dropdownGlobal | 54,028 | 0.07 | 0.07 | 0.15 |

Targets pass on this machine at both sizes: bounded contextual dropdown p95 under
200 ms and filtered first-page-plus-count p95 under 300 ms. Initial contextual
player dropdown p95 exceeded 500 ms at current size because every candidate
rescanned games. A grouped candidate query now starts with the reverse player
index and looks up games by primary key; it counts distinct games once per bounded
candidate set. No speculative text index was added. Prefix option search uses
`property_options_search`; list plans use `games_hidden_v7`, indexed primary source
links and primary-key source lookups, then a temporary B-tree for deterministic
collection/section/sequence sorting. This remaining sort met the measured target.

The current-size file is about 137 MiB; the fourfold fixture is about 488 MiB.
Largest tables/indexes are `games`, opening matches and their reverse/unique
indexes, followed by opening classifications and dimensions. Standalone records
and raw extraction archives are absent from both new files. The cache is derived
metadata, never a replacement for PGN content. These measurements are local
release criteria, not promises about other hardware or arbitrary future datasets.

## Deferred work

The external extraction producer still needs an adapter to the shared writer.
Internet fetching, source-specific parsers, a new import UI, name aliases and
reconciliation, and Explorer statistics remain outside this release. Rollback is
reopening the unchanged original database in the previous application version.
