# Kindle Play — post-MVP improvements (desktop)

**Planning only — no implementation changes.** Created 2026-11-09. Repository: abavelski/chess-games-db, default integration branch **master**. MVP baseline: [server README](README.md) and [setup](SETUP.md). Companion Kindle plan: [KINDLE_PLAY_IMPROVEMENTS.md](https://github.com/abavelski/kindle-chess-puzzles/blob/main/docs/KINDLE_PLAY_IMPROVEMENTS.md).

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

## Codex execution protocol

Each row below is one independently shippable Codex assignment, ideally one branch/PR. **Use the first Ready task whose dependencies are accepted.** Apply the mandatory reuse-first rule above; list reused/extracted/new components in the task evidence before requesting review. Read this document, relevant modules and existing tests. Set *both* table and task-detail status to In progress with branch/date; write a failing focused test first, implement only that task, pass focused tests plus npm test and npm run build, and (when GUI touched) npm run test:desktop in a graphical environment. Record actual commands/results and commit SHA, avoid claiming device or live Maia checks from mocks. Set **Waiting for human** when automated checks are green; the **last task step is human verification**. Only after the owner explicitly accepts should the two status locations become Done. Do not silently mark the next task Ready until dependencies are accepted. Do not change the owner's existing engine profiles or real studies DB during tests; use temporary profiles/databases.

| Order | Task | Depends on | Initial status | Codex deliverable |
| --- | --- | --- | --- | --- |
| 1 | BKP-01 — manually managed server + status IPC | MVP | **Ready** | Lifecycle controller, listener/engine state, start/stop/status, tests |
| 2 | BKP-02 — Maia desktop workspace tab | BKP-01 Done | Blocked | Four-tab navigation and status/control UI |
| 3 | BKP-03 — play either color + extended game snapshots | BKP-02 Done | Blocked | White/Black state machine, Maia turn, SAN/time/ID contract |
| 4 | BKP-04 — persist live games in My Studies | BKP-03 Done | Blocked | Stable study, PGN upsert on every committed turn, UI freshness |

### BKP-01 — manually managed lifecycle and status service

**Status: Ready.** Owner: Codex implementation / human acceptance. Start when selected.

1. **Extend** electron/kindle-play-lifecycle.mjs and its existing config validation, listener, Maia-provider and logging helpers into a single controller (one listener per Electron process) whose game/session state can outlive an individual listener. Do not introduce a second independent server implementation. Remove the unconditional startup invocation from electron/main.mjs. Existing kindle-play-server.json host/port remain supported as bind preferences; an old enabled:true **must not silently auto-start**. Default listener is stopped each app launch; manual Start is the only activation. Do not delete or rewrite an existing config, including malformed/future bytes.
2. Add narrowly scoped, sender-authorized IPC methods for status/start/stop in main and a frozen typed preload API. Status should distinguish stopped / starting / listening / stopping / error, show configured bind host/port and actual listener address, Maia configured/available vs currently thinking vs idle, current game status/result, rating, playerColor, ply, lastMoveAt. Initial game is none. Never expose engine paths, checkpoint secrets or raw exceptions to the renderer. Status update can use bounded polling on active Maia tab or an IPC event subscription with teardown.
3. Start is idempotent and detects port conflicts; Stop closes sockets, stops the Maia child, blocks new requests and resolves any in-flight request without publishing a half-turn. In-process current game may be reused if listener restarts; if that is infeasible, explicitly test/document the reset and rely on My Studies persistence. App quit always closes children/listener. Keep LAN security notice (bind to 0.0.0.0 only on trusted private Wi-Fi; no TLS/auth).
4. Tests first: disabled-at-boot even with legacy enabled:true; start/stop/restart, duplicate clicks, bind failure and recovery, missing Maia, current/idle/status timestamps, stop while provider pending, no running socket after quit, no regression in old HTTP behavior.

**Automated acceptance:** focused lifecycle/IPC tests, npm test, npm run build; run GUI smoke if impacted. **Human verification (last step):** with Electron running, Start exposes health at the configured LAN address, Stop immediately prevents new connections, restarting service works, and a fresh Electron launch does not start automatically. Record observed outcome; then ask owner to accept.

### BKP-02 — new Maia workspace tab

**Status: Blocked (BKP-01).** Owner: Codex implementation / human acceptance.

1. Extend the **existing** src/WorkspaceRoot.tsx navigation and pane abstractions with the fourth, last tab **Maia**, after Games, Openings, My Studies. Reuse existing workspace CSS and shared button/status/error styles instead of building a second shell. Keep existing tab selection, scroll/focus restoration, lazy mounting and My Studies unsaved-draft leave guard; do not change the older tabs' content or saved workspace preference behavior. A new src/MaiaWorkspace.tsx is appropriate; add a typed API interface.
2. Show a clear stopped/listening/error state, Start/Stop with pending feedback and safely rendered errors; Maia availability/idle/thinking; game none/playing/finished, human color and Elo, ply, last committed move date/time (or Never). Show actual bind address and concise trusted-LAN warning. If server stopped but a session exists, label it clearly rather than claiming the Kindle is connected. Disable ambiguous duplicate actions; ensure readable keyboard/focus states.
3. Use IPC controller status, not direct network calls from renderer. Refresh status when tab is opened and while visible; clear polls/listeners when hidden/unmounted. Include representative UI smoke assertions with mock IPC and a real-controller integration case, no Maia model required.

**Automated acceptance:** new nav/UI tests, npm test, npm run build, npm run test:desktop when GUI available. **Human verification (last step):** click through all four tabs, Start and Stop from Maia, verify ongoing-game/last-move display and errors; ensure My Studies dirty-editor warning still works. Owner approval gates Done.

### BKP-03 — color-neutral game flow, engine turn and SAN history

**Status: Blocked (BKP-02).** Owner: Codex implementation / human acceptance.

1. Implement the above wire contract in electron/kindle-play-{game,http,maia}.mjs. Keep a White-default request for old clients. Generalize engine position validation from Black-only to side-to-move; don't share UCI analysis process. For human Black, ask Maia for the opening White move before committing 201. For both colors, accept only the human's turn and produce legal SAN via chessops alongside standard UCI.
2. Make gameId/startedAt/lastMoveAt stable and testable via injected clock/ID generators; update the Maia tab status after successful creation, moves, resign and failure. Preserve atomicity under engine timeout, bad bestmove, stale ply, duplicate requests and concurrent Start/Stop.
3. Change resignation result by human side. Support legal promotion, castling, en passant, mate/draw and terminal *human* moves with no unnecessary engine reply. Ensure fullmove/turn FEN is correct after Black or White move; a Black game can be odd ply while playing.
4. Add HTTP fixtures: legacy POST with rating only, explicit White, explicit Black 201 with one Maia White move, valid Black reply turn, 422/409/503/504 rollback, malformed color, resign from Black, checkmate and timed-out Black opening. No real Maia dependency for unit/HTTP tests.

**Automated acceptance:** focused game/HTTP/Maia tests plus npm test, npm run build and desktop smoke. **Human verification (last step):** test both colors with configured local Maia (curl is enough before Kindle FKP-02), confirm Maia plays White first when human is Black and no duplicate opening move appears after GET. Approve before downstream Kindle task.

### BKP-04 — live My Studies persistence and refresh

**Status: Blocked (BKP-03).** Owner: Codex implementation / human acceptance.

1. Reuse the **existing, application-owned PersonalStudiesStore instance/service** and the **same** personal-studies.sqlite3 file used by My Studies; coordinate ownership with electron/personal-studies.mjs rather than opening a parallel store. No second DB or archive writes. Create **one** stable study when each game is successfully started, including ply 0 for human White and Maia's initial White move for human Black. Use gameId to retain the same study ID through moves/resign. Do not overwrite other studies, or create a study after a failed game start.
2. Generate strict legal single-game SAN PGN from the committed complete UCI history, with headers Date (YYYY.MM.DD), Event (Kindle vs Maia), White/Black appropriately named, WhiteElo or BlackElo for Maia rating, Result (* until finished, then 1-0/0-1/1/2-1/2), plus a stable app/game identifier (e.g. custom header) and an identifiable source tag. Choose a clear title with creation date/time, Maia strength and human color. Extend allowed origin_kind with a Kindle-specific source if needed, and update types/tests without a destructive migration. Validate via existing validatePgn; no incomplete transaction or invalid PGN.
3. On **each successful published state** (the human move plus Maia reply, or a terminal human move) and on resign, update exactly the same study and increment revision; don't defer until game end. Use the store's expectedRevision for conflict protection. If disk full, storage invalid, study deleted, or user-edited revision conflicts, **never silently overwrite** it: return an actionable STORAGE_UNAVAILABLE/STUDY_CONFLICT error and leave active game snapshot at prior committed state, or document/test an equally safe, explicitly reconciled persistence protocol. In particular, a failed Maia reply must leave study + in-memory state unchanged. Write/validate before responding success and before advancing the authoritative visible state.
4. My Studies must display saved games after leaving the Kindle, after Electron restart and when switching from Maia tab. Refresh list on workspace reactivation; when the active study is open, offer safe reload of externally updated revision without discarding dirty edits. No background overwriting a human's draft; duplicate/manual copy is allowed. Add concise source/in-progress labelling.
5. Tests first with temporary SQLite: start, successive turn revisions, Black opening move, no duplicate studies, resign/mate/draw correct tags, real PGN replay and metadata, storage failure, expectedRevision conflict, failed Maia calculation and restart persistence. Exercise existing personal studies create/edit/delete/backup and desktop smoke regressions.

**Automated acceptance:** focused persistence and studies interop tests, npm test, npm run build, npm run test:desktop. **Human verification (last step):** start a game, make 2+ moves, leave Kindle, open My Studies and inspect up-to-date PGN, Elo, date and side; play another move and refresh; restart Electron and confirm saved incomplete game remains; resign and inspect final Result. Explicit human approval gates Done.

## Completion and cross-repo release

The desktop is accepted only when BKP-01..04 are Done with recorded human evidence. Then implement Kindle FKP-02 (color) and FKP-03 (clickable SAN history) against this contract; FKP-01 close icon can be developed independently. Perform the last end-to-end human verification in [the Kindle companion plan](https://github.com/abavelski/kindle-chess-puzzles/blob/main/docs/KINDLE_PLAY_IMPROVEMENTS.md). Until that observation, label cross-device success **not verified**.

Codex task prompt: “Read docs/tasks/kindle-play-server/IMPROVEMENTS_PLAN.md; implement only the first Ready BKP task, tests first, update status + evidence in both places, and stop at Waiting for human. Do not start the next task without human acceptance.”
