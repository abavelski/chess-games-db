[CmdletBinding()]
param(
    [string]$ShareDirectory = 'Z:\ChessExplorer\updates',
    [switch]$SkipBuild
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
    try {
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        [IO.Compression.ZipFile]::CreateFromDirectory($app, $zip, [IO.Compression.CompressionLevel]::Fastest, $false)
        $hash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash
        Copy-Item -LiteralPath $zip -Destination $pending
        if ((Get-FileHash -LiteralPath $pending -Algorithm SHA256).Hash -ne $hash) { throw 'Shared copy checksum mismatch.' }
        [IO.File]::Move($pending, (Join-Path $share "app-$id.zip"))
        $manifest = @{ id = $id; version = $version; archive = "app-$id.zip"; sha256 = $hash }
        [IO.File]::WriteAllText($manifestTemp, ($manifest | ConvertTo-Json), (New-Object System.Text.UTF8Encoding($false)))
        # Readers see either the old complete release or the new complete release.
        $latest = Join-Path $share 'latest.json'
        if (Test-Path -LiteralPath $latest) { [IO.File]::Replace($manifestTemp, $latest, "$manifestTemp.previous") }
        else { [IO.File]::Move($manifestTemp, $latest) }
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'update-windows-app.ps1') -Destination (Join-Path $share 'Update-App.ps1') -Force
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Update.bat') -Destination (Join-Path $share 'Update.bat') -Force
        Write-Host "Published app $version ($id) to $share"
    } finally {
        foreach ($file in @($zip, $pending, $manifestTemp, "$manifestTemp.previous")) {
            if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file -Force }
        }
    }
} finally { Pop-Location }
