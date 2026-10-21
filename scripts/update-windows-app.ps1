[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$InstallDirectory,
    [string]$ShareDirectory = 'Z:\ChessExplorer\updates',
    [string]$DatabaseConfig,
    [string]$PythonPath,
    [switch]$CheckOnly
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:OS -ne 'Windows_NT') { throw 'Run this script on Windows.' }
# Select the folder containing the app EXE (the bootstrap bundle's app folder).
$app = [IO.Path]::GetFullPath($InstallDirectory).TrimEnd('\')
$exe = 'Annotated Games Explorer.exe'
$parent = Split-Path $app -Parent
$leaf = Split-Path $app -Leaf
if (-not $parent -or -not $leaf) { throw 'The app folder cannot be a drive root.' }
$lock = [IO.File]::Open((Join-Path $parent ".$leaf-update.lock"), 'OpenOrCreate', 'ReadWrite', 'None')
$stage = $null
function Find-Python {
    if ($PythonPath) { return $PythonPath }
    $bundled = Join-Path $parent '.runtime/maia/Scripts/python.exe'
    if (Test-Path -LiteralPath $bundled -PathType Leaf) { return $bundled }
    return 'python.exe'
}
try {
    $journal = Join-Path $parent ".$leaf-release-journal.json"
    if (Test-Path -LiteralPath $journal) {
        if (Get-Process -Name 'Annotated Games Explorer' -ErrorAction SilentlyContinue) { throw 'Close Annotated Games Explorer before recovery.' }
        $helper = Join-Path $PSScriptRoot 'windows-release-data.py'
        & (Find-Python) -I $helper recover $journal
        if ($LASTEXITCODE -ne 0) { throw "Interrupted update needs recovery; keep $journal and all backups." }
    }
    if (-not (Test-Path -LiteralPath (Join-Path $app $exe) -PathType Leaf) -or
        -not (Test-Path -LiteralPath (Join-Path $app 'resources/app.asar') -PathType Leaf)) {
        throw 'InstallDirectory must be the portable app folder containing Annotated Games Explorer.exe and resources/app.asar.'
    }
    if (-not (Test-Path -LiteralPath $ShareDirectory -PathType Container)) { throw "Update share is unavailable: $ShareDirectory" }
    $latest = Join-Path $ShareDirectory 'latest.json'
    if (-not (Test-Path -LiteralPath $latest)) { Write-Host 'No app update published yet.'; return }
    $release = Get-Content -LiteralPath $latest -Raw | ConvertFrom-Json
    if ($release.id -notmatch '^\d{8}-\d{6}-[a-f0-9]{32}$' -or
        $release.archive -cne "app-$($release.id).zip" -or $release.sha256 -notmatch '^[A-Fa-f0-9]{64}$') {
        throw 'Invalid update manifest.'
    }
    $databases = @()
    $configHash = ''
    if ($release.PSObject.Properties['databases']) {
        $databases = @($release.databases)
        if (-not $DatabaseConfig) { $DatabaseConfig = Join-Path $parent 'database-updates.json' }
        if (-not (Test-Path -LiteralPath $DatabaseConfig -PathType Leaf)) {
            throw "This release includes databases. Create the local mapping first: $DatabaseConfig (see docs/windows-release.md). Nothing replaced."
        }
        $mapping = Get-Content -LiteralPath $DatabaseConfig -Raw | ConvertFrom-Json
        $configHash = (Get-FileHash -LiteralPath $DatabaseConfig -Algorithm SHA256).Hash
        $seen = @{}
        foreach ($database in $databases) {
            if ($database.name -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*\.(sqlite3|sqlite|db)$' -or
                $database.file -cne "data-$($release.id)/$($database.name)" -or
                $database.sha256 -notmatch '^[A-Fa-f0-9]{64}$' -or $seen.ContainsKey($database.name)) { throw 'Invalid database manifest.' }
            $seen[$database.name] = $true
            if (-not $mapping.PSObject.Properties[$database.name]) { throw "No local target configured for $($database.name). Nothing replaced." }
            $target = [string]$mapping.PSObject.Properties[$database.name].Value
            if (-not [IO.Path]::IsPathRooted($target) -or -not (Test-Path -LiteralPath $target -PathType Leaf)) { throw "Database target must be an existing absolute local path: $target" }
            if ($target.StartsWith('\\')) { throw 'Receiving databases must be on a local disk, not a network share.' }
        }
    }
    $receipt = Join-Path $app '.network-update.json'
    if (Test-Path -LiteralPath $receipt) {
        $installed = Get-Content -LiteralPath $receipt -Raw | ConvertFrom-Json
        $sameConfig = $databases.Count -eq 0 -or ($installed.PSObject.Properties['databaseConfigSha256'] -and $installed.databaseConfigSha256 -eq $configHash)
        if (-not $CheckOnly -and $sameConfig -and $installed.id -eq $release.id -and $installed.sha256 -eq $release.sha256) {
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
    if ($databases.Count -gt 0) { $release | Add-Member -NotePropertyName databaseConfigSha256 -NotePropertyValue $configHash }
    [IO.File]::WriteAllText((Join-Path $replacement '.network-update.json'), ($release | ConvertTo-Json -Depth 8), (New-Object System.Text.UTF8Encoding($false)))
    if (Get-Process -Name 'Annotated Games Explorer' -ErrorAction SilentlyContinue) { throw 'Close Annotated Games Explorer, then run the updater again.' }
    if ($databases.Count -gt 0) {
        $plan = @()
        foreach ($database in $databases) {
            $incoming = Join-Path $stage $database.name
            Write-Host "Copying prebuilt database and indexes: $($database.name)..."
            Copy-Item -LiteralPath (Join-Path $ShareDirectory $database.file) -Destination $incoming
            $plan += @{ incoming = $incoming; target = [string]$mapping.PSObject.Properties[$database.name].Value; sha256 = $database.sha256 }
        }
        $planPath = Join-Path $stage 'database-plan.json'
        [IO.File]::WriteAllText($planPath, (ConvertTo-Json -InputObject @($plan) -Depth 8), (New-Object System.Text.UTF8Encoding($false)))
        $arguments = @('-I', (Join-Path $PSScriptRoot 'windows-release-data.py'), 'apply', $planPath, $app, $replacement)
        if ($CheckOnly) { $arguments += '--check-only' }
        & (Find-Python) @arguments
        if ($LASTEXITCODE -ne 0) { throw 'Release update failed. See the error above; keep any recovery journal and backups.' }
        if (-not $CheckOnly) { Write-Host "Installed app $($release.version) and databases with existing study work preserved." }
        return
    }
    if ($CheckOnly) { Write-Host 'App preflight passed. Nothing replaced.'; return }
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
