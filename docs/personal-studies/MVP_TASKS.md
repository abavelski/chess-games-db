# Personal Studies — ordered MVP implementation tasks

**Status:** implementation in progress; completed tasks are checked below. This is the executable backlog, not a claim that the feature exists. Each task is a small reviewable change with independent unit/fixture tests and **no writes to users' real databases**. Task IDs are scoped here as **Personal Studies PS-xx** (not `docs/tasks/position-search/`).

## Milestone A — isolated foundation

### [x] PS-01 · Contracts, fixtures and regression baseline
- **Depends on:** none.
- **Build:** document exact one-game/one-chapter, standard-root, metadata, editable-tree, error limits and no-write boundaries; add deterministic example PGNs with nested variations, root comments, ratings, NAGs and drawings; establish existing suite baseline.
- **Acceptance:** fixtures describe valid/invalid standard positions, unsupported FEN/variants, multi-game input and PGN fidelity; current `npm test`, `npm run build` and available desktop suites green before feature work. Check both Games and Openings session paths.
- **Files likely:** `tests/fixtures/personal-studies/*`, `docs/personal-studies/*`.

### [x] PS-02 · Dedicated SQLite schema and migration/backup policy
- **Depends on:** PS-01.
- **Build:** private `personal-studies.sqlite3` schema in `app.userData` with `application_id`, `user_version`, unique IDs, single PGN tree, indexed metadata, tags and revisions. Lazy creation and standalone migration path, never tied to archive schemas.
- **Acceptance:** new/missing DB initializes on first My Studies use; reopen preserves records; unknown future schema, corrupt DB and wrong app ID fail with actionable errors; no old library is accessed/modified. Transactions/foreign keys verified.
- **Files likely:** `lib/personal-studies/storage.mjs` + migration SQL + isolated tests.

### PS-03 · Typed, bounded study storage API
- **Depends on:** PS-02.
- **Build:** create/list/filter/get/update/duplicate/delete; offset or cursor pagination with bounded page size, tag normalization, deterministic sort, optional year/kind/tag filters; transactional metadata+PGN+tags save, optimistic `expectedRevision`.
- **Acceptance:** search/title/White/Black/Event, tag AND/OR policy defined and tested; stale revision is a conflict; invalid field/oversized payload never commits; deleting one study cascades only its tags; duplicate gets a new ID. An empty result is valid.
- **Files likely:** storage/query and validators, SQLite fixture tests.

### PS-04 · Secure Electron IPC / file lifecycle
- **Depends on:** PS-03.
- **Build:** register `personal-studies:*` handlers in main through a separate module; expose narrow `window.personalStudies` methods and TypeScript declarations; userData path/status; no renderer SQL, arbitrary file or Node access.
- **Acceptance:** only allowlisted validated parameters/actions reach the store; unknown ID and storage failure messages are safe; close handles at app shutdown; archive/openings IPC and their selected files are unchanged.
- **Files likely:** `electron/personal-studies.mjs`, `electron/main.mjs`, `electron/preload.cjs`, typings.

### PS-05 · Third workspace / state preservation
- **Depends on:** PS-04.
- **Build:** add lazily mounted **My Studies** navigation in `src/WorkspaceRoot.tsx`; independent focus, scroll and resume behavior; preserve current Games/Openings initialization and their existing saved workspace preference. Explicitly decide whether the new workspace itself remembers its selection, without breaking `OpeningUserStore`'s `games|openings` validation.
- **Acceptance:** switching all three panes never discards Games/opening review, filters, selected moves, focused control or scroll; no engine processing in suspended pane; keyboard/screen-reader nav labels work; reopening app retains existing Games/Openings choice.
- **Files likely:** `src/WorkspaceRoot.tsx`, optional new workspace preference adapter, desktop test.

### PS-06 · Studies list, basic metadata, tags and new/delete
- **Depends on:** PS-03–PS-05.
- **Build:** `PersonalStudiesWorkspace` list/search/sort/filter, blank create, rename, tag editor (free-form labels), date/ratings/Event/players metadata, duplicate/delete confirmation, visible local storage path/help.
- **Acceptance:** tournament and other study creation, unknown headers allowed, tags normalized, list results deterministic; search and filters compose, empty list and error states usable; no archive or opening-library entry is changed.
- **Files likely:** `src/PersonalStudiesWorkspace.tsx`, list/meta components.

## Milestone B — true editable one-game tree

