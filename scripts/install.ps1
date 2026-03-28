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

$HooksDir = "$env:USERPROFILE\.claude\hooks"
New-Item -ItemType Directory -Path $HooksDir -Force | Out-Null

$HookScript = @'
#!/bin/bash
INPUT=$(cat)
SERVER_URL="${CLAUDE_PLUGIN_OPTION_SERVER_URL}"
AUTH_TOKEN="${CLAUDE_PLUGIN_OPTION_AUTH_TOKEN}"
if [ -z "$SERVER_URL" ] || [ -z "$AUTH_TOKEN" ]; then
  SERVER_URL="${CLAWLENS_SERVER}"; AUTH_TOKEN="${CLAWLENS_TOKEN}"
fi
if [ -z "$SERVER_URL" ] || [ -z "$AUTH_TOKEN" ]; then exit 0; fi
if command -v jq >/dev/null 2>&1; then
  EVENT=$(echo "$INPUT" | jq -r '.hook_event_name // ""')
elif command -v node >/dev/null 2>&1; then
  EVENT=$(echo "$INPUT" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{console.log(JSON.parse(d).hook_event_name||'')}catch{console.log('')}})")
else
  EVENT=""
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
  *)                  exit 0 ;;
esac
RESP=$(curl -sf -m 3 -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $AUTH_TOKEN" -d "$INPUT" "$SERVER_URL/api/v1/hook/$P" 2>/dev/null)
[ -n "$RESP" ] && echo "$RESP"
'@

$HookPath = "$HooksDir\clawlens-hook.sh"
[System.IO.File]::WriteAllText($HookPath, $HookScript.Replace("`r`n", "`n"), [System.Text.UTF8Encoding]::new($false))
Write-Host "  -> $HookPath"

# Step 2: Configure hooks in settings.json
Write-Host "[2/3] Configuring hooks..."

$SettingsPath = "$env:USERPROFILE\.claude\settings.json"
$HookCmd = ($HookPath -replace '\\', '/')

# Read existing settings or start fresh
$Settings = $null
if (Test-Path $SettingsPath) {
    try { $Settings = Get-Content $SettingsPath -Raw | ConvertFrom-Json } catch {}
}
if (-not $Settings) { $Settings = New-Object PSObject }

# Set env vars
if (-not (Get-Member -InputObject $Settings -Name 'env' -MemberType NoteProperty)) {
    $Settings | Add-Member -NotePropertyName 'env' -NotePropertyValue (New-Object PSObject)
}
$Settings.env | Add-Member -NotePropertyName 'CLAUDE_PLUGIN_OPTION_SERVER_URL' -NotePropertyValue $ServerUrl -Force
$Settings.env | Add-Member -NotePropertyName 'CLAUDE_PLUGIN_OPTION_AUTH_TOKEN' -NotePropertyValue $AuthToken -Force

# Build hooks JSON string directly (avoids PS 5.1 hashtable depth issues)
$HooksJson = @"
{
  "SessionStart": [{"hooks": [{"type": "command", "command": "$HookCmd", "timeout": 5}]}],
  "UserPromptSubmit": [{"hooks": [{"type": "command", "command": "$HookCmd", "timeout": 3}]}],
  "PreToolUse": [{"hooks": [{"type": "command", "command": "$HookCmd", "timeout": 2, "async": true}]}],
  "Stop": [{"hooks": [{"type": "command", "command": "$HookCmd", "timeout": 3}]}],
  "StopFailure": [{"hooks": [{"type": "command", "command": "$HookCmd", "timeout": 2, "async": true}]}],
  "SessionEnd": [{"hooks": [{"type": "command", "command": "$HookCmd", "timeout": 3, "async": true}]}],
  "PostToolUse": [{"hooks": [{"type": "command", "command": "$HookCmd", "timeout": 3, "async": true}]}],
  "SubagentStart": [{"hooks": [{"type": "command", "command": "$HookCmd", "timeout": 2, "async": true}]}],
  "PostToolUseFailure": [{"hooks": [{"type": "command", "command": "$HookCmd", "timeout": 2, "async": true}]}],
  "ConfigChange": [{"hooks": [{"type": "command", "command": "$HookCmd", "timeout": 3}]}],
  "FileChanged": [{"matcher": "settings.json", "hooks": [{"type": "command", "command": "$HookCmd", "timeout": 3}]}]
}
"@
$Settings | Add-Member -NotePropertyName 'hooks' -NotePropertyValue ($HooksJson | ConvertFrom-Json) -Force

$Json = $Settings | ConvertTo-Json -Depth 10
[System.IO.File]::WriteAllText($SettingsPath, $Json, [System.Text.UTF8Encoding]::new($false))
Write-Host "  -> $SettingsPath"

# Step 3: Verify
Write-Host "[3/3] Verifying..."
try {
    $Health = Invoke-RestMethod -Uri "$ServerUrl/health" -TimeoutSec 5
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
