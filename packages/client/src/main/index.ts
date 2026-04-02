import { app } from 'electron';

import { createTray, updateTrayState } from './tray';
import { createWindow, loadDashboard, getWindow } from './window';
import { startAllServices, stopAllServices } from './services/service-manager';
import { setNotificationsEnabled } from './services/notifications';
import { loadConfig } from './utils/config';
import { setupIpcHandlers } from './ipc';
import { installAutoStart, isAutoStartInstalled, uninstallAutoStart } from './services/auto-start';
import { checkForUpdates } from './services/updater';
import { setupPageHtml } from './pages/setup';

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

app.whenReady().then(async () => {
  const config = loadConfig();

  // Setup IPC handlers first (needed by setup wizard)
  setupIpcHandlers(config);

  if (!config.serverUrl || !config.authToken) {
    // Show setup wizard
    const win = createWindow(true);
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(setupPageHtml));
    win.show();

    // When the setup completes, the page reloads — re-evaluate config
    win.webContents.on('did-finish-load', () => {
      const freshConfig = loadConfig();
      if (freshConfig.serverUrl && freshConfig.authToken) {
        Object.assign(config, freshConfig);
        win.close();
        startApp(config);
      }
    });

    return;
  }

  startApp(config);
});

async function startApp(config: ReturnType<typeof loadConfig>): Promise<void> {
  // Create tray
  createTray();
  updateTrayState('off');

  // Apply preferences
  setNotificationsEnabled(config.notificationsEnabled !== false);

  // Ensure auto-start matches config preference
  if (config.autoStart !== false) {
    if (!isAutoStartInstalled()) {
      try {
        installAutoStart();
        console.log('[howinlens] Auto-start installed');
      } catch (err) {
        console.error('[howinlens] Failed to install auto-start:', err);
      }
    }
  } else {
    try { uninstallAutoStart(); } catch {}
  }

  // Start all background services via service manager
  await startAllServices(config);

  // Check for updates (non-blocking)
  checkForUpdates();

  console.log('[howinlens] Client started');
}

app.on('window-all-closed', () => {
  // Don't quit when all windows are closed — keep running in tray
});

app.on('before-quit', async () => {
  await stopAllServices();
});

// macOS: re-create window when clicking dock icon
app.on('activate', () => {
  const win = getWindow();
  if (!win) {
    const config = loadConfig();
    if (config.serverUrl) {
      const w = createWindow();
      loadDashboard(w, config.serverUrl);
    }
  }
});

// Second instance: focus the existing window
app.on('second-instance', () => {
  const win = getWindow();
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
});
