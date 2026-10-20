# PS-10 — Search mode: played game versus annotated alternatives

Status: **planned**. Depends on: PS-05, PS-09.

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
