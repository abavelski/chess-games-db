# Windows release and installation

Use this checklist for an Intel/AMD 64-bit Windows machine. The installer includes Electron, Node's app runtime, and SQLite bindings: the destination does **not** need Node.js, npm, Git, Visual Studio, or the repository. The database and chess engines are separate files.

## Small ZIP with automatic setup (recommended)

With dependencies and the [local engines](tasks/local-engine-review/SETUP.md) already installed on your Windows development machine, run from the repository root:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/prepare-windows-bootstrap.ps1
```

The script builds and tests the packaged app, then creates a folder and ZIP under `release/`. It includes the app, Stockfish, the small uv bootstrap tool, and Maia/chess wheels. Databases are never included; copy your schema-v7 archive separately. It excludes Python, PyTorch, CUDA libraries, and Maia's model. Optionally pass `-Database <path>` to validate an archive and use a temporary copy for the packaged startup test. On a fresh checkout, run `npm.cmd ci` and install the local engines first. Building the tiny Maia wheel needs Git and internet on the development machine.

On the destination (Windows 10/11 x64):

1. Extract the entire ZIP to a permanent writable folder.
2. Double-click **Setup.bat** with internet connected. It downloads Python, PyTorch, dependencies and the pinned Maia 79M model into `.runtime` inside that folder, then tests Stockfish and actual Maia inference.
3. Copy your database separately. Double-click **Start.bat**, click **Open database**, and select your archive. Later launches work offline.

Setup reads CPU cores, RAM, NVIDIA GPU compute capability and driver version locally. A GTX 1070 with driver 560.76 or newer selects PyTorch 2.11/CUDA 12.6. Unknown GPUs, older drivers, and unsupported architectures select CPU; GPU inference failure also falls back to CPU. Threads use at most half the physical CPU cores, capped at four; Stockfish's cache is reduced on low-RAM machines. Maia uses the same thread setting. The report is saved as `.runtime/hardware.json`.

For the smaller CPU download, run `Setup.bat -CpuOnly`. To repeat hardware detection or repair an installation, run `Setup.bat -Recheck`. Download failures can be retried by running Setup.bat again. Browsing and Stockfish remain available by launching `app/Annotated Games Explorer.exe` directly.

No admin rights, Node.js, Git, compiler, system Python, or CUDA toolkit installation is needed on the destination. Small Microsoft C++ runtime DLLs are included for local Python use. Setup does not install GPU drivers or change PATH/registry. The app's engine profile is saved under `%APPDATA%\chess-books-explorer`, preserving an existing profile once as `engines.json.before-bundle`; other installed files and caches stay inside the extracted folder. Rerun Setup.bat after moving the folder. GPU mode can still download/install several GB; this approach reduces the ZIP you copy.

Builder options: `-CheckOnly` checks source inputs without building/copying; `-SkipBuild` uses the existing `release/win-unpacked` app; `-EngineConfig <path>` selects another local engine profile; `-UvPath <path>` selects the uv executable (default `.local-engines/tooling/bin/uv.exe`, installed by the engine guide's uv option). The old full-runtime bundle script has been removed.

Hardware selection follows [PyTorch's 2.11 support matrix](https://dev-discuss.pytorch.org/t/dropping-volta-support-from-cuda-12-8-binaries-for-release-2-11/3290) and the conservative [CUDA 12.6 Windows driver minimum](https://docs.nvidia.com/cuda/archive/12.6.0/cuda-toolkit-release-notes/index.html). Unrecognized newer GPUs use CPU until their matching PyTorch build is added.

## App updates over your local network

For the portable app (including the recommended bootstrap bundle above), both PCs can use the same shared folder mapped as `Z:`. Run these commands in ordinary PowerShell, without elevation, so your mapped drive is available.

On the development PC, with npm dependencies installed, publish the current source:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/publish-windows-update.ps1
```

This builds the Windows x64 app and publishes a ZIP and `latest.json` under `Z:\ChessExplorer\updates`. It also copies the standalone updater there as `Update-App.ps1` and a ready-to-use `Update.bat`. Use `-SkipBuild` to publish an already built `release/win-unpacked` instead. Each publication is distinct even when the package version is unchanged; the latest manifest becomes visible only after the ZIP has finished copying and passed its checksum check.

On your son's PC, copy `Z:\ChessExplorer\updates\Update.bat` beside `Setup.bat` and `Start.bat`, outside the `app` folder. New bootstrap bundles already include it. Close the app and double-click **Update.bat** whenever you want to pull the latest published app. It finds the adjacent `app` folder automatically and keeps the result visible until you press a key. Run the local copy, rather than the copy on the share.

