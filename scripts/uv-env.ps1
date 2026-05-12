$RepoRoot = Split-Path -Parent $PSScriptRoot
$env:UV_CACHE_DIR = Join-Path $RepoRoot ".uv-cache"
$env:UV_PYTHON_INSTALL_DIR = Join-Path $RepoRoot ".uv-python"
$env:UV_PROJECT_ENVIRONMENT = Join-Path $RepoRoot ".venv-uv"

Write-Host "UV_CACHE_DIR=$env:UV_CACHE_DIR"
Write-Host "UV_PYTHON_INSTALL_DIR=$env:UV_PYTHON_INSTALL_DIR"
Write-Host "UV_PROJECT_ENVIRONMENT=$env:UV_PROJECT_ENVIRONMENT"
