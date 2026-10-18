# Local engine setup

A fresh checkout does **not** include Stockfish, Maia, Python environments, models, or a machine-specific engine profile. Install them on each machine using the steps below. `.local-engines/` is ignored by Git and excluded from installers. Engines are optional and default off in review.

## Choose the run mode

| Mode | Command | Engine configuration lookup |
| --- | --- | --- |
| Development (Vite + Electron) | `npm run dev` | User-data `engines.json`, then checkout's `.local-engines/engines.json` |
| Local production renderer (no dev server) | `npm run build`, then `npm start` | Same lookup as development; Electron is still unpackaged |
| Packaged production app | `npm run dist:dir` (unpacked app) or `npm run dist` (installer), then launch the resulting app | **Only** user-data `engines.json`; checkout profile is ignored |

The first readable, valid profile wins as a whole; fields are not merged between files. An existing user-data profile takes precedence even when its engine paths no longer exist. Restart the app after editing a profile. Technical paths are configured in the file; **Game review settings** controls display preferences and Maia rating.

## 1. Prepare a fresh checkout

Run commands from the repository root. Install **Node.js 22+**, npm, **Git** (needed by pip for the pinned Maia source), and **Python 3.12**. On macOS, install Apple's Command Line Tools if Git or native dependency installation requests them. On Windows, use native **PowerShell** and Windows Python/Node installations, rather than a WSL environment for the Windows desktop app.

```sh
npm install
```

On Windows, if PowerShell blocks `npm.ps1` because script execution is disabled, use `npm.cmd` in place of `npm` for all commands below. No execution-policy change is needed.

Installation rebuilds SQLite bindings for Electron. Downloading engines, Python packages and weights needs internet access; normal analysis uses local files and forces Hugging Face offline mode. The SQLite game archive is also separate from Git and installers: select an existing schema-v7 archive with **Open database**.

## 2. Install Stockfish 19

