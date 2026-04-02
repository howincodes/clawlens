import { Notification } from 'electron';

// ---------------------------------------------------------------------------
// Notification service — native OS notifications for server-pushed events.
//
// Connected to watcher-connection.ts which dispatches events here.
// Respects the user's notificationsEnabled config flag.
// ---------------------------------------------------------------------------

let enabled = true;

/**
 * Enable or disable notifications.
 */
export function setNotificationsEnabled(value: boolean): void {
  enabled = value;
}

/**
 * Show a native notification if supported and enabled.
 */
export function showNotification(title: string, body: string): void {
  if (!enabled || !Notification.isSupported()) return;
  new Notification({ title, body }).show();
}

// ---------------------------------------------------------------------------
// Event-specific notifications — called from watcher-connection.ts
// ---------------------------------------------------------------------------

/**
 * Credential was rotated (new tokens pushed from server).
 */
export function notifyCredentialRotated(email: string): void {
  showNotification(
    'Credentials Rotated',
    `New tokens for ${email} have been applied.`,
  );
}

/**
 * Usage is approaching the rate limit.
 */
export function notifyUsageAlert(utilization: number, window: string): void {
  showNotification(
    'Usage Warning',
    `${window} usage is at ${utilization}%. Consider slowing down.`,
  );
}

/**
 * Token is about to expire and the server hasn't refreshed it yet.
 */
export function notifyTokenExpiring(email: string, minutesLeft: number): void {
  showNotification(
    'Token Expiring Soon',
    `${email} token expires in ${minutesLeft} minutes. Contact admin if it doesn't auto-refresh.`,
  );
}

/**
 * Account needs re-authentication (refresh token expired or revoked).
 */
export function notifyNeedsReauth(email: string): void {
  showNotification(
    'Re-authentication Required',
    `${email} needs to be re-authenticated. Contact your admin.`,
  );
}

/**
 * Server command received (generic).
 */
export function notifyServerCommand(command: string, message?: string): void {
  showNotification(
    'Server Command',
    message || `Received command: ${command}`,
  );
}
