import { autoUpdater } from 'electron-updater';
import { showNotification } from './notifications';

// ---------------------------------------------------------------------------
// Auto-updater — checks for updates on startup and every 24 hours.
// Uses electron-updater with GitHub Releases as the update source.
// ---------------------------------------------------------------------------

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
let checkTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Initialize the auto-updater and check for updates.
 * Call once at startup — it schedules recurring checks.
 */
export function checkForUpdates(): void {
  // Configure updater
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  // Suppress noisy logging in production
  autoUpdater.logger = null;

  // Event handlers
  autoUpdater.on('update-available', (info) => {
    console.log(`[updater] Update available: v${info.version}`);
    showNotification(
      'Update Available',
      `HowinLens v${info.version} is downloading...`,
    );
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log(`[updater] Update downloaded: v${info.version}`);
    showNotification(
      'Update Ready',
      `HowinLens v${info.version} will install on next restart.`,
    );
  });

  autoUpdater.on('error', (err) => {
    // Don't spam errors — update failures are expected in dev/offline
    console.log(`[updater] Check failed: ${err.message}`);
  });

  // Initial check (delayed to not slow startup)
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 10_000); // 10 seconds after launch

  // Recurring checks
  checkTimer = setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, CHECK_INTERVAL_MS);
}

/**
 * Stop the update checker.
 */
export function stopUpdateChecker(): void {
  if (checkTimer) {
    clearInterval(checkTimer);
    checkTimer = null;
  }
}
