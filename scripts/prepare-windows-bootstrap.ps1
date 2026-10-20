[CmdletBinding()]
param(
    [string]$Database,
    [string]$EngineConfig,
    [string]$UvPath,
    [switch]$SkipBuild,
    [switch]$CheckOnly
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repo = Split-Path $PSScriptRoot -Parent
$utf8 = New-Object System.Text.UTF8Encoding($false)
function Require-File([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Missing file: $Path" }
    (Resolve-Path -LiteralPath $Path).Path
}
function Invoke-Checked([string]$Program, [string[]]$Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program failed (exit $LASTEXITCODE)." }
}
function Copy-Tree([string]$Source, [string]$Destination) {
    & robocopy.exe $Source $Destination /E /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "Copy failed: $Source" }
}
if ($env:OS -ne 'Windows_NT' -or -not [Environment]::Is64BitProcess -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { throw 'Build in 64-bit PowerShell on Intel/AMD Windows.' }
if (-not $EngineConfig) { $EngineConfig = Join-Path $repo '.local-engines/engines.json' }
if (-not $UvPath) { $UvPath = Join-Path $repo '.local-engines/tooling/bin/uv.exe' }
$uv = Require-File $UvPath
$databasePath = if ($Database) { Require-File $Database } else { '' }
$config = Get-Content -LiteralPath (Require-File $EngineConfig) -Raw | ConvertFrom-Json
$stockfish = Require-File $config.stockfishPath
$python = Require-File $config.pythonPath
# Check Python/database with a script file: PowerShell 5.1 mangles quotes in -c.
$snapshotTool = Join-Path $PSScriptRoot 'windows-database-snapshot.py'
if ($databasePath) { Invoke-Checked $python @('-I', $snapshotTool, $databasePath) }
if ($CheckOnly) { Write-Host 'Bootstrap inputs ready; no output created.'; exit 0 }

Push-Location $repo
try {
    if (-not $SkipBuild) { Invoke-Checked 'npm.cmd' @('run', 'dist:dir', '--', '--win', '--x64') }
    $app = Join-Path $repo 'release/win-unpacked'
    $null = Require-File (Join-Path $app 'Annotated Games Explorer.exe')
    $null = Require-File (Join-Path $app 'resources/app.asar.unpacked/electron/maia_bridge.py')
    $smokeArguments = @('scripts/start-electron.mjs', 'tests/packaged-desktop-smoke.mjs')
    if ($databasePath) { $smokeArguments += $databasePath }
    Invoke-Checked 'node' $smokeArguments
    $version = (Get-Content (Join-Path $repo 'package.json') -Raw | ConvertFrom-Json).version
    $name = "ChessExplorer-$version-bootstrap-$(Get-Date -Format 'yyyyMMdd-HHmmss')-$([guid]::NewGuid().ToString('N').Substring(0,6))"
    $bundle = Join-Path $repo "release/$name"
    $setup = Join-Path $bundle 'setup'
    $null = New-Item -ItemType Directory -Path $setup
    Copy-Tree $app (Join-Path $bundle 'app')
    Copy-Tree (Split-Path $stockfish -Parent) (Join-Path $bundle 'stockfish')
    Copy-Item -LiteralPath $uv -Destination (Join-Path $setup 'uv.exe')
    # App-local C++ runtime: PyTorch also needs these on a clean Windows PC.
    # Copy only Microsoft runtime DLLs, not development tools or system Python.
    $vcDirectory = Join-Path $setup 'vc-runtime'
    $null = New-Item -ItemType Directory -Path $vcDirectory
    $vcFiles = @()
    foreach ($dll in @('msvcp140.dll', 'msvcp140_1.dll', 'msvcp140_2.dll', 'msvcp140_atomic_wait.dll', 'msvcp140_codecvt_ids.dll', 'concrt140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll')) {
        $sourceDll = Require-File (Join-Path $env:windir "System32/$dll")
        $signature = Get-AuthenticodeSignature -LiteralPath $sourceDll
        if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') { throw "Expected a signed Microsoft C++ runtime: $sourceDll" }
        Copy-Item -LiteralPath $sourceDll -Destination (Join-Path $vcDirectory $dll)
        $vcFiles += @{ name = $dll; sha256 = (Get-FileHash -LiteralPath $sourceDll -Algorithm SHA256).Hash }
    }
    # Build just the tiny Maia wheel on the development machine, never its dependencies.
    # Git/build tooling is needed only here, not on the destination PC.
    $wheels = Join-Path $setup 'wheels'
    Invoke-Checked $python @('-m', 'pip', 'wheel', '--no-deps', '--wheel-dir', $wheels, 'maia3 @ git+https://github.com/CSSLab/maia3.git@1e13597c42d4858b7cfd7cfdae01e297263364b2', 'python-chess==1.999', 'chess==1.11.2')
    $wheel = @(Get-ChildItem -LiteralPath $wheels -Filter 'maia3-*.whl')
    if ($wheel.Count -ne 1) { throw 'Expected exactly one Maia wheel.' }
    foreach ($mapping in @(
        @('windows-bootstrap-setup.ps1', 'Setup.ps1'),
        @('windows-hardware.ps1', 'hardware.ps1'),
        @('windows-runtime-check.py', 'runtime-check.py')
    )) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $mapping[0]) -Destination (Join-Path $setup $mapping[1]) }
    $manifest = @{
        release = $name; pythonVersion = '3.12.15'; torchVersion = '2.11.0'
        stockfishExecutable = Split-Path $stockfish -Leaf
        uvSha256 = (Get-FileHash -LiteralPath $uv -Algorithm SHA256).Hash
        maiaWheel = "wheels/$($wheel[0].Name)"
        maiaWheelSha256 = (Get-FileHash -LiteralPath $wheel[0].FullName -Algorithm SHA256).Hash
        checkpointUrl = 'https://huggingface.co/UofTCSSLab/Maia3-79M/resolve/a107d6ceb7b298cb04ae1da4edffe2939858b894/maia3-79m.pt'
        checkpointSha256 = '3fc6181d5db789b45a15305732148757ae74efa3e0028e81ba335b462dac45c2'
        vcRuntime = $vcFiles
    }
    [IO.File]::WriteAllText((Join-Path $setup 'manifest.json'), ($manifest | ConvertTo-Json), $utf8)
    foreach ($launcher in @('Setup', 'Start')) {
        $launchFlag = if ($launcher -eq 'Start') { '-Launch' } else { '' }
        [IO.File]::WriteAllText((Join-Path $bundle "$launcher.bat"), "@echo off`r`npowershell.exe -NoProfile -ExecutionPolicy Bypass -File `"%~dp0setup\Setup.ps1`" $launchFlag %*`r`nif errorlevel 1 pause`r`n", $utf8)
    }
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Update.bat') -Destination (Join-Path $bundle 'Update.bat')
    [IO.File]::WriteAllText((Join-Path $bundle 'READ-ME.txt'), @'
1. Extract the ENTIRE ZIP into a permanent, writable folder on Windows 10/11 x64.
2. Double-click Setup.bat. Internet is required for this first setup.
3. Copy your database separately. Double-click Start.bat, then Open database.
4. For later app updates, close the app and double-click Update.bat.
   It pulls the latest published app from Z:\ChessExplorer\updates.

Setup reads CPU, RAM and NVIDIA GPU/driver information locally. It selects a
compatible PyTorch build and tests real Maia predictions. GTX 1070 with driver
560.76 or newer uses CUDA 12.6; unknown/unsupported GPUs use CPU. GPU test
failure falls back to CPU. GPU downloads can still be several GB: this approach
reduces what you COPY, not necessarily total download size or installed size.

To choose the smaller CPU installation explicitly, run: Setup.bat -CpuOnly
To detect hardware again or repair dependencies, run: Setup.bat -Recheck

Python, packages, model, download cache and hardware report stay in .runtime
inside this folder. No admin rights, Git, Node.js or compiler are needed.
Small Microsoft C++ runtime DLLs are included for local Python use.
Setup does not install/change GPU drivers, PATH, or machine-wide Python.
Only the app's engine profile is written to your Windows APPDATA folder;
an existing profile is backed up once as engines.json.before-bundle.
Future launches work offline. After moving the folder, rerun Setup.bat.
If downloads fail, rerun Setup.bat; browsing and Stockfish remain available
by opening app/Annotated Games Explorer.exe directly.
Close other copies of the app before setup. This ZIP contains no game databases.
'@, $utf8)
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = "$bundle.zip"
    [IO.Compression.ZipFile]::CreateFromDirectory($bundle, $zip, [IO.Compression.CompressionLevel]::Fastest, $true)
    Write-Host "Ready: $zip"
    Write-Host "ZIP size: $([Math]::Round((Get-Item -LiteralPath $zip).Length / 1MB)) MB"
} finally { Pop-Location }
