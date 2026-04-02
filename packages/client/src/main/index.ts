import { app, ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import os from 'os';

import { createTray, updateTrayState } from './tray';
import { createWindow, loadDashboard, getWindow } from './window';
import { startAllServices, stopAllServices } from './services/service-manager';
import { setNotificationsEnabled } from './services/notifications';
import { loadConfig } from './utils/config';
import { setupIpcHandlers } from './ipc';
import { installAutoStart, isAutoStartInstalled, uninstallAutoStart } from './services/auto-start';
import { checkForUpdates } from './services/updater';
import { setupPageHtml } from './pages/setup';

console.log('[app] HowinLens v0.3.0 starting...');
console.log('[app] isPackaged=%s, platform=%s, pid=%d', app.isPackaged, process.platform, process.pid);

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.log('[app] Another instance already holds the lock — exiting');
  app.quit();
}

app.whenReady().then(async () => {
  console.log('[app] Electron ready');
  const config = loadConfig();
  console.log('[app] Config: serverUrl=%s, hasToken=%s', config.serverUrl || '(empty)', !!config.authToken);

  // Setup IPC handlers (needed by both setup wizard and dashboard)
  setupIpcHandlers(config);

  if (!config.serverUrl || !config.authToken) {
    console.log('[app] No config — showing setup wizard');
    showSetupWizard(config);
    return;
  }

  console.log('[app] Config found — starting app');
  await startApp(config);
});

// ---------------------------------------------------------------------------
// Setup wizard — writes HTML to temp file so preload bridge works
// ---------------------------------------------------------------------------

function showSetupWizard(config: ReturnType<typeof loadConfig>): void {
  // Write setup HTML to a temp file (data: URLs don't get the preload bridge)
  const tmpDir = path.join(os.tmpdir(), 'howinlens');
  fs.mkdirSync(tmpDir, { recursive: true });
  const tmpFile = path.join(tmpDir, 'setup.html');
  fs.writeFileSync(tmpFile, setupPageHtml);
  console.log('[app] Setup HTML written to %s', tmpFile);

  const win = createWindow(true);
  win.loadFile(tmpFile);
  win.show();
  console.log('[app] Setup window shown');

  // When setup completes, the renderer calls 'setup-complete' via preload bridge
  ipcMain.handleOnce('setup-complete', async () => {
    console.log('[app] Setup complete — loading fresh config');
    const freshConfig = loadConfig();
    Object.assign(config, freshConfig);
    win.destroy();

    // Clean up temp file
    try { fs.unlinkSync(tmpFile); } catch {}

    await startApp(config);
  });
}

// ---------------------------------------------------------------------------
// Main app start (tray + background services)
// ---------------------------------------------------------------------------

async function startApp(config: ReturnType<typeof loadConfig>): Promise<void> {
  console.log('[app] Starting main app...');

  // Create tray
  createTray();
  updateTrayState('off');
  console.log('[app] Tray created');

  // Notifications
  setNotificationsEnabled(config.notificationsEnabled !== false);

  // Auto-start: NEVER install in dev mode
  const isDev = !app.isPackaged;
  if (isDev) {
    console.log('[app] Dev mode — skipping auto-start, removing any existing agent');
    try { uninstallAutoStart(); } catch {}
  } else if (config.autoStart !== false) {
    if (!isAutoStartInstalled()) {
      try {
        installAutoStart();
        console.log('[app] Auto-start installed');
      } catch (err) {
        console.error('[app] Auto-start install failed:', err);
      }
    }
  } else {
    try { uninstallAutoStart(); } catch {}
  }

  // Start background services
  console.log('[app] Starting services...');
  await startAllServices(config);

  // Check for updates (non-blocking)
  checkForUpdates();

  console.log('[app] ✓ Running in tray — click tray icon to open dashboard');
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.on('window-all-closed', () => {
  // Keep running in tray — don't quit
});

app.on('before-quit', async () => {
  console.log('[app] Quitting...');
  await stopAllServices();
});

app.on('activate', () => {
  // macOS: re-create window when clicking dock icon
  const win = getWindow();
  if (!win) {
    const config = loadConfig();
    if (config.serverUrl) {
      const w = createWindow();
      loadDashboard(w, config.serverUrl);
      w.show();
    }
  } else {
    win.show();
  }
});

app.on('second-instance', () => {
  const win = getWindow();
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
});
