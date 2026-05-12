param(
  [int]$BackendPort = 8000,
  [int]$FrontendPort = 5173,
  [switch]$NoBrowser,
  [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$BackendUrl = "http://127.0.0.1:$BackendPort"
$FrontendUrl = "http://127.0.0.1:$FrontendPort"

function Require-Command($Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command '$Name' was not found in PATH."
  }
}

function Test-Http($Url) {
  try {
    $response = Invoke-WebRequest $Url -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
  } catch {
    return $false
  }
}

function Start-BackgroundCommand($Name, $WorkingDirectory, $Command, $LogPath) {
  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = "powershell.exe"
  $psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -Command `"Set-Location '$WorkingDirectory'; $Command`""
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true

  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $psi
  $null = $process.Start()

  Write-Host "Started $Name (pid $($process.Id)); log: $LogPath"
}

function Wait-ForHttp($Url, $Name) {
  for ($i = 0; $i -lt 30; $i++) {
    if (Test-Http $Url) {
      Write-Host "$Name is ready: $Url"
      return
    }
    Start-Sleep -Seconds 1
  }
  Write-Warning "$Name did not respond yet. Check its log file."
}

Set-Location $RepoRoot
. "$PSScriptRoot\uv-env.ps1"

Require-Command "uv"
Require-Command "node"
Require-Command "npm"

if (-not (Test-Path "$RepoRoot\backend\.env")) {
  Copy-Item "$RepoRoot\backend\.env.example" "$RepoRoot\backend\.env"
  Write-Host "Created backend\.env from backend\.env.example"
}

if (-not $SkipInstall) {
  Write-Host "Syncing Python environment with uv..."
  uv sync --python 3.12

  if (-not (Test-Path "$RepoRoot\frontend\node_modules")) {
    Write-Host "Installing frontend dependencies..."
    Push-Location "$RepoRoot\frontend"
    npm install
    Pop-Location
  }
}

if (Test-Http "$BackendUrl/api/health") {
  Write-Host "Backend already running: $BackendUrl"
} else {
  Start-BackgroundCommand `
    -Name "backend" `
    -WorkingDirectory $RepoRoot `
    -Command ". '$PSScriptRoot\uv-env.ps1'; uv run uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port $BackendPort *> backend\server.log" `
    -LogPath "$RepoRoot\backend\server.log"
}

if (Test-Http $FrontendUrl) {
  Write-Host "Frontend already running: $FrontendUrl"
} else {
  Start-BackgroundCommand `
    -Name "frontend" `
    -WorkingDirectory "$RepoRoot\frontend" `
    -Command "npm run dev -- --host 127.0.0.1 --port $FrontendPort *> dev.log" `
    -LogPath "$RepoRoot\frontend\dev.log"
}

Wait-ForHttp "$BackendUrl/api/health" "Backend"
Wait-ForHttp $FrontendUrl "Frontend"

if (-not $NoBrowser) {
  Start-Process $FrontendUrl
}

Write-Host ""
Write-Host "TreeChat is running."
Write-Host "Frontend: $FrontendUrl"
Write-Host "Backend:  $BackendUrl"
Write-Host "Logs:"
Write-Host "  backend\server.log"
Write-Host "  frontend\dev.log"
