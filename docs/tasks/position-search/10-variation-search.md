# PS-10 — Search mode: played game versus annotated alternatives

Status: **completed** (2026-10-21). Depends on: PS-05, PS-09.

## Deliver

- Extend the position-search API with an explicit `mainline` (default) vs `includeSourceVariations` scope, checked against the corresponding index coverage state. Return a **match type** (played game / source variation) with the selected path, and the total distinct games.
- In position browser add a clearly labelled **Include annotated variations** checkbox. Show which matches occurred only in the author's notes, not in the actual game, and navigate to their indexed variation path. Keep filters and sorting intact.
- Prefer a mainline occurrence over a variation when a game contains both. When only branches match, choose deterministic earliest/shortest stable path; no duplicated game cards. Do not count a game twice when the same position occurs repeatedly.
- If variation coverage is not complete/available, state this explicitly rather than silently pretending the opt-in mode is exhaustive.

## Acceptance / tests

- A position occurring only in an annotation branch appears only with the option enabled; mainline default still matches the MVP results.
- A position occurring in both mainline and two variations produces one row labelled mainline and opens the preferred mainline occurrence.
- Mainline-only, fully indexed and partial-index fixtures show correct scope state and counts.
- Keyboard toggle, clearing, paging, opening a sideline and Back state work on desktop; `npm test`, `npm run build`.

## Implementation

- `searchByPosition(fen, { scope: 'mainline' | 'includeSourceVariations', ...filters })` defaults to the unchanged mainline-only semantics. Scope validation lives at the trusted IPC edge. The indexed SQL still checks signed Polyglot hash plus exact 4-field key, matching PGN SHA-256 and supported builder version; when opted in, it includes complete all-scope author-variation occurrences only. `ROW_NUMBER` prefers played game positions and otherwise earliest ply, shortest then stable binary path, eliminating duplicate game cards and repeat visits before filters, sort and pagination. Rows carry `match.type` (`playedGame` / `sourceVariation`), `isMainline`, exact path and ply.
- Coverage reports `scope`, `mainlineOnly` and separate complete/incomplete counts. A mainline-only or failed variation build never claims complete opt-in coverage; its safe played-position matches remain visible with an explicit partial warning. Full opt-in coverage requires successful all-lines indexing for every visible game. Missing or invalid index extensions preserve the existing unavailable/incompatible state.
- The browser exposes an accessible checkbox labelled **Include annotated variations**, re-queries the active board without wiping filters, and labels annotation-only matches. Review independently replays and validates selected mainline/variation occurrences against the original PGN and the mounted viewer; hidden Study stops or stale paths produce a safe notice and ancestor/start fallback. Paging, clearing, and Back maintain the browsing context.
- Tests: `tests/position-variation-search.check.mjs` covers mainline-only/full/partial scope, duplicate games, mainline preference, nested variation paths, filters and paging; `tests/review-navigation.test.mjs` covers variation safety; `tests/position-search-desktop-smoke.mjs` exercises keyboard toggling, labelled source-only hit, review entry, Back, clear and scope reset. Existing PS-05/PS-09 regressions continue to exercise old default behavior.

No source PGNs, personal variations, schema versions or opening-classification data are changed. Build author variations only on an archive **copy** with `npm run positions -- build --database PATH --include-variations`.
