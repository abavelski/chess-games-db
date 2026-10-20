# PS-06 — Position search board in the game browser

Status: **planned**. Depends on: PS-05. Can develop against mocked position-search IPC.

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
