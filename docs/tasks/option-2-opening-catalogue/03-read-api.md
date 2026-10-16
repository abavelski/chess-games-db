# O2-03 — Opening labels and hierarchical search API

Status: implemented and verified (taxonomy/count/filter fixtures, legacy and stale-data behavior, IPC, unit/archive suites, build and desktop smoke).

Depends on: O2-01 storage contract; use seeded fixtures without O2-02. Read [shared rules](../README.md).

Deliver:

- Extend `src/types.ts`, database queries, preload, and IPC with optional opening data and a taxonomy/facet lookup. Publish the payload contract before implementing the UI.
- Game rows/details include primary opening name, family/line/subline path, derived ECO, matched ply, and enrichment status. Preserve original `eco` separately. Return only hash-current results from the active revision.
- Add `openingNodeId` filtering. Selecting a node finds games whose mainline reaches any named position assigned to that node or its descendants. This includes transpositions and earlier matched lines even if the displayed deepest match changes later. Use `EXISTS`/distinct game IDs so multiple matches never duplicate rows or totals.
- Facets return distinct-game counts and available children within existing book/player/year/event/ECO/search filters. For taxonomy navigation, exclude the opening selection itself from base counts, then scope children to the selected parent. Resolve ancestry by IDs, not name substring or ECO prefix.
- Keep existing ECO filtering independent and combine filters with AND. Add an explicit “Unclassified” selection for games without a current primary match; preserve status to distinguish why.
- On schema v3, return no opening capability/labels and continue normal searches. Invalid/stale node IDs on capable archives return a clear validation error, never silently broaden results.

Acceptance/tests:

- Seed family → line → subline fixtures plus transposed/multi-match games. Assert parent includes descendants, child excludes siblings, counts/pagination are unique, and combined filters work.
- Cover stale PGN hashes, staged revisions, unmatched/invalid games, SQL-injection inputs, legacy archives, and unchanged existing APIs. Verify label queries do not decompress PGN per list row.
- Backend and IPC tests pass without the download script, opening UI, or network.
