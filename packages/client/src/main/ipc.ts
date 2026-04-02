import { ipcMain } from 'electron';
import { updateTrayState } from './tray';
import { apiRequest } from './services/api-client';
import { writeCredentials, deleteCredentials } from './services/credentials';
import { setWatchStatus } from './services/heartbeat';
import { showNotification } from './services/notifications';
import { loadConfig, saveConfig, type HowinLensConfig } from './utils/config';
import { createSettingsWindow } from './window';

export function setupIpcHandlers(config: HowinLensConfig): void {
  // -----------------------------------------------------------------------
  // Status & Watch
  // -----------------------------------------------------------------------

  ipcMain.handle('get-status', async () => {
    return apiRequest(config, '/api/v1/client/status');
  });

  ipcMain.handle('watch-on', async () => {
    const result = await apiRequest(config, '/api/v1/client/watch/on', {
      method: 'POST',
      body: JSON.stringify({ source: 'tray' }),
    });

    if (result?.ok && result.credential) {
      await writeCredentials(result.credential);
      setWatchStatus('on');
      updateTrayState('on');
      showNotification('HowinLens', 'You are now On Watch. Tracking active.');
    }

    return result;
  });

  ipcMain.handle('watch-off', async () => {
    const result = await apiRequest(config, '/api/v1/client/watch/off', {
      method: 'POST',
      body: JSON.stringify({ source: 'tray' }),
    });

    if (result?.ok) {
      await deleteCredentials();
      setWatchStatus('off');
      updateTrayState('off');
      showNotification('HowinLens', 'You are now Off Watch. Have a good break.');
    }

    return result;
  });

  ipcMain.handle('set-active-task', async (_event, taskId: number | null) => {
    return apiRequest(config, '/api/v1/client/active-task', {
      method: 'PUT',
      body: JSON.stringify({ taskId }),
    });
  });

  // -----------------------------------------------------------------------
  // Config & Settings
  // -----------------------------------------------------------------------

  ipcMain.handle('get-config', () => {
    return { serverUrl: config.serverUrl };
  });

  ipcMain.handle('get-full-config', () => {
    return loadConfig();
  });

  ipcMain.handle('save-config', async (_event, newConfig: Partial<HowinLensConfig>) => {
    const merged = { ...config, ...newConfig };
    saveConfig(merged);
    // Update the live config reference
    Object.assign(config, merged);
    return { ok: true };
  });

  ipcMain.handle('verify-connection', async (_event, serverUrl: string, authToken: string) => {
    try {
      const url = `${serverUrl}/api/v1/client/status`;
      const res = await fetch(url, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
      });

      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          return { ok: false, error: 'Invalid auth token' };
        }
        return { ok: false, error: `Server returned ${res.status}` };
      }

      const data = await res.json();
      return {
        ok: true,
        userName: data?.user?.name || data?.user?.email || 'user',
      };
    } catch (err: any) {
      return { ok: false, error: err.message || 'Connection failed' };
    }
  });

  ipcMain.handle('open-settings', () => {
    createSettingsWindow();
  });

  // -----------------------------------------------------------------------
  // Internal events from tray menu
  // -----------------------------------------------------------------------

  ipcMain.on('watch-on', () => {
    ipcMain.emit('watch-on');
  });

  ipcMain.on('watch-off', () => {
    ipcMain.emit('watch-off');
  });
}
