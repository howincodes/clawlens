# ClawLens Client Installer for Windows
# Usage: irm https://raw.githubusercontent.com/howincodes/clawlens/main/scripts/install-client.ps1 | iex

$ErrorActionPreference = "Stop"
$Version = if ($env:CLAWLENS_VERSION) { $env:CLAWLENS_VERSION } else { "0.1.0" }
$Arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "amd64" }
$InstallDir = "$env:LOCALAPPDATA\ClawLens"
$Binary = "$InstallDir\clawlens.exe"
$ConfigFile = "$InstallDir\config.json"
$ClaudeDir = "$env:USERPROFILE\.claude"
$ManagedSettings = "$ClaudeDir\managed-settings.json"

Write-Host ""
Write-Host "  ClawLens Client Installer" -ForegroundColor Cyan
Write-Host "  ========================="
Write-Host "  Version:  v$Version"
Write-Host "  Platform: windows/$Arch"
Write-Host ""

# --- Check existing installation ---
$existingInstall = (Test-Path $ConfigFile) -or (Test-Path $ManagedSettings) -or (Test-Path $Binary)
if ($existingInstall) {
    Write-Host "  Existing ClawLens installation detected:" -ForegroundColor Yellow
    if (Test-Path $Binary) { Write-Host "    Binary:  $Binary" -ForegroundColor Yellow }
    if (Test-Path $ConfigFile) { Write-Host "    Config:  $ConfigFile" -ForegroundColor Yellow }
    if (Test-Path $ManagedSettings) { Write-Host "    Hooks:   $ManagedSettings" -ForegroundColor Yellow }

    # Also check old admin paths
    $oldPaths = @("C:\Program Files\ClaudeCode\clawlens", "C:\Program Files\ClaudeCode\managed-settings.json")
    foreach ($p in $oldPaths) {
        if (Test-Path $p) { Write-Host "    Old:     $p" -ForegroundColor Yellow }
    }

    Write-Host ""
    $choice = Read-Host "  Clean all and reinstall from scratch? (y/n)"
    if ($choice -ne "y" -and $choice -ne "Y") {
        Write-Host "  Cancelled." -ForegroundColor Red
        return
    }

    Write-Host ""
    Write-Host "  Cleaning up..." -ForegroundColor Yellow
    Get-Process -Name "clawlens*" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    @($InstallDir, "$env:USERPROFILE\.clawlens", "C:\Program Files\ClaudeCode\clawlens", "C:\Program Files\ClaudeCode\managed-settings.json") | ForEach-Object {
        if (Test-Path $_) { Remove-Item $_ -Recurse -Force -ErrorAction SilentlyContinue; Write-Host "    Removed: $_" }
    }
    if (Test-Path $ManagedSettings) { Remove-Item $ManagedSettings -Force -ErrorAction SilentlyContinue; Write-Host "    Removed: $ManagedSettings" }
    Write-Host ""
}

# --- Step 1: Download binary ---
Write-Host "[1/4] Downloading ClawLens binary..."
$Url = "https://github.com/howincodes/clawlens/releases/download/v${Version}/clawlens-windows-${Arch}.exe"
if (!(Test-Path $InstallDir)) { New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null }
Invoke-WebRequest -Uri $Url -OutFile $Binary -UseBasicParsing
Write-Host "  -> $Binary" -ForegroundColor Green

# --- Step 2: Add to PATH ---
Write-Host "[2/4] Configuring PATH..."
$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($UserPath -notlike "*$InstallDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$UserPath;$InstallDir", "User")
    Write-Host "  -> Added to PATH" -ForegroundColor Green
} else {
    Write-Host "  -> Already in PATH" -ForegroundColor Green
}
$env:Path = "$env:Path;$InstallDir"

# --- Step 3: Setup (register + config + hooks) ---
Write-Host "[3/4] Setting up..."
Write-Host ""

$Code = ""
while ([string]::IsNullOrWhiteSpace($Code)) {
    $Code = Read-Host "  Install code (from dashboard, e.g. CLM-alice-abc123)"
    if ([string]::IsNullOrWhiteSpace($Code)) { Write-Host "  Code cannot be empty!" -ForegroundColor Red }
}

