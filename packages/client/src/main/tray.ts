import { Tray, Menu, nativeImage, app } from 'electron';
import { createWindow, getWindow, loadDashboard, createSettingsWindow } from './window';
import { loadConfig } from './utils/config';

let tray: Tray | null = null;
let currentStatus: TrayStatus = 'off';

export type TrayStatus = 'on' | 'off' | 'syncing' | 'alert';

// ---------------------------------------------------------------------------
// Programmatic icon generation — colored dots, no asset files needed
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<TrayStatus, string> = {
  on: '#22c55e',      // green
  off: '#71717a',     // gray
  syncing: '#3b82f6', // blue
  alert: '#eab308',   // yellow
};

function createStatusIcon(status: TrayStatus): Electron.NativeImage {
  const color = STATUS_COLORS[status];
  const size = 16;

  // Create a small PNG using a data URI embedded in a canvas-like buffer.
  // Since we can't use Canvas in the main process, use nativeImage.createFromDataURL
  // with an inline SVG rendered to a data URL.
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle cx="8" cy="8" r="6" fill="${color}" />
      ${status === 'on' ? '<circle cx="8" cy="8" r="3" fill="#fff" opacity="0.3" />' : ''}
      ${status === 'alert' ? '<text x="8" y="11" text-anchor="middle" font-size="9" font-weight="bold" fill="#000">!</text>' : ''}
    </svg>
  `.trim();

  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  const image = nativeImage.createFromDataURL(dataUrl);

  // Mark as template on macOS for proper dark/light menu bar support
  if (process.platform === 'darwin') {
    image.setTemplateImage(false); // We use color, not template
  }

  return image;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function createTray(): Tray {
  const icon = createStatusIcon('off');
  tray = new Tray(icon);
  tray.setToolTip('HowinLens — Off Watch');
  updateContextMenu();

  tray.on('click', () => {
    toggleWindow();
  });

  return tray;
}

export function updateTrayState(status: TrayStatus): void {
  currentStatus = status;

  if (tray) {
    tray.setImage(createStatusIcon(status));

    const labels: Record<TrayStatus, string> = {
      on: 'On Watch',
      off: 'Off Watch',
      syncing: 'Syncing...',
      alert: 'Attention Required',
    };
    tray.setToolTip(`HowinLens — ${labels[status]}`);
    updateContextMenu();
  }
}

export function getTray(): Tray | null {
  return tray;
}

export function getCurrentTrayStatus(): TrayStatus {
  return currentStatus;
}

// ---------------------------------------------------------------------------
// Context menu
// ---------------------------------------------------------------------------

function updateContextMenu(): void {
  if (!tray) return;

  const statusLabel: Record<TrayStatus, string> = {
    on: '\u25CF On Watch',       // ●
    off: '\u25CB Off Watch',     // ○
    syncing: '\u25D4 Syncing',   // ◔
    alert: '\u26A0 Alert',       // ⚠
  };

  const contextMenu = Menu.buildFromTemplate([
    {
      label: statusLabel[currentStatus],
      enabled: false,
    },
    { type: 'separator' },
    {
      label: currentStatus === 'on' ? 'Go Off Watch' : 'Go On Watch',
      click: () => {
        // Toggle watch via IPC
        const { ipcMain } = require('electron');
        ipcMain.emit(currentStatus === 'on' ? 'watch-off' : 'watch-on');
      },
    },
    {
      label: 'Open Dashboard',
      click: () => showWindow(),
    },
    {
      label: 'Settings',
      click: () => createSettingsWindow(),
    },
    { type: 'separator' },
    {
      label: 'Quit HowinLens',
      click: () => app.quit(),
    },
  ]);

  tray.setContextMenu(contextMenu);
}

// ---------------------------------------------------------------------------
// Window helpers
// ---------------------------------------------------------------------------

function toggleWindow(): void {
  const win = getWindow();
  if (win && win.isVisible()) {
    win.hide();
  } else {
    showWindow();
  }
}

function showWindow(): void {
  const config = loadConfig();
  let win = getWindow();
  if (!win) {
    win = createWindow();
  }
  if (config.serverUrl) {
    const currentUrl = win.webContents.getURL();
    if (!currentUrl.startsWith(config.serverUrl)) {
      loadDashboard(win, config.serverUrl);
    }
  }
  win.show();
  win.focus();
}
