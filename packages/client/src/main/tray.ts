import { Tray, Menu, nativeImage, app } from 'electron';
import path from 'path';
import { createWindow, getWindow } from './window';
import { loadConfig } from './utils/config';

let tray: Tray | null = null;
let watchStatus: 'on' | 'off' = 'off';

export function createTray(): Tray {
  const iconPath = path.join(__dirname, '../../assets', watchStatus === 'on' ? 'tray-on.png' : 'tray-off.png');

  // Create a default icon if assets don't exist yet
  let icon: Electron.NativeImage;
  try {
    icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) throw new Error('empty');
  } catch {
    // Create a simple colored dot as default icon
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);
  tray.setToolTip('HowinLens - Off Watch');
  updateContextMenu();

  tray.on('click', () => {
    toggleWindow();
  });

  return tray;
}

function toggleWindow() {
  const win = getWindow();
  if (win && win.isVisible()) {
    win.hide();
  } else {
    showWindow();
  }
}

function showWindow() {
  const config = loadConfig();
  let win = getWindow();
  if (!win) {
    win = createWindow();
  }
  if (config.serverUrl) {
    const currentUrl = win.webContents.getURL();
    if (!currentUrl.startsWith(config.serverUrl)) {
      win.loadURL(`${config.serverUrl}/client/dashboard`);
    }
  }
  win.show();
  win.focus();
}

export function updateTrayState(status: 'on' | 'off' | 'alert') {
  watchStatus = status === 'alert' ? 'on' : status;
  if (tray) {
    tray.setToolTip(`HowinLens - ${status === 'on' ? 'On Watch' : status === 'alert' ? 'Alert' : 'Off Watch'}`);
    updateContextMenu();
  }
}

function updateContextMenu() {
  if (!tray) return;

  const contextMenu = Menu.buildFromTemplate([
    {
      label: watchStatus === 'on' ? '● On Watch' : '○ Off Watch',
      enabled: false,
    },
    { type: 'separator' },
    {
      label: watchStatus === 'on' ? 'Go Off Watch' : 'Go On Watch',
      click: () => {
        // Toggle watch via IPC → API call
        const { ipcMain } = require('electron');
        if (watchStatus === 'on') {
          ipcMain.emit('watch-off');
        } else {
          ipcMain.emit('watch-on');
        }
      },
    },
    {
      label: 'Open Dashboard',
      click: () => showWindow(),
    },
    { type: 'separator' },
    {
      label: 'Quit HowinLens',
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
}

export function getTray() {
  return tray;
}