For a different portable folder layout, you can still run the updater directly, replacing the example path with the **app folder containing `Annotated Games Explorer.exe`**:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File Z:\ChessExplorer\updates\Update-App.ps1 -InstallDirectory 'C:\ChessExplorer\app'
```

Both PowerShell scripts accept `-ShareDirectory 'Z:\another-folder'` if you prefer a different shared folder; also edit `UPDATE_SHARE` near the top of your local `Update.bat` to match. If running a local copy of the updater, an empty share reports no published update; an unavailable share reports an error and preserves the installed app.

The updater downloads and verifies the ZIP locally before replacing the app folder. Repeating it without a new publication does nothing. No Node.js, npm, internet, or administrator rights are needed on the receiving PC. Start the app normally after updating.

Keep databases, engines, `.runtime`, and setup files **outside the app folder**, as in the bootstrap bundle. They and the user's AppData settings are preserved. Select only the bundle's `app` folder, never the entire bundle. This updater is for portable folders; for an app installed with the NSIS installer, use a newly built installer instead.

Each successful update keeps the previous app in a sibling `app.before-update-<id>` folder. To roll back, close the app, move the current `app` folder aside, and rename that backup to `app`. You can delete old backup folders after checking an update. Published ZIPs are also retained on the share; keep the ZIP referenced by `latest.json` and remove older ones as desired. The shared folder should be writable only by people you trust to publish executable app updates.

The manual installer procedure follows if you prefer separate components.

## 1. Create the release on your development machine

From the repository root on Windows, with Node.js 22+ and npm installed:

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run dist -- --win --x64
```

The installer is `release/Annotated Games Explorer Setup <version>.exe` (version comes from `package.json`). `npm.cmd run build` alone produces only the web interface, not an installable app.

## 2. Prepare what to copy

| Copy | Purpose |
| --- | --- |
| The `Setup <version>.exe` from `release/` | App installer |
| `data/annotated-games.sqlite3`, or your chosen schema-v7 archive | Games; excluded from the installer |
| The entire extracted `.local-engines/stockfish/` folder | Stockfish executable and accompanying files |
| The Maia files described below | Maia analysis, if wanted |

Copy the archive while database import/enrichment tools are closed, using a completed, checkpointed database. Older archives must be [converted on the development machine](../README.md#schema-version) first.

For installation without a setup wizard, run `npm.cmd run dist:dir -- --win --x64` and copy the **whole** `release/win-unpacked/` folder instead of the installer. Launch `Annotated Games Explorer.exe` inside it; copying that executable alone is insufficient.

### Maia: prepare an offline runtime installation

Maia needs Python 3.12, its packages, and the 79M checkpoint. An existing virtual environment is not portable; recreate it on the destination. These extra steps let you do that without Git or build tools there.

On the development machine, with Python 3.12 and Git installed, build a wheel folder containing Maia and its dependencies:

```powershell
py -3.12 -m venv .local-engines/release-builder
& ./.local-engines/release-builder/Scripts/python.exe -m pip install --upgrade pip wheel
& ./.local-engines/release-builder/Scripts/python.exe -m pip wheel --wheel-dir release/maia-wheels 'maia3 @ git+https://github.com/CSSLab/maia3.git@1e13597c42d4858b7cfd7cfdae01e297263364b2'
```

Only proceed if wheel building succeeds. Also copy:

- The entire `release/maia-wheels/` folder (potentially several GB).
- A full Windows x64 Python 3.12 installer, including pip, for offline installation.
- The actual `maia3-79m.pt` checkpoint from `.local-engines/models/models--UofTCSSLab--Maia3-79M/snapshots/a107d6ceb7b298cb04ae1da4edffe2939858b894/`. If it is a cache link, copy its file contents, not the link.

See [engine setup](tasks/local-engine-review/SETUP.md) if Stockfish or the checkpoint has not been downloaded yet. This checklist uses Maia on CPU, so no NVIDIA GPU or CUDA setup is needed.

## 3. Install on the fresh machine

1. Run the app installer.
2. Create `C:\ChessExplorer`, copy the database there, and copy the Stockfish folder to `C:\ChessExplorer\stockfish`.
3. For Maia, install Python 3.12 with pip and the Python launcher enabled. Copy the wheel folder to `C:\ChessExplorer\maia-wheels` and the checkpoint to `C:\ChessExplorer\maia3-79m.pt`, then run in PowerShell:

   ```powershell
   py -3.12 -m venv C:\ChessExplorer\maia-venv
   & C:/ChessExplorer/maia-venv/Scripts/python.exe -m pip install --no-index --find-links C:/ChessExplorer/maia-wheels maia3
   ```

4. Launch the app once, then close it. In File Explorer, open `%APPDATA%\chess-books-explorer`. Save the following as `engines.json` in UTF-8 **without a BOM** (ensure the filename is not `engines.json.txt`):

   ```json
   {
     "stockfishPath": "C:/ChessExplorer/stockfish/stockfish-windows-x86-64-universal.exe",
     "pythonPath": "C:/ChessExplorer/maia-venv/Scripts/python.exe",
     "checkpointPath": "C:/ChessExplorer/maia3-79m.pt",
     "device": "cpu",
     "threads": 4,
     "hash": 256,
     "budget": 3000
   }
   ```

   Adjust paths to the actual files. If omitting Maia, set `pythonPath` and `checkpointPath` to `""`. Engines are optional; browsing games requires neither engine nor Python. Packaged apps read this user-data profile, not the checkout's `.local-engines/engines.json`.

5. Reopen the app, click **Open database**, and choose the copied archive. Open a game and enable **Stockfish**, then **Maia**. Confirm Stockfish lines/evaluation and Maia move probabilities appear; first Maia loading can take longer. Repeat with the network disconnected to verify the complete offline installation.

Keep the database, engines, and Python runtime at their configured locations, outside the app installation folder. Normal use requires no internet connection. For distribution beyond your own machines, see the engine guide's license and model redistribution notes.
