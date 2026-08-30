param(
  [ValidateRange(1, 65535)]
  [int]$BackendPort = 8000,
  [ValidateRange(1, 65535)]
  [int]$FrontendPort = 5173,
  [switch]$Lan,
  [string]$HttpsCertificate,
  [string]$HttpsPrivateKey,
  [switch]$NoBrowser,
  [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
Add-Type -AssemblyName System.Net.Http

if ($BackendPort -eq $FrontendPort) {
  throw "BackendPort and FrontendPort must be different."
}

function Require-Command($Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command '$Name' was not found in PATH."
  }
}

function Resolve-RequiredFile($Path, $Label) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "$Label was not found: $Path"
  }
  return (Resolve-Path -LiteralPath $Path).Path
}

function ConvertTo-PowerShellLiteral($Value) {
  return "'" + ([string]$Value).Replace("'", "''") + "'"
}

function Test-TcpPort($Port) {
  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $task = $client.ConnectAsync("127.0.0.1", $Port)
    return $task.Wait(300) -and $client.Connected
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

function Test-Http($Url, [switch]$AllowUntrustedCertificate) {
  $handler = [System.Net.Http.HttpClientHandler]::new()
  $client = $null
  $response = $null
  try {
    if ($AllowUntrustedCertificate) {
      $handler.ServerCertificateCustomValidationCallback = {
        param($RequestMessage, $Certificate, $Chain, $SslPolicyErrors)
        return $true
      }
    }
    $client = [System.Net.Http.HttpClient]::new($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(2)
    $response = $client.GetAsync($Url).GetAwaiter().GetResult()
    return [int]$response.StatusCode -ge 200 -and [int]$response.StatusCode -lt 500
  } catch {
    return $false
  } finally {
    if ($null -ne $response) {
      $response.Dispose()
    }
    if ($null -ne $client) {
      $client.Dispose()
    } else {
      $handler.Dispose()
    }
  }
}

function New-AuthenticationSecret {
  $bytes = [byte[]]::new(32)
  $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $generator.GetBytes($bytes)
    return [Convert]::ToBase64String($bytes)
  } finally {
    $generator.Dispose()
    [Array]::Clear($bytes, 0, $bytes.Length)
  }
}

function Read-LanCredentials {
  do {
    $username = (Read-Host "LAN login username").Trim()
    if (-not $username) {
      Write-Warning "Username cannot be empty."
    }
  } while (-not $username)

  while ($true) {
    $securePassword = Read-Host "LAN login password (at least 12 characters)" -AsSecureString
    $secureConfirmation = Read-Host "Confirm LAN login password" -AsSecureString
    try {
      $password = ([System.Net.NetworkCredential]::new("", $securePassword)).Password
      $confirmation = ([System.Net.NetworkCredential]::new("", $secureConfirmation)).Password
      if ($password.Length -lt 12) {
        Write-Warning "Password must contain at least 12 characters."
        continue
      }
      if ($password -cne $confirmation) {
        Write-Warning "Passwords do not match."
        continue
      }
      return [pscustomobject]@{
        Username = $username
        Password = $password
      }
    } finally {
      $password = $null
      $confirmation = $null
      if ($null -ne $securePassword) {
        $securePassword.Dispose()
      }
      if ($null -ne $secureConfirmation) {
        $secureConfirmation.Dispose()
      }
    }
  }
}

function Start-BackgroundCommand($Name, $WorkingDirectory, $Command, $LogPath, [hashtable]$EnvironmentVariables = @{}) {
  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = "powershell.exe"
  $psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -Command `"$Command`""
  $psi.WorkingDirectory = $WorkingDirectory
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true

  foreach ($entry in $EnvironmentVariables.GetEnumerator()) {
    $psi.EnvironmentVariables[[string]$entry.Key] = [string]$entry.Value
  }

  try {
    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $psi
    if (-not $process.Start()) {
      throw "Failed to start $Name."
    }
    Write-Host "Started $Name (pid $($process.Id)); log: $LogPath"
  } finally {
    foreach ($key in @($EnvironmentVariables.Keys)) {
      $psi.EnvironmentVariables.Remove([string]$key)
    }
    $EnvironmentVariables.Clear()
  }
}

function Wait-ForHttp($Url, $Name, [switch]$AllowUntrustedCertificate) {
  for ($i = 0; $i -lt 30; $i++) {
    if (Test-Http $Url -AllowUntrustedCertificate:$AllowUntrustedCertificate) {
      Write-Host "$Name is ready: $Url"
      return
    }
    Start-Sleep -Seconds 1
  }
  throw "$Name did not respond within 30 seconds. Check its log file."
}

function Get-LanAddresses {
  try {
    return @(
      Get-NetIPAddress -AddressFamily IPv4 -AddressState Preferred -ErrorAction Stop |
        Where-Object {
          -not $_.SkipAsSource -and
          $_.IPAddress -notmatch '^(127\.|169\.254\.)'
        } |
        Select-Object -ExpandProperty IPAddress -Unique
    )
  } catch {
    Write-Warning "Could not enumerate LAN addresses: $($_.Exception.Message)"
    return @()
  }
}

$hasCertificate = -not [string]::IsNullOrWhiteSpace($HttpsCertificate)
$hasPrivateKey = -not [string]::IsNullOrWhiteSpace($HttpsPrivateKey)
if ($hasCertificate -xor $hasPrivateKey) {
  throw "HTTPS requires both -HttpsCertificate and -HttpsPrivateKey."
}

$UseHttps = $hasCertificate -and $hasPrivateKey
if ($UseHttps) {
  $HttpsCertificate = Resolve-RequiredFile $HttpsCertificate "HTTPS certificate"
  $HttpsPrivateKey = Resolve-RequiredFile $HttpsPrivateKey "HTTPS private key"
}
if ($Lan -and -not $UseHttps) {
  Write-Warning "LAN is starting over plaintext HTTP. Passwords, cookies, prompts, and API keys can be intercepted or modified. Use HTTPS unless this is an isolated trusted network."
}

$BackendHost = "127.0.0.1"
$FrontendHost = if ($Lan) { "0.0.0.0" } else { "127.0.0.1" }
$FrontendScheme = if ($UseHttps) { "https" } else { "http" }
$BackendUrl = "http://127.0.0.1:$BackendPort"
$FrontendUrl = "${FrontendScheme}://127.0.0.1:$FrontendPort"

Set-Location $RepoRoot
. "$PSScriptRoot\uv-env.ps1"

Require-Command "uv"
Require-Command "node"
Require-Command "npm"

if ($Lan -or $UseHttps) {
  $occupiedPorts = @(@($BackendPort, $FrontendPort) | Where-Object { Test-TcpPort $_ })
  if ($occupiedPorts.Count -gt 0) {
    throw "LAN/HTTPS startup requires clean ports. Stop the existing servers first; occupied: $($occupiedPorts -join ', ')."
  }
}

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
    try {
      npm install
    } finally {
      Pop-Location
    }
  }
}

