[CmdletBinding()]
param(
    [string]$ShareDirectory = 'Z:\ChessExplorer\updates',
    [string]$PythonPath = 'python.exe',
    [switch]$SkipBuild
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
# One command for this checkout's two indexed libraries. The receiving PC maps
# these published filenames to its own existing paths in database-updates.json.
$repo = Split-Path $PSScriptRoot -Parent
& (Join-Path $PSScriptRoot 'publish-windows-update.ps1') `
    -ShareDirectory $ShareDirectory -PythonPath $PythonPath -SkipBuild:$SkipBuild `
    -DatabasePaths @(
        (Join-Path $repo 'data/annotated-games-v7-final.sqlite3'),
        (Join-Path $repo 'data/megabase-all-ru-en.sqlite3')
    )
