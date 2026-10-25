# OT-11 article reading and controlled navigation

The explorer shows related articles for the selected route and filters.
Clicking anywhere on an article card opens a
dedicated article study page. The explorer board, continuations, material list
and library header are hidden while reading. The page has its own heading,
reading language, safe prose/diagrams, model-game links and **Back to articles**.
Escape also returns to article selection.

Opening an article preserves the previous route, filters, material pagination,
and board orientation. Back restores the material list, including its scroll
and focused control. Filtering
is a separate, explicit **Limit explorer to this article** action in the reader;
simply opening an article does not narrow the previous selection. Reading
versions are selected automatically from readable content: English first,
Russian second, then any other available language. Source language and
source/chapter attribution remain visible; there is no reading-language selector.
The article list includes all languages, and saved language preferences do not
restrict it.

The renderer accepts typed reading blocks only. Text, emphasis, headings, lists,
quotations, code, controlled links and local validated FEN diagrams are rendered
through React. No source HTML, URLs, styles or event attributes are mounted.
Malformed block nesting is rendered through safe containers. Missing media and
invalid diagrams remain readable notices. Diagram FEN is available for copying.

Internal links use stored targets. Unvalidated numeric position hints open the
exact source occurrence at its verified root with a notice. Ambiguous links
show explicit candidate records and source chapters; unavailable candidates
cannot be opened. No label guessing, header-identity expansion or CBLink
execution occurs. Model-game lists distinguish linked examples from same-source
membership, expose that evidence and page independently of the reading body.

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
relationship labels, root-only interpretation of hints, exact ambiguous
candidate selection, dedicated-page navigation, unchanged selection, legacy-catalogue recovery, reload/Escape return, return scroll
and focus, hostile malformed HTML, valid/invalid local diagrams, zero external
or source-file resource requests, and unchanged Games/source/runtime hashes.
Synthetic fixtures contain original explanatory paragraphs and hostile markup;
no encyclopedia payload is required or committed.

React review checked bounded lists/history, stable entry keys, effect cleanup,
stale reading responses, independent example paging, accessible reading/language
controls, and safe nested-block rendering. No Games save/favourite API is used.
