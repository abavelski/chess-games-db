# OT-10 move-driven explorer

Openings now has a legal controlled board, SAN breadcrumb, immediate replies,
three exact counters, contextual material tabs and filters. Board clicks, reply
buttons, keyboard activation and UCI entry share strict legal replay and normalize
castling identically. Promotion waits for an explicit piece choice. Undo/reset
retain the selected root; terminal positions and legal unsupported moves stay
visible without invented continuations.

Default navigation follows a move order. Find other move orders or submitted
FEN explicitly creates an anchor. The original prefix route, filters, material
tab/page and orientation are kept for return. Further anchored moves retain the
original anchor rather than re-running unrestricted position lookup. Invalid FEN
does not change the board or repair castling metadata.

Filters apply source roles, direct article scope, metadata and actual comment
language consistently. Empty role selection means all sources. Zero-match
selections remain visible. Reading language only changes presentation; it never
changes exploration counters. Material pages are bounded and load on demand.

Every legal move updates the board locally before a worker response. Each result
is tagged with its full route and request revision. Old replies/cards are hidden
while loading and discarded after navigation/filter/library changes. The board
does not remount when results arrive. Empty coverage, exhausted source lines and
unsupported legal moves have different messages and actionable navigation.

The opening adapter controls Chessground directly using the same embedded pieces,
compatibility destinations and legal-move contracts as Games. It does not use
move-encoded viewer paths as source identities. Document/scroll listeners bind
at construction, controlled bounds are invalidated after updates, and interactive
animations do not lag legal board state. Games retains its existing PgnBoard.

The layout becomes two columns with material beneath at narrower desktop widths.
The opening workspace removes the Games browser's global minimum-content-width
constraint to account for the vertical scrollbar. Reply/tab keyboard controls,
promotion choices, FEN/UCI labels and focus targets are explicit. Source text is
rendered as React text; no source HTML is mounted.

```powershell
node --test tests/opening-session.test.mjs
npm.cmd run build
node scripts/start-electron.mjs tests/opening-explorer-desktop-smoke.mjs
node scripts/start-electron.mjs tests/desktop-smoke.mjs
```

All pass. The isolated explorer smoke covers real mouse piece input, keyboard
replies, stable board identity, transposition/return, role/article/metadata/comment
filters, retained zero-match filters, reading-language independence, delayed stale
responses, unsupported legal moves, underpromotion/undo, narrow-window overflow
and unchanged Games/source/runtime hashes. Existing Games review still passes.
React review checked effect context/stale guards, bounded lists, stable board
identity, listener cleanup, controlled forms, keys and accessible focus.

Article prose/navigation is OT-11; annotated example review and persistent resume
are OT-12. This task does not claim those later study flows are complete.