### PS-07 · Pure study PGN codec and branch identity
- **Depends on:** PS-01, PS-03.
- **Build:** strict single-game standard-root PGN parser/serializer using existing `chessops`; explicit ordered move tree, supported metadata+NAGs+comments/directives; safe node identity and ordinal viewer-path mapping; parse/replay *all* branches, not just mainline. Import untouched source bytes until first committed edit where feasible.
- **Acceptance:** identical semantic tree after serialize→parse, including root comments and distinct imported same-SAN siblings; bad FEN/variant, illegal nested moves and multiple games rejected before DB mutation; nested edit/navigation never selects a different sibling. Unknown annotations preserved or clearly warned about.
- **Files likely:** `lib/personal-studies/pgn.mjs`, codec tests. **Do not reuse `mergePersonal` as study ownership model.**

### PS-08 · Editable board/move tree shell
- **Depends on:** PS-05–PS-07.
- **Build:** editor with `PgnBoard`, `ReviewMoves`, existing resize/nav/flip controls; opt-in editable board mode without changing Games default; selected move/variation correctly tracks after PGN rerenders.
- **Acceptance:** blank, complete and incomplete games open; flip/keyboard/path navigation and review layout work; can select every nested variation; existing game review remains visually/behaviorally unchanged.
- **Files likely:** `src/PersonalStudyEditor.tsx`, opt-in shared component props.

### PS-09 · Legal moves, full games, variations and deletion
- **Depends on:** PS-07–PS-08.
- **Build:** add legal moves by board, append/branch at selected ply, promotion picker, select existing matching continuation, delete a selected move/subtree, and maintain a clear mainline. Support insert from beginning/root; independent nested variation branches.
- **Acceptance:** edit changes only the selected study; illegal move and invalid promotion never alter tree; deleting a branch leaves siblings intact and moves selection to surviving ancestor; 2+ nested levels and initial position pass desktop tests. Never inadvertently merge imported duplicate siblings.
- **Files likely:** pure tree-edit module, editor action tests.

### PS-10 · Prose comments, root notes and NAG editor
- **Depends on:** PS-07–PS-09.
- **Build:** editable position comments (including move zero), add/remove NAGs, preserve annotations attached to sibling branches; render using existing review-score/comment styles; reserve room for future evaluations.
- **Acceptance:** comments and numeric NAGs survive save/reopen/export and child/sibling deletion; non-ASCII text and escaped PGN content safe; comment and NAG changes mark document dirty without touching Games personal-analysis store.
- **Files likely:** editor annotations panel, pure codec tests.

### PS-11 · Drawing edit & persistence
- **Depends on:** PS-07–PS-10.
- **Build:** Chessground user arrows and square highlights per selected position, common G/R/B/Y colors, discoverable tools and clear/remove, encode `[%cal]`/`[%csl]` in root/move PGN comments; keep engine autoShapes ephemeral.
- **Acceptance:** each of four arrow and square colors exports and reimports; drawings at two different variations and at root remain independent; removing a shape does not delete prose, unknown PGN directives or engine arrows. Board flip does not change square IDs.
- **Files likely:** drawing codec, `PgnBoard` opt-in hooks, study controls, tests.

### PS-12 · Explicit save, dirty-exit and recovery
- **Depends on:** PS-06–PS-11.
- **Build:** dirty tracking for tree/headers/tags/drawings, Save/Discard/Cancel guard for leaving study or changing workspace, revision-aware atomic commit with retained draft on failure. Prevent closing while pending write without confirmation. Include stable saved-vs-draft indicator.
- **Acceptance:** save/reopen identical study; leave-cancel keeps edits; discard restores last persisted state; injected IO failure and revision conflict retain local draft with readable error; switching to Games/Openings cannot silently lose study work.
- **Files likely:** editor state hook, modal, storage integration tests.

## Milestone C — Lichess-compatible portable PGN

### PS-13 · Import PGN (paste and file)
- **Depends on:** PS-06–PS-07, PS-10–PS-11.
- **Build:** import one UTF-8 standard-game PGN with branches, comments, NAGs, `[%cal]`/`[%csl]`; parse headers into indexed metadata; choose local title and tags independently; optional user-entered Lichess source URL for provenance only.
- **Acceptance:** single-game import usable completely offline; malformed/unsupported FEN/Variant, multiple games, invalid move and oversized file rejected before write; canceled file dialog no-op; imports never overwrite existing studies. Lichess chapter fixture shows drawings.
- **Files likely:** import dialog, IPC open-file helper with bounded content, codec+desktop tests.

