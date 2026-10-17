# Local engine analysis and Piece mode

Status: task 1 complete (local process manager, offline Maia policy adapter, configuration IPC, lifecycle tests, and guided setup). Task 2 complete (history-aware analysis requests, bounded session cache, legal temporary branches, and SAN line previews). Task 3 complete (independent controls, setup dialog, arrows, evaluation bar, clickable lines, and desktop integration coverage). Task 4 complete (isolated clean/free board, reset, one-click state restoration, pause/resume, and Escape/focus coverage). Task 5 complete (expanded automated coverage, real offline engine/desktop verification, pinned assets, performance measurements, and installation/user documentation). All five tasks implemented.

Setup: [local engines and model installation](SETUP.md). Results: [verification and performance](VERIFICATION.md).

## Agreed scope

- Run everything locally in separate engine processes managed by Electron. No hosted backend or browser engine.
- Use full native Stockfish with its matching neural networks for evaluation, and the largest released Maia 3 model (currently 79M) for human move predictions. Pin and verify exact versions, model files, licenses, and hardware requirements during implementation. Provide explicit resource settings; never silently substitute a smaller model.
- Add independent engine, line, arrow, and evaluation-bar controls. Maia has its own enable button and target-rating selector.
- Add **Piece mode**: a distraction-free, freely movable board with one-click return to the exact review state.
- Preserve the original PGN, book annotations, and read-only archive. Temporary analysis and preferences live outside the archive.

## 1. Local engine management

- Add an engine manager behind Electron's preload/IPC boundary. The renderer sends structured analysis requests; Electron owns process launch, UCI communication, cancellation, and shutdown.
- Support platform-appropriate Stockfish executables and a local Maia runtime with cached model weights. Start with configured local installations, then package or provide a guided installation for supported desktop platforms, including Maia's Python/runtime dependencies.
- Install/cache required assets before analysis; show setup progress and actionable missing-engine/model errors. Once installed, analysis works offline with no automatic network requests.
- Expose Stockfish CPU threads, memory, and analysis budget. Detect Maia's supported CPU/GPU acceleration and show the selected model/device; benchmark the largest model locally before setting defaults.
- Start engines on demand, reuse loaded models, and stop searches when leaving review or disabling an engine. Handle crashes and timeouts without blocking the board.

## 2. Position analysis and temporary variations

- Connect the selected position in `src/GameReview.tsx` and `src/PgnBoard.tsx` to both engines, including book variations and custom starting positions. Pass available move history, not just FEN, for repetition handling and Maia's history input.
- On navigation, cancel obsolete work and reject late results belonging to another position. Debounce rapid navigation and cache results outside the archive using position/history, engine/model version, rating, and search settings.
- Stream Stockfish evaluation, mate scores, depth, and 1/3/5 principal variations. Keep numeric scores consistently from White's perspective, regardless of side to move or board orientation.
- Obtain Maia's ranked legal moves and their model probabilities at the selected rating. Use the actual policy probabilities, not the UCI compatibility centipawn score. Default both player ratings to the selected value; separate opponent rating can be an advanced setting.
- Let users click through Stockfish lines on a temporary analysis branch and return to the source position. Permit legal exploratory moves in normal analysis without editing the book's move tree or PGN.
- Initially show Maia next-move candidates. Multi-move human continuations are a later extension requiring repeated predictions and explicit sequence-probability handling.

## 3. Review controls and display

| Control | Behavior |
| --- | --- |
| Stockfish on/off | Start/stop Stockfish analysis; default off. |
| Engine lines show/hide | Show/hide clickable variations, each with evaluation. |
| Lines: 1 / 3 / 5 | Select the number of Stockfish candidates; default 3. |
| Engine arrows show/hide | Draw candidate first moves with rank indicated by thickness/opacity. |
| Evaluation bar show/hide | Toggle a slim Stockfish bar beside the board, with numeric/mate score. |
| Maia on/off | Enable/disable human predictions independently; default off. |
| Maia rating | Select a supported Lichess target rating, initially 600–2600 subject to the pinned model. |
| Maia arrows show/hide | Toggle distinct human-candidate arrows; show probabilities in the Maia panel. |
| Book annotations show/hide | Toggle authored board arrows/highlights independently of engine overlays. |
| Piece mode | Enter the clean, freely movable board described below. |

- Reuse Chessground's arrow rendering, composing engine overlays with existing book shapes and annotation glyphs so navigation does not overwrite them.
- Keep Stockfish evaluations and Maia move probabilities clearly labeled. Provide an arrow legend and readable handling when both engines suggest the same move.
- Hiding a display does not disable its engine; engine on/off controls computation. Mark paused/stale results clearly and hide results for a previous position.
- Keep controls keyboard accessible and save normal review preferences outside the archive.

## 4. Piece mode: clean board and free movement

- On entry, snapshot the complete review state: game and selected variation/path, any temporary analysis branch, board orientation, transcript scroll/focus, overlay preferences, and engine enable states.
- Display only the board plus minimal **Reset position** and **Return to review** controls. Hide the score, commentary, headers, book arrows/highlights/glyphs, move markers, engine lines/arrows, evaluation bar, and other review chrome. Pause both engines.
- Allow arbitrary piece dragging for analysis, including moves outside normal legal turn order. Maintain a separate temporary board state; do not force these edits into a legal PGN variation or send invalid positions to engines.
- **Reset position** restores the position present when Piece mode was entered while staying in Piece mode.
- **Return to review** restores the entire snapshot in one click, discards free-board edits, and resumes only the engines previously enabled. Escape returns to review first; the existing Escape-to-games behavior applies outside Piece mode.
- Support repeated entry/exit, flipped boards, source variations, and FEN-start games. Piece editing tools such as adding/removing pieces are a possible later extension; unrestricted dragging is in scope now.

## 5. Verification and delivery

- Add focused tests for UCI parsing, score perspective, mate scores, cancellation/stale results, history-sensitive requests, Maia probabilities/rating changes, and engine lifecycle. Use fixtures/fake engines so the normal test suite needs no model downloads.
- Extend desktop smoke coverage for independent controls, book/engine arrow coexistence, clickable analysis lines, Piece mode free moves/reset, and exact one-click restoration, including Escape behavior.
- Run `npm test`, `npm run build`, and `npm run test:desktop`; preserve opt-in book-reader coverage. Confirm source PGN/archive integrity.
- Manually verify both real engines offline, model/device reporting, concurrent analysis responsiveness, resource limits, and process cleanup on the target desktop. Record timings for the largest Maia model and full Stockfish.
- Document local installation, bundled assets and licensing, resource settings, controls, and recovery from missing engines/models.

Delivery order: engine manager → analysis integration → review controls → Piece mode → end-to-end verification. Keep review usable at every stage; no database migration is required.

## Follow-up: simplified controls (2026-10-17)

The review toolbar now contains only Engine settings, Stockfish, and Maia. Engine settings holds line visibility, independent line counts (1/3/5), and arrows for each engine, plus Maia rating, evaluation bar, and book annotations. Engine buttons toggle analysis with those saved preferences. Technical paths and resource options remain in the local JSON profile, outside the review panel.
