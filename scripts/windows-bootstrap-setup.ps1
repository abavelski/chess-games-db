[CmdletBinding()]
param([switch]$Launch, [switch]$CpuOnly, [switch]$Recheck)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version Latest
$root = Split-Path $PSScriptRoot -Parent
$runtimeDirectory = Join-Path $root '.runtime'
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Invoke-Checked([string]$Program, [string[]]$Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program failed (exit $LASTEXITCODE). Rerun Setup.bat to retry." }
}
function Write-Json([string]$Path, $Value) { [IO.File]::WriteAllText($Path, ($Value | ConvertTo-Json -Depth 8), $utf8) }
function Use-EngineProfile($Settings) {
    $directory = Join-Path $env:APPDATA 'chess-books-explorer'
    $null = New-Item -ItemType Directory -Force -Path $directory
    $profile = Join-Path $directory 'engines.json'
    if ((Test-Path -LiteralPath $profile) -and -not (Test-Path -LiteralPath "$profile.before-bundle")) {
        Copy-Item -LiteralPath $profile -Destination "$profile.before-bundle"
    }
    Write-Json $profile $Settings
}

try {
    if ($env:OS -ne 'Windows_NT' -or -not [Environment]::Is64BitProcess -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64') {
        throw 'This bundle requires Intel/AMD 64-bit Windows 10 or 11.'
    }
    $app = Join-Path $root 'app/Annotated Games Explorer.exe'
    $manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'manifest.json') -Raw | ConvertFrom-Json
    $stockfish = Join-Path $root ("stockfish/" + $manifest.stockfishExecutable)
    if (-not (Test-Path -LiteralPath $app) -or -not (Test-Path -LiteralPath $stockfish)) { throw 'Extract the entire ZIP first.' }
    $null = New-Item -ItemType Directory -Force -Path $runtimeDirectory
    # Prevent simultaneous package installs into the same environment.
    $lock = [IO.File]::Open((Join-Path $runtimeDirectory 'setup.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
    try {
        $readyPath = Join-Path $runtimeDirectory 'ready.json'
        $ready = $null
        if (Test-Path -LiteralPath $readyPath) {
            try { $ready = Get-Content -LiteralPath $readyPath -Raw | ConvertFrom-Json } catch { $ready = $null }
        }
        $reuse = $ready -and $ready.root -eq $root -and $ready.release -eq $manifest.release -and (Test-Path -LiteralPath $ready.settings.pythonPath) -and (Test-Path -LiteralPath $ready.settings.checkpointPath) -and -not $Recheck -and (-not $CpuOnly -or $ready.settings.device -eq 'cpu')
        if ($reuse) {
            Use-EngineProfile $ready.settings
            Write-Host "Already set up: Maia $($ready.settings.device), $($ready.settings.threads) threads."
        } else {
            . (Join-Path $PSScriptRoot 'hardware.ps1')
            $hardware = Get-BootstrapHardware
            $plan = Get-BootstrapPlan -LogicalProcessors $hardware.logicalProcessors -PhysicalCores $hardware.physicalCores -MemoryGiB $hardware.memoryGiB -Gpus $hardware.gpus -CpuOnly:$CpuOnly
            Write-Host "$($hardware.cpu); $($hardware.memoryGiB) GiB RAM"
            Write-Host $plan.reason
            Write-Json (Join-Path $runtimeDirectory 'hardware.json') $hardware
            $settings = [pscustomobject]@{
                stockfishPath = $stockfish; pythonPath = ''; checkpointPath = ''
                device = 'cpu'; threads = $plan.threads; hash = $plan.hash; budget = 3000
            }
            # A failed repair must not leave an old "ready" marker pointing at
            # packages that have since been replaced or partially installed.
            Write-Json $readyPath @{ root = ''; release = ''; settings = $settings }
            # Browsing and Stockfish remain usable even if a Maia download fails.
            Use-EngineProfile $settings
            $uv = Join-Path $PSScriptRoot 'uv.exe'
            if ((Get-FileHash -LiteralPath $uv -Algorithm SHA256).Hash -ne $manifest.uvSha256) { throw 'Bootstrap tool checksum mismatch. Extract the original ZIP again.' }
            $wheel = Join-Path $PSScriptRoot $manifest.maiaWheel
            if ((Get-FileHash -LiteralPath $wheel -Algorithm SHA256).Hash -ne $manifest.maiaWheelSha256) { throw 'Maia package checksum mismatch.' }
            # uv downloads only into this bundle; no PATH/registry changes or admin rights.
            $previousInstallDir = $env:UV_PYTHON_INSTALL_DIR
            $previousCacheDir = $env:UV_CACHE_DIR
            $previousLinkMode = $env:UV_LINK_MODE
            try {
                $env:UV_PYTHON_INSTALL_DIR = Join-Path $runtimeDirectory 'python'
                $env:UV_CACHE_DIR = Join-Path $runtimeDirectory 'cache'
                $env:UV_LINK_MODE = 'copy'
                Invoke-Checked $uv @('--no-config', 'python', 'install', $manifest.pythonVersion, '--no-bin', '--no-registry')
                $basePython = & $uv --no-config python find $manifest.pythonVersion --managed-python --no-python-downloads
                if ($LASTEXITCODE -ne 0) { throw 'Cannot locate downloaded Python.' }
                $environment = Join-Path $runtimeDirectory 'maia'
                Invoke-Checked $uv @('--no-config', 'venv', '--python', ([string]$basePython).Trim(), '--allow-existing', $environment)
                $python = Join-Path $environment 'Scripts/python.exe'
                $dllDirectory = Join-Path $environment 'Library/bin'
                $null = New-Item -ItemType Directory -Force -Path $dllDirectory
                foreach ($dll in $manifest.vcRuntime) {
                    $sourceDll = Join-Path $PSScriptRoot ("vc-runtime/" + $dll.name)
                    if ((Get-FileHash -LiteralPath $sourceDll -Algorithm SHA256).Hash -ne $dll.sha256) { throw "C++ runtime checksum mismatch: $($dll.name)" }
                    Copy-Item -LiteralPath $sourceDll -Destination (Join-Path (Split-Path $python -Parent) $dll.name) -Force
                    Copy-Item -LiteralPath $sourceDll -Destination (Join-Path $dllDirectory $dll.name) -Force
                }
                $checkpoint = Join-Path $runtimeDirectory 'maia3-79m.pt'
                $validCheckpoint = (Test-Path -LiteralPath $checkpoint) -and (Get-FileHash -LiteralPath $checkpoint -Algorithm SHA256).Hash -eq $manifest.checkpointSha256
                if (-not $validCheckpoint) {
                    Write-Host 'Downloading the pinned Maia 79M model (about 301 MB)...'
                    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
                    $download = "$checkpoint.download"
                    Invoke-WebRequest -UseBasicParsing -Uri $manifest.checkpointUrl -OutFile $download
                    if ((Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash -ne $manifest.checkpointSha256) { throw 'Model checksum mismatch; setup stopped.' }
                    Move-Item -LiteralPath $download -Destination $checkpoint -Force
                }
                $attempts = if ($plan.device -eq 'cuda') { @('cu126', 'cpu') } else { @('cpu') }
                $installed = $false
                foreach ($backend in $attempts) {
                    $device = if ($backend -eq 'cpu') { 'cpu' } else { 'cuda' }
                    Write-Host "Installing Maia with PyTorch $backend. Internet is required; GPU downloads can be several GB."
                    # Only wheels: the destination never needs Git or a compiler.
                    try {
                        Invoke-Checked $uv @('--no-config', 'pip', 'install', '--python', $python, '--only-binary', ':all:', '--find-links', (Join-Path $PSScriptRoot 'wheels'), '--torch-backend', $backend, "torch==$($manifest.torchVersion)+$backend", $wheel)
                        & $python -I (Join-Path $PSScriptRoot 'runtime-check.py') --device $device --checkpoint $checkpoint --threads $plan.threads
                        if ($LASTEXITCODE -eq 0) { $installed = $true; break }
                    } catch {
                        if ($device -eq 'cpu') { throw }
                        Write-Warning $_
                    }
                    if ($device -eq 'cuda') { Write-Warning 'GPU setup/inference failed. Installing CPU PyTorch instead.' }
                }
                if (-not $installed) { throw 'Maia inference failed. Browsing/Stockfish are available via app/Annotated Games Explorer.exe. See the console error and rerun Setup.bat.' }
                $settings.pythonPath = $python; $settings.checkpointPath = $checkpoint; $settings.device = $device
                # Check Stockfish before publishing the completed configuration.
                $stockfishInfo = @('uci', 'isready', 'quit') | & $stockfish
                if ($LASTEXITCODE -ne 0 -or 'readyok' -notin $stockfishInfo) { throw 'Stockfish startup check failed.' }
                Use-EngineProfile $settings
                Write-Json $readyPath @{ root = $root; release = $manifest.release; settings = $settings }
            } finally {
                $env:UV_PYTHON_INSTALL_DIR = $previousInstallDir
                $env:UV_CACHE_DIR = $previousCacheDir
                $env:UV_LINK_MODE = $previousLinkMode
            }
            Write-Host "Setup complete: Maia $($settings.device), $($settings.threads) threads. Future launches work offline."
        }
    } finally { $lock.Dispose() }
    if ($Launch) { Start-Process -FilePath $app -WorkingDirectory $root }
    else { Write-Host 'Double-click Start.bat to open the app.' }
} catch {
    Write-Host "Setup failed: $_" -ForegroundColor Red
    exit 1
}
