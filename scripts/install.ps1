# ClawLens Client Installer for Windows
# Usage: irm https://raw.githubusercontent.com/howincodes/clawlens/main/scripts/install.ps1 | iex

Write-Host ""
Write-Host "  ClawLens Installer"
Write-Host "  =================="
Write-Host ""

$ServerUrl = Read-Host "  Server URL (e.g. https://clawlens.howincloud.com)"
if (-not $ServerUrl) { Write-Host "  Error: Server URL required"; exit 1 }
$ServerUrl = $ServerUrl.TrimEnd('/')

$AuthToken = Read-Host "  Auth token (from admin dashboard)"
if (-not $AuthToken) { Write-Host "  Error: Auth token required"; exit 1 }

# Step 1: Install hook script
Write-Host ""
Write-Host "[1/3] Installing hook script..."

$HooksDir = Join-Path $env:USERPROFILE ".claude\hooks"
New-Item -ItemType Directory -Path $HooksDir -Force | Out-Null

$HookScript = @'
#!/bin/bash
TMPFILE=$(mktemp 2>/dev/null || echo "/tmp/clawlens-hook-$$")
cat > "$TMPFILE"
SERVER_URL="${CLAUDE_PLUGIN_OPTION_SERVER_URL}"
AUTH_TOKEN="${CLAUDE_PLUGIN_OPTION_AUTH_TOKEN}"
if [ -z "$SERVER_URL" ] || [ -z "$AUTH_TOKEN" ]; then
  SERVER_URL="${CLAWLENS_SERVER}"; AUTH_TOKEN="${CLAWLENS_TOKEN}"
fi
if [ -z "$SERVER_URL" ] || [ -z "$AUTH_TOKEN" ]; then rm -f "$TMPFILE"; exit 0; fi
if command -v jq >/dev/null 2>&1; then
  EVENT=$(jq -r '.hook_event_name // ""' < "$TMPFILE")
elif command -v node >/dev/null 2>&1; then
  EVENT=$(node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{console.log(JSON.parse(d).hook_event_name||'')}catch{console.log('')}})" < "$TMPFILE")
else
  EVENT=$(grep -o '"hook_event_name":"[^"]*"' "$TMPFILE" | head -1 | cut -d'"' -f4)
fi
case "$EVENT" in
  SessionStart)       P="session-start" ;;
  UserPromptSubmit)   P="prompt" ;;
  PreToolUse)         P="pre-tool" ;;
  Stop)               P="stop" ;;
  StopFailure)        P="stop-error" ;;
  SessionEnd)         P="session-end" ;;
  PostToolUse)        P="post-tool" ;;
  SubagentStart)      P="subagent-start" ;;
  PostToolUseFailure) P="post-tool-failure" ;;
  ConfigChange)       P="config-change" ;;
  FileChanged)        P="file-changed" ;;
  *)                  rm -f "$TMPFILE"; exit 0 ;;
esac
# Enrich SessionStart with subscription info
if [ "$EVENT" = "SessionStart" ]; then
  AUTH_JSON=$(claude auth status 2>/dev/null || true)
  if [ -n "$AUTH_JSON" ]; then
    SUB_EMAIL=$(echo "$AUTH_JSON" | grep -o '"email":"[^"]*"' | head -1 | cut -d'"' -f4)
    SUB_TYPE=$(echo "$AUTH_JSON" | grep -o '"subscriptionType":"[^"]*"' | head -1 | cut -d'"' -f4)
  fi
  HOOK_MODEL=$(grep -o '"model":"[^"]*"' "$TMPFILE" | head -1 | cut -d'"' -f4)
  ENRICH=""
  [ -n "$SUB_EMAIL" ] && ENRICH="${ENRICH}\"subscription_email\":\"$SUB_EMAIL\","
  [ -n "$SUB_TYPE" ] && ENRICH="${ENRICH}\"subscription_type\":\"$SUB_TYPE\","
  ENRICH="${ENRICH}\"hostname\":\"$(hostname 2>/dev/null || echo unknown)\",\"platform\":\"$(uname -s 2>/dev/null || echo Windows)\""
  if [ -n "$ENRICH" ]; then
    sed "s/}$/,${ENRICH}}/" "$TMPFILE" > "${TMPFILE}.new" && mv "${TMPFILE}.new" "$TMPFILE"
  fi
fi
RESP=$(curl -sf -m 5 -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $AUTH_TOKEN" -d @"$TMPFILE" "$SERVER_URL/api/v1/hook/$P" 2>/dev/null)
rm -f "$TMPFILE"
[ -n "$RESP" ] && echo "$RESP"
'@

$HookPath = Join-Path $HooksDir "clawlens-hook.sh"
[System.IO.File]::WriteAllText($HookPath, $HookScript.Replace("`r`n", "`n"), [System.Text.UTF8Encoding]::new($false))
Write-Host "  -> $HookPath"

# Step 2: Configure hooks in settings.json
Write-Host "[2/3] Configuring hooks..."

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
# This avoids PowerShell hashtable/PSObject depth issues entirely
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

# Step 3: Verify
Write-Host "[3/3] Verifying..."
try {
    Invoke-RestMethod -Uri "$ServerUrl/health" -TimeoutSec 5 | Out-Null
    Write-Host "  -> Server: OK"
} catch {
    Write-Host "  -> Server: UNREACHABLE (check URL)"
}

Write-Host ""
Write-Host "  ===================="
Write-Host "  ClawLens installed!"
Write-Host "  ===================="
Write-Host ""
Write-Host "  Restart Claude Code for hooks to take effect."
Write-Host ""