$Server = ""
while ([string]::IsNullOrWhiteSpace($Server)) {
    $Server = Read-Host "  Server URL (e.g. https://clawlens.howincloud.com)"
    if ([string]::IsNullOrWhiteSpace($Server)) { Write-Host "  Server URL cannot be empty!" -ForegroundColor Red }
}
$Server = $Server.TrimEnd("/")

# Register with server
Write-Host ""
Write-Host "  Registering with server..."
try {
    $regBody = @{ code = $Code } | ConvertTo-Json
    $reg = Invoke-RestMethod -Uri "$Server/api/v1/register" -Method Post -Body $regBody -ContentType "application/json"
    Write-Host "  -> Registered! User: $($reg.user_id)" -ForegroundColor Green
} catch {
    Write-Host "  -> Registration failed: $_" -ForegroundColor Red
    Write-Host "  Check: is the install code correct? Is the server running?" -ForegroundColor Red
    return
}

# Write config
$config = @{
    server_url = $Server
    auth_token = $reg.auth_token
    user_id = $reg.user_id
    status = "active"
    default_model = "sonnet"
    sync_interval = 5
    collection_level = if ($reg.settings.collection_level) { $reg.settings.collection_level } else { "full" }
    collect_responses = if ($null -ne $reg.settings.collect_responses) { $reg.settings.collect_responses } else { $true }
    secret_scrub = if ($reg.settings.secret_scrub) { $reg.settings.secret_scrub } else { "redact" }
    prompt_max_length = if ($reg.settings.prompt_max_length) { $reg.settings.prompt_max_length } else { 10000 }
    client_version = $Version
    credit_weights = if ($reg.settings.credit_weights) { $reg.settings.credit_weights } else { @{ opus = 10; sonnet = 3; haiku = 1 } }
} | ConvertTo-Json -Depth 3
$config | Set-Content $ConfigFile -Encoding UTF8
Write-Host "  -> Config written" -ForegroundColor Green

# Write managed-settings.json
if (!(Test-Path $ClaudeDir)) { New-Item -ItemType Directory -Path $ClaudeDir -Force | Out-Null }
$binaryForward = $Binary.Replace("\", "/")
$hooks = @{
    allowManagedHooksOnly = $true
    hooks = @{
        SessionStart = @(@{ matcher = ""; hooks = @(@{ type = "command"; command = "$binaryForward hook session-start"; timeout = 10 }) })
        UserPromptSubmit = @(@{ hooks = @(@{ type = "command"; command = "$binaryForward hook prompt"; timeout = 5 }) })
        PreToolUse = @(@{ hooks = @(@{ type = "command"; command = "$binaryForward hook pre-tool"; timeout = 2 }) })
        Stop = @(@{ hooks = @(@{ type = "command"; command = "$binaryForward hook stop"; timeout = 5 }) })
        StopFailure = @(@{ matcher = ""; hooks = @(@{ type = "command"; command = "$binaryForward hook stop-error"; timeout = 2 }) })
        SessionEnd = @(@{ matcher = ""; hooks = @(@{ type = "command"; command = "$binaryForward hook session-end"; timeout = 3 }) })
    }
} | ConvertTo-Json -Depth 5
$hooks | Set-Content $ManagedSettings -Encoding UTF8
Write-Host "  -> Hooks installed" -ForegroundColor Green

# --- Step 4: Verify ---
Write-Host "[4/4] Verifying..."
Write-Host "  Binary:   $Binary"
Write-Host "  Config:   $ConfigFile"
Write-Host "  Hooks:    $ManagedSettings"

# Quick health check
try {
    $health = Invoke-RestMethod -Uri "$Server/api/v1/health" -TimeoutSec 5
    Write-Host "  Server:   OK ($Server)" -ForegroundColor Green
} catch {
    Write-Host "  Server:   UNREACHABLE" -ForegroundColor Red
}

Write-Host ""
Write-Host "  =============================" -ForegroundColor Green
Write-Host "  ClawLens installed!" -ForegroundColor Green
Write-Host "  =============================" -ForegroundColor Green
Write-Host ""
Write-Host "  NEXT: Close ALL terminals, then open a fresh one and run:" -ForegroundColor Yellow
Write-Host "        claude" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Every prompt will appear in your dashboard at $Server" -ForegroundColor Cyan
Write-Host ""
