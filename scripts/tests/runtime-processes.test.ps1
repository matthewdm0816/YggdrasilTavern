$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
. "$repoRoot\scripts\runtime-processes.ps1"
$testRoot = Join-Path $repoRoot (".uv-cache\launcher-test-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
$childFile = Join-Path $testRoot "child-pid.txt"
$escapedChildFile = $childFile.Replace("'", "''")
$command = "`$child = Start-Process powershell.exe -ArgumentList '-NoProfile -Command Start-Sleep -Seconds 90' -WindowStyle Hidden -PassThru; `$child.Id | Set-Content -LiteralPath '$escapedChildFile'; Start-Sleep -Seconds 90"
$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
$launcher = $null
$unrelated = $null
$ownedChild = $null

try {
  $launcher = Start-Process powershell.exe -ArgumentList "-NoProfile -EncodedCommand $encoded" -WindowStyle Hidden -PassThru
  $unrelated = Start-Process powershell.exe -ArgumentList "-NoProfile -Command Start-Sleep -Seconds 90" -WindowStyle Hidden -PassThru
  for ($attempt = 0; $attempt -lt 40 -and -not (Test-Path -LiteralPath $childFile); $attempt++) {
    Start-Sleep -Milliseconds 100
  }
  if (-not (Test-Path -LiteralPath $childFile)) { throw "Test child process did not start." }
  $ownedChild = Get-Process -Id ([int](Get-Content -LiteralPath $childFile)) -ErrorAction Stop

  Stop-ServiceProcess $testRoot "frontend" 5173
  if ($launcher.HasExited -or $unrelated.HasExited) { throw "An unrecorded process was stopped." }

  Register-ServiceProcess $testRoot "backend" 8000 $launcher
  $recordPath = Get-ServiceRecordPath $testRoot "backend" 8000
  $record = Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
  $record.StartedAtUtcTicks = 1
  $record | ConvertTo-Json | Set-Content -LiteralPath $recordPath -Encoding UTF8
  Stop-ServiceProcess $testRoot "backend" 8000
  if ($launcher.HasExited -or $ownedChild.HasExited) { throw "A stale identity authorized process termination." }

  Register-ServiceProcess $testRoot "backend" 8000 $launcher
  Stop-ServiceProcess $testRoot "backend" 8000
  if (-not $launcher.WaitForExit(5000) -or -not $ownedChild.WaitForExit(5000)) {
    throw "Recorded launcher or its child was not stopped."
  }
  if ($unrelated.HasExited) { throw "An unrelated process was stopped." }
  if (Test-Path -LiteralPath $recordPath) { throw "Completed process record was not removed." }
  Write-Host "PASS: missing and stale records preserve processes; valid records stop only the owned process tree."
} finally {
  # Clean up only the exact test processes captured above.
  foreach ($process in @($ownedChild, $launcher, $unrelated)) {
    if ($null -ne $process) {
      if (-not $process.HasExited) { $process.Kill() }
      $process.Dispose()
    }
  }
}
