# PS-11 — Find matching games from any reviewed position

Status: **completed** (2026-10-21). Depends on: PS-07, PS-10.

## Deliver

- Add **Find games with this position** to Game Review (original mainline, source variation or saved personal variation where the board position is legal). Use the current validated position from the viewer/analysis state, not a manually reconstructed move number or a UI board-only string.
- Switch to browser with an active position query and **preserve all existing filters**. Default query scope to mainline; allow the user to opt into source variations. The currently open game may appear naturally among matches; do not falsely deduplicate other annotated editions.
- Support return to the originating game at its original exact path, with scroll, focus, analysis state and unsaved-edit protections. Respect the existing Save/Discard/Cancel prompt if navigating away with personal notes.
- Disable with explanation for invalid free-piece mode positions, empty/unavailable archive or unsupported search position; don't pass an illegal board state into the index API.

## Acceptance / tests

- Launch from source sideline and independently saved legal personal branch; query finds a different annotated game with the same position.
- Return to the correct originating game, path and review state; no loss of unsaved comments or variation edits.
- Opening from Piece mode is unavailable or explicitly exits it without illegal search.
- Filter persistence, keyboard/back navigation, and no-index coverage are covered in desktop smoke; `npm test`, `npm run build`.


## Implementation

- Game Review exposes a keyboard-accessible **Find games with this position** action. It calls `reviewedSearchFen(sourcePosition(viewer))`, computing a verified Polyglot-normalized four-field FEN from the current legal viewer replay (mainline, source variation or separately saved personal variation) without inferring a position from ply or Chessground-only visuals. Unsupported positions and open free-piece mode cannot enter the search API.
- The App transitions to its existing position-search results without changing search terms, opening selections, years, favourites, personal filters or sorting. The new query defaults to mainline scope; **Include annotated variations** remains available. Independently saved personal branches are a source of the *search position*, not indexed match data.
- The originating `GameReview` remains mounted, suspended behind the browser and any comparison game. **Return to reviewed game** restores the same viewer instance at its original variation path, orientation, transcript/editor state, focus and analysis settings, without reloading or rewriting the PGN. Analysis is paused while hidden. The original browser query and its filters remain available on exit.
- Dirty comments or personal branch edits trigger the existing **Save / Discard / Cancel** dialog before initiating search. Save is explicit and awaited; Cancel keeps changes in review; Discard restores the saved snapshot. Invalid/free-piece positions cannot be passed to indexed search; a missing index produces explicit non-exhaustive coverage rather than misleading empty results. The browser labels the original FEN to distinguish it from the separate interactive search setup board.
- Regression checks: `tests/review-navigation.test.mjs` tests legal source, saved personal and pinned-en-passant search FENs and invalid requests. `tests/position-review-search-desktop-smoke.mjs` tests filters, default/opt-in scope, source and personal branches, comparison-game return, keyboard focus, preserved original board/path, Piece mode, unsaved prompt and absent-index messaging. This smoke is included in `npm run test:desktop`.

No automatic indexing, schema changes, source PGN writes or personal-analysis enrichment is introduced.
