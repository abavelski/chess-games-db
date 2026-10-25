# OT-13 validation checkpoint

Status: **in progress**. Automated measurements and recovery checks are recorded
below. The player reported confusing article-study behavior; that blocker is
fixed and covered by a desktop regression. A complete player check on two
openings and one transposition, including counter understanding and return
context, is still outstanding. Do not mark OT-13 done or start OT-14 until that
evidence is recorded and any blockers are addressed.

## Reproducible local measurements

The reference machine remains Windows 10.0.19045, Ryzen 5 5600X / 12 logical
CPUs, 34,241,204,224 bytes RAM and Samsung SSD 980 1TB NVMe (E:). Electron is
38.8.6 with Node 22.22.0. The external library is 7,404,560,384 bytes, UUID
`3e447545-f184-4066-a688-d418ba3492c4`, revision
`41ead7eb4579750679f4e46cf409f6fc588cab62bbab524a0645f18b3ef86b02`.

Ignored local reports:

- `data/opening-study/performance-baseline.json`: original broad-query baseline.
- `data/opening-study/performance-final.json`: current native measurements.
- `data/opening-study/performance-ui.json`: full-library desktop measurements.

The benchmark records five fresh service/SQLite connections for each route,
separating initialization from first-query time, and ten warm application-cursor
misses plus immediate hits per route. It covers root, e4, Sicilian, Najdorf,
no-hit, both source roles, comment language, metadata, article scope, root anchor,
anchor suffix, transposition and an actual ancestral repeated position found
in the first 512 source documents. The repeated-position fixture additionally
checks union counts against an independently enumerated leaf oracle.

Fresh connections have empty SQLite/application caches, but OS pages are
uncontrolled and full-file hashing warms them. No physical-disk-cold or reboot
measurement is claimed. Warm cursor misses retain SQLite/OS pages and the
bounded 32-entry exact-root-equivalence proof cache. Small sample p95 uses the
nearest rank; these measurements are reference evidence, not a universal SLA.
See the JSON for exact samples, first-readable document/article timings,
game/article pages, process RSS and explain plans.

Final native milliseconds (five fresh queries, ten warm misses/hits per row):

| Route | Fresh query p95 | Warm miss p50 | Warm miss p95 | Hit p95 |
| --- | ---: | ---: | ---: | ---: |
| Root | 149.6 | 127.0 | 131.3 | 0.47 |
| e4 | 84.2 | 74.8 | 81.5 | 0.31 |
| Sicilian, 3 plies | 21.1 | 12.0 | 15.4 | 0.26 |
| Najdorf, 10 plies | 10.1 | 4.5 | 9.8 | 0.26 |
| No hit | 0.5 | 0.1 | 0.2 | 0.12 |
| Theory | 41.5 | 21.4 | 29.5 | 0.27 |
| Main collection | 45.0 | 20.4 | 29.0 | 0.24 |
| English comments | 113.6 | 60.3 | 106.3 | 0.25 |
| Metadata | 22.3 | 17.4 | 35.2 | 0.21 |
| Root position anchor | 184.7 | 128.8 | 184.8 | 0.28 |
| Root anchor with Sicilian suffix | 62.0 | 15.7 | 16.2 | 0.15 |
| Transposition anchor | 4.2 | 1.0 | 3.2 | 0.14 |
| Actual ancestral repeated position | 0.7 | 0.3 | 0.4 | 0.11 |
| Article scope | 15.4 | 13.2 | 13.9 | 0.15 |

All measured warm explore rows meet 200 ms p95. Fresh service opening was
about 96–110 ms per case; the initial process service opening was 114 ms and
its root query 164 ms. Native maximum sampled RSS was 428 MiB while repeatedly
opening/closing services and running queries; GC is included. Game/article
detail and material-page distributions are retained in the local report.

## Findings and changes

Original warm miss p95 was root 1,089 ms, e4 681 ms, Sicilian 96 ms and broad
root-anchor suffix 1,456 ms. Profiling found two approximately 0.5-second root
queries fetching branch text and probing for children across 81,000 documents.
The existing covering prefix index returned compact intervals in about 24 ms.
The fix fetches compact node/interval cursors, then resolves branch metadata
only for displayed games. At one exact prefix depth, intervals are disjoint;
their lengths can be summed, and source endings are the difference from the
next depth's coverage. Position searches continue to union intervals.

For a position that is also a source root, a bounded scalar cache records
whether both occurrence-ID sets are identical. Two SQL EXCEPT checks prove
equality in both directions. Only a proven match uses the prefix execution
path; any extra repeated occurrence keeps the general position query. The
response remains a position anchor and no suffix is ever reseeded. This
optimization requires no runtime schema change or library rebuild.

Article-page evidence previously reparsed the entire document-ID set once per
card. One page-wide query now supplies the same evidence, bringing the first
e4 display in the full desktop journey from 423 ms to about 129 ms.

The latest desktop run measured first workspace/root display 506 ms; subsequent
uncached e4/c5/Nf3 displays 129/42/17 ms; 40 cached displays p50 8.4 ms, p95
27.9 ms, max 29 ms; readable article 27.4 ms; review 14.9 ms; explicit discovery
99 ms. Frame gaps were p95 7.1 ms, max 97.3 ms (including initial mount).
One desktop journey is not a frame-time guarantee. Browser working set was
about 302 MiB, tab 116 MiB, GPU 100 MiB and utility 45 MiB in that sample;
worker memory is included in its owning process. Native JSON records RSS after
each case, including normal GC effects; it is not an isolated peak profiler.

Query plans use `study_prefix`, `study_position`, `study_children`/`study_order`
and `relation_document`. PGN parsing, source decoding, Python and article HTML
sanitizing do not occur in the move-query path. Legal route replay is bounded
and remains necessary for validating user input.

