#Requires -RunAsAdministrator
<#
.SYNOPSIS
    ClawLens Enforcement Installer — Tier 2/3 Managed Hooks (Windows)

.DESCRIPTION
    Installs Claude Code managed hooks that report all developer activity
    to your ClawLens server. Developers cannot override managed hooks.

    Tier 2: All hooks fire to server. No session gating.
    Tier 3: Same as Tier 2, plus a gate script on SessionStart that can
            revoke access (kill/pause) in real time.

.PARAMETER Tier3
    Enable Tier 3 mode (gate script with kill/pause capability).

.PARAMETER ServerUrl
    ClawLens server URL (e.g., https://clawlens.example.com).

.PARAMETER AuthToken
    Auth token for this team.

.EXAMPLE
    .\enforce.ps1
    .\enforce.ps1 -Tier3
    .\enforce.ps1 -ServerUrl "https://clawlens.example.com" -AuthToken "tok_xxx" -Tier3
#>

[CmdletBinding()]
param(
    [switch]$Tier3,
    [string]$ServerUrl,
    [string]$AuthToken
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ── Helpers ──────────────────────────────────────────────────────────────────

function Write-Header {
    $tier = if ($Tier3) { "tier3" } else { "tier2" }
    Write-Host ""
    Write-Host "  ClawLens Enforcement Installer"
    Write-Host "  ================================"
    Write-Host "  Tier: $tier"
    Write-Host ""
}

function Write-Utf8NoBom {
    param(
        [string]$Path,
        [string]$Content
    )
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Content, $utf8)
}

function Get-FileHashSHA256 {
    param([string]$Path)
    return (Get-FileHash -Path $Path -Algorithm SHA256).Hash.ToLower()
}

# ── Paths ────────────────────────────────────────────────────────────────────

$ManagedDir = "C:\Program Files\ClaudeCode\managed-settings.d"
$GateDir    = "C:\Program Files\ClaudeCode"
$LogDir     = "C:\ProgramData\ClawLens\logs"

# ── Pre-flight ───────────────────────────────────────────────────────────────

Write-Header

# Verify admin
$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error "This script must be run as Administrator."
    exit 1
}

# Check for python3 or python
$pythonCmd = $null
if (Get-Command "python3" -ErrorAction SilentlyContinue) {
    $pythonCmd = "python3"
} elseif (Get-Command "python" -ErrorAction SilentlyContinue) {
    $pythonCmd = "python"
} else {
    Write-Error "Python is required but not found. Install Python 3 and ensure it is on PATH."
    exit 1
}

# Check for curl
if (-not (Get-Command "curl.exe" -ErrorAction SilentlyContinue)) {
    Write-Error "curl.exe is required but not found."
    exit 1
}

# ── Prompt for config (if not passed as params) ─────────────────────────────

if ([string]::IsNullOrWhiteSpace($ServerUrl)) {
    $ServerUrl = Read-Host "  Server URL"
}
$ServerUrl = $ServerUrl.TrimEnd("/")

if ([string]::IsNullOrWhiteSpace($AuthToken)) {
    $AuthToken = Read-Host "  Auth token"
}

if ([string]::IsNullOrWhiteSpace($ServerUrl) -or [string]::IsNullOrWhiteSpace($AuthToken)) {
    Write-Error "Server URL and auth token are required."
    exit 1
}

if ($ServerUrl -notmatch "^https?://") {
    Write-Error "Server URL must start with http:// or https://"
    exit 1
}

# ── Check for existing installation ─────────────────────────────────────────

$SettingsFile = Join-Path $ManagedDir "10-clawlens.json"
if (Test-Path $SettingsFile) {
    Write-Host "  WARNING: Existing ClawLens enforcement found."
    $overwrite = Read-Host "  Overwrite? (y/n)"
    if ($overwrite -notin @("y", "Y")) {
        Write-Host "  Aborted."
        exit 0
    }
    Write-Host "  -> Overwriting existing installation."
    Write-Host ""
}

# ── Step 1: Create managed settings ─────────────────────────────────────────

Write-Host "[1/3] Installing managed hooks..."

# Create directories
New-Item -ItemType Directory -Path $ManagedDir -Force | Out-Null
New-Item -ItemType Directory -Path $GateDir -Force | Out-Null
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null

# ── Install hook/gate scripts ────────────────────────────────────────────────

$tier = if ($Tier3) { "tier3" } else { "tier2" }

