import { ipcMain, Notification } from 'electron';
import { updateTrayState } from './tray';
import { apiRequest } from './services/api-client';
import { writeCredentials, deleteCredentials } from './services/credentials';
import type { HowinLensConfig } from './utils/config';

export function setupIpcHandlers(config: HowinLensConfig) {
  ipcMain.handle('get-status', async () => {
    return apiRequest(config, '/api/v1/client/status');
  });

  ipcMain.handle('watch-on', async () => {
    const result = await apiRequest(config, '/api/v1/client/watch/on', {
      method: 'POST',
      body: JSON.stringify({ source: 'tray' }),
    });

    if (result?.ok && result.credential) {
      await writeCredentials(result.credential.accessToken, result.credential.refreshToken);
      updateTrayState('on');

      new Notification({
        title: 'HowinLens',
        body: 'You are now On Watch. Tracking active.',
      }).show();
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
      updateTrayState('off');

      new Notification({
        title: 'HowinLens',
        body: 'You are now Off Watch. Have a good break.',
      }).show();
    }

    return result;
  });

  ipcMain.handle('set-active-task', async (_event, taskId: number | null) => {
    return apiRequest(config, '/api/v1/client/active-task', {
      method: 'PUT',
      body: JSON.stringify({ taskId }),
    });
  });

  ipcMain.handle('get-config', () => {
    return { serverUrl: config.serverUrl };
  });

  // Listen for internal events from tray
  ipcMain.on('watch-on', async () => {
    await ipcMain.emit('watch-on');
  });

  ipcMain.on('watch-off', async () => {
    await ipcMain.emit('watch-off');
  });
}