## Recovery and preservation

Native checks cover invalid/expired requests, cursor eviction, revision mismatch,
missing/corrupt files, file identity changes, unavailable archival source,
worker termination with running/queued requests and successful worker reopening.
Store checks cover invalid-route atomic rollback, wrong database type and
independent backup/reopen. Builder checkpoint/publication checks from OT-04–07
cover interrupted/resumed units and refusal to publish incomplete data.

Workspace, explorer, hostile-article, annotated-review and full-library desktop
checks pass. Exact-path/hash fallback, missing remembered library, source/Games
file rejection, stale replies, reload, custom FENs and branch overlays have
synthetic coverage. Opening flows do not call Games writes. Synthetic desktop
tests compare Games/source/runtime hashes. Full benchmark and desktop runs
rehash the complete runtime and confirm its published checksum unchanged:
`ed27366391bca685a47fdf12187b0b97962c4ffee0f86b44e48cbb74dd87fbbc`.
The archival source was also rehashed and still matches
`9860ea58102bb69f6beea655943358d042f3f1f2221d9814eb5aceaa4e7e04fd`.

## Player feedback

The player narrowed a Sicilian position to one article, clicked **Study this
article**, and could not tell whether anything happened. The screenshot showed
the article filter already applied, but the explanatory reader remained hidden.
This was a usability blocker: repeating the action produced no visible next step.

The action now both applies the article scope and opens the reader, even when
that scope is already active. The reader says **Selected for study** and explains
that board continuations and game records are scoped to the article; the player
can read, play a continuation or open a model game. The title remains a direct
reading action. A regression reproduces initial selection and repeated selection
of an already scoped article. The rebuilt desktop must be restarted to see it.

Still required: the player's retest of this change and the rest of the two-opening
and transposition journey. Counter understanding has not yet been confirmed.

The player's next screenshot requested a simpler workspace. Removed the offline
library eyebrow, introductory sentence, library-information disclosure, and
the source-role/metadata/comment-language filter panel. On resume, settings for
those removed controls are cleared and their material pagination resets, so no
invisible restrictions remain. Article study scope still has a clear action
beside the study material. Build and the workspace, explorer, article and review
desktop checks pass after the simplification. The backend filter API remains
available; the UI acceptance scope now follows this explicit player request.

The next simplification request removed the counter-explanation disclosure and
the FEN/text move-entry disclosure. Board input, move-path navigation and the
explicit same-position action remain available. The explorer desktop smoke now
uses board gestures for legal no-hit and stale-response checks, and a saved
setup fixture for promotion/resume coverage.

```powershell
node scripts/run-archive-tool.mjs scripts/benchmark-opening-library.mjs data/opening-study/opening-library.sqlite3 data/opening-study/performance-final.json
$env:CHESS_OPENING_LIBRARY = 'E:\dev\chess-games-db\data\opening-study\opening-library.sqlite3'
$env:CHESS_OPENING_UI_REPORT = 'E:\dev\chess-games-db\data\opening-study\performance-ui.json'
node scripts/start-electron.mjs tests/opening-full-library-desktop-smoke.mjs
```

The next feedback request replaced the separate opening-example review with the
polished Games review screen. Examples now use the same full-height board,
resize control, score/variation transcript, annotation glyphs and drawings,
keyboard navigation, settings, engine controls and Piece mode. Back to study
preserves the explorer/article context. A thin runtime-tree adapter preserves
source comment language, unsupported-annotation notices and duplicate sibling
identity; the previous opening-specific review component and styles are deleted.
Opening examples retain read-only source data and temporary analysis; Games
personal saves and favourites remain scoped to the Games archive.

Build, focused tests and opening review/article/explorer, Games review and
personal-review desktop checks pass. Full-library smoke confirms unchanged data.
Detailed checks and remaining environment limitations are recorded in
`REVIEW_AND_RESUME.md`. Player retest and OT-13 journey acceptance are outstanding.

The next article feedback requested a separate study page, matching game-review
navigation. Study this article and article titles now hide the explorer and open
a dedicated page with safe reading content, diagrams and model-game links.
Games return to the mounted article; Back to articles (or Escape) returns to the
originating list, preserving selection, material page, catalogue search, scroll
and focus. Opening the page no longer implicitly filters the explorer; the
reader offers a separate Limit explorer to this article action. Existing article
scope stays intact. The return-list kind is stored for session resume.

Build/typecheck, article (including reload, Escape, game round trip and hostile
content), opening review, explorer and existing Games desktop smokes pass.
Two native user-store checks pass, including the optional return-destination
field and invalid-value rejection. The full-library smoke follows the new Back
to articles action; full-library performance was not remeasured for this change.
OT-13 remains in progress pending player feedback.

The player requested removal of the Source comments tab because it duplicated
game annotations. The explorer now offers only Articles and Game records; the
comment-card UI is removed. All source annotations remain in shared game review.
Old saved comment-tab selections and previous move-order views normalize to
Game records, page 1, rather than leaving an invisible tab selected. The backend
annotation query contract remains compatible with existing libraries.
Build/typecheck and explorer/review desktop smokes pass, covering the two-tab
workspace, saved comment-view recovery and preserved game annotations.

The player next requested removal of Browse all article titles. Removed that
button, the dedicated title-browser component and its styles. Articles continue
to open from the regular material list and controlled article links. Legacy
catalogue sessions restore the Articles tab on page 1; reader Back/Escape returns
to material instead of an inaccessible catalogue. Backend title-query support
remains compatible. This explicitly supersedes the earlier standalone title-UI
acceptance scope. Build/typecheck and article/explorer desktop smokes pass,
including saved-catalogue recovery, safe reading and game-review round trips.
