[CmdletBinding()]
param(
    [string]$ShareDirectory = 'Z:\ChessExplorer\updates',
    [switch]$SkipBuild,
    [string[]]$DatabasePaths = @(),
    [string]$PythonPath = 'python.exe'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repo = Split-Path $PSScriptRoot -Parent
if ($env:OS -ne 'Windows_NT') { throw 'Run this script on Windows.' }
Push-Location $repo
try {
    if (-not $SkipBuild) {
        & npm.cmd run dist:dir -- --win --x64
        if ($LASTEXITCODE -ne 0) { throw 'Windows app build failed; nothing published.' }
    }
    $app = Join-Path $repo 'release/win-unpacked'
    foreach ($file in @('Annotated Games Explorer.exe', 'resources/app.asar')) {
        if (-not (Test-Path -LiteralPath (Join-Path $app $file) -PathType Leaf)) { throw "Missing packaged app file: $file" }
    }
    $version = (Get-Content -LiteralPath (Join-Path $repo 'package.json') -Raw | ConvertFrom-Json).version
    # Every publish gets an ID even when package.json's version has not changed.
    $id = "$(Get-Date -Format 'yyyyMMdd-HHmmss')-$([guid]::NewGuid().ToString('N'))"
    $null = New-Item -ItemType Directory -Force -Path $ShareDirectory
    $share = (Resolve-Path -LiteralPath $ShareDirectory).Path
    $zip = Join-Path $repo "release/app-$id.zip"
    $pending = Join-Path $share "app-$id.zip.partial"
    $manifestTemp = Join-Path $share "latest-$id.json.partial"
    $dataStage = Join-Path $repo "release/data-$id"
    $dataPending = Join-Path $share "data-$id.partial"
    try {
        $databases = @()
        if ($DatabasePaths.Count -gt 0) {
            $names = @{}
            $null = New-Item -ItemType Directory -Path $dataStage
            foreach ($path in $DatabasePaths) {
                $source = (Resolve-Path -LiteralPath $path).Path
                $name = Split-Path $source -Leaf
                if ($name -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*\.(sqlite3|sqlite|db)$' -or $names.ContainsKey($name)) {
                    throw 'Database filenames must be unique, simple .sqlite3/.sqlite/.db names.'
                }
                $names[$name] = $true
                $snapshot = Join-Path $dataStage $name
                & $PythonPath -I (Join-Path $PSScriptRoot 'windows-release-data.py') snapshot $source $snapshot
                if ($LASTEXITCODE -ne 0) { throw "Database snapshot failed: $source" }
                $databases += @{ name = $name; file = "data-$id/$name"; sha256 = (Get-FileHash -LiteralPath $snapshot -Algorithm SHA256).Hash }
            }
            $null = New-Item -ItemType Directory -Path $dataPending
            foreach ($database in $databases) {
                $target = Join-Path $dataPending $database.name
                Copy-Item -LiteralPath (Join-Path $dataStage $database.name) -Destination $target
                if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $database.sha256) { throw 'Shared database checksum mismatch.' }
            }
            [IO.Directory]::Move($dataPending, (Join-Path $share "data-$id"))
        }
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        [IO.Compression.ZipFile]::CreateFromDirectory($app, $zip, [IO.Compression.CompressionLevel]::Fastest, $false)
        $hash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash
        Copy-Item -LiteralPath $zip -Destination $pending
        if ((Get-FileHash -LiteralPath $pending -Algorithm SHA256).Hash -ne $hash) { throw 'Shared copy checksum mismatch.' }
        [IO.File]::Move($pending, (Join-Path $share "app-$id.zip"))
        $manifest = @{ id = $id; version = $version; archive = "app-$id.zip"; sha256 = $hash }
        if ($databases.Count -gt 0) { $manifest.databases = @($databases) }
        # Publish helpers before the manifest, including on the first publication.
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'windows-release-data.py') -Destination (Join-Path $share 'windows-release-data.py') -Force
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'update-windows-app.ps1') -Destination (Join-Path $share 'Update-App.ps1') -Force
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Update.bat') -Destination (Join-Path $share 'Update.bat') -Force
        [IO.File]::WriteAllText($manifestTemp, ($manifest | ConvertTo-Json), (New-Object System.Text.UTF8Encoding($false)))
        # Readers see either the old complete release or the new complete release.
        $latest = Join-Path $share 'latest.json'
        if (Test-Path -LiteralPath $latest) { [IO.File]::Replace($manifestTemp, $latest, "$manifestTemp.previous") }
        else { [IO.File]::Move($manifestTemp, $latest) }
        Write-Host "Published app $version ($id) to $share"
    } finally {
        foreach ($file in @($zip, $pending, $manifestTemp, "$manifestTemp.previous")) {
            if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file -Force }
        }
        foreach ($directory in @($dataStage, $dataPending)) {
            if (Test-Path -LiteralPath $directory) {
                $resolved = (Resolve-Path -LiteralPath $directory).Path
                $expectedParent = if ($directory -eq $dataStage) { Join-Path $repo 'release' } else { $share }
                if ((Split-Path $resolved -Parent) -ne [IO.Path]::GetFullPath($expectedParent)) { throw 'Unexpected database staging path.' }
                Remove-Item -LiteralPath $resolved -Recurse -Force
            }
        }
    }
} finally { Pop-Location }
