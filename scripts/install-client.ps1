# ClawLens Client Installer for Windows
# Usage: irm https://raw.githubusercontent.com/howincodes/clawlens/main/scripts/install-client.ps1 | iex

$ErrorActionPreference = "Stop"

$Version = if ($env:CLAWLENS_VERSION) { $env:CLAWLENS_VERSION } else { "0.1.0" }
$Repo = "howincodes/clawlens"

# Detect architecture
$Arch = if ([Environment]::Is64BitOperatingSystem) {
    if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "amd64" }
} else { "amd64" }

$Binary = "clawlens-windows-${Arch}.exe"
$Url = "https://github.com/${Repo}/releases/download/v${Version}/${Binary}"
$InstallDir = "$env:LOCALAPPDATA\ClawLens"
$InstallPath = "$InstallDir\clawlens.exe"

Write-Host ""
Write-Host "  ClawLens Client Installer" -ForegroundColor Cyan
Write-Host "  ========================="
Write-Host "  Version:  v$Version"
Write-Host "  Platform: windows/$Arch"
Write-Host ""

# Create install directory
if (!(Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}

# Download
Write-Host "Downloading $Binary..."
Invoke-WebRequest -Uri $Url -OutFile $InstallPath -UseBasicParsing

# Add to PATH if not already there
$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($UserPath -notlike "*$InstallDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$UserPath;$InstallDir", "User")
    Write-Host "Added $InstallDir to PATH"
}

Write-Host ""
Write-Host "  Installed at $InstallPath" -ForegroundColor Green
Write-Host ""
Write-Host "  Restart your terminal, then:"
Write-Host "    clawlens setup --code <YOUR_INSTALL_CODE> --server <SERVER_URL>"
Write-Host ""
