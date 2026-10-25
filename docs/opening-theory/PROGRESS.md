# Opening study implementation progress

Branch: `feature/opening-study-mvp`. All commits stay local; do not push.
Packaging: same repository/build, separate Games / Openings workspaces.

| Task | Status | Evidence |
| --- | --- | --- |
| OT-01 | Done | [Decisions and sketch](DECISIONS.md); packaging accepted by user |
| OT-02 | Done | [Source quality](SOURCE_QUALITY.md); local full inventory reconciles; Python tests pass |
| OT-03 | Done | [Feasibility review](FEASIBILITY.md); 942 real records; 16 tree tests pass |
| OT-04 | Done | [Builder](BUILDING.md); 82,888 items staged; three native SQLite checks pass |
| OT-05 | Done | [Tree converter](BUILDING.md); six native checks + 16 reader tests; first 100 real records checkpointed |
| OT-06 | Done | [Safe articles](BUILDING.md); four body/security tests + native relationship check; three real samples |
| OT-07 | Done | [Full-library report](FULL_LIBRARY_REPORT.md); published 7.4 GB ready artifact, checksum, complete reconciliation |
| OT-08 | Done | [Query service](QUERY_SERVICE.md); eight native oracle/worker checks; full-data prefix smoke |
| OT-09 | Done | [Workspace](WORKSPACE.md); build, isolated opening workspace and existing Games desktop smokes pass |
| OT-10 | Done | [Explorer](EXPLORER.md); legal input/session tests, build, explorer and Games desktop smokes pass |
| OT-11 | Done | [Reading](READING.md); build, publication/query checks and hostile-content article desktop smoke pass |
| OT-12 | Done | [Review/resume](REVIEW_AND_RESUME.md); independent store/query checks, build and five desktop smokes pass |
| OT-13 | In progress | [Performance/usability checkpoint](PERFORMANCE_AND_USABILITY.md); automated checks and article-action fix; player journey/retest outstanding |
| OT-14 | Pending | Execute after OT-13 acceptance evidence exists |

## Resume

Read this file, `MVP_TASKS.md`, and the last task commit on the branch. Check
`git status` before editing. Continue OT-13. Source:
`data/tmp/opening-theory.sqlite`; open read-only, never migrate or repair it.
All source payloads and real-data reports belong under ignored `data/`.
Keep synthetic fixtures redistributable. Mark a task done only when its
acceptance evidence exists, update this file and the task heading, and commit
that task before proceeding. Later tasks are not implicitly done by scaffolding.

Latest game-list simplification: removed the Open annotated example button.
Each game card now opens review across its full area, with a native keyboard
button, accessible player label, hover feedback and visible focus outline.
Matching-source-branch controls remain independently interactive. Build and
review/explorer desktop smokes pass, including full-card pointer hit testing,
keyboard opening and existing annotation/restart checks.

Latest board simplification: removed Following move order and its row, the
side-to-move label, Undo and Start. Find other move orders is next to Reset path.
Reset now restores standard starting FEN/prefix mode, clears all filters and
previous anchor context, and resets material pagination, including from custom
FENs and filtered roots. Build and explorer/article desktop smokes pass; keyboard
backward navigation, root-filter reset, custom-FEN reset and saved reset state
are covered. OT-13 remains open for player feedback.

Latest language simplification: removed reading-language selectors and the
review all-languages checkbox. Articles and opening-review comments now choose
English, then Russian, then another available language automatically. Article
lists remain language-inclusive; saved language preferences are ignored.
Readable article bodies and non-empty comments outrank placeholders. Build,
11 native query checks, five review unit tests and article/review/explorer
desktop smokes pass. OT-13 remains open for player feedback.

Latest navigation simplification: removed Browse all article titles and the
unused title-catalogue UI. Saved catalogue views now restore Articles, page 1;
reader Back/Escape returns to regular material. Build and article/explorer
desktop smokes pass, including legacy-catalogue recovery and preserved safe
reading/game links. OT-13 remains open for player feedback.

Latest simplification: removed the Source comments tab and its preview cards.
The material tabs are Articles and Game records; source comments, glyphs,
variations and drawings stay in the shared game review. Legacy saved comment
views (including previous move-order views) restore as Game records on page 1.
Build and explorer/review desktop smokes pass, including legacy-session fallback
and annotation rendering. OT-13 remains open for player feedback.

Latest article feedback fix: Study this article and article titles now open a
dedicated study page with model-game links and Back to articles / Escape.
Opening a reader preserves the previous selection; article scope is a separate
explicit action. Related/catalogue return, search/focus/scroll, game round trips
and reload are covered by the article desktop smoke. Build, article, explorer,
review and Games desktop checks and two native user-store checks pass.
See `READING.md`. Player retest and OT-13 acceptance remain outstanding.

Latest feedback fix: annotated examples now reuse the Games `GameReview` UI;
the opening-specific preview and its styles are removed. Source annotations,
ordinal duplicate branches, exact resume and Back to study remain supported.
Shared-review unit/build, opening review/article/explorer, Games and personal
review desktop checks pass; full-library smoke confirms unchanged runtime.
See `REVIEW_AND_RESUME.md` for the Python/optional engine test limitations.
OT-13 remains in progress pending player feedback; OT-14 remains pending.

OT-13 continuation: retest the article action in the rebuilt desktop, collect
the player's two-opening/transposition/counter/return feedback, address any
blockers and record it in `PERFORMANCE_AND_USABILITY.md`. Measurements and
recovery checks are implemented; exact native distributions are in ignored
`data/opening-study/performance-final.json` and desktop timings in
`performance-ui.json`. Do not treat the initial confusing button report as
approval of the whole study journey. OT-14 remains pending.

OT-07 is complete. Ready runtime: `data/opening-study/opening-library.sqlite3`
with `.report.json` and `.sha256`. Its completed v2 staging name was removed
at publication. Do not rerun the old staging command against the existing final
output. New source/build versions require new staging/output paths. Example
command for an interrupted future generation (substitute its actual paths):

```powershell
node scripts/run-archive-tool.mjs scripts/build-opening-library.mjs --source data/tmp/opening-theory.sqlite --staging data/opening-study/NEXT.staging.sqlite3 --output data/opening-study/NEXT-ready.sqlite3 --corpus opening-encyclopaedia-2024 --resume --phase trees
```

Do not start a second writer if that command is already running. After it
finishes, run the same command with `--phase articles`, then `--phase publish`.
Neither conversion phase publishes. Publication passed synthetic end-to-end
tests and the full local source; see the report above.

The earlier `library.staging.sqlite3` is superseded, preserved locally and must
not be resumed with builder v2. Full-data inspection added FRA/ESP/NED language
normalization and root FEN/counters to tree hashes; those versioned changes
require a new generation. The v2 build uses bounded 128 MiB SQLite cache and
WAL/NORMAL (atomic checkpoints; after a power loss, lost complete transactions
are simply processed again). Do not mix maps from the two generations.

OT-03 is a documented feasibility gate before full conversion. OT-07 requires
a full-corpus published artifact; OT-13 requires full-data measurements and
player feedback. Record unresolved gates honestly rather than claiming success.