Use the full native [official Stockfish 19 release](https://github.com/official-stockfish/Stockfish/releases/tag/sf_19). Extract the entire release and retain matching network files if supplied separately. The profile must point to the actual executable, not the archive or its directory.

### macOS (Apple Silicon or Intel)

From the repository root:

```sh
mkdir -p .local-engines
curl -fL https://github.com/official-stockfish/Stockfish/releases/download/sf_19/stockfish-macos-universal.tar.gz -o .local-engines/stockfish.tar.gz
tar -xzf .local-engines/stockfish.tar.gz -C .local-engines
chmod +x .local-engines/stockfish/stockfish-macos-universal
```

Verified archive SHA-256: `a1f0e3bcc5a6927a11fe6fc8e54a779754645f3c2bae2cf13420fd1957adaa77`. Check with `shasum -a 256 .local-engines/stockfish.tar.gz`. If macOS blocks the downloaded executable, review the security prompt and allow the trusted official download through **System Settings → Privacy & Security**.

### Windows (PowerShell)

For Intel/AMD 64-bit Windows:

```powershell
New-Item -ItemType Directory -Force .local-engines | Out-Null
Invoke-WebRequest https://github.com/official-stockfish/Stockfish/releases/download/sf_19/stockfish-windows-x86-64-universal.zip -OutFile .local-engines/stockfish.zip
Expand-Archive .local-engines/stockfish.zip -DestinationPath .local-engines -Force
Get-ChildItem .local-engines/stockfish -Filter *.exe -Recurse
```

For Windows ARM64, download `stockfish-windows-arm64-universal.zip` from the same release instead. Use the extracted `.exe` matching your architecture when creating the profile below. Keep its extracted directory intact.

Verified Windows x86-64 archive SHA-256: `3c8bf1f9ea66a09350a40df4f632288285ac206d99f33ab5842c408fc30b48a7`. Check with `Get-FileHash .local-engines/stockfish.zip -Algorithm SHA256`.

Stockfish is GPL-3.0; retain the license and matching source if redistributing it. This project uses user-installed engines rather than bundling third-party binaries.

## 3. Install Maia 3 (79M)

Use a dedicated Python 3.12 environment. These commands pin the same Maia code and model revision used by this project's local setup. No environment activation is needed.

### macOS

```sh
python3.12 -m venv .local-engines/maia-venv
.local-engines/maia-venv/bin/python -m pip install --upgrade pip
.local-engines/maia-venv/bin/python -m pip install 'maia3 @ git+https://github.com/CSSLab/maia3.git@1e13597c42d4858b7cfd7cfdae01e297263364b2'
.local-engines/maia-venv/bin/maia3-cache --model maia3-79m --revision a107d6ceb7b298cb04ae1da4edffe2939858b894 --cache-dir .local-engines/models
```

### Windows (PowerShell)

```powershell
py -3.12 -m venv .local-engines/maia-venv
& ./.local-engines/maia-venv/Scripts/python.exe -m pip install --upgrade pip
& ./.local-engines/maia-venv/Scripts/python.exe -m pip install 'maia3 @ git+https://github.com/CSSLab/maia3.git@1e13597c42d4858b7cfd7cfdae01e297263364b2'
& ./.local-engines/maia-venv/Scripts/maia3-cache.exe --model maia3-79m --revision a107d6ceb7b298cb04ae1da4edffe2939858b894 --cache-dir .local-engines/models
```

If Python 3.12 is unavailable and you prefer a checkout-local runtime, an existing Python installation can bootstrap [uv](https://docs.astral.sh/uv/). Instead of `py -3.12 -m venv ...`, run:

```powershell
py -m pip install --target .local-engines/tooling uv
& ./.local-engines/tooling/bin/uv.exe python install 3.12 --install-dir .local-engines/python --no-bin
$localPython = (Get-ChildItem .local-engines/python -Filter python.exe -Recurse | Select-Object -First 1).FullName
& $localPython -m venv .local-engines/maia-venv
```

Then continue with the Windows pip and model-cache commands above. Keep `.local-engines/python` in place: the virtual environment depends on it.

The cache command prints the checkpoint path. With this cache directory and revision it is:

```text
.local-engines/models/models--UofTCSSLab--Maia3-79M/snapshots/a107d6ceb7b298cb04ae1da4edffe2939858b894/maia3-79m.pt
```

Always select the **79M** checkpoint; other architectures are not interchangeable. The adapter uses the official model, tokenizer, history, legal-move mask, and policy probabilities, with an explicit local checkpoint.

Start with `device: "auto"`: the bridge chooses CUDA, then Apple MPS, then CPU according to availability. For NVIDIA acceleration, install a compatible PyTorch build in this same environment using the [official PyTorch installation selector](https://pytorch.org/get-started/locally/) before verification. Set `device` explicitly to `cpu`, `mps`, or `cuda` if desired. If acceleration fails, select `cpu` and retry. The app never substitutes a smaller model.

For Windows x64 with an RTX 3090 and a compatible NVIDIA driver, this CUDA 12.8 build was used for the local setup:

```powershell
& ./.local-engines/maia-venv/Scripts/python.exe -m pip install 'torch==2.11.0+cu128' --index-url https://download.pytorch.org/whl/cu128
& ./.local-engines/maia-venv/Scripts/python.exe -c "import torch; print(torch.__version__); print('CUDA available:', torch.cuda.is_available())"
```

Allow several hundred MB for weights plus the Python/PyTorch environment and working memory. CUDA PyTorch downloads and installation require several GB of additional disk space. CPU latency depends on your hardware. Virtual environments are machine-specific: recreate them on a new machine or after moving the checkout rather than copying them between operating systems.

The pinned [Maia code](https://github.com/CSSLab/maia3/tree/1e13597c42d4858b7cfd7cfdae01e297263364b2) is AGPL-3.0. The [weights repository](https://huggingface.co/UofTCSSLab/Maia3-79M/tree/a107d6ceb7b298cb04ae1da4edffe2939858b894) does not declare a separate license in its model-card metadata; verify redistribution terms with upstream before bundling.

## 4. Create the local engine profile

Create `.local-engines/engines.json` as UTF-8 **without a BOM**, using absolute paths for your machine. Do not put shell quotes inside path values. `~`, environment variables such as `%USERPROFILE%`, and relative paths are not expanded by the engine manager.

macOS example (replace `/Users/you/dev/chess-games-db` with your checkout path):

```json
{
  "stockfishPath": "/Users/you/dev/chess-games-db/.local-engines/stockfish/stockfish-macos-universal",
  "pythonPath": "/Users/you/dev/chess-games-db/.local-engines/maia-venv/bin/python",
  "checkpointPath": "/Users/you/dev/chess-games-db/.local-engines/models/models--UofTCSSLab--Maia3-79M/snapshots/a107d6ceb7b298cb04ae1da4edffe2939858b894/maia3-79m.pt",
  "device": "auto",
  "threads": 4,
  "hash": 256,
  "budget": 3000
}
```

Windows example (replace the checkout path and confirm the extracted executable filename):

```json
{
  "stockfishPath": "C:/Users/you/dev/chess-games-db/.local-engines/stockfish/stockfish-windows-x86-64-universal.exe",
  "pythonPath": "C:/Users/you/dev/chess-games-db/.local-engines/maia-venv/Scripts/python.exe",
  "checkpointPath": "C:/Users/you/dev/chess-games-db/.local-engines/models/models--UofTCSSLab--Maia3-79M/snapshots/a107d6ceb7b298cb04ae1da4edffe2939858b894/maia3-79m.pt",
  "device": "auto",
  "threads": 4,
  "hash": 256,
  "budget": 3000
}
```

Forward slashes work in Windows JSON paths; backslashes must be escaped as `\\`. `threads` and `hash` (MB) configure Stockfish, and `budget` is its per-position analysis time in milliseconds. Use fewer threads on small machines.

For development, launch `npm run dev`. To run the production renderer locally, use `npm run build` followed by `npm start`. Both can use this checkout profile unless a valid user-data profile already exists.

## 5. Configure a packaged production app

Build on the target OS with `npm run dist:dir` or `npm run dist`; output is under `release/`. Launch the resulting app once, then fully quit it (on macOS, **Cmd+Q**, not just closing its window). Create `engines.json` in its user-data directory by copying your tested checkout profile:

| OS | Default user-data profile for this package (`chess-books-explorer`) |
| --- | --- |
| macOS | `~/Library/Application Support/chess-books-explorer/engines.json` |
| Windows | `%APPDATA%\chess-books-explorer\engines.json` |

macOS:

```sh
mkdir -p "$HOME/Library/Application Support/chess-books-explorer"
cp .local-engines/engines.json "$HOME/Library/Application Support/chess-books-explorer/engines.json"
```

Windows (PowerShell):

```powershell
New-Item -ItemType Directory -Force "$env:APPDATA/chess-books-explorer" | Out-Null
Copy-Item .local-engines/engines.json "$env:APPDATA/chess-books-explorer/engines.json"
```

These defaults also apply to `npm run dev` and `npm start`, so the copied profile will take precedence in those modes too. To return to the checkout profile, quit the app and rename or remove the user-data `engines.json`.

Keep engines, the Python environment, and model cache at the absolute paths in the profile. For use independent of a checkout, install them in a persistent user-owned directory outside the app bundle/install directory, using the same installation steps with that directory in place of `.local-engines/`, and update all three paths. Do not move a populated virtual environment; recreate it at its final location. Do not place engines or weights inside `app.asar`. A new computer needs its own installation and profile; the installer does not provision them.

Restart the app, open a game, and enable **Stockfish** and **Maia** in the toolbar. Expect Stockfish evaluation/lines and Maia move probabilities. Initial Maia loading can take longer than subsequent predictions.

## 6. Verify the installation

The CLI check works with either profile path and does not need a graphical session:

```sh
npm run engines:verify -- .local-engines/engines.json
```

It verifies Stockfish output, Maia policy legality/probabilities, cold/warm latency, checkpoint checksum, selected device, and child-process cleanup. It downloads nothing.

For an opt-in Electron integration test with the real engines, use a graphical desktop session. macOS:

```sh
CHESS_ENGINE_CONFIG=.local-engines/engines.json npm run test:engines:local
```

Windows (PowerShell):

```powershell
$env:CHESS_ENGINE_CONFIG = (Resolve-Path .local-engines/engines.json).Path
npm run test:engines:local
Remove-Item Env:CHESS_ENGINE_CONFIG
```

This builds the renderer and checks analysis, arrows, evaluation bar, Piece mode pause/resume, legal exploration, and archive integrity with HTTP blocked. It uses isolated temporary archives and preferences. `CHESS_ENGINE_CONFIG` is an input to this test only; it does **not** configure the normal app. The test runs unpackaged Electron; separately launch the packaged app to verify its user-data profile.

Real-engine CLI and unpackaged Electron verification have passed on macOS and Windows x64 (Ryzen 5 5600X, 32 GiB RAM). Windows installer/packaged-app validation remains separate. Standard desktop tests use fixture engines whose shebang launch is verified on macOS/Linux.

## Resources and recovery

Start with 4 Stockfish threads (or fewer on small machines), 256 MB hash, and a 3-second analysis budget. Change these in the JSON profile and restart the app. The largest Maia model stays loaded between predictions; disabling Maia stops new predictions, while closing review stops active work. Closing the window/app releases both engine processes. Restart the app after changing technical configuration.

Missing executable/checkpoint errors direct you to the local installation instructions. Install/cache assets before enabling engines. A crash or timeout leaves the book review usable; toggle the engine off/on to restart it. Review and automated tests require no online services. `.local-engines/`, virtual environments, weight files, and generated reports are ignored by Git.

## Review preferences

The review toolbar has three controls: **Game review settings** (gear icon), **Stockfish**, and **Maia**. Game review settings contains Flip board (using the Lichess icon), independent line visibility, line counts (1/3/5) and arrows for each engine, plus the evaluation bar, book annotations, and Maia rating. These preferences are remembered locally. Turning either engine off/on preserves them; the evaluation bar disappears with Stockfish when it is off. Technical paths, memory, threads, device, and time budget are intentionally outside this panel.

## Engine failure logs

Engine failures are written locally to `<Electron userData>/logs/engines.log`,
with one rotated file (`engines.log.1`). Default paths are
`~/Library/Application Support/chess-books-explorer/logs/engines.log` on macOS
and `%APPDATA%\chess-books-explorer\logs\engines.log` on Windows.
Entries include exit code/signal, stdout/stderr diagnostics, recent commands,
and the position/move history. Logs are bounded and never uploaded. Restart the
app after installing code updates so its engine manager loads the fixes.
