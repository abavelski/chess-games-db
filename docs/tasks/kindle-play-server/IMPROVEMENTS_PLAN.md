# Kindle Play — post-MVP improvements (desktop)

**Implementation tracked below; human acceptance remains pending.** Created 2026-11-09. Repository: abavelski/chess-games-db, default integration branch **master**. MVP baseline: [server README](README.md) and [setup](SETUP.md). Companion Kindle plan: [KINDLE_PLAY_IMPROVEMENTS.md](https://github.com/abavelski/kindle-chess-puzzles/blob/main/docs/KINDLE_PLAY_IMPROVEMENTS.md).

## Outcome and boundaries

Replace the opt-in auto-start server with a **Maia** workspace tab after Games, Openings, My Studies. The owner can start/stop the LAN listener in the running Electron app and read listener/Maia status, current game (including player side, rating, progress/result), and timestamp of the last committed move. Support the human playing White **or** Black, and automatically create/update one durable My Studies record when a game starts, after each *committed* turn, and at game end. Leaving the Kindle app does not affect the desktop game or the saved record. Restarting Electron may still discard the active in-memory HTTP session; its last saved My Studies game must remain.

Do not modify the historical frozen v1 MVP contract in README.md; this document defines the **additive v1 extension**. Preserve existing route names, errors, 4 KiB request limit, trusted-LAN-only/no authentication warning, authoritative FEN, standard UCI moves and expectedPly concurrency guard. No clocks, alternate starting positions, engine evaluations, multi-client games, or takebacks. Do not rewrite archived games/openings or the user's other studies.

### Current implementation anchors (verified on master)

- Electron boot calls startKindlePlayServer in electron/main.mjs; electron/kindle-play-lifecycle.mjs reads kindle-play-server.json with enabled/host/port. It owns server and Maia process. Server HTTP/game/provider live in electron/kindle-play-{http,game,maia}.mjs.
- Workspace tabs are in src/WorkspaceRoot.tsx (games/openings/studies). Electron APIs are exposed via electron/preload.cjs; main-process IPC is authorization-gated.
- electron/kindle-play-game.mjs currently assumes human White, #game in memory, and move() applies human + one Black Maia response as one committed snapshot. electron/kindle-play-maia.mjs explicitly rejects anything except Black-to-move. Preserve the rollback/no-half-move contract.
- electron/personal-studies.mjs opens userData/personal-studies.sqlite3 through lib/personal-studies/storage.mjs. PersonalStudiesStore.create/update accepts one *validated legal SAN PGN* and update requires expectedRevision. Study kind can be other; existing origin_kind validation does not yet include Kindle. Studies has its own UI and dirty-draft protection.
- Relevant tests: tests/kindle-play-{game,maia,http,lifecycle}.test.mjs, tests/kindle-play-desktop-smoke.mjs, tests/personal-studies-*.test.mjs, tests/personal-studies-desktop-smoke.mjs.

## Reuse-first implementation rule (mandatory for every BKP task)

**Extend existing components before adding new ones.** Before coding, inspect the named implementation anchors, tests, and shared styles. Prefer a small generalization or extraction of an existing component/helper over a parallel implementation. Introduce a new module only for behavior with no suitable home; avoid speculative shared abstractions. Keep the reuse boundaries strict: never share an analysis engine *session* with live play, and never route game persistence through the renderer. In each task's implementation evidence, briefly state **what was reused, what was extracted, and why any new component was necessary**.

| Concern | Reuse or extend | Avoid duplicating |
| --- | --- | --- |
| Server lifecycle and Maia status | `electron/kindle-play-lifecycle.mjs` config validator/logging, existing `createKindlePlayServer` and `KindlePlayMaia`, existing engine settings loader; `electron/main.mjs` shutdown and sender-authorization patterns | A second HTTP listener stack, settings parser, engine profile, separate Maia child manager or unsafe renderer access |
| Desktop Maia screen | `src/WorkspaceRoot.tsx` navigation/pane lifecycle, existing workspace CSS, `electron/preload.cjs` typed bridge convention; reuse existing app button/status/error patterns | A separate navigation shell, redundant React polling infrastructure, or duplicate IPC/auth boilerplate |
| Both-color play | Existing `KindlePlayGame`, `applyUci`, `terminalResult`, chessops FEN/legal/SAN routines, `KindlePlayMaia` + `UciProcess` | A second rules engine, manual SAN generator, copied game state machine, or changes to the review-analysis engine queue |
| Saved games | Existing **single** `PersonalStudiesStore` backing `electron/personal-studies.mjs`, its `create/update`, revision checks, `validatePgn` and metadata extraction; existing My Studies refresh/dirty-draft UI | A second SQLite store/connection manager, PGN validation pipeline, studies list/editor, or a separate Kindle-games database |
| Tests | Current Kindle server tests, fake UCI fixture, personal-studies SQLite fixtures and desktop smoke harness | A parallel test runner or live model dependency for ordinary unit tests |

**Storage integration detail:** make the desktop play controller and the existing Personal Studies IPC use the *same store/service ownership path* (e.g. expose a narrow application-internal store accessor) rather than each constructing its own PersonalStudiesStore for the same file. Keep study writes in the Electron main process using store APIs, never by calling renderer IPC. A small shared formatter for UCI-to-SAN PGN is fine if needed; reuse existing chessops and study validation.

## Cross-repository API agreement (implement in BKP-03 before FKP-02/FKP-03)

Keep apiVersion: 1, endpoints and GET semantics; make the following **additive** contract changes. Existing White-only Kindle builds must keep working with the updated server.

| Interface | Behavior |
| --- | --- |
| POST /api/v1/games | Accept either { "rating":1500 } (legacy White default) or { "rating":1500, "playerColor":"white"\|"black" }. Reject invalid casing/values/extra keys with 400 BAD_REQUEST. |
| Game state | playerColor is the human side, white or black. Existing fen, moves (standard UCI, ordered from White), ply, status, result, lastMove retained. Add sanMoves (SAN strings, exactly one per UCI ply), gameId (stable opaque string), startedAt (ISO-8601), lastMoveAt (ISO-8601 or null). These fields may be absent on an older server: upgraded Kindle must fall back to UCI labels and not rely on them for legality. |
| Human White start | Return starting FEN with ply=0 and sanMoves=[]; human plays first. |
| Human Black start | Generate exactly one legal White Maia opening move **before** publishing game / responding 201; return Black-to-move FEN, ply=1, moves and sanMoves containing one entry. If Maia fails, do not create/replace game or study. |
| POST /api/v1/games/current/moves | Require mover == playerColor and exact expectedPly. Validate human UCI; if not terminal, get exactly one Maia reply of the opposite color. Publish the whole legal turn as one snapshot, possibly with odd ply when human White finishes or even ply when human Black finishes. No partial human move on engine failure. |
| POST /api/v1/games/current/resign | Always produces the **opponent** win, regardless of human side. Keep standard error-state shape and completed-game replacement rules. |
| Time and IDs | startedAt assigned once on successful creation, lastMoveAt changed only for successfully committed moves (including Maia's opening move for Black), neither changed on error/GET/resign. gameId identifies the session/study and never changes during play. |
| GET /api/v1/health | Preserve {apiVersion,maiaAvailable}; listener state is surfaced separately over **local authenticated Electron IPC**, not a new unauthenticated LAN admin API. |

Keep SAN computation and chess legality in desktop chessops, not Kindle. Document exact wire fixtures for both colors in tests. For Black, 201 can take as long as an engine move; client requests remain asynchronous. Preserve the same 503/504 and timeout/reconciliation rules. While one request is active, return 409 BUSY; malformed/unavailable engine opening must not leave a phantom game. Version 1 fields are additive; do **not** silently break legacy clients by requiring the new color key.

## Current implementation run (2026-11-10)

The owner explicitly requested all missing tasks on one common feature branch,
with commits when complete. That instruction supersedes the per-task branch and
dependency acceptance pauses for this run. Existing uncommitted BKP-01 work was
preserved and completed on `feature/kindle-play-improvements`. Implementation of
BKP-01..04 is authorized together; human acceptance and real-device verification
are still required before marking tasks Done.

### Automated evidence for BKP-01 through BKP-04

Implementation commit: **`69f56c61a1d8fa33d91d78b76fb0463fa4c38ad2`** on
`feature/kindle-play-improvements`. All four implementations are **Waiting for human**;
the commands below apply to each task. Historical 2026-11-09 notes remain below
as history and are superseded by this run's automated results.

- `node --test tests/kindle-play-improvements.test.mjs`: initially failed both
  new Black-opening tests against the old implementation, then passed after changes.
- `node --test tests/kindle-play-*.test.mjs`: focused game/HTTP/lifecycle/Maia
  checks passed; subsequent mate/SAN/timestamp/White-opening additions are included
  in the full suite below.
- `node scripts/run-archive-tool.mjs --test tests/kindle-play-studies.check.mjs`:
  **4 passed**, temporary SQLite only; final expanded storage assertions also
  passed in the full archive suite.
- `npm.cmd test`: native exit **0**; **169 unit tests passed**, **98 archive checks
  passed, 5 existing archive skips**, no failures. Includes personal studies
  create/edit/delete/backup regressions and the four new persistence checks.
- `npm.cmd run build`: native exit **0**, TypeScript and Vite passed; existing Sass
  import deprecation warnings remain.
- `npm.cmd run test:desktop`: final native exit **0**, build and **all 14 desktop
  smoke programs passed**, including Games/Openings, independent engine review,
  My Studies draft/backup behavior and real-controller Kindle integration. Mocked
  IPC fixtures cover safely rendered errors/thinking and hidden-tab polling cleanup.
  Initial verification caught the Maia tab/engine toggle selector collision;
  the existing review-scoped helper fixed it. A subsequent overlapping rebuild
  invalidated lazy chunks during a smoke; the final run used one stable build.
- `git diff --check`: passed. PowerShell execution policy requires `npm.cmd` here;
  native exit codes were recorded explicitly to distinguish stderr warnings from
  command failure.

No owner engine profile, real studies database, archived games or opening library
was changed by tests. No real Maia model, Kindle device or cross-device LAN result
is claimed. The task-specific human checklists below remain the final acceptance
steps; no task is marked Done and no downstream Kindle task is accepted by mocks.

## Codex execution protocol

**Token-efficient CLI option:** use [`bash scripts/codex-play.sh`](../../CODEX_PLAY_CLI.md) from this repository. It invokes Codex on one task with Sol 6.1/medium by default, then runs the existing tests/build/desktop-smoke commands outside the model; use `verify` without Codex and `fix` to resume only with a short failing-log excerpt. The remainder of this task protocol and its human acceptance gates still apply. Do not ask Codex to duplicate the wrapper's full checks.


Each row below is one independently shippable Codex assignment, ideally one branch/PR. **Use the first Ready task whose dependencies are accepted.** Apply the mandatory reuse-first rule above; list reused/extracted/new components in the task evidence before requesting review. Read this document, relevant modules and existing tests. Set *both* table and task-detail status to In progress with branch/date; write a failing focused test first, implement only that task, pass focused tests plus npm test and npm run build, and (when GUI touched) npm run test:desktop in a graphical environment. Record actual commands/results and commit SHA, avoid claiming device or live Maia checks from mocks. Set **Waiting for human** when automated checks are green; the **last task step is human verification**. Only after the owner explicitly accepts should the two status locations become Done. Do not silently mark the next task Ready until dependencies are accepted. Do not change the owner's existing engine profiles or real studies DB during tests; use temporary profiles/databases.

| Order | Task | Depends on | Status | Codex deliverable |
| --- | --- | --- | --- | --- |
| 1 | BKP-01 — manually managed server + status IPC | MVP | **Waiting for human** | Lifecycle controller, listener/engine state, start/stop/status, tests |
| 2 | BKP-02 — Maia desktop workspace tab | BKP-01 Done | **Waiting for human** | Four-tab navigation and status/control UI |
| 3 | BKP-03 — play either color + extended game snapshots | BKP-02 Done | **Waiting for human** | White/Black state machine, Maia turn, SAN/time/ID contract |
| 4 | BKP-04 — persist live games in My Studies | BKP-03 Done | **Waiting for human** | Stable study, PGN upsert on every committed turn, UI freshness |

### BKP-01 — manually managed lifecycle and status service

**Status: Waiting for human.** Branch: `feature/kindle-play-improvements`; continued 2026-11-10. Owner: Codex implementation / human acceptance. See current run evidence below.

**Current implementation evidence (BKP-01, 2026-11-10):** Preserved and completed the existing uncommitted controller/preload work. Reused the single lifecycle/controller, config/logging, HTTP server, dedicated Maia provider, engine settings and sender authorization; no second listener, settings parser or child manager. The typed bridge is the only service-specific new contract. Replaced controller-local timestamps with authoritative game timestamps so Black openings and persistence failures report correctly. Stop cancels pending provider work before closing connections, retains committed sessions across Start/Stop and closes the dedicated child on quit. Existing lifecycle tests cover boot-disabled legacy configs, malformed bytes, duplicate actions, bind recovery, pending-turn rollback, restart, authorization and shutdown. Shared commands/results and implementation SHA are recorded above.

1. **Extend** electron/kindle-play-lifecycle.mjs and its existing config validation, listener, Maia-provider and logging helpers into a single controller (one listener per Electron process) whose game/session state can outlive an individual listener. Do not introduce a second independent server implementation. Remove the unconditional startup invocation from electron/main.mjs. Existing kindle-play-server.json host/port remain supported as bind preferences; an old enabled:true **must not silently auto-start**. Default listener is stopped each app launch; manual Start is the only activation. Do not delete or rewrite an existing config, including malformed/future bytes.
2. Add narrowly scoped, sender-authorized IPC methods for status/start/stop in main and a frozen typed preload API. Status should distinguish stopped / starting / listening / stopping / error, show configured bind host/port and actual listener address, Maia configured/available vs currently thinking vs idle, current game status/result, rating, playerColor, ply, lastMoveAt. Initial game is none. Never expose engine paths, checkpoint secrets or raw exceptions to the renderer. Status update can use bounded polling on active Maia tab or an IPC event subscription with teardown.
3. Start is idempotent and detects port conflicts; Stop closes sockets, stops the Maia child, blocks new requests and resolves any in-flight request without publishing a half-turn. In-process current game may be reused if listener restarts; if that is infeasible, explicitly test/document the reset and rely on My Studies persistence. App quit always closes children/listener. Keep LAN security notice (bind to 0.0.0.0 only on trusted private Wi-Fi; no TLS/auth).
4. Tests first: disabled-at-boot even with legacy enabled:true; start/stop/restart, duplicate clicks, bind failure and recovery, missing Maia, current/idle/status timestamps, stop while provider pending, no running socket after quit, no regression in old HTTP behavior.

**Implementation evidence (2026-11-09, `codex/bkp-01`, uncommitted):**
- Reused the existing lifecycle config validator/logging, HTTP server, `KindlePlayGame`, dedicated `KindlePlayMaia`, engine settings getter, sender authorization and frozen preload conventions. Extended the lifecycle module with the controller and IPC registration; no extraction, new runtime module, second listener stack, or UI component was needed. Added only a TypeScript bridge contract in `src/kindle-play-types.ts`. Workspace/shared styles require no changes for this service-only task.
- Manual Start/Stop/status; legacy `enabled:true` stays stopped at boot. Bind errors are sanitized and retryable; existing config bytes are preserved. Listener restart retains the same game and last committed move timestamp. Stop cancels provider work before socket shutdown, preserving the committed turn; quit closes the dedicated child/listener.
- Test-first: lifecycle tests initially failed on the missing controller export; a startup/Stop/restart test then exposed duplicate provider close, corrected before the final focused run.
- Focused command: `node --test tests/kindle-play-lifecycle.test.mjs tests/kindle-play-http.test.mjs` ? **15 passed, 0 failed**. Includes IPC authorization/preload contract, boot defaults, bind recovery, concurrent controls, pending-provider cancellation, timestamps, quit sockets and existing HTTP behavior; fake UCI only, no live Maia/device claim.
- Updated the existing desktop smoke harness for manual IPC Start/Stop/restart; **not run here**. Full suites, builds, desktop smoke and deployment were intentionally left to the wrapper. Automated acceptance and human verification remain pending; task stays **In progress**. No commit, merge or push.

**Verification repair (2026-11-09):** The wrapper stopped in `tests/desktop-smoke.mjs` at the existing Back-to-games focus assertion, before the Kindle smoke. Reused the smoke harness's native Electron input pattern for that Back button instead of a programmatic DOM click; retained the focus, page and scroll assertions. No application change, extraction or new component. Focused run: `node scripts/start-electron.mjs tests/desktop-smoke.mjs --no-sandbox --disable-gpu` passed. The default launch failed locally during GPU initialization; a GPU-only workaround timed out. No full suite/build/deployment rerun. Wrapper re-verification and human acceptance remain pending; status remains **In progress**.

**Automated acceptance:** focused lifecycle/IPC tests, npm test, npm run build; run GUI smoke if impacted. **Human verification (last step):** with Electron running, Start exposes health at the configured LAN address, Stop immediately prevents new connections, restarting service works, and a fresh Electron launch does not start automatically. Record observed outcome; then ask owner to accept.

### BKP-02 — new Maia workspace tab

**Status: Waiting for human.** Branch: `feature/kindle-play-improvements`; started 2026-11-10. Owner: Codex implementation / human acceptance.

**Implementation evidence (BKP-02, 2026-11-10):** Reused `WorkspaceRoot` navigation, lazy panes, scroll/focus restoration, existing studies leave guard, workspace/button styles and the frozen authorized preload bridge. Added only `MaiaWorkspace.tsx` for the new pane; no second shell or polling dependency. Status polling is bounded, sequential and torn down when hidden. Controls show listener transitions/errors, actual address, trusted-LAN notice, engine availability/activity, retained sessions, side/rating/ply/result and committed move time. Existing persisted Games/Openings preference behavior is preserved. The existing Kindle desktop harness covers actual controller Start/Stop and study freshness plus mocked IPC error/thinking states, escaped text and polling teardown. Scoped the engine smoke's existing button helper to review controls to distinguish the new Maia tab from its engine toggle. No shared extraction was necessary.

1. Extend the **existing** src/WorkspaceRoot.tsx navigation and pane abstractions with the fourth, last tab **Maia**, after Games, Openings, My Studies. Reuse existing workspace CSS and shared button/status/error styles instead of building a second shell. Keep existing tab selection, scroll/focus restoration, lazy mounting and My Studies unsaved-draft leave guard; do not change the older tabs' content or saved workspace preference behavior. A new src/MaiaWorkspace.tsx is appropriate; add a typed API interface.
2. Show a clear stopped/listening/error state, Start/Stop with pending feedback and safely rendered errors; Maia availability/idle/thinking; game none/playing/finished, human color and Elo, ply, last committed move date/time (or Never). Show actual bind address and concise trusted-LAN warning. If server stopped but a session exists, label it clearly rather than claiming the Kindle is connected. Disable ambiguous duplicate actions; ensure readable keyboard/focus states.
3. Use IPC controller status, not direct network calls from renderer. Refresh status when tab is opened and while visible; clear polls/listeners when hidden/unmounted. Include representative UI smoke assertions with mock IPC and a real-controller integration case, no Maia model required.

**Automated acceptance:** new nav/UI tests, npm test, npm run build, npm run test:desktop when GUI available. **Human verification (last step):** click through all four tabs, Start and Stop from Maia, verify ongoing-game/last-move display and errors; ensure My Studies dirty-editor warning still works. Owner approval gates Done.

### BKP-03 — color-neutral game flow, engine turn and SAN history

**Status: Waiting for human.** Branch: `feature/kindle-play-improvements`; started 2026-11-10. Owner: Codex implementation / human acceptance.

**Implementation evidence (BKP-03, 2026-11-10):** Reused `KindlePlayGame`, chessops legal moves/FEN/SAN, `terminalResult`, existing HTTP validation/routes and the dedicated Maia/UCI process. Extracted private candidate-play, engine-reply and commit helpers inside the existing game class to share both-color logic; no new rules/state-machine module. Added injected clock/ID generation, stable metadata, SAN per ply, color-aware resignation and atomic asynchronous White Maia openings. The first focused improvement tests failed against the old White-only behavior before implementation. Game/HTTP fixtures cover legacy and explicit White, Black opening/turns, validation, busy isolation, 422/409/503/504 rollback, failed replacement, both-color mate, SAN castling/en passant and unchanged timestamps on failures/GET/resign; existing promotion/draw tests remain. Fake UCI also verifies a real White-opening subprocess, without a live model claim.

1. Implement the above wire contract in electron/kindle-play-{game,http,maia}.mjs. Keep a White-default request for old clients. Generalize engine position validation from Black-only to side-to-move; don't share UCI analysis process. For human Black, ask Maia for the opening White move before committing 201. For both colors, accept only the human's turn and produce legal SAN via chessops alongside standard UCI.
2. Make gameId/startedAt/lastMoveAt stable and testable via injected clock/ID generators; update the Maia tab status after successful creation, moves, resign and failure. Preserve atomicity under engine timeout, bad bestmove, stale ply, duplicate requests and concurrent Start/Stop.
3. Change resignation result by human side. Support legal promotion, castling, en passant, mate/draw and terminal *human* moves with no unnecessary engine reply. Ensure fullmove/turn FEN is correct after Black or White move; a Black game can be odd ply while playing.
4. Add HTTP fixtures: legacy POST with rating only, explicit White, explicit Black 201 with one Maia White move, valid Black reply turn, 422/409/503/504 rollback, malformed color, resign from Black, checkmate and timed-out Black opening. No real Maia dependency for unit/HTTP tests.

**Automated acceptance:** focused game/HTTP/Maia tests plus npm test, npm run build and desktop smoke. **Human verification (last step):** test both colors with configured local Maia (curl is enough before Kindle FKP-02), confirm Maia plays White first when human is Black and no duplicate opening move appears after GET. Approve before downstream Kindle task.

### BKP-04 — live My Studies persistence and refresh

**Status: Waiting for human.** Branch: `feature/kindle-play-improvements`; started 2026-11-10. Owner: Codex implementation / human acceptance.

**Implementation evidence (BKP-04, 2026-11-10):** Reused the exact `PersonalStudiesStore` instance owned by `registerPersonalStudies`, its create/update/revision transactions and legal PGN validation, plus the studies list/editor/dirty-draft dialog. Exposed that store only to application-internal main-process composition. New `kindle-play-studies.mjs` is the narrow adapter for Kindle PGN headers and session-to-study revision tracking; persistence had no existing Kindle-specific home. No second database/connection owner, renderer writes or archive changes. The existing game commit helper writes synchronously before publication, so storage/conflict/engine failures leave both prior snapshots intact. Added `kindle-play` provenance without schema migration. Reused list refresh on activation and bounded visible polling; newer revisions offer guarded reload and retain dirty drafts. Temporary-SQLite checks cover ply-zero saves, Black openings, stable study IDs/revisions, legal PGN replay/metadata, restart, unrelated-study preservation, create/update storage failure, user edits/deletion, search failures, mate/draw/resign results; the real-controller desktop smoke covers shared-store IPC and safe draft reload.

1. Reuse the **existing, application-owned PersonalStudiesStore instance/service** and the **same** personal-studies.sqlite3 file used by My Studies; coordinate ownership with electron/personal-studies.mjs rather than opening a parallel store. No second DB or archive writes. Create **one** stable study when each game is successfully started, including ply 0 for human White and Maia's initial White move for human Black. Use gameId to retain the same study ID through moves/resign. Do not overwrite other studies, or create a study after a failed game start.
2. Generate strict legal single-game SAN PGN from the committed complete UCI history, with headers Date (YYYY.MM.DD), Event (Kindle vs Maia), White/Black appropriately named, WhiteElo or BlackElo for Maia rating, Result (* until finished, then 1-0/0-1/1/2-1/2), plus a stable app/game identifier (e.g. custom header) and an identifiable source tag. Choose a clear title with creation date/time, Maia strength and human color. Extend allowed origin_kind with a Kindle-specific source if needed, and update types/tests without a destructive migration. Validate via existing validatePgn; no incomplete transaction or invalid PGN.
3. On **each successful published state** (the human move plus Maia reply, or a terminal human move) and on resign, update exactly the same study and increment revision; don't defer until game end. Use the store's expectedRevision for conflict protection. If disk full, storage invalid, study deleted, or user-edited revision conflicts, **never silently overwrite** it: return an actionable STORAGE_UNAVAILABLE/STUDY_CONFLICT error and leave active game snapshot at prior committed state, or document/test an equally safe, explicitly reconciled persistence protocol. In particular, a failed Maia reply must leave study + in-memory state unchanged. Write/validate before responding success and before advancing the authoritative visible state.
4. My Studies must display saved games after leaving the Kindle, after Electron restart and when switching from Maia tab. Refresh list on workspace reactivation; when the active study is open, offer safe reload of externally updated revision without discarding dirty edits. No background overwriting a human's draft; duplicate/manual copy is allowed. Add concise source/in-progress labelling.
5. Tests first with temporary SQLite: start, successive turn revisions, Black opening move, no duplicate studies, resign/mate/draw correct tags, real PGN replay and metadata, storage failure, expectedRevision conflict, failed Maia calculation and restart persistence. Exercise existing personal studies create/edit/delete/backup and desktop smoke regressions.

**Automated acceptance:** focused persistence and studies interop tests, npm test, npm run build, npm run test:desktop. **Human verification (last step):** start a game, make 2+ moves, leave Kindle, open My Studies and inspect up-to-date PGN, Elo, date and side; play another move and refresh; restart Electron and confirm saved incomplete game remains; resign and inspect final Result. Explicit human approval gates Done.

## Completion and cross-repo release

The desktop is accepted only when BKP-01..04 are Done with recorded human evidence. Then implement Kindle FKP-02 (color) and FKP-03 (clickable SAN history) against this contract; FKP-01 close icon can be developed independently. Perform the last end-to-end human verification in [the Kindle companion plan](https://github.com/abavelski/kindle-chess-puzzles/blob/main/docs/KINDLE_PLAY_IMPROVEMENTS.md). Until that observation, label cross-device success **not verified**.

Codex task prompt: “Read docs/tasks/kindle-play-server/IMPROVEMENTS_PLAN.md; implement only the first Ready BKP task, tests first, update status + evidence in both places, and stop at Waiting for human. Do not start the next task without human acceptance.”
