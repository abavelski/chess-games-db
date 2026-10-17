# Local engine setup

Engines are user-installed and run locally. The app never downloads a model during review. Executable paths, Python environment, checkpoint, and resource settings are configured in the JSON profile below; settings are stored in Electron's user-data `engines.json`, outside the archive.

## Stockfish

Install the full native [Stockfish 19 release](https://github.com/official-stockfish/Stockfish/releases/tag/sf_19) for your operating system and CPU. Extract the entire release and retain its matching network files if supplied separately. Set `stockfishPath` in the profile to the executable. On macOS the official universal build supports Apple Silicon and Intel; use the appropriate official Windows/Linux build on those platforms.

Verified macOS archive: `stockfish-macos-universal.tar.gz`, SHA-256 `a1f0e3bcc5a6927a11fe6fc8e54a779754645f3c2bae2cf13420fd1957adaa77`. Stockfish is GPL-3.0; retain the release's license and matching source if redistributing it. This repository uses user-installed engines rather than bundling third-party binaries.

## Maia 3 (79M)

Use Python 3.12 and a dedicated environment. The commands work in a terminal on macOS/Linux; on Windows use `py -3.12` and `.local-engines/maia-venv/Scripts/` in place of the Python/bin paths. Install the PyTorch build appropriate to your GPU if using CUDA; CPU is supported. Apple MPS is detected when available.

```sh
python3.12 -m venv .local-engines/maia-venv
.local-engines/maia-venv/bin/python -m pip install 'maia3 @ git+https://github.com/CSSLab/maia3.git@1e13597c42d4858b7cfd7cfdae01e297263364b2'
.local-engines/maia-venv/bin/maia3-cache --model maia3-79m --revision a107d6ceb7b298cb04ae1da4edffe2939858b894 --cache-dir .local-engines/models
```

Set `pythonPath` to that environment's Python executable and `checkpointPath` to the downloaded `maia3-79m.pt` file under the models snapshot directory. Always select the 79M checkpoint; other architectures are not interchangeable. The adapter uses the official model, tokenizer, history, legal-move mask, and policy probabilities. Runtime forces Hugging Face offline mode and passes an explicit local checkpoint.

The pinned [Maia code](https://github.com/CSSLab/maia3/tree/1e13597c42d4858b7cfd7cfdae01e297263364b2) is AGPL-3.0. The [weights repository](https://huggingface.co/UofTCSSLab/Maia3-79M/tree/a107d6ceb7b298cb04ae1da4edffe2939858b894) does not declare a separate license in its model-card metadata; verify weight redistribution terms with upstream before bundling. User installation avoids bundling the weights here.

Expect several hundred MB for weights, plus the Python/PyTorch environment and working memory. Large-model CPU/GPU latency depends on your hardware. The runtime uses the configured device and never silently falls back to a smaller model; the local verification command reports the model/device. If acceleration fails, explicitly select CPU and retry.

## Resources and recovery

Start with 4 Stockfish threads (or fewer on small machines), 256 MB hash, and a 3-second analysis budget. Change these in the JSON profile and restart the app. The largest Maia model stays loaded between predictions; disabling Maia stops new predictions, while closing review stops active work. Closing the window/app releases both engine processes. Restart the app after changing technical configuration.

Missing executable/checkpoint errors direct you to the local installation instructions. Install/cache assets before enabling engines. A crash or timeout leaves the book review usable; toggle the engine off/on to restart it. Review and automated tests require no online services. `.local-engines/`, virtual environments, weight files, and generated reports are ignored by Git.

## Review preferences

The review toolbar has three controls: **Engine settings**, **Stockfish**, and **Maia**. Engine settings contains independent line visibility, line counts (1/3/5) and arrows for each engine, plus the evaluation bar, book annotations, and Maia rating. These preferences are remembered locally. Turning either engine off/on preserves them; the evaluation bar disappears with Stockfish when it is off. Technical paths, memory, threads, device, and time budget are intentionally outside this panel.

## Development profile and verification

During development, the app also reads an optional ignored `.local-engines/engines.json` when no saved user configuration exists. This machine has that profile configured for full Stockfish 19 and Maia 79M; launch the app and enable them in review. The user-data profile takes precedence over the development profile. Packaged apps use the user-data configuration and the guided installation above.

A profile has these fields (use absolute paths appropriate to your machine):

```json
{
  "stockfishPath": "/absolute/path/to/stockfish",
  "pythonPath": "/absolute/path/to/maia-venv/bin/python",
  "checkpointPath": "/absolute/path/to/maia3-79m.pt",
  "device": "auto",
  "threads": 4,
  "hash": 256,
  "budget": 3000
}
```

Run the explicit local-model checks after installing assets:

```sh
npm run engines:verify -- .local-engines/engines.json
CHESS_ENGINE_CONFIG=.local-engines/engines.json npm run test:engines:local
```

The first command verifies policy legality/probabilities, records cold/warm latency and checkpoint checksum, and confirms child-process cleanup. The second uses the built Electron app with real engines, blocks all HTTP requests, and exercises analysis, arrows, the evaluation bar, Piece mode pause/resume, legal free exploration, and archive integrity. Its archive and preferences are isolated temporary fixtures. Neither command downloads anything. The standard desktop suite uses deterministic fixture engines; their executable shebang launch is verified on macOS/Linux. Windows packaging and executable selection require a Windows validation pass.
