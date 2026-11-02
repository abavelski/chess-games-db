# OT-11 article reading and controlled navigation

The explorer shows related articles for the selected route and filters.
The redundant indexed-subset footer and brief loading text between moves are
omitted. Panels retain their accessible busy state while results update, and
positions with no matches still show an explicit empty-result message.
Clicking anywhere on an article card opens a
dedicated article study page. The explorer board, continuations, material list
and library header are hidden while reading. The page has its own heading,
compact interactive board, safe prose/diagrams, model-game links and **Back to articles**.
Escape also returns to article selection.

Opening an article preserves the previous route, filters, material pagination,
and board orientation. Back restores the material list, including its scroll
and focused control. Opening an article does not narrow the previous selection;
the reader's **Limit explorer to this article** action was removed following
player feedback. Reading
versions are selected automatically from readable content: English first,
Russian second, then any other available language. Source language and
source/chapter attribution remain in the collapsed Source and coverage details;
there is no reading-language selector. The redundant safe-formatting notice is removed.
The article list includes all languages, and saved language preferences do not
restrict it.

The renderer accepts typed reading blocks only. Text, emphasis, headings, lists,
quotations, code, controlled links and local validated FEN diagrams are rendered
through React. No source HTML, URLs, styles or event attributes are mounted.
Malformed block nesting is rendered through safe containers. Generic "Source image
unavailable offline" placeholders are hidden, including paragraphs containing only
that placeholder. Other missing media retain readable notices; invalid FEN diagrams
and their placeholder messages are hidden.
Clicking a diagram, its FEN, or a valid
complete FEN in article text loads the left study board. Legal moves, promotion,
previous/next, flip, reset to the selected position and starting position work
independently of the explorer. Article boards remain mounted during game review.
The board stacks above the article in narrow windows. Articles are filtered by
their relationships to games matching the explorer's move sequence or position
anchor. Opening an article captures that explorer board position as its starting
position; Starting position returns there. The snapshot is saved with each
article-history entry and restored on reload. Older saved entries use the
restored explorer position. Returning from review or paging examples preserves
the current board exploration. The first article diagram does not override the
matching explorer position.

Internal links use stored targets. Unvalidated numeric position hints open the
exact source occurrence at its verified root with a notice. Ambiguous links
show explicit candidate records and source chapters; unavailable candidates
cannot be opened. Dead link-only navigation paragraphs are omitted. Inline
credits and prose keep their text without an unavailable label or link action.
No label guessing, header-identity expansion or CBLink
execution occurs. Model games continue inside the article reading pane and page
independently. Whole-card buttons open review and show players, result, event,
date, ECO and annotator when supplied. The visible Same chapter and Why this
example? labels were removed; relationship evidence remains in the API.

The explorer and up to eight linked article-history entries stay mounted while
an example is inspected. Model games open the shared Games review screen; Back
to study returns to the article with its reading scroll and focused game link.
Previous article returns through linked articles. Reload resumes the dedicated
reading page, and Back returns to the material list. The separate title catalogue
and its Browse all article titles button were removed following player feedback.
Old catalogue sessions restore the Articles tab on page 1; old catalogue return
destinations restore the regular material list. The backend title-query API
remains compatible, but the standalone title-browser UI is no longer exposed.
No source/runtime database migration is involved.

```powershell
npm.cmd run build
node scripts/run-archive-tool.mjs --test tests/opening-publication.check.mjs tests/opening-query.check.mjs
node scripts/start-electron.mjs tests/opening-articles-desktop-smoke.mjs
```

All pass. The isolated article smoke verifies language fallback, prose and
game metadata and whole-card links, root-only interpretation of hints, exact ambiguous
candidate selection, dedicated-page navigation, unchanged selection, legacy-catalogue recovery, reload/Escape return, return scroll
and focus, hostile malformed HTML, valid/invalid local diagrams, zero external
or source-file resource requests, and unchanged Games/source/runtime hashes.
It also exercises clickable text FENs/diagrams, real pointer moves on the compact
board, previous/next/reset/flip/start controls and a 640px stacked layout.
Synthetic fixtures contain original explanatory paragraphs and hostile markup;
no encyclopedia payload is required or committed.

React review checked bounded lists/history, stable entry keys, effect cleanup,
stale reading responses, independent example paging, accessible reading/language
controls, and safe nested-block rendering. No Games save/favourite API is used.
