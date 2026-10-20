[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$InstallDirectory,
    [string]$ShareDirectory = 'Z:\ChessExplorer\updates'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:OS -ne 'Windows_NT') { throw 'Run this script on Windows.' }
# Select the folder containing the app EXE (the bootstrap bundle's app folder).
$app = (Resolve-Path -LiteralPath $InstallDirectory).Path.TrimEnd('\')
$exe = 'Annotated Games Explorer.exe'
if (-not (Test-Path -LiteralPath (Join-Path $app $exe) -PathType Leaf) -or
    -not (Test-Path -LiteralPath (Join-Path $app 'resources/app.asar') -PathType Leaf)) {
    throw 'InstallDirectory must be the portable app folder containing Annotated Games Explorer.exe and resources/app.asar.'
}
$parent = Split-Path $app -Parent
$leaf = Split-Path $app -Leaf
if (-not $parent -or -not $leaf) { throw 'The app folder cannot be a drive root.' }
$lock = [IO.File]::Open((Join-Path $parent ".$leaf-update.lock"), 'OpenOrCreate', 'ReadWrite', 'None')
$stage = $null
try {
    if (-not (Test-Path -LiteralPath $ShareDirectory -PathType Container)) { throw "Update share is unavailable: $ShareDirectory" }
    $latest = Join-Path $ShareDirectory 'latest.json'
    if (-not (Test-Path -LiteralPath $latest)) { Write-Host 'No app update published yet.'; return }
    $release = Get-Content -LiteralPath $latest -Raw | ConvertFrom-Json
    if ($release.id -notmatch '^\d{8}-\d{6}-[a-f0-9]{32}$' -or
        $release.archive -cne "app-$($release.id).zip" -or $release.sha256 -notmatch '^[A-Fa-f0-9]{64}$') {
        throw 'Invalid update manifest.'
    }
    $receipt = Join-Path $app '.network-update.json'
    if (Test-Path -LiteralPath $receipt) {
        $installed = Get-Content -LiteralPath $receipt -Raw | ConvertFrom-Json
        if ($installed.id -eq $release.id -and $installed.sha256 -eq $release.sha256) {
            Write-Host "Already up to date ($($release.version))."; return
        }
    }
    if (Get-Process -Name 'Annotated Games Explorer' -ErrorAction SilentlyContinue) { throw 'Close Annotated Games Explorer, then run the updater again.' }
    $stage = Join-Path $parent ".$leaf-update-$([guid]::NewGuid().ToString('N'))"
    $null = New-Item -ItemType Directory -Path $stage
    $zip = Join-Path $stage 'app.zip'
    Write-Host "Copying app update $($release.version)..."
    Copy-Item -LiteralPath (Join-Path $ShareDirectory $release.archive) -Destination $zip
    if ((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash -ne $release.sha256) { throw 'Update checksum mismatch; existing app has not been changed.' }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $replacement = Join-Path $stage 'app'
    [IO.Compression.ZipFile]::ExtractToDirectory($zip, $replacement)
    foreach ($file in @($exe, 'resources/app.asar')) {
        if (-not (Test-Path -LiteralPath (Join-Path $replacement $file) -PathType Leaf)) { throw "Incomplete update: $file" }
    }
    [IO.File]::WriteAllText((Join-Path $replacement '.network-update.json'), ($release | ConvertTo-Json), (New-Object System.Text.UTF8Encoding($false)))
    if (Get-Process -Name 'Annotated Games Explorer' -ErrorAction SilentlyContinue) { throw 'Close Annotated Games Explorer, then run the updater again.' }
    $backup = Join-Path $parent "$leaf.before-update-$([guid]::NewGuid().ToString('N'))"
    [IO.Directory]::Move($app, $backup)
    try { [IO.Directory]::Move($replacement, $app) }
    catch { [IO.Directory]::Move($backup, $app); throw }
    Write-Host "Installed app $($release.version). Start the app as usual."
    Write-Host "Previous app saved in: $backup"
} finally {
    $lock.Dispose()
    if ($stage -and (Test-Path -LiteralPath $stage)) {
        # Only remove the unique staging directory created by this invocation.
        $resolvedStage = (Resolve-Path -LiteralPath $stage).Path
        if ((Split-Path $resolvedStage -Parent) -ne $parent -or
            (Split-Path $resolvedStage -Leaf) -notmatch ('^\.' + [regex]::Escape($leaf) + '-update-[a-f0-9]{32}$')) { throw 'Unexpected staging path; refusing cleanup.' }
        Remove-Item -LiteralPath $resolvedStage -Recurse -Force
    }
}
