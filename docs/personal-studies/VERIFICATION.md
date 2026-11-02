# Personal Studies verification

## PS-01 baseline — 2026-11-02 (Windows)

- `npm test`: 128 pure tests passed; 86 archive checks passed. Five symlink-only subtests explicitly skipped because Windows symlink privileges are unavailable. Sidecar and hardlink checks still execute.
- `npm run build`: passed (existing Sass deprecation warnings).
- `npm run test:desktop`: all eleven suites passed in a disposable profile, including Games review, Openings filters, engines, Piece mode, annotations, imports and position searches.
- Baseline repairs: select installed Python on Windows, close Python SQLite fixture connections, open publication flush handles with write permission on Windows, update obsolete desktop Back selectors.
- Fixture databases only; no real user database used in verification.

## PS-18 implementation verification — 2026-11-02 (Windows)

Implementation tasks PS-01–PS-18 are delivered. The automated release gate passes; the manual Lichess gate remains blocked as described below.

- `npm test`: **140 pure tests passed; 94 archive/storage checks passed**, with five explicitly skipped Windows symlink-privilege subtests. No failed tests.
- `npm run build`: **passed**, including TypeScript. Existing Sass deprecation warnings remain.
- `npm run test:desktop`: **all 13 suites passed**. The command now includes the independent Openings workspace regression and Personal Studies desktop flow. After the final guard/layout refinements, the build, complete unit/storage tests and expanded studies desktop flow passed again.
- Desktop coverage: lazy database creation; three-workspace navigation and persisted Games/Openings preference; preserved Games selected move; blank/new study; search and metadata/tags; nested branches, existing continuations, subtree deletion; board-click underpromotion picker; root/move prose and NAGs; arrows; explicit save/reopen; revision conflict retaining local draft; workspace/app-close Cancel; Discard; Save-and-leave including save-then-delete; offline chapter import with visible root drawings; clipboard and file export; fake Stockfish/Maia, explicit continuation acceptance, paused hidden analysis; Piece mode; online backup; confirmed deletion.
- Storage/codec coverage: full branch legality, standard roots, malformed/multiple/oversized/invalid UTF-8 inputs, unknown headers/directives, duplicate SAN siblings, Unicode/literal braces, four drawing colors on root and distinct branches, atomic rollback under injected write failure, stale revision conflicts, deletion cascades, reopen, wrong app ID/future schema/corruption, WAL-active backup and standalone restore, cancel and existing-file protection.
- Isolation: actual application-selected **disposable fixture** Games and published Openings runtime files retained identical bytes and every table's row count across the full study flow. Real user profiles/databases were not used or modified.
- Measured on this machine: **516 move nodes rendered in 65 ms** (512 mainline plies plus nested variations); 512-ply codec/score pipeline roughly 30–80 ms; a 100-row indexed page from 240 studies roughly 1–2 ms. Regression budgets are 5 seconds for the tree pipeline/render and 2 seconds for list retrieval, allowing slower CI machines. List responses exclude PGN payloads.
- Expected rejection scenarios emit Electron handler diagnostics (schema/file mismatch and revision conflict); these are deliberate test paths, not test failures. Engines are synthetic and offline; no binaries are downloaded.

## Remaining release blocker and limitations

**Real Lichess chapter → local → Lichess chapter → local: NOT VERIFIED.** The manual procedure, annotation matrix and known possible losses are in [INTEROPERABILITY.md](INTEROPERABILITY.md). Do not declare the MVP release-approved until that round trip is performed and recorded. PS-15 expressly permits delivery with this explicit blocker.

Standard starting position only; no chapters inside a local study, cloud sync or Lichess account integration. Titles, kinds, tags and provenance remain local. My Studies selection resumes in the current session; the existing Games/Openings startup preference remains authoritative across restarts. Export and backup refuse existing filenames. Restore is an explicit close-app replacement procedure, not an automatic merge. Unsupported imported drawing tokens remain in PGN but are not rendered as editable shapes. Literal brace fidelity across remote systems depends on retention of the custom text backup directive.
