import { execSync } from 'child_process';

/**
 * Show a native OS notification. Fails silently — never crashes the daemon.
 */
function showNotification(title: string, body: string): void {
  try {
    if (process.platform === 'darwin') {
      execSync(`osascript -e 'display notification "${body.replace(/"/g, '\\"')}" with title "${title.replace(/"/g, '\\"')}"'`);
    } else if (process.platform === 'linux') {
      execSync(`notify-send "${title}" "${body}" 2>/dev/null`);
    }
    // Windows: log only (notifications require PowerShell modules)
  } catch {}
}

export function notifyCredentialRotated(email: string): void {
  showNotification('Credentials Rotated', `New tokens for ${email} applied.`);
}

export function notifyUsageAlert(utilization: number, window: string): void {
  showNotification('Usage Warning', `${window} usage at ${utilization}%.`);
}

export function notifyNeedsReauth(email: string): void {
  showNotification('Re-auth Required', `${email} needs re-authentication.`);
}

export function notifyServerCommand(command: string, message?: string): void {
  showNotification('HowinLens', message || `Command: ${command}`);
}
