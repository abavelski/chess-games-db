# Kindle vs Maia — desktop HTTP server MVP

Status: **Done**. Implementation, local acceptance and user-confirmed LAN verification complete. Updated: 2026-11-09 (plan: 2026-11-08).
Repository: `abavelski/chess-games-db`; default branch **master**.
Goal: expose a tiny, opt-in LAN HTTP server from the **existing Electron desktop application**, using its configured local **Maia 3 79M** installation as a playing opponent. Independent implementation plan; no Kindle repo checkout needed.

## Existing code to reuse / boundaries

- `electron/main.mjs`: Electron lifecycle. Start/stop the optional server here and close it on quit. This is **not** an external hosted service.
- `electron/engine-ipc.mjs`: existing engine settings loading from `app.getPath('userData')/engines.json`, with development fallback `.local-engines/engines.json`. Extract a small reusable loader if needed; do not maintain two diverging Maia configurations.
- `electron/engines.mjs`: `UciProcess` handles process startup/stop, UCI handshakes, timeouts, and offline Python environment; the Maia adapter uses `setoption name Elo value <rating>` + `position fen <initial FEN> moves ...` + `go nodes 1`. Reuse its process layer, **not** the UI-analysis `EngineManager.analyze` result events: that method does not return a bestmove and its latest-request cancellation is shared with UI analysis. Keep the play engine process/session independent of analysis, with serialized requests.
- `electron/maia_bridge.py`: already produces `bestmove` in normal UCI format and loads only local checkpoints. Do not modify Maia or download models for the API.
- `chessops` already provides legal move validation, position replay, result detection, and FEN serialization. Be careful: chessops may represent castles internally as king-to-rook; convert at the external UCI boundary to standard king-destination moves. Preserve complete move history for Maia's `--use-uci-history` setup.
- `tests/fixtures/fake-playing-maia.mjs` and `tests/engines.test.mjs`: fake UCI process + existing test conventions. Do **not** touch archive database, Electron renderer, Stockfish, or book data.

## Deliberate limitations and server setup

One active **in-memory** game, standard starting position, White human vs Black Maia, chosen rating, request/reply per move, resign. No custom FEN, selectable Black side, multi-device concurrency, PGN export, clock, takebacks, engine evaluations, persistence, or server UI in v1.

Server is **disabled by default**. Read optional `kindle-play-server.json` from Electron `userData` at startup, e.g.:

    {"enabled":true,"host":"0.0.0.0","port":8765}

Only start if explicitly enabled. Validate host/port, log actual bound address, and surface startup/bind/config errors in the desktop logs without crashing normal desktop usage. `127.0.0.1` is for local testing; `0.0.0.0` permits Kindle access from the same trusted Wi-Fi. **MVP has no authentication or TLS: trusted LAN only; no router port forwarding, public Wi-Fi, or internet exposure.** Do not expose filesystem or engine configuration on the HTTP routes. Normal desktop engine setup is still required; `/health` reports `maiaAvailable:false` if paths/checkpoint are not configured.

## Frozen MVP HTTP contract (copy held in this repository)

**Implement this contract exactly; do not require the other repository at build/test time.** The desktop is the authoritative chess rules engine and position store. The Kindle is a thin HTTP client. HTTP/1.1, UTF-8 JSON, `Content-Type: application/json`, base URL `http://<desktop-LAN-IP>:8765` (configurable host/port). Routes use the exact spelling below. One active game maximum, one human player **White**, Maia plays **Black**. A game is held **in memory** on the desktop; there is no database, authentication, multiplayer, or persistence in v1. The currently finished game remains readable until a new one is started.

| Method | Route | Request | Success |
| --- | --- | --- | --- |
| GET | `/api/v1/health` | none | 200 `{"apiVersion":1,"maiaAvailable":true}` (availability may be false) |
| POST | `/api/v1/games` | `{"rating":1500}` | 201 game state; replaces a **finished** game only; 409 if one is playing |
| GET | `/api/v1/games/current` | none | 200 game state; 404 `NO_GAME` if no game |
| POST | `/api/v1/games/current/moves` | `{"uci":"e2e4","expectedPly":0}` | 200 game state **after** human move and Maia reply, unless human move ended game |
| POST | `/api/v1/games/current/resign` | `{}` | 200 finished state (White resigns, Black wins) |

