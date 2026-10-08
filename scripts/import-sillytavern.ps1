param(
    [string]$SshHost = "oc",
    [string]$Directory = "~/SillyTavern",
    [string]$User = "default-user",
    [switch]$Apply,
    [switch]$Activate,
    [string]$Report
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "uv-env.ps1")
$ImportArguments = @("run", "--frozen", "--python", "3.12", "python", (Join-Path $PSScriptRoot "import-sillytavern.py"), "--directory", $Directory, "--user", $User)
if ($SshHost) { $ImportArguments += @("--ssh", $SshHost) }
if ($Apply) { $ImportArguments += "--apply" }
if ($Activate) { $ImportArguments += "--activate" }
if ($Report) { $ImportArguments += @("--report", [System.IO.Path]::GetFullPath($Report)) }
Push-Location $RepoRoot
try {
    & uv @ImportArguments
    if ($LASTEXITCODE -ne 0) { throw "SillyTavern 导入失败，退出码 $LASTEXITCODE；请查看上方错误。" }
} finally {
    Pop-Location
}
