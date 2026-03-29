# ClawLens Client Installer for Windows
# Usage: irm https://raw.githubusercontent.com/howincodes/clawlens/main/scripts/install.ps1 | iex

Write-Host ""
Write-Host "  ClawLens Installer"
Write-Host "  =================="
Write-Host ""

# ── Pre-flight checks ───────────────────────────────────────────────────────

if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
    Write-Host "  Error: claude command not found."
    Write-Host "  Install Claude Code first: https://docs.anthropic.com/en/docs/claude-code"
    exit 1
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "  Error: node command not found."
    Write-Host "  Claude Code requires Node.js — install it first."
    exit 1
}

# Verify Node.js version >= 18
$NodeMajor = [int](node -e "console.log(process.versions.node.split('.')[0])")
if ($NodeMajor -lt 18) {
    Write-Host "  Error: Node.js 18+ required (found v$NodeMajor)."
    Write-Host "  Update Node.js: https://nodejs.org/"
    exit 1
}

Write-Host "  claude: $(Get-Command claude | Select-Object -ExpandProperty Source)"
Write-Host "  node:   $(node --version)"
Write-Host ""

# ── Prompt for config ────────────────────────────────────────────────────────

$ServerUrl = Read-Host "  Server URL (e.g. https://clawlens.howincloud.com)"
if (-not $ServerUrl) { Write-Host "  Error: Server URL required"; exit 1 }
$ServerUrl = $ServerUrl.TrimEnd('/')

if (-not ($ServerUrl -match '^https?://')) {
    Write-Host "  Error: Server URL must start with http:// or https://"
    exit 1
}

$AuthToken = Read-Host "  Auth token (from admin dashboard)"
if (-not $AuthToken) { Write-Host "  Error: Auth token required"; exit 1 }

# ── Step 1: Install hook handler ────────────────────────────────────────────

Write-Host ""
Write-Host "[1/4] Installing hook handler..."

$HooksDir = Join-Path $env:USERPROFILE ".claude\hooks"
New-Item -ItemType Directory -Path $HooksDir -Force | Out-Null

# Download the Node.js hook handler (zero dependencies, Node 18+)
$MjsPath = Join-Path $HooksDir "clawlens.mjs"
$MjsUrl = "https://raw.githubusercontent.com/howincodes/clawlens/main/client/clawlens.mjs"
try {
    Invoke-WebRequest -Uri $MjsUrl -OutFile $MjsPath -UseBasicParsing
} catch {
    Write-Host "  ERROR: Could not download clawlens.mjs from $MjsUrl"
    exit 1
}
Write-Host "  -> $MjsPath"

# Install watcher
$WatcherUrl = "https://raw.githubusercontent.com/howincodes/clawlens/main/client/clawlens-watcher.mjs"
$WatcherPath = Join-Path $HooksDir "clawlens-watcher.mjs"
try {
    Invoke-WebRequest -Uri $WatcherUrl -OutFile $WatcherPath -UseBasicParsing
} catch {
    Write-Host "  ERROR: Could not download clawlens-watcher.mjs"
    exit 1
}
Write-Host "  -> $WatcherPath (watcher)"

# Write the thin bash wrapper (Claude Code runs hooks via bash even on Windows)
$HookScript = @'
#!/bin/bash
# ClawLens hook — thin wrapper that calls Node.js handler
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
node "$SCRIPT_DIR/clawlens.mjs" 2>/dev/null || exit 0
'@

$HookPath = Join-Path $HooksDir "clawlens-hook.sh"
[System.IO.File]::WriteAllText($HookPath, $HookScript.Replace("`r`n", "`n"), [System.Text.UTF8Encoding]::new($false))
Write-Host "  -> $HookPath"

# ── Step 2: Configure hooks in settings.json ─────────────────────────────────

Write-Host "[2/4] Configuring hooks..."

$ClaudeDir = Join-Path $env:USERPROFILE ".claude"
$SettingsPath = Join-Path $ClaudeDir "settings.json"
New-Item -ItemType Directory -Path $ClaudeDir -Force | Out-Null