- Only integer ratings **600, 700, ..., 2600** are accepted (same range/steps as the desktop Maia selector); default UI choice 1500. Unsupported values: 400 `BAD_REQUEST`.
- Game state is the same JSON shape in every successful game response:

    {
      "apiVersion": 1,
      "rating": 1500,
      "playerColor": "white",
      "fen": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      "moves": [],
      "ply": 0,
      "status": "playing",
      "result": null,
      "lastMove": null
    }

- `fen` is a complete six-field FEN for the authoritative current position. `moves` is the whole ordered, standard-UCI move history from the initial chess position; `ply === moves.length`; `lastMove` is the last UCI move or null. Use normal king-destination castle moves (e.g. `e1g1`, **not** king-to-rook), promotions `e7e8q`/`r`/`b`/`n`. `status` is `playing` or `finished`. When finished, `result` is `{"outcome":"white_win"|"black_win"|"draw","reason":"checkmate"|"stalemate"|"draw"|"resignation"}` with actual scalar strings; when playing it is null. The API does not expose pending Black-to-move half-states.
- **Move transaction:** reject malformed UCI (400), illegal human move (422 `ILLEGAL_MOVE`), wrong `expectedPly` (409 `STALE_PLY`), finished game (409 `GAME_FINISHED`), or another ongoing request (409 `BUSY`). The server verifies the move against chess rules, tentatively applies it, checks game end, otherwise gets exactly one Maia `bestmove`, verifies/applies the legal reply, and only then atomically publishes the resulting state. On Maia failure/timeout (503 `ENGINE_UNAVAILABLE` or 504 `ENGINE_TIMEOUT`), **leave the prior game state unchanged**.
- Each error returns `{"error":{"code":"CODE","message":"Readable explanation"}}`; game-specific errors **also** include a top-level `"state"` holding the unchanged/current authoritative game state, if one exists. Reject oversize requests (max 4 KiB JSON), unsupported methods and unknown routes with appropriate HTTP errors. No CORS is needed.
- A delayed/lost POST response is ambiguous to the client. **Before retrying a timed-out move, GET current state**; inspect `ply`/`moves` to decide if it committed. `expectedPly` makes an accidental repeat a conflict instead of a second move. Kindle must never locally commit a move before server confirmation.
- GET/POST are synchronous request-response APIs, **not** streaming or polling for Maia completion. Each move POST waits for Maia; the client must use a background worker, a visible "Maia thinking" state and a sufficiently long timeout for cold model loading (e.g. ~195 s, with desktop engine deadline shorter). No move requests while one is pending.
- Game completion: finish on checkmate, stalemate, applicable automatic draws, or explicit resignation. There is no pause/resume protocol: GET current lets the Kindle reconnect while the same desktop process runs; desktop restart loses the in-memory game. One game per server process at a time is sufficient for MVP.

### Contract checks both repositories must pass

1. Start rating 1500 → standard starting FEN, `ply=0`, White; GET returns identical state.
2. Legal `e2e4` at `expectedPly=0` → 200, server supplies one **legal Maia** Black move, `ply=2`, complete updated FEN and history.
3. Illegal `e2e5` → 422, board/history/ply unchanged; stale `expectedPly` → 409, never creates a duplicate move.
4. Missing server, Maia unavailable, timeout or disconnect → readable error, no optimistic Kindle board change; reconnect via GET.
5. Resign → `finished` with `black_win` / `resignation`; reject further moves; a new game may replace finished one.
6. Promotion and castling UCI/FEN handling are standard and verified with focused tests even if reaching them through a full on-device match is unlikely.

## Desktop implementation checklist (task tracker)

| Task | Depends on | Status | Deliverable |
| --- | --- | --- | --- |
| SERVER-01 | — | Done | Pure game state / chess legality module + focused tests |
| SERVER-02 | SERVER-01 | Done | Independent Maia move provider using existing UCI process |
| SERVER-03 | SERVER-01, SERVER-02 | Done | HTTP router with the frozen contract and integration tests |
| SERVER-04 | SERVER-03 | Done | Opt-in Electron lifecycle/configuration and setup instructions |
| SERVER-05 | SERVER-04 | Done | Automated, real Maia, desktop and user-confirmed LAN acceptance complete |

