# Lichess-style review layout and board sizing

Implemented: no score heading; numbered White/Black mainline columns; full-width
comments; smaller, indented nested variations; corner board resizing.

## What is reused

The app continues to use Lichess PGN Viewer for the move tree, navigation and
board lifecycle, Chessground for rendering, dragging and board geometry, and
PGN Viewer's annotation glyphs. Source PGN and archive bytes remain unchanged.

Lichess's full analysis renderer is not a standalone React component:
[ColumnView](https://github.com/lichess-org/lila/blob/master/ui/analyse/src/treeView/columnView.ts)
and [InlineView](https://github.com/lichess-org/lila/blob/master/ui/analyse/src/treeView/inlineView.ts)
depend on the Lila analysis controller, tree/disclosure settings, and its virtual
DOM. The existing [PGN Viewer](https://github.com/lichess-org/pgn-viewer) is the
reusable package, but its stock move list does not preserve this app's complete
book-text handling. We retain the parsed review tokens and render their layout
in React rather than importing Lila's application controller.

The new renderer follows Lichess's column-view structure: numbered rows with
White/Black cells, comments and sidelines interrupting the full row, and a
numbered continuation row when the interruption occurs after White's move.
[Tree styles](https://github.com/lichess-org/lila/blob/master/ui/lib/css/tree/_tree.scss)
inform the compact sans-serif commentary and smaller bordered variation groups.
Illegal source moves, custom Black-to-move FENs, annotations and evaluations
remain readable and retain their original ordering.

## Board sizing

The lower-right corner uses the same diagonal drag interaction as
[Lichess's resize handle](https://github.com/lichess-org/lila/blob/master/ui/lib/src/chessgroundResize.ts),
with a local pointer-event implementation. It saves the preferred width in local
storage instead of calling Lichess's preference endpoint. Chessground's existing
ResizeObserver keeps piece and arrow geometry in sync.

- Drag the corner to change the square board size.
- Focus the handle and use arrow keys; Shift increases the step. Home/End select
  the minimum/maximum size. F and Escape retain their review shortcuts.
- Double-click the corner to reset automatic sizing.
- Window and footer measurements constrain the board so navigation and the score
  remain usable, including embedded book review. Shrinking the window clamps the
  current display; growing it restores the saved preference.

## Verification

Unit coverage checks paired rows, comment interruptions, nested variations,
custom FEN move numbers and illegal-source preservation. Desktop checks use
actual mouse dragging, verify a square board, saved size and window clamping,
keyboard sizing/reset, larger mainline columns, smaller nested sidelines, and
all existing navigation/annotation behavior. The full unit/archive, build,
desktop, book-reader and real local-engine checks are required before delivery.
Optional `CHESS_REVIEW_SCREENSHOT=/absolute/path.png` on the desktop smoke suite
captures the fixture review for visual inspection; generated captures stay out
of Git.
