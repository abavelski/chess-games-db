# PS-08 — Mainline search MVP: release checks and measurements

Status: **planned**. Depends on: PS-04 through PS-07.

## Deliver

- Add an end-to-end fixture and desktop smoke journey: install derived extension on a *copy*, index it offline, construct the position on the board, combine browser filters, search, enter the matching move, return and clear the position.
- Benchmark explicit index build time, incremental rerun, additional database footprint, and p50/p95 search latency for start position, common opening, transposed middlegame and rare position. Record dataset, device, sample size, SQL plan, duplicate-game counts and index completeness; do not assert invented timing targets.
- Validate existing offline Lichess opening classification and schema-7 games, favourites, personal notes, critical positions, annotations and external engine settings still work. Include invalid and custom-start PGNs; verify no implicit user archive mutation.
- Document one-time opt-in **install → build → status → rebuild → recovery** commands and search semantics, index size and scope (mainline only) in `docs/database.md` and README.
- Mark PS-01–08 complete only after evidence is recorded; keep PS-09–12 clearly planned.

## Acceptance / tests

- `npm test`, `npm run build`, `npm run test:desktop` and new archive/index smoke all pass offline.
- Opening Explorer fixtures are unchanged by position indexing; user database remains untouched in tests.
- A real database **copy**, if available, is indexed and benchmarked; otherwise explicitly label measurements fixture-only. Publish verification numbers in this folder.
- MVP usability check: no opening name is needed; at least two transposed fixtures are found and open at the matched position.
