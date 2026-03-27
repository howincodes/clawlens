# ClawLens Client Updater for Windows
# Usage: irm https://raw.githubusercontent.com/howincodes/clawlens/main/scripts/update-client.ps1 | iex

$ErrorActionPreference = "Stop"
$Version = if ($env:CLAWLENS_VERSION) { $env:CLAWLENS_VERSION } else { "0.1.0" }
$Arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "amd64" }
$InstallDir = "$env:LOCALAPPDATA\ClawLens"
$Binary = "$InstallDir\clawlens.exe"
$Url = "https://github.com/howincodes/clawlens/releases/download/v${Version}/clawlens-windows-${Arch}.exe"

Write-Host ""
Write-Host "  ClawLens Client Updater" -ForegroundColor Cyan
Write-Host "  ======================="
Write-Host "  Version: v$Version"
Write-Host ""

# Stop running processes
Get-Process -Name "clawlens*" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

# Download
Write-Host "Downloading..."
if (!(Test-Path $InstallDir)) { New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null }
Invoke-WebRequest -Uri $Url -OutFile $Binary -UseBasicParsing

Write-Host ""
Write-Host "  Updated to v$Version!" -ForegroundColor Green
Write-Host "  Restart Claude Code for changes to take effect."
Write-Host ""
