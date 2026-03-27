# ClawLens Windows Full Reset + Fresh Install
# Run in NORMAL PowerShell (NOT admin)
# Usage: irm https://raw.githubusercontent.com/howincodes/clawlens/main/scripts/reset-windows.ps1 | iex

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "  ClawLens Windows Reset + Fresh Install" -ForegroundColor Cyan
Write-Host "  ======================================="
Write-Host ""

# 1. Kill any running clawlens processes
Write-Host "[1/7] Stopping ClawLens processes..."
Get-Process -Name "clawlens*" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

# 2. Remove ALL old ClawLens files from everywhere
Write-Host "[2/7] Removing all old ClawLens files..."
$paths = @(
    "$env:LOCALAPPDATA\ClawLens",
    "$env:USERPROFILE\.clawlens",
    "$env:USERPROFILE\.claude\managed-settings.json",
    "C:\Program Files\ClaudeCode\clawlens",
    "C:\Program Files\ClaudeCode\managed-settings.json"
)
foreach ($p in $paths) {
    if (Test-Path $p) {
        Remove-Item $p -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "  Removed: $p" -ForegroundColor Yellow
    }
}

# 3. Download fresh binary
Write-Host "[3/7] Downloading fresh ClawLens binary..."
$Version = "0.1.0"
$Arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "amd64" }
$Url = "https://github.com/howincodes/clawlens/releases/download/v${Version}/clawlens-windows-${Arch}.exe"
$InstallDir = "$env:LOCALAPPDATA\ClawLens"
$Binary = "$InstallDir\clawlens.exe"

New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
Invoke-WebRequest -Uri $Url -OutFile $Binary -UseBasicParsing
Write-Host "  Downloaded to: $Binary" -ForegroundColor Green

# 4. Add to PATH
Write-Host "[4/7] Adding to PATH..."
$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($UserPath -notlike "*$InstallDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$UserPath;$InstallDir", "User")
    $env:Path = "$env:Path;$InstallDir"
    Write-Host "  Added $InstallDir to PATH" -ForegroundColor Green
} else {
    Write-Host "  Already in PATH" -ForegroundColor Green
}

# 5. Register with server
Write-Host "[5/7] Registering with server..."
$Code = Read-Host "  Enter install code (e.g. CLM-xxx-xxxxxx)"
$Server = Read-Host "  Enter server URL (e.g. https://clawlens.howincloud.com)"

# Call register API directly
$regBody = @{ code = $Code } | ConvertTo-Json
$reg = Invoke-RestMethod -Uri "$Server/api/v1/register" -Method Post -Body $regBody -ContentType "application/json"

Write-Host "  Registered! User ID: $($reg.user_id)" -ForegroundColor Green

# 6. Write config to user-writable location
Write-Host "[6/7] Writing config..."
$ConfigDir = "$env:LOCALAPPDATA\ClawLens"
$config = @{
    server_url = $Server
    auth_token = $reg.auth_token
    user_id = $reg.user_id
    status = "active"
    default_model = "sonnet"
    sync_interval = 5
    collection_level = $reg.settings.collection_level
    collect_responses = $reg.settings.collect_responses
    secret_scrub = $reg.settings.secret_scrub
    prompt_max_length = $reg.settings.prompt_max_length
    client_version = "0.1.0"
    credit_weights = $reg.settings.credit_weights
} | ConvertTo-Json -Depth 3

$config | Set-Content "$ConfigDir\config.json" -Encoding UTF8
Write-Host "  Config: $ConfigDir\config.json" -ForegroundColor Green

# 7. Write managed-settings.json to ~/.claude/
Write-Host "[7/7] Installing hooks..."
$claudeDir = "$env:USERPROFILE\.claude"
if (!(Test-Path $claudeDir)) {
    New-Item -ItemType Directory -Path $claudeDir -Force | Out-Null
}

# Use forward slashes for bash compatibility
$binaryPath = $Binary.Replace("\", "/")

$hooks = @{
    allowManagedHooksOnly = $true
    hooks = @{
        SessionStart = @(@{
            matcher = ""
            hooks = @(@{ type = "command"; command = "$binaryPath hook session-start"; timeout = 10 })
        })
        UserPromptSubmit = @(@{
            hooks = @(@{ type = "command"; command = "$binaryPath hook prompt"; timeout = 5 })
        })
        PreToolUse = @(@{
            hooks = @(@{ type = "command"; command = "$binaryPath hook pre-tool"; timeout = 2 })
        })
        Stop = @(@{
            hooks = @(@{ type = "command"; command = "$binaryPath hook stop"; timeout = 5 })
        })
        StopFailure = @(@{
            matcher = ""
            hooks = @(@{ type = "command"; command = "$binaryPath hook stop-error"; timeout = 2 })
        })
        SessionEnd = @(@{
            matcher = ""
            hooks = @(@{ type = "command"; command = "$binaryPath hook session-end"; timeout = 3 })
        })
    }
} | ConvertTo-Json -Depth 5

$hooks | Set-Content "$claudeDir\managed-settings.json" -Encoding UTF8
Write-Host "  Hooks: $claudeDir\managed-settings.json" -ForegroundColor Green

# Done
Write-Host ""
Write-Host "  =============================" -ForegroundColor Green
Write-Host "  ClawLens installed!" -ForegroundColor Green
Write-Host "  =============================" -ForegroundColor Green
Write-Host ""
Write-Host "  Binary:   $Binary"
Write-Host "  Config:   $ConfigDir\config.json"
Write-Host "  Hooks:    $claudeDir\managed-settings.json"
Write-Host "  Server:   $Server"
Write-Host ""
Write-Host "  IMPORTANT: Close ALL terminals and Claude Code windows," -ForegroundColor Yellow
Write-Host "  then open a fresh terminal and run: claude" -ForegroundColor Yellow
Write-Host ""
