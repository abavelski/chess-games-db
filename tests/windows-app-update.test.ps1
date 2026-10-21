$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repo = Split-Path $PSScriptRoot -Parent
$fixture = Join-Path $repo "test-results/windows-update-$([guid]::NewGuid().ToString('N'))"
$null = New-Item -ItemType Directory -Path (Join-Path $fixture 'scripts') -Force
function Assert([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Run-Script([string]$Script, [string[]]$Arguments, [bool]$ExpectSuccess = $true) {
    $ErrorActionPreference = 'Continue'
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Script @Arguments 2>&1 | Out-String | Write-Host
    Assert (($LASTEXITCODE -eq 0) -eq $ExpectSuccess) "Unexpected result from $Script (exit $LASTEXITCODE)"
}
try {
    Copy-Item -LiteralPath (Join-Path $repo 'scripts/publish-windows-update.ps1') -Destination (Join-Path $fixture 'scripts')
    Copy-Item -LiteralPath (Join-Path $repo 'scripts/update-windows-app.ps1') -Destination (Join-Path $fixture 'scripts')
    Copy-Item -LiteralPath (Join-Path $repo 'scripts/Update.bat') -Destination (Join-Path $fixture 'scripts')
    Copy-Item -LiteralPath (Join-Path $repo 'scripts/windows-release-data.py') -Destination (Join-Path $fixture 'scripts')
    $publish = Join-Path $fixture 'scripts/publish-windows-update.ps1'
    $update = Join-Path $fixture 'scripts/update-windows-app.ps1'
    $share = Join-Path $fixture 'share with spaces'
    $app = Join-Path $fixture 'release/win-unpacked'
    $install = Join-Path $fixture 'son/app'
    $null = New-Item -ItemType Directory -Path (Join-Path $app 'resources') -Force
    $null = New-Item -ItemType Directory -Path (Join-Path $install 'resources') -Force
    Set-Content -LiteralPath (Join-Path $fixture 'package.json') -Value '{"version":"0.1.0"}'
    foreach ($file in @('Annotated Games Explorer.exe', 'resources/app.asar')) {
        Set-Content -LiteralPath (Join-Path $app $file) -Value 'new app'
        Set-Content -LiteralPath (Join-Path $install $file) -Value 'old app'
    }
    Set-Content -LiteralPath (Join-Path $fixture 'son/database.sqlite3') -Value 'personal data'
    Run-Script $publish @('-ShareDirectory', $share, '-SkipBuild')
    Assert (Test-Path -LiteralPath (Join-Path $share 'Update.bat')) 'Missing published Update.bat launcher'
    Run-Script $update @('-ShareDirectory', $share, '-InstallDirectory', $install)
    Assert ((Get-Content -LiteralPath (Join-Path $install 'Annotated Games Explorer.exe')) -eq 'new app') 'App was not replaced'
    Assert ((Get-Content -LiteralPath (Join-Path $fixture 'son/database.sqlite3')) -eq 'personal data') 'Database changed'
    $backups = @(Get-ChildItem -LiteralPath (Join-Path $fixture 'son') -Directory -Filter 'app.before-update-*')
    Assert ($backups.Count -eq 1) 'Missing rollback backup'
    Assert ((Get-Content -LiteralPath (Join-Path $backups[0].FullName 'Annotated Games Explorer.exe')) -eq 'old app') 'Backup lost original app'
    Run-Script $update @('-ShareDirectory', $share, '-InstallDirectory', $install)
    Assert (@(Get-ChildItem -LiteralPath (Join-Path $fixture 'son') -Directory -Filter 'app.before-update-*').Count -eq 1) 'Repeat update should do nothing'
    # Publish again with the same package version: replacing latest.json must work.
    Run-Script $publish @('-ShareDirectory', $share, '-SkipBuild')
    Run-Script $update @('-ShareDirectory', $share, '-InstallDirectory', $install)
    Assert (@(Get-ChildItem -LiteralPath (Join-Path $fixture 'son') -Directory -Filter 'app.before-update-*').Count -eq 2) 'Same-version publication was skipped'
    Run-Script $publish @('-ShareDirectory', $share, '-SkipBuild')
    $latest = Get-Content -LiteralPath (Join-Path $share 'latest.json') -Raw | ConvertFrom-Json
    Add-Content -LiteralPath (Join-Path $share $latest.archive) -Value 'corrupt transfer'
    Run-Script $update @('-ShareDirectory', $share, '-InstallDirectory', $install) $false
    Assert ((Get-Content -LiteralPath (Join-Path $install '.network-update.json') -Raw | ConvertFrom-Json).id -ne $latest.id) 'Failed update changed installed receipt'
    Assert (@(Get-ChildItem -LiteralPath (Join-Path $fixture 'son') -Directory -Filter 'app.before-update-*').Count -eq 2) 'Failed update touched app'
    Assert (@(Get-ChildItem -LiteralPath (Join-Path $fixture 'son') -Directory -Filter '.app-update-*').Count -eq 0) 'Staging files left behind'
    Write-Host 'Windows app publish/update integration checks passed.'
} finally {
    $resolved = (Resolve-Path -LiteralPath $fixture).Path
    $expectedParent = [IO.Path]::GetFullPath((Join-Path $repo 'test-results'))
    if ((Split-Path $resolved -Parent) -ne $expectedParent) { throw 'Unexpected test cleanup path.' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
