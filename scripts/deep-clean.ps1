# ClawLens Deep Clean — remove ALL traces of ClawLens + old projects
# Usage: Run as Administrator for full cleanup (managed settings)
#        Run as normal user for standard cleanup
#
# Removes:
# - ClawLens standard install (hooks, watcher, cache, startup shortcut)
# - ClawLens enforced mode (managed-settings.d)
# - Old claude-code-limiter managed settings
# - Old ClawLens v0.1 remnants
# - Old plugin registrations
# - Everything from settings.json (hooks, env vars)

Write-Host ""
Write-Host "  ClawLens Deep Clean"
Write-Host "  ==================="
Write-Host "  Removes ALL traces of ClawLens + old projects"
Write-Host ""

$HooksDir = Join-Path $env:USERPROFILE ".claude\hooks"
$SettingsPath = Join-Path $env:USERPROFILE ".claude\settings.json"
$IsAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

# ══════════════════════════════════════════════════════════════════════════════
# 1. Stop watcher
# ══════════════════════════════════════════════════════════════════════════════

Write-Host "  [1/8] Stopping watcher..."
$PidFile = Join-Path $HooksDir ".clawlens-watcher.pid"
if (Test-Path $PidFile) {
    $WatcherPid = Get-Content $PidFile -ErrorAction SilentlyContinue
    if ($WatcherPid) {
        try { Stop-Process -Id ([int]$WatcherPid) -Force -ErrorAction SilentlyContinue } catch {}
    }
    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
}
Get-Process -Name "node" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match "clawlens-watcher|claude-code-limiter" } |
    Stop-Process -Force -ErrorAction SilentlyContinue
Write-Host "    Done"

# ══════════════════════════════════════════════════════════════════════════════
# 2. Remove Startup shortcuts
# ══════════════════════════════════════════════════════════════════════════════

Write-Host "  [2/8] Removing auto-start entries..."
$StartupDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup"
@("clawlens-watcher.vbs", "claude-code-limiter.vbs") | ForEach-Object {
    $f = Join-Path $StartupDir $_
    if (Test-Path $f) { Remove-Item $f -Force; Write-Host "    Removed $_" }
}
Write-Host "    Done"

# ══════════════════════════════════════════════════════════════════════════════
# 3. Remove hook files
# ══════════════════════════════════════════════════════════════════════════════

Write-Host "  [3/8] Removing hook files..."
@("clawlens.mjs", "clawlens-watcher.mjs", "clawlens-hook.sh",
  "antigravity-collector.mjs", "hook.js", "limiter-hook.sh") | ForEach-Object {
    $f = Join-Path $HooksDir $_
    if (Test-Path $f) { Remove-Item $f -Force }
}
Write-Host "    Done"

# ══════════════════════════════════════════════════════════════════════════════
# 4. Remove cache and log files
# ══════════════════════════════════════════════════════════════════════════════

Write-Host "  [4/8] Removing cache and log files..."
@(".clawlens-cache.json", ".clawlens-model.txt", ".clawlens-config.json",
  ".clawlens-watcher.pid", ".clawlens-debug.log", ".clawlens-watcher.log",
  ".clawlens-watcher-stderr.log", ".clawlens-notify.ps1", ".clawlens-notify-launcher.ps1",
  ".clawlens-ag-last-sync.json",
  ".limiter-cache.json", ".limiter-config.json") | ForEach-Object {
    $f = Join-Path $HooksDir $_
    if (Test-Path $f) { Remove-Item $f -Force }
}
$AgExportDir = Join-Path $HooksDir ".clawlens-ag-export"
if (Test-Path $AgExportDir) { Remove-Item $AgExportDir -Recurse -Force }
Write-Host "    Done"

# ══════════════════════════════════════════════════════════════════════════════
# 5. Clean settings.json
# ══════════════════════════════════════════════════════════════════════════════