### SERVER-01 — authoritative in-memory chess game

Status: **Done**. Verified: `node --test tests/kindle-play-game.test.mjs` (4 passing tests), 2026-11-09.

- Add a small module, proposed `electron/kindle-play-game.mjs`, with new game, current snapshot, validate/apply tentative White UCI, apply legal engine UCI, terminal result, and resign. Use `chessops`; never blindly apply a UCI string.
- Rating schema: integer 600..2600 inclusive, multiples of 100, defaults to client-selected 1500. Use server-enforced bounds. Reject starting a new game while one is playing; a finished one may be replaced.
- Publish immutable/snapshot-shaped JSON, six-field FEN, full UCI move history, lastMove and ply. Get/check terminal states after either side's move. Server owns state; client sends no FEN or history.
- Atomicity: a failed Maia calculation cannot leave the accepted human half-move committed. Test start, move legality, ply conflict, terminal state, resign, castling, promotion, and failed engine rollback. Handle all valid chess rules; draw classification can use the library's existing automatic end detection.

### SERVER-02 — dedicated Maia opponent

Status: **Done**. Verified: `node --test tests/kindle-play-maia.test.mjs` (4 passing tests), 2026-11-09.

- Proposed module `electron/kindle-play-maia.mjs`: reuses `UciProcess`, `engineDefaults`/`validateSettings`, the configured local Python + checkpoint, and existing offline bridge. **Do not share the analysis manager's session or cancellation queue** with the server.
- Lazily start one Maia child, send `setoption name Elo value N` before each request, full initial position and UCI move history, then `go nodes 1`. Wait for `bestmove`, sanitize and check legality. Stop on app quit; recover from process crashes/timeouts by discarding that process and allowing retry on unchanged board. Do not fall back to Stockfish or an arbitrary random move.
- Serialize one engine search at a time, bound cold startup/search (existing UCI process has 180 s behavior), and make a deterministic injected fake UCI fixture test the exact commands, selected rating, history, castling normalization, cleanup, and no UI-analysis interference.

### SERVER-03 — HTTP adapter / contract tests

Status: **Done**. Verified: `node --test tests/kindle-play-http.test.mjs` (6 passing tests), including a real fake-UCI subprocess over HTTP, lost-response recovery and human checkmate, 2026-11-09.

- Proposed module `electron/kindle-play-http.mjs`, using Node's built-in `node:http`; no Express/framework required. Keep business logic independently testable without Electron.
- Implement the five routes and exact JSON response/status/error fields above, 4 KiB request limit, method and JSON checks, no CORS, `Cache-Control: no-store`; reject malformed/unexpected bodies, invalid paths and extra moves while BUSY. `/health` does not start/warm Maia.
- Endpoint tests over ephemeral localhost port + fake move provider, especially 201/200/400/404/409/422/503/504, GET-after-rejected-move, duplicate/stale requests, Maia timeout rollback, and resign/new-game behavior. Assert output FEN/history rather than just status codes.

### SERVER-04 — Electron integration and operational guidance

Status: **Done**. Verified: `node --test tests/kindle-play-lifecycle.test.mjs` (3 passing tests), 2026-11-09. Operational instructions: [SETUP.md](SETUP.md). Packaging already covers the new modules.

- Wire server start in `electron/main.mjs` when ready and shutdown in `will-quit`. Reuse settings loader from `engine-ipc.mjs` or factor it into a shared module. No privileged APIs exposed to the renderer.
- Document desktop user-data config location, how to find the desktop LAN IP, firewall allowance only for trusted home LAN, the existing `docs/tasks/local-engine-review/SETUP.md` Maia installation, and quick `curl` tests. Default off, missing Maia behavior, desktop quit/restart behavior, and how to troubleshoot errors are explicit.
- Keep normal Electron UX, analysis engine and database imports completely unchanged with the server disabled. Check packaging: new `electron/*.mjs` modules are already covered by `package.json` build files.

### SERVER-05 — verification and handoff

Status: **Done**. All automated, graphical desktop and real local Maia checks passed on 2026-11-09. The user subsequently confirmed that LAN verification was complete and working, satisfying the remaining human acceptance check.

