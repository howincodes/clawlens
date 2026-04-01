import { app, Tray } from 'electron';

import { createTray, updateTrayState } from './tray';
import { createWindow, getWindow } from './window';
import { startHeartbeat, stopHeartbeat } from './services/heartbeat';
import { startJsonlWatcher, stopJsonlWatcher } from './services/jsonl-watcher';
import { loadConfig } from './utils/config';
import { setupIpcHandlers } from './ipc';

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

let tray: Tray | null = null;

app.whenReady().then(async () => {
  const config = loadConfig();

  if (!config.serverUrl || !config.authToken) {
    // Show setup window if not configured
    const win = createWindow(true);
    win.loadURL('data:text/html,' + encodeURIComponent(`
      <html><body style="font-family:system-ui;padding:40px;text-align:center">
        <h2>HowinLens Setup</h2>
        <p>Edit config at ~/.howinlens/config.json</p>
        <pre style="text-align:left;background:#f5f5f5;padding:20px;border-radius:8px">
{
  "serverUrl": "https://your-server.com",
  "authToken": "your-auth-token"
}</pre>
        <p style="color:#666;margin-top:20px">Then restart the app.</p>
      </body></html>
    `));
    return;
  }

  // Create tray
  tray = createTray();
  updateTrayState('off');

  // Setup IPC handlers
  setupIpcHandlers(config);

  // Start background services
  startHeartbeat(config);
  startJsonlWatcher(config);

  console.log('[howinlens] Client started');
});

app.on('window-all-closed', () => {
  // Don't quit when all windows are closed — keep running in tray
});

app.on('before-quit', () => {
  stopHeartbeat();
  stopJsonlWatcher();
});

// macOS: re-create window when clicking dock icon
app.on('activate', () => {
  const win = getWindow();
  if (!win) {
    const config = loadConfig();
    if (config.serverUrl) {
      const w = createWindow();
      w.loadURL(`${config.serverUrl}/client/dashboard`);
    }
  }
});
