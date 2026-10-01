param(
  [int]$BackendPort = 8000,
  [int]$FrontendPort = 5173
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
. "$PSScriptRoot\runtime-processes.ps1"
Stop-ServiceProcess $RepoRoot "backend" $BackendPort
Stop-ServiceProcess $RepoRoot "frontend" $FrontendPort

Write-Host "TreeChat stop command finished."
