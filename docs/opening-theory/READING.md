# OT-11 article reading and controlled navigation

The explorer has an independent searchable title catalog, including essays
without indexed examples. Related cards open a safe article reader alongside
the board. Reading language is explicit; a non-explanatory preferred body gets
a visible language fallback. Source language and chapter attribution remain
visible. Study this article applies direct occurrence membership while keeping
the reader and board position available.

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

The explorer and up to eight article-history entries stay mounted while an
example is inspected. Returning restores article scroll and link focus. A
verified source-location preview currently supplies that boundary; complete
annotated navigation and persistent resume are OT-12.

```powershell
npm.cmd run build
node scripts/run-archive-tool.mjs --test tests/opening-publication.check.mjs tests/opening-query.check.mjs
node scripts/start-electron.mjs tests/opening-articles-desktop-smoke.mjs
```

All pass. The isolated article smoke verifies language fallback, prose and
relationship labels, root-only interpretation of hints, exact ambiguous
candidate selection, article scope, standalone title discovery, return scroll
and focus, hostile malformed HTML, valid/invalid local diagrams, zero external
or source-file resource requests, and unchanged Games/source/runtime hashes.
Synthetic fixtures contain original explanatory paragraphs and hostile markup;
no encyclopedia payload is required or committed.

React review checked bounded lists/history, stable entry keys, effect cleanup,
stale reading responses, independent example paging, accessible reading/language
controls, and safe nested-block rendering. No Games save/favourite API is used.
