import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('howinlens', {
  getStatus: () => ipcRenderer.invoke('get-status'),
  watchOn: () => ipcRenderer.invoke('watch-on'),
  watchOff: () => ipcRenderer.invoke('watch-off'),
  setActiveTask: (taskId: number | null) => ipcRenderer.invoke('set-active-task', taskId),
  getConfig: () => ipcRenderer.invoke('get-config'),
  onWatchStatusChanged: (callback: (status: string) => void) => {
    ipcRenderer.on('watch-status-changed', (_event, status) => callback(status));
  },
  onNotification: (callback: (title: string, body: string) => void) => {
    ipcRenderer.on('notification', (_event, title, body) => callback(title, body));
  },
});
