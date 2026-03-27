#Requires -RunAsAdministrator
<#
.SYNOPSIS
    ClawLens Enforcement Removal — clean uninstall (Windows)

.DESCRIPTION
    Removes all managed settings, hook/gate scripts, watchdog scheduled task,
    and log files installed by enforce.ps1.

.EXAMPLE
    .\restore.ps1
#>

[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ── Paths ────────────────────────────────────────────────────────────────────

$ManagedDir = "C:\Program Files\ClaudeCode\managed-settings.d"
$GateDir    = "C:\Program Files\ClaudeCode"
$LogDir     = "C:\ProgramData\ClawLens\logs"
$TaskName   = "ClawLensWatchdog"

# ── Pre-flight ───────────────────────────────────────────────────────────────

$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error "This script must be run as Administrator."
    exit 1
}

Write-Host ""
Write-Host "  ClawLens Enforcement Removal"
Write-Host "  =============================="
Write-Host ""

# ── Remove scheduled task ────────────────────────────────────────────────────

$existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existingTask) {
    try {
        # Stop the task if running
        if ($existingTask.State -eq "Running") {
            Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        }
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "  -> Removed scheduled task: $TaskName"
    } catch {
        Write-Warning "Failed to remove scheduled task: $_"
    }
} else {
    Write-Host "  -> Scheduled task not found (already removed or never installed)"
}

# ── Remove managed settings ─────────────────────────────────────────────────

$settingsRemoved = 0

$settingsFile = Join-Path $ManagedDir "10-clawlens.json"
if (Test-Path $settingsFile) {
    Remove-Item -Path $settingsFile -Force
    $settingsRemoved++
}

$backupFile = Join-Path $ManagedDir ".10-clawlens.json.bak"
if (Test-Path $backupFile) {
    Remove-Item -Path $backupFile -Force
}

$hashFile = Join-Path $ManagedDir ".clawlens-hash"
if (Test-Path $hashFile) {
    Remove-Item -Path $hashFile -Force
}

if ($settingsRemoved -gt 0) {
    Write-Host "  -> Removed managed settings"
} else {
    Write-Host "  -> Managed settings not found (already removed or never installed)"
}

# Clean up empty managed-settings.d directory
if (Test-Path $ManagedDir) {
    $remaining = (Get-ChildItem -Path $ManagedDir -Force -ErrorAction SilentlyContinue | Measure-Object).Count
    if ($remaining -eq 0) {
        Remove-Item -Path $ManagedDir -Force -ErrorAction SilentlyContinue
        Write-Host "  -> Removed empty directory: $ManagedDir"
    }
}

# ── Remove scripts ──────────────────────────────────────────────────────────

$scriptsRemoved = 0
$scriptNames = @("clawlens-hook.ps1", "clawlens-gate.ps1", "clawlens-watchdog.ps1")

foreach ($scriptName in $scriptNames) {
    $scriptPath = Join-Path $GateDir $scriptName
    if (Test-Path $scriptPath) {
        Remove-Item -Path $scriptPath -Force
        $scriptsRemoved++
    }
}

if ($scriptsRemoved -gt 0) {
    Write-Host "  -> Removed $scriptsRemoved script(s)"
} else {
    Write-Host "  -> No scripts found to remove"
}

# ── Remove log files ────────────────────────────────────────────────────────

if (Test-Path $LogDir) {
    Remove-Item -Path "$LogDir\clawlens-watchdog.log" -Force -ErrorAction SilentlyContinue
    Remove-Item -Path "$LogDir\clawlens-watchdog.log.old" -Force -ErrorAction SilentlyContinue

    # Clean up empty log directory
    $remaining = (Get-ChildItem -Path $LogDir -Force -ErrorAction SilentlyContinue | Measure-Object).Count
    if ($remaining -eq 0) {
        Remove-Item -Path $LogDir -Recurse -Force -ErrorAction SilentlyContinue
        # Also remove parent if empty
        $parentDir = Split-Path $LogDir -Parent
        $parentRemaining = (Get-ChildItem -Path $parentDir -Force -ErrorAction SilentlyContinue | Measure-Object).Count
        if ($parentRemaining -eq 0) {
            Remove-Item -Path $parentDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}
Write-Host "  -> Removed log files"

# ── Optional: uninstall plugin ───────────────────────────────────────────────

Write-Host ""
$choice = Read-Host "  Also uninstall the ClawLens plugin? (y/n)"
if ($choice -in @("y", "Y")) {
    if (Get-Command "claude" -ErrorAction SilentlyContinue) {
        try {
            & claude plugin uninstall clawlens 2>$null
            Write-Host "  -> Plugin uninstalled"
        } catch {
            Write-Host "  -> Plugin not installed or uninstall failed"
        }
    } else {
        Write-Host "  -> claude command not found (skipping plugin removal)"
    }
} else {
    Write-Host "  -> Skipped plugin removal"
}

# ── Done ─────────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "  ClawLens enforcement removed."
Write-Host "  Restart Claude Code for changes to take effect."
Write-Host ""