$BackendEnvironment = @{}
if ($Lan) {
  $credentials = Read-LanCredentials
  $BackendEnvironment["YGGDRASIL_AUTH_ENABLED"] = "1"
  $BackendEnvironment["YGGDRASIL_AUTH_USERNAME"] = $credentials.Username
  $BackendEnvironment["YGGDRASIL_AUTH_PASSWORD"] = $credentials.Password
  $BackendEnvironment["YGGDRASIL_AUTH_SECRET"] = New-AuthenticationSecret
  if ($UseHttps) {
    $BackendEnvironment["YGGDRASIL_AUTH_COOKIE_SECURE"] = "1"
  }
  $credentials.Password = $null
  $credentials = $null
}

$uvEnvironmentScript = ConvertTo-PowerShellLiteral "$PSScriptRoot\uv-env.ps1"
$BackendCommand = ". $uvEnvironmentScript; uv run uvicorn app.main:app --app-dir backend --host $BackendHost --port $BackendPort *> backend\server.log"
$CanReuseExistingServers = -not $Lan -and -not $UseHttps

if ($CanReuseExistingServers -and (Test-Http "$BackendUrl/api/health")) {
  Write-Host "Backend already running: $BackendUrl"
} else {
  Start-BackgroundCommand `
    -Name "backend" `
    -WorkingDirectory $RepoRoot `
    -Command $BackendCommand `
    -LogPath "$RepoRoot\backend\server.log" `
    -EnvironmentVariables $BackendEnvironment
}

$FrontendEnvironment = @{
  "YGGDRASIL_BACKEND_ORIGIN" = $BackendUrl
}
if ($UseHttps) {
  $FrontendEnvironment["YGGDRASIL_HTTPS_CERT_FILE"] = $HttpsCertificate
  $FrontendEnvironment["YGGDRASIL_HTTPS_KEY_FILE"] = $HttpsPrivateKey
}

if ($CanReuseExistingServers -and (Test-Http $FrontendUrl)) {
  Write-Host "Frontend already running: $FrontendUrl"
} else {
  Start-BackgroundCommand `
    -Name "frontend" `
    -WorkingDirectory "$RepoRoot\frontend" `
    -Command "npm run dev -- --host $FrontendHost --port $FrontendPort *> dev.log" `
    -LogPath "$RepoRoot\frontend\dev.log" `
    -EnvironmentVariables $FrontendEnvironment
}

Wait-ForHttp "$BackendUrl/api/health" "Backend"
Wait-ForHttp $FrontendUrl "Frontend" -AllowUntrustedCertificate:$UseHttps

if (-not $NoBrowser) {
  Start-Process $FrontendUrl
}

Write-Host ""
Write-Host "YggdrasilTavern is running."
Write-Host "Frontend (this computer): $FrontendUrl"
if ($Lan) {
  $lanAddresses = Get-LanAddresses
  if ($lanAddresses.Count -eq 0) {
    Write-Host "LAN: ${FrontendScheme}://<this-computer-LAN-IP>:$FrontendPort"
  } else {
    foreach ($address in $lanAddresses) {
      Write-Host "LAN: ${FrontendScheme}://${address}:$FrontendPort"
    }
  }
  Write-Host "Backend remains on loopback; LAN API traffic is authenticated through the Vite proxy."
} else {
  Write-Host "Backend: $BackendUrl"
}
Write-Host "Logs:"
Write-Host "  backend\server.log"
Write-Host "  frontend\dev.log"