- Run focused tests, `npm test`, `npm run build`; run `npm run test:desktop` in an available graphical environment. With a configured real local Maia installation, start server explicitly and use `curl` to play several legal moves at two ratings; verify process cleanup, invalid move rejection and FEN against chessops.
- Confirm calls from a **different LAN device**, not only localhost. Do not report this as tested until observed.
- Record exact commands/results and any remaining limitations in this file. Update **both** tracker table and detailed task statuses as tasks are completed. If no real Maia/model/device is present, mark the human checks `Waiting for device`, not Done.

### Verification record — 2026-11-09

All changes are on `feature/kindle-play-server`, with one commit per implementation task and a verification/handoff commit. Normal desktop settings were not modified; desktop smoke tests use temporary isolated profiles, deleted after Electron exits. The server remains disabled in normal desktop launches unless explicitly configured.

| Command | Observed result |
| --- | --- |
| `node --test tests/kindle-play-*.test.mjs` | 17 passed, 0 failed: game, independent subprocess, HTTP, settings and lifecycle |
| `npm.cmd test` | 157 Node tests passed; archive suite: 94 passed, 5 skipped, 0 failed |
| `npm.cmd run build` | Passed TypeScript and Vite production build; dependency Sass import deprecation warnings remain |
| `npm.cmd run test:desktop` | Passed all 14 graphical Electron smoke scripts, including new Kindle curl/fake-UCI flow and existing archive, review, engines, opening workspace and personal studies checks |
| `npm.cmd run test:kindle:local` | Passed real Electron entry point + installed Python/Maia 3 79M + curl, ratings 700 and 2300, three legal move pairs each; health did not launch an engine; one dedicated process reused; all FENs matched chessops; 422 illegal move and 409 stale ply preserved state; resignation and replacement passed; quit closed listener and observed UCI child exit |
| `git diff --check` | Passed |

PowerShell blocked the `npm.ps1` wrapper, so verification used `npm.cmd` without changing execution policy. Full local output is in ignored `test-results/kindle-tests.log`, `kindle-build.log`, `kindle-desktop.log` and `kindle-real-maia.log`. Existing desktop tests deliberately log some rejected/conflicting operations; their exit status was zero.

Observed real-Maia move histories and final six-field FENs (not fake replies):

```text
700:  e2e4 d7d5 g1f3 d5e4 b1c3 f7f5
rnbqkbnr/ppp1p1pp/8/5p2/4p3/2N2N2/PPPP1PPP/R1BQKB1R w KQkq - 0 4

2300: e2e4 c7c5 g1f3 b8c6 b1c3 d7d6
r1bqkbnr/pp2pppp/2np4/2p5/4P3/2N2N2/PPPP1PPP/R1BQKB1R w KQkq - 0 4
```

Focused checks cover standard king-destination castling (including conversion from engine king-to-rook output), all four promotions, en passant, checkmate after either side, stalemate, insufficient material, automatic fivefold repetition and 75-move draws. Failure tests cover missing configuration, startup/search timeouts, crashes, illegal bestmove, rollback, BUSY isolation, exact request bodies, fixed/chunked oversize uploads, lost POST response recovery by GET, and stale retry rejection. Health exposes no settings and does not warm Maia.

**Human LAN acceptance — complete, 2026-11-09:** at the user's request, enabled the normal desktop's server on `0.0.0.0:8765` and started Electron. Localhost and desktop-LAN-address health requests both returned `{"apiVersion":1,"maiaAvailable":true}`. Supplied client base URL `http://192.168.1.15:8765`, API prefix `/api/v1`, JSON request content type and 195-second move timeout. The user then reported: "verification is done, works fine" and authorized committing, merging to master and pushing. This records user-confirmed remote acceptance; the device model and individual remote HTTP responses were not supplied. No firewall rule was created by this work. The desktop remains running with its opt-in user-data config; see [SETUP.md](SETUP.md) to disable it.

## Done when

An agent can implement and verify the server entirely in this repo with a fake Maia. Once the actual local Maia and trusted LAN are available, another device can GET health, start an Elo-rated game, send a legal UCI move, receive a **legal Maia Black reply and authoritative FEN**, reject illegal or duplicated moves without corrupting the board, and resign. Desktop analysis and user data still work without the server enabled.
