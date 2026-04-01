import { BrowserWindow, screen } from 'electron';
import path from 'path';

let mainWindow: BrowserWindow | null = null;

export function createWindow(isSetup = false): BrowserWindow {
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: isSetup ? 500 : 400,
    height: isSetup ? 400 : 600,
    x: screenWidth - (isSetup ? 500 : 400) - 20,
    y: 40,
    show: false,
    frame: true,
    resizable: true,
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on('close', (e) => {
    if (!isSetup) {
      // Hide instead of close (keep tray running)
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

export function getWindow(): BrowserWindow | null {
  return mainWindow;
}
