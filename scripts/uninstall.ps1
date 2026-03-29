# ClawLens Uninstaller for Windows

Write-Host ""
Write-Host "  ClawLens Uninstaller"
Write-Host "  ===================="
Write-Host ""

$HooksDir = Join-Path $env:USERPROFILE ".claude\hooks"
$SettingsPath = Join-Path $env:USERPROFILE ".claude\settings.json"

# 1. Stop watcher
Write-Host "  Stopping watcher..."
$PidFile = Join-Path $HooksDir ".clawlens-watcher.pid"
if (Test-Path $PidFile) {
    $Pid = Get-Content $PidFile -ErrorAction SilentlyContinue
    if ($Pid) {
        try { Stop-Process -Id ([int]$Pid) -Force -ErrorAction SilentlyContinue } catch {}
        Write-Host "  -> Stopped watcher (pid $Pid)"
    }
    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
}
# Kill by name fallback
Get-Process -Name "node" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match "clawlens-watcher" } |
    Stop-Process -Force -ErrorAction SilentlyContinue

# 2. Remove Startup shortcut
Write-Host "  Removing auto-start..."
$StartupDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup"
$VbsFile = Join-Path $StartupDir "clawlens-watcher.vbs"
if (Test-Path $VbsFile) {
    Remove-Item $VbsFile -Force
    Write-Host "  -> Removed startup shortcut"
}

# 3. Remove hook files
Write-Host "  Removing hook files..."
@("clawlens.mjs", "clawlens-watcher.mjs", "clawlens-hook.sh") | ForEach-Object {
    $f = Join-Path $HooksDir $_
    if (Test-Path $f) { Remove-Item $f -Force }
}
Write-Host "  -> Removed hook files"

# 4. Remove cache and log files
Write-Host "  Removing cache and log files..."
@(".clawlens-cache.json", ".clawlens-model.txt", ".clawlens-config.json",
  ".clawlens-watcher.pid", ".clawlens-debug.log", ".clawlens-watcher.log",
  ".clawlens-watcher-stderr.log") | ForEach-Object {
    $f = Join-Path $HooksDir $_
    if (Test-Path $f) { Remove-Item $f -Force }
}
Write-Host "  -> Removed cache and log files"

# 5. Clean settings.json
if (Test-Path $SettingsPath) {
    Write-Host "  Cleaning settings.json..."
    try {
        node -e "
            const fs = require('fs');
            const f = process.argv[1];
            let s = {};
            try { s = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { process.exit(0); }
            if (s.hooks) {
                for (const [event, groups] of Object.entries(s.hooks)) {
                    s.hooks[event] = groups.filter(g => !JSON.stringify(g).includes('clawlens'));
                    if (s.hooks[event].length === 0) delete s.hooks[event];
                }
                if (Object.keys(s.hooks).length === 0) delete s.hooks;
            }
            if (s.env) {
                delete s.env.CLAUDE_PLUGIN_OPTION_SERVER_URL;
                delete s.env.CLAUDE_PLUGIN_OPTION_AUTH_TOKEN;
                delete s.env.CLAWLENS_DEBUG;
                if (Object.keys(s.env).length === 0) delete s.env;
            }
            fs.writeFileSync(f, JSON.stringify(s, null, 2));
        " "$SettingsPath"
        Write-Host "  -> Cleaned settings.json"
    } catch {
        Write-Host "  -> Warning: could not clean settings.json"
    }
}

# 6. Verify
Write-Host ""
$Remaining = Get-ChildItem $HooksDir -Filter "*clawlens*" -ErrorAction SilentlyContinue
if ($Remaining.Count -eq 0) {
    Write-Host "  ============================="
    Write-Host "  ClawLens removed completely."
    Write-Host "  ============================="
} else {
    Write-Host "  WARNING: Some ClawLens files remain:"
    $Remaining | ForEach-Object { Write-Host "  $_" }
}
Write-Host ""