if ($Tier3) {
    # Tier 3 gate script (PowerShell)
    $GateScript = Join-Path $GateDir "clawlens-gate.ps1"
    $gateContent = @'
# ClawLens Tier 3 gate — blocks killed/paused users at session start
$input_data = [Console]::In.ReadToEnd()
$server = $env:CLAWLENS_SERVER
$token  = $env:CLAWLENS_TOKEN

if ([string]::IsNullOrWhiteSpace($server) -or [string]::IsNullOrWhiteSpace($token)) {
    exit 0
}

try {
    $resp = curl.exe -sf -m 5 -X POST `
        -H "Content-Type: application/json" `
        -H "Authorization: Bearer $token" `
        -d $input_data `
        "$server/api/v1/hook/session-start" 2>$null

    if ([string]::IsNullOrWhiteSpace($resp)) { exit 0 }

    $data = $resp | ConvertFrom-Json -ErrorAction SilentlyContinue
    $status = $data.user_status

    switch ($status) {
        "killed" {
            Start-Process -NoNewWindow -FilePath "claude" -ArgumentList "auth", "logout" -ErrorAction SilentlyContinue
            Write-Output '{"continue": false, "stopReason": "Access revoked by admin. Contact your team lead."}'
            exit 0
        }
        "paused" {
            Write-Output '{"continue": false, "stopReason": "Access paused by admin. Contact your team lead."}'
            exit 0
        }
    }

    Write-Output $resp
} catch {
    exit 0
}
'@
    Write-Utf8NoBom -Path $GateScript -Content $gateContent
    Write-Host "  -> Gate script: $GateScript"
    $SessionStartHook = "`"type`": `"command`", `"command`": `"powershell.exe -ExecutionPolicy Bypass -File '$GateScript'`", `"timeout`": 5"
} else {
    # Tier 2 command hook (PowerShell)
    $HookScript = Join-Path $GateDir "clawlens-hook.ps1"
    $hookContent = @'
# ClawLens Tier 2 command hook — forwards events that need local context
$input_data = [Console]::In.ReadToEnd()
$server = $env:CLAWLENS_SERVER
$token  = $env:CLAWLENS_TOKEN

if ([string]::IsNullOrWhiteSpace($server) -or [string]::IsNullOrWhiteSpace($token)) {
    exit 0
}

try {
    $data = $input_data | ConvertFrom-Json -ErrorAction SilentlyContinue
    $event = $data.hook_event_name

    $pathSuffix = switch ($event) {
        "SessionStart" { "session-start" }
        "FileChanged"  { "file-changed" }
        default        { "unknown" }
    }

    $resp = curl.exe -sf -m 5 -X POST `
        -H "Content-Type: application/json" `
        -H "Authorization: Bearer $token" `
        -d $input_data `
        "$server/api/v1/hook/$pathSuffix" 2>$null

    if (-not [string]::IsNullOrWhiteSpace($resp)) {
        Write-Output $resp
    }
} catch {
    exit 0
}
'@
    Write-Utf8NoBom -Path $HookScript -Content $hookContent
    Write-Host "  -> Hook script: $HookScript"
    $SessionStartHook = "`"type`": `"command`", `"command`": `"powershell.exe -ExecutionPolicy Bypass -File '$HookScript'`", `"timeout`": 5"
}

# Determine which script to use for FileChanged
if ($Tier3) {
    $FileChangedCmd = "powershell.exe -ExecutionPolicy Bypass -File '$(Join-Path $GateDir "clawlens-gate.ps1")'"
} else {
    $FileChangedCmd = "powershell.exe -ExecutionPolicy Bypass -File '$(Join-Path $GateDir "clawlens-hook.ps1")'"
}

# ── Write 10-clawlens.json ──────────────────────────────────────────────────

$settingsJson = @"
{
  "allowManagedHooksOnly": true,
  "env": {
    "CLAWLENS_SERVER": "$ServerUrl",
    "CLAWLENS_TOKEN": "$AuthToken"
  },
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {$SessionStartHook}
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "$ServerUrl/api/v1/hook/prompt",
            "headers": {"Authorization": "Bearer $AuthToken"},
            "timeout": 5
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "$ServerUrl/api/v1/hook/pre-tool",
            "headers": {"Authorization": "Bearer $AuthToken"},
            "timeout": 2
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "$ServerUrl/api/v1/hook/stop",
            "headers": {"Authorization": "Bearer $AuthToken"},
            "timeout": 5
          }
        ]
      }
    ],
    "StopFailure": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "$ServerUrl/api/v1/hook/stop-error",
            "headers": {"Authorization": "Bearer $AuthToken"},
            "timeout": 2,
            "async": true
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "$ServerUrl/api/v1/hook/session-end",
            "headers": {"Authorization": "Bearer $AuthToken"},
            "timeout": 3,
            "async": true
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "$ServerUrl/api/v1/hook/post-tool",
            "headers": {"Authorization": "Bearer $AuthToken"},
            "timeout": 3,
            "async": true
          }
        ]
      }
    ],
    "SubagentStart": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "$ServerUrl/api/v1/hook/subagent-start",
            "headers": {"Authorization": "Bearer $AuthToken"},
            "timeout": 2,
            "async": true
          }
        ]
      }
    ],
    "PostToolUseFailure": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "$ServerUrl/api/v1/hook/post-tool-failure",
            "headers": {"Authorization": "Bearer $AuthToken"},
            "timeout": 2,
            "async": true
          }
        ]
      }
    ],
    "ConfigChange": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "$ServerUrl/api/v1/hook/config-change",
            "headers": {"Authorization": "Bearer $AuthToken"},
            "timeout": 3
          }
        ]
      }
    ],
    "FileChanged": [
      {
        "matcher": "settings.json",
        "hooks": [
          {
            "type": "command",
            "command": "$FileChangedCmd",
            "timeout": 3
          }
        ]
      }
    ]
  }
}
"@

