import { BrowserWindow, screen } from 'electron';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { errorPageHtml } from './pages/error';
import { settingsPageHtml } from './pages/settings';

// ---------------------------------------------------------------------------
// Window position persistence
// ---------------------------------------------------------------------------

const BOUNDS_PATH = path.join(os.homedir(), '.howinlens', 'window-bounds.json');

interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

function loadBounds(defaults: WindowBounds): WindowBounds {
  try {
    if (fs.existsSync(BOUNDS_PATH)) {
      const raw = fs.readFileSync(BOUNDS_PATH, 'utf-8');
      const saved = JSON.parse(raw) as WindowBounds;

      // Validate saved bounds are still on-screen
      const displays = screen.getAllDisplays();
      const onScreen = displays.some(d => {
        const { x, y, width, height } = d.workArea;
        return saved.x >= x - 50 && saved.x < x + width &&
               saved.y >= y - 50 && saved.y < y + height;
      });

      if (onScreen) return saved;
    }
  } catch {}
  return defaults;
}

function saveBounds(bounds: WindowBounds): void {
  try {
    const dir = path.dirname(BOUNDS_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(BOUNDS_PATH, JSON.stringify(bounds));
  } catch {}
}

// ---------------------------------------------------------------------------
// Main window
// ---------------------------------------------------------------------------

let mainWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;

export function createWindow(isSetup = false): BrowserWindow {
  const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;

  const defaultBounds: WindowBounds = {
    width: isSetup ? 480 : 420,
    height: isSetup ? 520 : 640,
    x: screenWidth - (isSetup ? 480 : 420) - 20,
    y: 40,
  };

  const bounds = isSetup ? defaultBounds : loadBounds(defaultBounds);

  // Setup window needs direct IPC (no sandbox), dashboard needs security hardening
  const webPreferences = isSetup
    ? {
        // Setup wizard: allow nodeIntegration so ipcRenderer.invoke() works with data: URLs
        nodeIntegration: true,
        contextIsolation: false,
        sandbox: false,
      }
    : {
        // Dashboard: secure sandbox with preload
        preload: path.join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      };

  mainWindow = new BrowserWindow({
    ...bounds,
    show: false,
    frame: true,
    resizable: true,
    skipTaskbar: false,
    title: 'HowinLens',
    backgroundColor: '#0f1117',
    webPreferences,
  });

  // Set CSP headers for dashboard windows (not setup window)
  if (!isSetup) {
    mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; " +
            "script-src 'self'; " +
            "style-src 'self' 'unsafe-inline'; " +
            "img-src 'self' data: https:; " +
            "font-src 'self' data:; " +
            "connect-src 'self' https:; " +
            "frame-ancestors 'none'; " +
            "base-uri 'self'; " +
            "form-action 'self'"
          ],
        },
      });
    });
  }

  // Save position/size on move and resize
  if (!isSetup) {
    const debouncedSave = debounce(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        const b = mainWindow.getBounds();
        saveBounds(b);
      }
    }, 500);

    mainWindow.on('move', debouncedSave);
    mainWindow.on('resize', debouncedSave);
  }

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

/**
 * Load the dashboard URL with offline/error fallback.
 */
export function loadDashboard(win: BrowserWindow, serverUrl: string): void {
  const dashboardUrl = `${serverUrl}/client/dashboard`;

  win.loadURL(dashboardUrl).catch(() => {
    // Server unreachable — show error page
    win.loadURL('data:text/html;charset=utf-8,' +
      encodeURIComponent(errorPageHtml(serverUrl, 'Could not connect to server')));
  });

  // Handle navigation errors (e.g., server goes down mid-session)
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    // Ignore aborted loads (user navigated away) and cancellations
    if (errorCode === -3 || errorCode === -1) return;

    win.loadURL('data:text/html;charset=utf-8,' +
      encodeURIComponent(errorPageHtml(serverUrl, errorDescription || `Error ${errorCode}`)));
  });
}

// ---------------------------------------------------------------------------
// Settings window
// ---------------------------------------------------------------------------

export function createSettingsWindow(): BrowserWindow {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return settingsWindow;
  }

  settingsWindow = new BrowserWindow({
    width: 420,
    height: 520,
    resizable: false,
    title: 'HowinLens Settings',
    backgroundColor: '#0f1117',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  settingsWindow.loadURL('data:text/html;charset=utf-8,' +
    encodeURIComponent(settingsPageHtml));

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });

  return settingsWindow;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export function getWindow(): BrowserWindow | null {
  return mainWindow;
}

export function getSettingsWindow(): BrowserWindow | null {
  return settingsWindow;
}

// ---------------------------------------------------------------------------
// Utils
// ---------------------------------------------------------------------------

function debounce(fn: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}
