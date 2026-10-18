# Verification results

Validated on 2026-10-16 on macOS arm64, Apple M1 Pro, 32 GiB RAM.

## Automated checks

- `npm test`: position/history/branch tests, UCI scores and terminal positions, policy probabilities, process startup/failure/timeout/cancellation, and existing archive/query suites.
- `npm run build`: TypeScript and production bundle.
- `npm run test:desktop`: existing library/opening smoke suites plus local-engine subprocess IPC, independent switches, overlapping arrows, rating changes, clickable lines, missing-engine recovery, setup dialog, clean/free Piece mode, reset, exact review restoration, focus/Escape, variations, custom FENs, and archive byte preservation.
- `npm run test:book-reader`: existing opt-in book-reader coverage retained.
- `CHESS_ENGINE_CONFIG=.local-engines/engines.json npm run test:engines:local`: real Stockfish and Maia in Electron, all HTTP blocked; engine output, device reporting, both arrow layers, evaluation, Piece mode pause/resume, actual mouse input for legal exploratory moves, and unchanged archive.

## Real local models

| Setting / result | Observed |
| --- | --- |
| Stockfish | Full native Stockfish 19, official macOS universal release |
| Stockfish resources | 4 threads, 256 MB hash, 3-second budget, 3 principal variations |
| Position | After `1.e4 e5`; both engines launched concurrently |
| Stockfish completion | 3,168 ms including startup, depth 23, White evaluation +0.18 |
| Maia | Official 79M checkpoint, pinned source/model revisions in SETUP.md |
| Acceleration | Apple MPS; no smaller-model substitution |
| First Maia completion | 1,566 ms including process/model startup |
| Subsequent Maia prediction | 73 ms at rating 1800 after `1.d4 d5` |
| Model SHA-256 | `3fc6181d5db789b45a15305732148757ae74efa3e0028e81ba335b462dac45c2` |
| Process cleanup | Both engine subprocesses exited after manager shutdown |
| Real Electron review | Both engines complete in about 3.4 seconds; legal candidates, correct model/device display, both arrow layers and evaluation bar |

Timings are observations on this machine, not performance guarantees. Numerical evaluations can vary with search timing. The local benchmark script reproduces the measurements; raw reports, runtime environments, executables, and model files remain ignored by Git.

## Practical limits

Engine/model installation is guided, not bundled into installers. Stockfish and Maia assets are configured locally. Runtime never downloads models. Windows x64 runtime verification is recorded below; Windows packaging and Linux remain unverified. Maia currently shows next-move probabilities; multi-move human continuations and piece-add/remove tools remain optional future extensions, as planned. Existing upstream Sass import deprecation warnings remain; builds and checks pass.

## Windows local setup (2026-10-18)

Validated on Windows x64, AMD Ryzen 5 5600X, 32 GiB RAM, NVIDIA RTX 3090.
Installed official Stockfish 19 and the same pinned Maia source/model revisions
documented above. Python 3.12.15 is installed inside `.local-engines/python`
using uv; Maia uses a dedicated environment with PyTorch 2.11.0+cu128.
Both the checkout and `%APPDATA%/chess-books-explorer/engines.json` profiles
point to these local assets, with device `auto`, 4 Stockfish threads, 256 MB
hash, and a 3-second analysis budget.

- `npm.cmd run build` passes, with existing Sass deprecation warnings.
- Real offline CLI verification passes on CPU and CUDA, including legal policy
  probabilities, the pinned checkpoint SHA-256, and engine-process cleanup.
- CUDA CLI measurements: Stockfish completes in 3,566 ms at depth 24; Maia's
  first prediction completes in 3,973 ms, with a subsequent prediction in 27 ms.
- Real Electron review passes on CPU and CUDA with HTTP blocked, including
  engine output, both arrow layers, evaluation bar, Piece mode pause/resume,
  legal mouse exploration, both castling wings/colors, and archive integrity.
  Initial CUDA review analysis completes in 4,042 ms.
- Python dependency checks pass. The final CLI report and dependency snapshot
  remain in the ignored `.local-engines` directory.

These measurements describe this machine; installer/packaged-app validation
was not part of this setup.

## Simplified controls (2026-10-17)

The desktop suite additionally verifies the three-button toolbar, a preference-only settings dialog, independent Stockfish/Maia line counts passed to local processes, hidden lines with visible arrows, remembered choices when engines are toggled off/on, and preferences retained across reviews. The full unit/archive, desktop, book-reader, and real-engine offline checks were rerun for this change.

## Stockfish exits after castling (2026-10-17)

Reproduced the reported blank `Engine exited.` message with the installed native
Stockfish 19. PGN Viewer/chessops represents castling as a king move onto its rook
(e.g. `e1h1`); standard UCI expects the king's destination (`e1g1`). Sending the
unconverted history made Stockfish print `CRITICAL ERROR ... Illegal move: e1h1`
to stdout and exit with code 1. The app previously retained stderr only, hiding
the actual explanation; no historical engine failure log had been persisted.

The engine boundary now translates both colors and castling wings into standard
UCI while preserving the complete move history and original PGN. This also fixes
Maia silently rejecting the same history. Failure handling drains both output
streams, includes exit code/signal and stdout diagnostics, and writes a bounded
local JSON-lines log at `<Electron userData>/logs/engines.log` (one rotated file).
Normal shutdown does not create a failure entry. Logs contain the requested
position/history and recent engine commands so later failures can be diagnosed.

Regression coverage includes castling conversion from real-game history and
custom FENs, startup stdout errors/exit codes, log rotation, and real Stockfish
and Maia analysis after castling on both sides of the board. Unit/archive,
build, desktop, opt-in book-reader, and real-engine offline checks pass.
