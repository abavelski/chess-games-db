# Kindle play server setup

The server runs inside the existing Electron desktop app and is **off by default**.
It keeps one game in memory: human White, Maia Black. Closing/restarting the desktop
loses the game. Finished games remain readable until a new game replaces them.

Install and configure local Maia 3 79M using [local engine setup](../local-engine-review/SETUP.md).
The server uses exactly the desktop's engine profile: user-data `engines.json`,
with `.local-engines/engines.json` as an unpackaged development fallback.
Desktop engine configuration changes apply on the next play request. The play
process is separate from review analysis. No models are downloaded by this API.

Create `kindle-play-server.json` in Electron's user-data directory, then restart:

```json
{"enabled":true,"host":"0.0.0.0","port":8765}
```

Typical user-data locations (the application name is `chess-books-explorer`):

- Windows: `%APPDATA%\chess-books-explorer`
- macOS: `~/Library/Application Support/chess-books-explorer`
- Linux: `${XDG_CONFIG_HOME:-~/.config}/chess-books-explorer`

Use `127.0.0.1` for local testing. Host must be an IPv4/IPv6 address; port must
be an integer from 1 to 65535. Host and port default to `127.0.0.1:8765` when
omitted. Remove the file or set `enabled` to `false` and restart to disable.

There is no authentication or TLS. Use only a trusted home LAN: no public Wi-Fi,
router port forwarding, or internet exposure. If the firewall prompts, allow the
desktop app only on your private/home network. No firewall changes are automatic.
The server exposes neither files nor engine configuration.

Find the desktop's LAN IPv4 address with `ipconfig` (Windows), network settings
(macOS), or `ip -4 addr` (Linux). Choose the Wi-Fi/Ethernet adapter used by the
Kindle, for example `192.168.1.25`; do not use `0.0.0.0` as a client destination.
Both devices must be on the same trusted network, without guest/client isolation.

With the desktop running, execute these in order (use `curl.exe` on Windows
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
and leaves the previous board intact. The first move can take time to load the
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
models and machine-specific settings remain external. No renderer API is added.

For repeatable local acceptance, run `npm run test:kindle:local` (or
`npm.cmd run test:kindle:local` on Windows). This starts the real Electron entry
point with an isolated temporary user-data directory and opt-in localhost
configuration, uses the development Maia profile, calls all routes with curl,
plays three move pairs at each of ratings 700 and 2300, checks every FEN and
observes child/listener cleanup on quit. It does not change your normal desktop
profile. `npm run test:desktop` includes the same flow with a fake UCI opponent.
Neither command proves reachability from a different LAN device; perform that
check separately using the desktop LAN address and the curl sequence above.
