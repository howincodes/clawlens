import { BrowserWindow, screen } from 'electron';
import path from 'path';

// Embedded WebView Auth (Phase 1, Item 3)
// The BrowserWindow's webContents can navigate to claude.ai for OAuth login.
// The webview already supports arbitrary URLs — no additional code is needed.
// When we integrate real OAuth flows, the window can load the Anthropic
// authorization endpoint directly, and we intercept the redirect callback
// to capture the access token and refresh token.

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
