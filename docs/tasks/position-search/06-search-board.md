# PS-06 — Position search board in the game browser

Status: **implemented** (2026-10-21). Depends on: PS-05. Uses its real typed IPC.

## Deliver

- Add an unobtrusive **Search by position** control on the games browser. Display a dedicated board starting at orthodox chess setup. User plays **legal moves**, with notation/move history, Undo, Reset and Search; show current turn, and optional board flip if inexpensive. Do not reuse the non-legal-move Piece mode.
- Compute/display resulting FEN using `chessops`, pass FEN plus the current browser filters to PS-05, and render results in the existing paged game list; visually distinguish position search from named-opening selection. Inferred opening names are *not required* to use the search.
- Preserve position search state across pagination, opening a game, and returning. Allow the user to clear position search without resetting unrelated year/source/favourite/opening filters. Reset pagination when position or filters change.
- Clearly show unavailable index, index-in-progress/partial/stale coverage, invalid input and genuine zero results; do not fire a new search on every accidental drag or during asynchronous updates. Keyboard-accessible controls and small desktop sizes.

## Acceptance / tests

- Play a legal named opening and a transposed order; Search returns expected fixture games without choosing a line name.
- Illegal moves cannot alter board/key; Undo and Reset restore expected FEN; side-to-move and castling behavior follow `chessops`.
- Combine selected source/year/opening/favourites filters; results, counts, pagination and clear behavior match browser expectations.
- Open another game and Back; search board, move history, result page, scroll and focus are restored. Show explicit no-index message for a standard v7 fixture.
- Desktop smoke on small window + keyboard tests; `npm test`, `npm run build`.

## Implementation and verification

- `src/position-search-board.mjs` reuses `src/analysis.mjs` and `chessops` to replay a deterministic standard-chess history, generate valid destinations, handle castling/EP/promotion and reject illegal moves. The browser's board operates via square buttons, including roving arrow-key focus and Enter/Space activation; it does not reuse the analysis Piece mode.
- `src/PositionSearchBoard.tsx` shows highlighted legal targets, SAN history, side to move, complete FEN, Flip, Undo, Reset, and an explicit Search button. Moves never fire a request; they only update a draft board. Search applies the current FEN and shows a warning if the board changes before searching again. Cancelled/illegal moves cannot corrupt the FEN or search state.
- `src/App.tsx` keeps the draft board, applied position, current filters, page and review-return scroll/focus in persistent state. Search results use the existing list and pagination, show a matching ply label, and react to source/year/opening/favourites/personal filters. A separate Clear position search action restores normal games without clearing other filters or the current board.
- Missing/incompatible/partial/stale/failed/unsupported index coverage is shown explicitly rather than misreporting zero hits. With complete coverage, zero results are genuine under current filters. No schema upgrade or background index building occurs in Electron. Selecting a result still opens normal review at root; PS-07 will use the stored match path to navigate to it.
- `tests/position-search-board.test.mjs` checks pure replay, legal vs illegal moves, turn, transpositions, castling, undo/reset and malformed move histories. `tests/position-search-desktop-smoke.mjs` uses disposable indexed and unindexed schema-7 archives to check transposed searches, paging, combined filters, keyboard, small window, returning from review, missing-index diagnostics and read-only operation. It runs under xvfb in CI along with `npm test` and `npm run build`.
