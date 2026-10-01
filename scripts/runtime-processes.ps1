function Get-ServiceRecordPath([string]$RepoRoot, [string]$Name, [int]$Port) {
  if ($Name -notin @("backend", "frontend") -or $Port -lt 1 -or $Port -gt 65535) {
    throw "Invalid YggdrasilTavern service identity."
  }
  $root = [IO.Path]::GetFullPath($RepoRoot)
  return Join-Path $root ".yggdrasil-runtime\$Name-$Port.json"
}

function Register-ServiceProcess([string]$RepoRoot, [string]$Name, [int]$Port, $Process) {
  $recordPath = Get-ServiceRecordPath $RepoRoot $Name $Port
  New-Item -ItemType Directory -Path (Split-Path -Parent $recordPath) -Force | Out-Null
  $record = [ordered]@{
    RepoRoot = [IO.Path]::GetFullPath($RepoRoot)
    Name = $Name
    Port = $Port
    ProcessId = $Process.Id
    StartedAtUtc = $Process.StartTime.ToUniversalTime().ToString("o")
    StartedAtUtcTicks = $Process.StartTime.ToUniversalTime().Ticks
    ExecutablePath = $Process.MainModule.FileName
  }
  $record | ConvertTo-Json | Set-Content -LiteralPath $recordPath -Encoding UTF8
}

function Test-ServiceProcessIdentity($Record, $Process) {
  if ($null -eq $Process) { return $false }
  return $Process.Id -eq $Record.ProcessId -and
    $Process.StartTime.ToUniversalTime().Ticks -eq [long]$Record.StartedAtUtcTicks -and
    $Process.MainModule.FileName -eq $Record.ExecutablePath
}

function Stop-ServiceProcess([string]$RepoRoot, [string]$Name, [int]$Port) {
  $recordPath = Get-ServiceRecordPath $RepoRoot $Name $Port
  if (-not (Test-Path -LiteralPath $recordPath -PathType Leaf)) {
    Write-Host "No recorded $Name process on port $Port. No process was stopped."
    return
  }
  $record = Get-Content -LiteralPath $recordPath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
  if ($record.RepoRoot -ne [IO.Path]::GetFullPath($RepoRoot) -or $record.Name -ne $Name -or
      $record.Port -ne $Port -or -not $record.ProcessId -or -not $record.StartedAtUtcTicks -or -not $record.ExecutablePath) {
    throw "Invalid process record: $recordPath. No process was stopped."
  }
  $process = Get-Process -Id $record.ProcessId -ErrorAction SilentlyContinue
  if (-not (Test-ServiceProcessIdentity $record $process)) {
    Write-Warning "The recorded $Name process has exited or its identity changed. No process was stopped."
    Remove-Item -LiteralPath $recordPath -ErrorAction Stop
    return
  }

  # Capture descendants and their creation times before stopping the launcher.
  # A later PID reuse must never authorize stopping an unrelated process.
  $snapshot = @(Get-CimInstance Win32_Process -ErrorAction Stop)
  $descendants = [Collections.Generic.List[object]]::new()
  $queue = [Collections.Generic.Queue[object]]::new()
  $queue.Enqueue([pscustomobject]@{
    ProcessId = [int]$record.ProcessId
    CreatedAtUtc = $process.StartTime.ToUniversalTime()
  })
  while ($queue.Count -gt 0) {
    $parent = $queue.Dequeue()
    foreach ($child in @($snapshot | Where-Object {
      $_.ParentProcessId -eq $parent.ProcessId -and $_.CreationDate.ToUniversalTime() -ge $parent.CreatedAtUtc
    })) {
      $descendants.Add($child)
      $queue.Enqueue([pscustomobject]@{
        ProcessId = [int]$child.ProcessId
        CreatedAtUtc = $child.CreationDate.ToUniversalTime()
      })
    }
  }
  # Stop the launcher first so it cannot create new children during shutdown.
  if (-not (Test-ServiceProcessIdentity $record (Get-Process -Id $record.ProcessId -ErrorAction SilentlyContinue))) {
    throw "The $Name launcher identity changed during shutdown."
  }
  Stop-Process -Id $record.ProcessId -Force -ErrorAction Stop
  for ($index = $descendants.Count - 1; $index -ge 0; $index--) {
    $child = $descendants[$index]
    $current = Get-CimInstance Win32_Process -Filter "ProcessId = $($child.ProcessId)" -ErrorAction Stop
    if ($null -ne $current -and $current.CreationDate -eq $child.CreationDate) {
      Stop-Process -Id $child.ProcessId -Force -ErrorAction Stop
    }
  }
  Remove-Item -LiteralPath $recordPath -ErrorAction Stop
  Write-Host "Stopped recorded $Name launcher and its child processes on port $Port."
}
