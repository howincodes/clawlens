import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('howinlens', {
  // Status & watch
  getStatus: () => ipcRenderer.invoke('get-status'),
  watchOn: () => ipcRenderer.invoke('watch-on'),
  watchOff: () => ipcRenderer.invoke('watch-off'),
  setActiveTask: (taskId: number | null) => ipcRenderer.invoke('set-active-task', taskId),

  // Config
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config: { serverUrl: string; authToken: string; autoStart?: boolean; notificationsEnabled?: boolean }) =>
    ipcRenderer.invoke('save-config', config),
  verifyConnection: (serverUrl: string, authToken: string) =>
    ipcRenderer.invoke('verify-connection', serverUrl, authToken),

  // Settings
  getFullConfig: () => ipcRenderer.invoke('get-full-config'),
  openSettings: () => ipcRenderer.invoke('open-settings'),

  // Events from main process
  onWatchStatusChanged: (callback: (status: string) => void) => {
    ipcRenderer.on('watch-status-changed', (_event, status) => callback(status));
  },
  onNotification: (callback: (title: string, body: string) => void) => {
    ipcRenderer.on('notification', (_event, title, body) => callback(title, body));
  },
});
