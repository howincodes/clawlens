#Requires -RunAsAdministrator
<#
.SYNOPSIS
    ClawLens Enforcement Installer — Managed Hooks with Gate (Windows)

.DESCRIPTION
    Installs Claude Code managed hooks that report all developer activity
    to your ClawLens server. Developers cannot override managed hooks.
    Includes a gate script on SessionStart that can revoke access
    (kill/pause) in real time.

.PARAMETER ServerUrl
    ClawLens server URL (e.g., https://clawlens.example.com).

.PARAMETER AuthToken
    Auth token for this team.

.EXAMPLE
    .\enforce.ps1
    .\enforce.ps1 -ServerUrl "https://clawlens.example.com" -AuthToken "tok_xxx"
#>

[CmdletBinding()]
param(
    [string]$ServerUrl,
    [string]$AuthToken
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ── Helpers ──────────────────────────────────────────────────────────────────

function Write-Header {
    Write-Host ""
    Write-Host "  ClawLens Enforcement Installer"
    Write-Host "  ================================"
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

# ── Pre-flight ───────────────────────────────────────────────────────────────

Write-Header

# Verify admin
$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error "This script must be run as Administrator."
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

Write-Host "[1/2] Installing managed hooks + gate script..."

# Create directories
New-Item -ItemType Directory -Path $ManagedDir -Force | Out-Null
New-Item -ItemType Directory -Path $GateDir -Force | Out-Null

# ── Install gate script (auth revocation on kill) ────────────────────────────

$GateScript = Join-Path $GateDir "clawlens-gate.ps1"
$gateContent = @'
# ClawLens gate — blocks killed/paused users at session start
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

# ── Install hook script (universal handler) ──────────────────────────────────

$HookScript = Join-Path $GateDir "clawlens-hook.ps1"
$hookContent = @'
# ClawLens hook handler — universal for ALL hook events
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
        "SessionStart"       { "session-start" }
        "UserPromptSubmit"   { "prompt" }
        "PreToolUse"         { "pre-tool" }
        "Stop"               { "stop" }
        "StopFailure"        { "stop-error" }
        "SessionEnd"         { "session-end" }
        "PostToolUse"        { "post-tool" }
        "SubagentStart"      { "subagent-start" }
        "PostToolUseFailure" { "post-tool-failure" }
        "ConfigChange"       { "config-change" }
        "FileChanged"        { "file-changed" }
        default              { "unknown" }
    }

    if ($pathSuffix -eq "unknown") { exit 0 }

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

$SessionStartCmd = "powershell.exe -ExecutionPolicy Bypass -File '$GateScript'"
$HookCmd = "powershell.exe -ExecutionPolicy Bypass -File '$HookScript'"

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
          {"type": "command", "command": "$SessionStartCmd", "timeout": 5}
        ]
      }
    ],
    "UserPromptSubmit": [
      {"hooks": [{"type": "command", "command": "$HookCmd", "timeout": 3}]}
    ],
    "PreToolUse": [
      {"hooks": [{"type": "command", "command": "$HookCmd", "timeout": 2, "async": true}]}
    ],
    "Stop": [
      {"hooks": [{"type": "command", "command": "$HookCmd", "timeout": 3}]}
    ],
    "StopFailure": [
      {"hooks": [{"type": "command", "command": "$HookCmd", "timeout": 2, "async": true}]}
    ],
    "SessionEnd": [
      {"hooks": [{"type": "command", "command": "$HookCmd", "timeout": 3, "async": true}]}
    ],
    "PostToolUse": [
      {"hooks": [{"type": "command", "command": "$HookCmd", "timeout": 3, "async": true}]}
    ],
    "SubagentStart": [
      {"hooks": [{"type": "command", "command": "$HookCmd", "timeout": 2, "async": true}]}
    ],
    "PostToolUseFailure": [
      {"hooks": [{"type": "command", "command": "$HookCmd", "timeout": 2, "async": true}]}
    ],
    "ConfigChange": [
      {"hooks": [{"type": "command", "command": "$HookCmd", "timeout": 3}]}
    ],
    "FileChanged": [
      {
        "matcher": "settings.json",
        "hooks": [
          {
            "type": "command",
            "command": "$HookCmd",
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
Write-Host "[2/2] Saving integrity hash..."

$hash = Get-FileHashSHA256 -Path $SettingsFile
$HashFile = Join-Path $ManagedDir ".clawlens-hash"
Write-Utf8NoBom -Path $HashFile -Content $hash

# Backup for reference
$BackupFile = Join-Path $ManagedDir ".10-clawlens.json.bak"
Copy-Item -Path $SettingsFile -Destination $BackupFile -Force

Write-Host "  -> Hash: $hash"

# ── Done ─────────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "  ====================================="
Write-Host "  ClawLens enforcement installed!"
Write-Host "  ====================================="
Write-Host ""
Write-Host "  Managed settings:  $SettingsFile"
Write-Host "  Gate script:       $GateScript"
Write-Host "  Kill/pause:        enabled (auth revocation on kill)"
Write-Host ""
Write-Host "  Developers CANNOT override these hooks (allowManagedHooksOnly = true)."
Write-Host ""
Write-Host "  Close ALL terminals, then open a fresh one and run: claude"
Write-Host ""