### PS-14 · Export/copy annotated PGN
- **Depends on:** PS-07, PS-10–PS-13.
- **Build:** copy current **saved or explicitly chosen draft** study to clipboard and Save As `.pgn` using an exact one-game full-tree serializer and supported tags/drawings. Distinguish draft vs saved export in UI, and prevent accidental file overwrite.
- **Acceptance:** imported exported PGN is parseable by `chessops` and Lichess with the same mainline, variations, comments, glyphs and shapes; unknown headers not silently dropped; cancel/failure doesn't change the DB; local free-form tags do not masquerade as remote metadata.
- **Files likely:** export dialog, codec tests, desktop tests.

### PS-15 · Interoperability matrix & real Lichess manual check
- **Depends on:** PS-13–PS-14.
- **Build:** fixture matrix comparing normalized chess tree + annotations after import/export; manual process documented for **Lichess chapter PGN → local → Lichess chapter → local**. Verify the supported annotation subset and record known losses (e.g. chapter arrangement, privacy, gamebook).
- **Acceptance:** fixtures pass offline; one tested manual Lichess round trip documented (without account tokens in repo), or explicit release blocker until performed; import/export affordances use accurate "chapter" labels and never claim cloud sync.
- **Files likely:** `tests/personal-studies-interop.test.mjs`, verification notes in this folder.

## Milestone D — integration and shipping

### PS-16 · Stockfish/Maia & Piece mode, opt-in continuation
- **Depends on:** PS-08–PS-12.
- **Build:** hook existing `useEngineAnalysis`, `EnginePanel`, `PieceMode` and replay utilities to active personal-study position; accept a chosen engine continuation into the selected branch **only after explicit user action**. Suspend hidden workspace and free-board analysis as Games already does.
- **Acceptance:** both engines can be toggled when configured; missing binary yields current helpful error; engine arrows/evals aren't persisted implicitly; selected candidate is appended only when clicked; reopen verifies chosen line; switching workspaces stops stale analysis.
- **Files likely:** editor adapter to existing engine hooks and mocks.

### PS-17 · Backup, restore guidance and failure tests
- **Depends on:** PS-02–PS-04, PS-12–PS-14.
- **Build:** safe online SQLite backup of full **personal** studies DB to user-selected location, exported-file distinction, short close-app restore procedure and clear warning of replacement; no migration of original archive. Test WAL-active backups and corrupt/unsupported schema.
- **Acceptance:** backup contains PGN, metadata and tags across app restart; restore into disposable profile preserves data; cancel/overwrite prompt works; no partial or incorrectly copied live WAL state. Instructions prominently distinguish full DB backup from one-study PGN export.
- **Files likely:** Electron backup handler, tests, docs.

### PS-18 · Desktop regression & MVP release gate
- **Depends on:** PS-01–PS-17.
- **Build:** automate create → edit branch → comment → draw → Save → reopen → import/export → delete across workspaces; measure list and variation rendering on representative fixtures; write release verification record and known limitations.
- **Acceptance:** `npm test`, `npm run build`, `npm run test:desktop` pass in supported GUI environment; actual Games/Openings DB bytes/row counts unchanged; existing archive comments, search, opening study sessions, engine modes still work; 200+ move variation fixture responsive, keyboard labels usable. Any unavailable desktop/manual Lichess check is reported as **not verified**, not passed.
- **Files likely:** `tests/personal-studies-desktop-smoke.mjs`, CI package scripts, `docs/personal-studies/VERIFICATION.md` once implemented.

## Sequencing, handoff and release discipline

**Critical path:** PS-01 → PS-02 → PS-03 → PS-04 → PS-05/PS-06 → PS-07 → PS-08/PS-09 → PS-10 → PS-11 → PS-12 → PS-13/PS-14 → PS-15 → PS-16/PS-17 → PS-18. PS-07 can start alongside UI foundation; PS-16 can start after editor state is stable, and PS-17 after storage.

**Review rules:** keep each task shippable behind an isolated third tab; smallest viable shared abstractions; tests for newly reused code; offline fixtures only; no automatic schema modification to Games v7 or opening runtime, no engine downloads or network tests during normal CI. Do not mark tasks complete simply because a plan is committed.

**MVP done means:** a person can create a local study, build a full legal tree, annotate each move/root with comments, NAGs and drawings, save and filter studies, exchange one study with a Lichess chapter by PGN, and still use Games and Openings exactly as before.