# Hook command path with forward slashes (Claude Code runs hooks via bash)
$HookCmd = $HookPath.Replace('\', '/')

# Read existing settings
$Settings = $null
if (Test-Path $SettingsPath) {
    try { $Settings = Get-Content $SettingsPath -Raw | ConvertFrom-Json } catch {}
}

# Build the complete settings JSON using a template
$Template = @'
{
  "env": {
    "CLAUDE_PLUGIN_OPTION_SERVER_URL": "__SERVER_URL__",
    "CLAUDE_PLUGIN_OPTION_AUTH_TOKEN": "__AUTH_TOKEN__"
  },
  "hooks": {
    "SessionStart": [{"hooks": [{"type": "command", "command": "__HOOK_CMD__", "timeout": 5}]}],
    "UserPromptSubmit": [{"hooks": [{"type": "command", "command": "__HOOK_CMD__", "timeout": 3}]}],
    "PreToolUse": [{"hooks": [{"type": "command", "command": "__HOOK_CMD__", "timeout": 2, "async": true}]}],
    "Stop": [{"hooks": [{"type": "command", "command": "__HOOK_CMD__", "timeout": 3}]}],
    "StopFailure": [{"hooks": [{"type": "command", "command": "__HOOK_CMD__", "timeout": 2, "async": true}]}],
    "SessionEnd": [{"hooks": [{"type": "command", "command": "__HOOK_CMD__", "timeout": 3, "async": true}]}],
    "PostToolUse": [{"hooks": [{"type": "command", "command": "__HOOK_CMD__", "timeout": 3, "async": true}]}],
    "SubagentStart": [{"hooks": [{"type": "command", "command": "__HOOK_CMD__", "timeout": 2, "async": true}]}],
    "PostToolUseFailure": [{"hooks": [{"type": "command", "command": "__HOOK_CMD__", "timeout": 2, "async": true}]}],
    "ConfigChange": [{"hooks": [{"type": "command", "command": "__HOOK_CMD__", "timeout": 3}]}],
    "FileChanged": [{"matcher": "settings.json", "hooks": [{"type": "command", "command": "__HOOK_CMD__", "timeout": 3}]}]
  }
}
'@

# Parse template, replace placeholders, merge with existing settings
$NewSettings = $Template | ConvertFrom-Json

$NewSettings.env.CLAUDE_PLUGIN_OPTION_SERVER_URL = $ServerUrl
$NewSettings.env.CLAUDE_PLUGIN_OPTION_AUTH_TOKEN = $AuthToken

# Fix hook command paths (ConvertFrom-Json preserves __HOOK_CMD__ as literal)
$Json = $NewSettings | ConvertTo-Json -Depth 10
$Json = $Json.Replace('__HOOK_CMD__', $HookCmd)

# Merge: keep existing non-clawlens settings
if ($Settings) {
    $Merged = $Settings
    # Overwrite env and hooks
    $NewObj = $Json | ConvertFrom-Json
    if (-not (Get-Member -InputObject $Merged -Name 'env' -MemberType NoteProperty)) {
        $Merged | Add-Member -NotePropertyName 'env' -NotePropertyValue $NewObj.env
    } else {
        $Merged.env | Add-Member -NotePropertyName 'CLAUDE_PLUGIN_OPTION_SERVER_URL' -NotePropertyValue $ServerUrl -Force
        $Merged.env | Add-Member -NotePropertyName 'CLAUDE_PLUGIN_OPTION_AUTH_TOKEN' -NotePropertyValue $AuthToken -Force
    }
    $Merged | Add-Member -NotePropertyName 'hooks' -NotePropertyValue $NewObj.hooks -Force
    $Json = $Merged | ConvertTo-Json -Depth 10
}

[System.IO.File]::WriteAllText($SettingsPath, $Json, [System.Text.UTF8Encoding]::new($false))
Write-Host "  -> $SettingsPath"

# ── Step 3: Verify ───────────────────────────────────────────────────────────

Write-Host "[3/4] Verifying..."
try {
    Invoke-RestMethod -Uri "$ServerUrl/health" -TimeoutSec 5 | Out-Null
    Write-Host "  -> Server: OK"
} catch {
    Write-Host "  -> Server: UNREACHABLE (check URL)"
}

# ── Step 4: Setup watcher auto-start ────────────────────────────────────────

Write-Host "[4/4] Setting up watcher auto-start..."

# Setup auto-start via Startup folder
$StartupDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup"
$VbsPath = Join-Path $StartupDir "clawlens-watcher.vbs"
$NodePath = (Get-Command node).Source
$VbsContent = @"
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run """$NodePath"" ""$WatcherPath""", 0, False
"@
[System.IO.File]::WriteAllText($VbsPath, $VbsContent, [System.Text.UTF8Encoding]::new($false))
Write-Host "  -> Windows startup: $VbsPath"

# Start watcher now
Start-Process -FilePath $NodePath -ArgumentList $WatcherPath -WindowStyle Hidden
Write-Host "  -> Watcher started"

Write-Host ""
Write-Host "  ============================="
Write-Host "  ClawLens installed!"
Write-Host "  ============================="
Write-Host ""
Write-Host "  Hook handler: $MjsPath"
Write-Host "  Hook wrapper: $HookPath"
Write-Host "  Watcher:      $WatcherPath"
Write-Host "  Settings:     $SettingsPath"
Write-Host "  Server:       $ServerUrl"
Write-Host ""
Write-Host "  Restart Claude Code for hooks to take effect."
Write-Host ""
