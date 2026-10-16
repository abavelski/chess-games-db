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

Engine/model installation is guided, not bundled into installers. Stockfish and Maia assets are configured locally. Runtime never downloads models. Windows/Linux native distributions and GPU combinations have not been tested on this macOS host. Maia currently shows next-move probabilities; multi-move human continuations and piece-add/remove tools remain optional future extensions, as planned. Existing upstream Sass import deprecation warnings remain; builds and checks pass.
