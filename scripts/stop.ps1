param(
  [int]$BackendPort = 8000,
  [int]$FrontendPort = 5173
)

$ErrorActionPreference = "Stop"
$Ports = @($BackendPort, $FrontendPort)

function Stop-PortProcess($Port) {
  $connections = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
  $pids = @()
  if ($connections) {
    $pids += $connections |
    Where-Object { $_.State -eq "Listen" } |
    Select-Object -ExpandProperty OwningProcess -Unique
  }

  if (-not $pids) {
    $netstatLines = netstat -ano | Select-String ":$Port\s"
    $pids += $netstatLines |
      ForEach-Object {
        $parts = ($_.Line.Trim() -split "\s+")
        if ($parts.Length -ge 5 -and $parts[3] -eq "LISTENING") {
          [int]$parts[4]
        }
      } |
      Sort-Object -Unique
  }

  if (-not $pids) {
    Write-Host "No process is listening on port $Port."
    return
  }

  foreach ($processId in $pids) {
    try {
      $process = Get-Process -Id $processId -ErrorAction Stop
      Stop-Process -Id $processId -Force
      Write-Host "Stopped $($process.ProcessName) pid $processId on port $Port."
    } catch {
      Write-Warning "Could not stop pid $processId on port ${Port}: $($_.Exception.Message)"
    }
  }
}

foreach ($port in $Ports) {
  Stop-PortProcess $port
}

Write-Host "TreeChat stop command finished."
