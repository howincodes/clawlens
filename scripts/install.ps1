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

$Settings = @{}
if (Test-Path $SettingsPath) {
    $Settings = Get-Content $SettingsPath -Raw | ConvertFrom-Json -AsHashtable
}
if (-not $Settings) { $Settings = @{} }

# Set env vars
if (-not $Settings.ContainsKey('env')) { $Settings['env'] = @{} }
$Settings['env']['CLAUDE_PLUGIN_OPTION_SERVER_URL'] = $ServerUrl
$Settings['env']['CLAUDE_PLUGIN_OPTION_AUTH_TOKEN'] = $AuthToken

# Build hooks config
$MakeHook = { param($timeout, $async)
    $h = @{ type = "command"; command = $HookCmd; timeout = $timeout }
    if ($async) { $h['async'] = $true }
    return @( @{ hooks = @( $h ) } )
}

$Hooks = @{
    SessionStart       = & $MakeHook 5 $false
    UserPromptSubmit   = & $MakeHook 3 $false
    PreToolUse         = & $MakeHook 2 $true
    Stop               = & $MakeHook 3 $false
    StopFailure        = & $MakeHook 2 $true
    SessionEnd         = & $MakeHook 3 $true
    PostToolUse        = & $MakeHook 3 $true
    SubagentStart      = & $MakeHook 2 $true
    PostToolUseFailure = & $MakeHook 2 $true
    ConfigChange       = & $MakeHook 3 $false
    FileChanged        = @( @{ matcher = "settings.json"; hooks = @( @{ type = "command"; command = $HookCmd; timeout = 3 } ) } )
}

$Settings['hooks'] = $Hooks
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