Write-Host "  [5/8] Cleaning settings.json..."
if (Test-Path $SettingsPath) {
    try {
        node -e "
            const fs = require('fs');
            const f = process.argv[1];
            let s = {};
            try { s = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { process.exit(0); }
            if (s.hooks) {
                for (const [event, groups] of Object.entries(s.hooks)) {
                    s.hooks[event] = groups.filter(g => {
                        const str = JSON.stringify(g);
                        return !str.includes('clawlens') && !str.includes('limiter');
                    });
                    if (s.hooks[event].length === 0) delete s.hooks[event];
                }
                if (Object.keys(s.hooks).length === 0) delete s.hooks;
            }
            if (s.env) {
                ['CLAUDE_PLUGIN_OPTION_SERVER_URL','CLAUDE_PLUGIN_OPTION_AUTH_TOKEN',
                 'CLAWLENS_DEBUG','CLAWLENS_SERVER','CLAWLENS_TOKEN',
                 'CLAUDE_LIMITER_SERVER','CLAUDE_LIMITER_TOKEN'].forEach(k => delete s.env[k]);
                if (Object.keys(s.env).length === 0) delete s.env;
            }
            fs.writeFileSync(f, JSON.stringify(s, null, 2));
        " "$SettingsPath"
        Write-Host "    Done"
    } catch {
        Write-Host "    Warning: could not clean settings.json"
    }
} else {
    Write-Host "    No settings.json found"
}

# ══════════════════════════════════════════════════════════════════════════════
# 6. Remove managed settings (enforced mode) — requires Admin
# ══════════════════════════════════════════════════════════════════════════════

Write-Host "  [6/8] Removing managed/enforced settings..."
$ManagedDir = "C:\ProgramData\ClaudeCode\managed-settings.d"
if ($IsAdmin) {
    @("10-clawlens.json", ".10-clawlens.json.bak", ".clawlens-hash",
      "10-limiter.json", "10-claude-code-limiter.json") | ForEach-Object {
        $f = Join-Path $ManagedDir $_
        if (Test-Path $f) { Remove-Item $f -Force }
    }
    # Gate scripts
    $GateDir = "C:\ProgramData\ClaudeCode"
    @("clawlens-hook.sh", "clawlens-gate.sh", "limiter-hook.sh",
      "limiter-gate.sh", "managed-settings.json") | ForEach-Object {
        $f = Join-Path $GateDir $_
        if (Test-Path $f) { Remove-Item $f -Force }
    }
    Write-Host "    Done"
} else {
    if (Test-Path $ManagedDir) {
        Write-Host "    Skipped (run as Administrator to remove managed settings)"
    } else {
        Write-Host "    No managed settings found"
    }
}

# ══════════════════════════════════════════════════════════════════════════════
# 7. Remove old binaries and plugins
# ══════════════════════════════════════════════════════════════════════════════

Write-Host "  [7/8] Removing old binaries and plugins..."
# Old config dirs
$OldDirs = @(
    (Join-Path $env:USERPROFILE ".clawlens"),
    (Join-Path $env:USERPROFILE ".claude-code-limiter")
)
foreach ($d in $OldDirs) {
    if (Test-Path $d) { Remove-Item $d -Recurse -Force -ErrorAction SilentlyContinue }
}
# Old plugin uninstall
try { claude plugin uninstall clawlens@howincodes 2>$null } catch {}
try { claude plugin uninstall claude-code-limiter 2>$null } catch {}
Write-Host "    Done"

# ══════════════════════════════════════════════════════════════════════════════
# 8. Verify
# ══════════════════════════════════════════════════════════════════════════════

Write-Host "  [8/8] Verifying..."
$Remaining = Get-ChildItem $HooksDir -Filter "*clawlens*" -ErrorAction SilentlyContinue
$RemainingLimiter = Get-ChildItem $HooksDir -Filter "*limiter*" -ErrorAction SilentlyContinue

Write-Host ""
if ($Remaining.Count -eq 0 -and $RemainingLimiter.Count -eq 0) {
    Write-Host "  All ClawLens traces removed completely."
} else {
    Write-Host "  WARNING: Some files remain:"
    $Remaining | ForEach-Object { Write-Host "  $_" }
    $RemainingLimiter | ForEach-Object { Write-Host "  $_" }
}
Write-Host ""
Write-Host "  Restart Claude Code for changes to take effect."
Write-Host ""
