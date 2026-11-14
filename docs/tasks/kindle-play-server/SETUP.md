# Kindle play server setup

The server runs inside the existing Electron desktop app and is **off by default**.
Open the **Maia** workspace tab (after My Studies) to Start/Stop the listener and
inspect the bind address, engine state, human side, rating and last committed move.
The human can play White or Black. The active HTTP session is in memory, but every
successful start, committed turn and resignation is saved as one game in My Studies.
Restarting Electron loses the active session; the saved study remains. Finished
sessions remain readable until a new game replaces them.

Install and configure local Maia 3 79M using [local engine setup](../local-engine-review/SETUP.md).
The server uses exactly the desktop's engine profile: user-data `engines.json`,
with `.local-engines/engines.json` as an unpackaged development fallback.
Desktop engine configuration changes apply on the next play request. The play
process is separate from review analysis. No models are downloaded by this API.

Optional bind preferences go in `kindle-play-server.json` in Electron's user-data directory:

```json
{"enabled":true,"host":"0.0.0.0","port":8765}
```

Typical user-data locations (the application name is `chess-books-explorer`):

- Windows: `%APPDATA%\chess-books-explorer`
- macOS: `~/Library/Application Support/chess-books-explorer`
- Linux: `${XDG_CONFIG_HOME:-~/.config}/chess-books-explorer`

Use `127.0.0.1` for local testing. Host must be an IPv4/IPv6 address; port must
be an integer from 1 to 65535. Host and port default to `127.0.0.1:8765` when
omitted, or when the file is missing. The legacy `enabled` field remains accepted
but no longer activates the listener. Every app launch starts stopped; existing
config files are never rewritten. Malformed or future config fields prevent Start
until corrected.

The Maia workspace uses authorized desktop preload methods `window.kindlePlay.start()`,
`stop()` and `status()` (all return a status promise). Start must be invoked manually. Stop closes
connections and cancels pending turns, preserving the last committed in-memory
game for a later Start. Quitting Electron still loses that in-memory game.

There is no authentication or TLS. Use only a trusted home LAN: no public Wi-Fi,
router port forwarding, or internet exposure. If the firewall prompts, allow the
desktop app only on your private/home network. No firewall changes are automatic.
The server exposes neither files nor engine configuration.

Find the desktop's LAN IPv4 address with `ipconfig` (Windows), network settings
(macOS), or `ip -4 addr` (Linux). Choose the Wi-Fi/Ethernet adapter used by the
Kindle, for example `192.168.1.25`; do not use `0.0.0.0` as a client destination.
Both devices must be on the same trusted network, without guest/client isolation.

With the desktop running and its listener manually started, execute these in order (use `curl.exe` on Windows
PowerShell to avoid its legacy `curl` alias). Examples use localhost; replace it
with the desktop LAN IP when calling from another device:

```sh
curl http://127.0.0.1:8765/api/v1/health
curl -H 'Content-Type: application/json' -d '{"rating":1500}' http://127.0.0.1:8765/api/v1/games
curl -H 'Content-Type: application/json' -d '{"uci":"e2e4","expectedPly":0}' --max-time 195 http://127.0.0.1:8765/api/v1/games/current/moves
curl http://127.0.0.1:8765/api/v1/games/current
curl -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:8765/api/v1/games/current/resign
```

For PowerShell versions with native argument quoting issues, use an input file:

```powershell
'{"rating":1500}' | Set-Content -Encoding ascii $env:TEMP/kindle-game.json
curl.exe -H 'Content-Type: application/json' --data-binary "@$env:TEMP/kindle-game.json" http://127.0.0.1:8765/api/v1/games
```

`health` checks configuration/files without loading Maia. It can return
`maiaAvailable:false`; games can be created, but a move needing Maia returns 503
and leaves the previous board and saved study intact. Black game creation needs a
Maia White opening move and returns no new game or study if the engine fails. The first move can take time to load the
model. The engine deadline is 180 seconds including startup; clients should allow
about 195 seconds, use a background worker, and display a thinking state.
After a timeout or lost response, **GET current state before retrying**. The move
may already have committed; compare `ply` and `moves`. Always send `expectedPly`.
GET during thinking returns the last complete state; concurrent mutations return
409 BUSY. The Kindle must render only confirmed states.

Startup, bound address, bind/config errors and engine failures appear in desktop
console output and user-data `logs/kindle-play-server.log` (bounded current and
previous log). If local health fails, inspect that log, check enabled/host/port,
restart, and check whether another process owns the port. If health works locally
but not remotely, check LAN IP, private-network firewall allowance and guest
isolation. For 503, check Python/checkpoint paths and the Maia installation;
file existence alone cannot prove that Python can load the model. After 504,
refresh and retry; the failed engine process is discarded automatically.

Packaging already includes `electron/**/*` and unpacks `maia_bridge.py`; local
models and machine-specific settings remain external. Listener control is available only through authorized local Electron IPC.

For repeatable local acceptance, run `npm run test:kindle:local` (or
`npm.cmd run test:kindle:local` on Windows). This starts the real Electron entry
point with an isolated temporary user-data directory and opt-in localhost
configuration, uses the development Maia profile, calls all routes with curl,
plays three move pairs at each of ratings 700 and 2300, checks every FEN and
observes child/listener cleanup on quit. It does not change your normal desktop
profile. `npm run test:desktop` includes the same flow with a fake UCI opponent.
Neither command proves reachability from a different LAN device; perform that
check separately using the desktop LAN address and the curl sequence above.

## Additive v1 extension

`POST /api/v1/games` accepts `{"rating":1500,"playerColor":"black"}` (allow
195 seconds for Maia to play White first). Omit `playerColor` for legacy White
play. Only lowercase `white` and `black` are accepted. For Black, the 201 state
already contains one White move, `ply:1`, and Black-to-move FEN. GET never makes
another opening move. Send the returned ply as `expectedPly` on the human move.

All game states retain the MVP fields and add `sanMoves`, `gameId`, `startedAt`,
and `lastMoveAt`. SAN and UCI arrays have exactly one entry per ply. IDs and start
times stay fixed; last-move time changes only on successful moves, including a
Black game's opening, never on GET, failed requests, or resignation. Human
resignation awards the win to the opposite color. The frozen MVP README describes
the historical baseline; this section and the improvements plan describe additions.

Saved studies have Kindle Play provenance, an In progress/Finished tag, legal SAN
PGN, side-appropriate Maia Elo, creation date, result and a KindleGameId header.
My Studies refreshes while visible and on reactivation. New saved revisions offer
**Reload saved revision**; the existing unsaved-changes dialog protects drafts.
Editing or deleting the live game's saved study causes `409 STUDY_CONFLICT` on the
next commit and leaves the game at its prior snapshot. Preserve/duplicate edits,
then restart Electron to start another session. Disk/storage problems return
`503 STORAGE_UNAVAILABLE`; correct the problem and retry after GET reconciliation.
Engine failures never advance the saved study. Stop/Start retains the current
session; neither action resumes a session after a full Electron restart.
