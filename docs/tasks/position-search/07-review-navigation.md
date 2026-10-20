# PS-07 — Jump from a search result to the matching mainline move

Status: **planned**. Depends on: PS-03, PS-05. May use a mocked result list initially.

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
