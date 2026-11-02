# OT-10 move-driven explorer

Openings has a legal controlled board, SAN move buttons, immediate replies,
three exact counters and Articles / Game records material tabs. Board clicks,
reply buttons and keyboard activation share strict legal replay and normalize
castling identically. Promotion waits for an explicit piece choice.

The Following move order header, side-to-move label, Undo button and Start
button were removed following player feedback. Their unused spacing is removed,
and the workspace heading gap is reduced. The board action row now contains
Flip, Reset path and Find other move orders, in that order. Move buttons and
Arrow Left / Home still allow backward navigation without a separate Undo UI.
An empty move path renders no breadcrumb row.

Reset path is always available: it restores the standard initial FEN in prefix
mode with no moves or filters, resets material pagination, clears remembered
article-filter names/errors and discards previous anchor context. It also works
from a custom-FEN anchor or an article-filtered root with no moves. Orientation
and the selected material tab remain user choices.

Default navigation follows a move order. Find other move orders explicitly
creates an anchor. A compact Position anchor status and Return to previous move
order action appear in the board controls only in anchor mode. The original
prefix route, filters, material tab/page and orientation are kept for return.
Further anchored moves retain the original anchor rather than re-running
unrestricted position lookup. Reset path discards this return context.

Direct article scope is the visible filter. Source/metadata/language filter
controls were removed in earlier feedback; hidden legacy restrictions are cleared
on resume. Articles and review comments choose English, Russian, then another
available language automatically. Language choice never restricts article lists
or exploration counters. Material pages are bounded and load on demand.

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
promotion choices and focus targets are explicit. Source text is
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