Write-Utf8NoBom -Path $SettingsFile -Content $settingsJson
Write-Host "  -> $SettingsFile"

# ── Validate the JSON ────────────────────────────────────────────────────────

try {
    $null = Get-Content $SettingsFile -Raw | ConvertFrom-Json
} catch {
    Write-Error "Generated JSON is invalid. This is a bug — please report it."
    exit 1
}

# ── Step 2: Save integrity hash ─────────────────────────────────────────────

Write-Host ""
Write-Host "[2/3] Saving integrity hash..."

$hash = Get-FileHashSHA256 -Path $SettingsFile
$HashFile = Join-Path $ManagedDir ".clawlens-hash"
Write-Utf8NoBom -Path $HashFile -Content $hash

# Backup for watchdog
$BackupFile = Join-Path $ManagedDir ".10-clawlens.json.bak"
Copy-Item -Path $SettingsFile -Destination $BackupFile -Force

Write-Host "  -> Hash: $hash"

# ── Step 3: Install watchdog via Task Scheduler ─────────────────────────────

Write-Host ""
Write-Host "[3/3] Installing watchdog scheduled task..."

$WatchdogScript = Join-Path $GateDir "clawlens-watchdog.ps1"
$watchdogContent = @"
# ClawLens Watchdog — auto-repair tampered managed settings
# Runs every 5 minutes via Task Scheduler

`$ManagedFile = "$SettingsFile"
`$HashFile    = "$HashFile"
`$BackupFile  = "$BackupFile"
`$LogFile     = "$LogDir\clawlens-watchdog.log"

function Write-Log {
    param([string]`$Message)
    `$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path `$LogFile -Value "`$timestamp : `$Message" -ErrorAction SilentlyContinue
}

# Rotate log if > 1MB
if (Test-Path `$LogFile) {
    `$logSize = (Get-Item `$LogFile).Length
    if (`$logSize -gt 1048576) {
        Move-Item -Path `$LogFile -Destination "`$LogFile.old" -Force -ErrorAction SilentlyContinue
        Write-Log "Log rotated"
    }
}

# Check backup exists
if (-not (Test-Path `$BackupFile)) {
    Write-Log "ERROR — backup file missing, cannot restore"
    exit 1
}

# Case 1: managed settings file deleted
if (-not (Test-Path `$ManagedFile)) {
    Write-Log "RESTORED — managed settings file was missing"
    Copy-Item -Path `$BackupFile -Destination `$ManagedFile -Force
    exit 0
}

# Case 2: hash mismatch
`$expectedHash = (Get-Content `$HashFile -ErrorAction SilentlyContinue).Trim()
if ([string]::IsNullOrWhiteSpace(`$expectedHash)) {
    Write-Log "ERROR — hash file missing or empty, cannot verify integrity"
    exit 1
}

`$currentHash = (Get-FileHash -Path `$ManagedFile -Algorithm SHA256).Hash.ToLower()

if (`$currentHash -ne `$expectedHash) {
    Write-Log "RESTORED — managed settings were modified (expected `$expectedHash, got `$currentHash)"
    Copy-Item -Path `$BackupFile -Destination `$ManagedFile -Force
}
"@

Write-Utf8NoBom -Path $WatchdogScript -Content $watchdogContent
Write-Host "  -> Watchdog script: $WatchdogScript"

# Remove existing scheduled task if present
$taskName = "ClawLensWatchdog"
$existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existingTask) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
}

# Create scheduled task that runs every 5 minutes
$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-ExecutionPolicy Bypass -NonInteractive -WindowStyle Hidden -File `"$WatchdogScript`""

$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5)

$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 1) `
    -MultipleInstances IgnoreNew

try {
    Register-ScheduledTask `
        -TaskName $taskName `
        -Action $action `
        -Trigger $trigger `
        -Principal $principal `
        -Settings $settings `
        -Description "ClawLens Watchdog — auto-repair tampered managed settings (every 5 min)" `
        -Force | Out-Null
    Write-Host "  -> Installed scheduled task: $taskName (every 5 min)"
} catch {
    Write-Warning "Failed to register scheduled task: $_"
    Write-Host "  Register manually: Register-ScheduledTask -TaskName '$taskName' ..."
}

# ── Done ─────────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "  ====================================="
Write-Host "  ClawLens enforcement installed! ($tier)"
Write-Host "  ====================================="
Write-Host ""
Write-Host "  Managed settings:  $SettingsFile"
Write-Host "  Watchdog:          active (every 5 min)"
if ($Tier3) {
    Write-Host "  Gate script:       $(Join-Path $GateDir 'clawlens-gate.ps1')"
    Write-Host "  Kill/pause:        enabled (auth revocation on kill)"
}
Write-Host ""
Write-Host "  Developers CANNOT override these hooks (allowManagedHooksOnly = true)."
Write-Host "  The watchdog will auto-restore settings if tampered with."
Write-Host ""
Write-Host "  Close ALL terminals, then open a fresh one and run: claude"
Write-Host ""
