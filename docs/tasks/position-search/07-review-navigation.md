# PS-07 — Jump from a search result to the matching mainline move

Status: **completed** (2026-10-21). Depends on: PS-03, PS-05. Uses real PS-05 results.

## Deliver

- Extend game opening from `src/App.tsx` to accept the preferred indexed path/ply returned by search, instead of always passing `initialPath=""` to `GameReview`. Reuse `PgnBoard`'s existing `initialPath` support and review path selection.
- Verify the matched **position**, not merely the ply label, after opening (especially custom FEN starts, transpositions and repeated positions); validate the path against the loaded original PGN. If index is now stale/missing or a path is unavailable, explain and fall back safely to game start without crashing.
- Keep source commentary, personal-analysis branches, engine toggles, Study stops and keyboard behavior intact. Back returns to the position-search results with page, sort, filters, board moves, scroll and focus.
- If Study stops hides the target as a spoiler, define clear behavior (don't silently reveal hidden future moves): either enter an explicit matching-position navigation state with user acknowledgement, or navigate to the nearest allowed position with an explanation.

## Acceptance / tests

- Select a game reached by transposition and land on exactly the correct board layout; another game in the result has a different matching ply.
- Custom `SetUp/FEN` game and root occurrence navigate correctly; repeated occurrence picks deterministic earliest match.
- Invalid/stale path and restricted Study stops fail gracefully; original PGN and personal work remain unchanged.
- Return-to-list preservation and engine/keyboard/regression desktop checks; `npm test`, `npm run build`.

## Implementation and verification

- `src/review-navigation.mjs` verifies the full PS-01 four-field position key, deterministic earliest mainline occurrence, path and ply by strictly replaying the **original** PGN with PS-03 before entering review; it never trusts an index hit based on a ply number alone. Absent, invalid, mismatched and stale paths report a notice and open at the game root.
- `src/App.tsx` passes the validated path to `GameReview`/`PgnBoard`. After the viewer mounts, `GameReview` additionally checks the actual selected position against the expected key, safely returning to root with a notice if the viewer cannot reproduce it. No source or personal data is written. Normal review behavior, engine controls, keyboard shortcuts and Back's preserved filters/page/board/scroll/focus are retained.
- When **Study stops** is enabled, review starts at initial reveal stage and a hidden target opens at the nearest currently visible *mainline ancestor*, with an explicit notice. It never silently exposes future moves or disables Study stops. The reader can reveal more through the existing controls.
- `tests/review-navigation.test.mjs` covers distinct matching plies reached through transpositions, custom FEN root, repeat-earliest selection, mismatched boards/ply/paths, invalid PGN and Study stops. The position-search desktop smoke asserts landing on the matching review move and restricted Study-stops navigation, plus Back/focus/page and keyboard regressions. CI runs `npm test`, `npm run build` and this desktop smoke in an isolated fixture.
