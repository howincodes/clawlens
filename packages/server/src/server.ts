import express, { type Express } from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

import { initDb, closeDb } from './db/index.js';
import { seedDatabase } from './db/seed.js';
import { initWebSocket } from './services/websocket.js';
import { initWatcherWebSocket } from './services/watcher-ws.js';
import { startDeadmanSwitch } from './services/deadman.js';
import { hookAuth } from './middleware/hook-auth.js';
import { adminRouter } from './routes/admin-api.js';
import { providerRouter } from './routes/provider-api.js';
import { watcherRouter } from './routes/watcher-api.js';
import { clientRouter } from './routes/client-api.js';
import { subscriptionRouter } from './routes/subscription-api.js';
import type { Request, Response, NextFunction } from 'express';
import { startAICrons } from './services/ai-jobs.js';
import { startUsageMonitor } from './services/usage-monitor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Express app setup
// ---------------------------------------------------------------------------

export const app: Express = express();

// Body parsing
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// CORS — allow all origins in dev; tighten in production via env var
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',')
  : ['http://localhost:5173', 'http://localhost:3000'];

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  }),
);

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/v1/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ---------------------------------------------------------------------------
// Provider API routes (unified hook endpoints for all providers)
// ---------------------------------------------------------------------------

// Helper: pre-set provider slug for backward-compat aliases.
// Express Routers reset req.params on entry, so we stash the slug on a
// custom property that the providerRouter middleware reads as fallback.
function setProvider(slug: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    (req as any)._providerSlug = slug;
    next();
  };
}

// New unified route
app.use('/api/v1/providers/:provider', hookAuth, providerRouter);

// Backward compat aliases (existing hook scripts + clients still use these)
app.use('/api/v1/hook', hookAuth, setProvider('claude-code'), providerRouter);
app.use('/api/v1/codex', hookAuth, setProvider('codex'), providerRouter);

// Client + watcher routes (not provider-specific)
app.use('/api/v1/watcher', hookAuth, watcherRouter);
app.use('/api/v1/client', hookAuth, clientRouter);

// ---------------------------------------------------------------------------
// Admin API routes (React dashboard endpoints)
// ---------------------------------------------------------------------------

app.use('/api/admin', adminRouter);
app.use('/api/admin/subscriptions', subscriptionRouter);

// ---------------------------------------------------------------------------
// Install script endpoints — for `curl | bash` client installation
// ---------------------------------------------------------------------------

app.get('/install', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/plain');
  res.send(`#!/bin/bash
set -e

echo "HowinLens CLI Installer"
echo "======================="

# Check Node.js
if ! command -v node &>/dev/null; then
  echo "ERROR: Node.js is required (v18+). Install from https://nodejs.org"
  exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "ERROR: Node.js v18+ required (found v$NODE_VERSION)"
  exit 1
fi

# Create dirs
INSTALL_DIR="$HOME/.howinlens/bin"
mkdir -p "$INSTALL_DIR"

# Download CLI
echo "Downloading HowinLens CLI..."
DOWNLOAD_URL="\${HOWINLENS_SERVER:-https://howinlens.howincloud.com}/download/client"
curl -fsSL "$DOWNLOAD_URL" -o "$INSTALL_DIR/howinlens-cli.tar.gz" 2>/dev/null || {
  echo "Download failed. Check your network connection."
  exit 1
}

# Extract
cd "$INSTALL_DIR"
tar -xzf howinlens-cli.tar.gz 2>/dev/null && rm -f howinlens-cli.tar.gz

# Create wrapper script
cat > "$INSTALL_DIR/howinlens" << 'WRAPPER'
#!/bin/bash
exec node "$(dirname "$0")/cli.js" "$@"
WRAPPER
chmod +x "$INSTALL_DIR/howinlens"

# Add to PATH
SHELL_RC=""
if [ -f "$HOME/.zshrc" ]; then SHELL_RC="$HOME/.zshrc"
elif [ -f "$HOME/.bashrc" ]; then SHELL_RC="$HOME/.bashrc"
elif [ -f "$HOME/.profile" ]; then SHELL_RC="$HOME/.profile"
fi

if [ -n "$SHELL_RC" ]; then
  if ! grep -q '.howinlens/bin' "$SHELL_RC" 2>/dev/null; then
    echo 'export PATH="$HOME/.howinlens/bin:$PATH"' >> "$SHELL_RC"
    echo "Added ~/.howinlens/bin to PATH in $SHELL_RC"
  fi
fi

export PATH="$HOME/.howinlens/bin:$PATH"

echo ""
echo "✓ HowinLens CLI installed!"
echo ""
echo "Next steps:"
echo "  howinlens login    # authenticate with your server"
echo "  howinlens start    # start the background daemon"
echo "  howinlens status   # check connection status"
`);
});

app.get('/install.ps1', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/plain');
  res.send(`# HowinLens CLI Installer for Windows
$ErrorActionPreference = "Stop"

Write-Host "HowinLens CLI Installer" -ForegroundColor Cyan

# Check Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: Node.js is required (v18+). Install from https://nodejs.org" -ForegroundColor Red
    exit 1
}

# Create dirs
$InstallDir = "$env:USERPROFILE\\.howinlens\\bin"
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

# Download
Write-Host "Downloading HowinLens CLI..."
$Url = "https://howinlens.howincloud.com/download/client"
Invoke-WebRequest -Uri $Url -OutFile "$InstallDir\\howinlens-cli.zip"
Expand-Archive -Path "$InstallDir\\howinlens-cli.zip" -DestinationPath $InstallDir -Force
Remove-Item "$InstallDir\\howinlens-cli.zip"

# Add to PATH
$CurrentPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($CurrentPath -notlike "*\\.howinlens\\bin*") {
    [Environment]::SetEnvironmentVariable("Path", "$InstallDir;$CurrentPath", "User")
    Write-Host "Added to PATH"
}

Write-Host ""
Write-Host "HowinLens CLI installed!" -ForegroundColor Green
Write-Host "Run: howinlens login"
`);
});

// ---------------------------------------------------------------------------
// Serve dashboard static files
// ---------------------------------------------------------------------------

const dashboardDir = process.env.DASHBOARD_DIR || path.join(__dirname, '../../dashboard/dist');

if (existsSync(dashboardDir)) {
  app.use(express.static(dashboardDir));

  // SPA fallback — serve index.html for non-API routes
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/ws')) {
      return next();
    }
    res.sendFile(path.join(dashboardDir, 'index.html'));
  });
}

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error('[server] Unhandled error:', err);
    res.status(500).json({
      error: 'Internal server error',
      ...(process.env.NODE_ENV !== 'production' && { message: err.message }),
    });
  },
);

// ---------------------------------------------------------------------------
// Start server (skip in test environment)
// ---------------------------------------------------------------------------

if (process.env.NODE_ENV !== 'test') {
  (async () => {
    const port = parseInt(process.env.PORT ?? '3000', 10);

    initDb();
    await seedDatabase();

    const server = createServer(app);
    const adminWss = initWebSocket(server);
    const watcherWss = initWatcherWebSocket(server);

    // Manual WebSocket upgrade routing — two WSS instances on one HTTP server
    // require explicit path dispatch since ws library's built-in path matching
    // only works for a single WSS per server.
    server.removeAllListeners('upgrade');
    server.on('upgrade', (request, socket, head) => {
      const pathname = new URL(request.url || '', 'http://localhost').pathname;
      if (pathname === '/ws/watcher') {
        watcherWss.handleUpgrade(request, socket, head, (ws) => {
          watcherWss.emit('connection', ws, request);
        });
      } else if (pathname === '/ws/admin' || pathname === '/ws') {
        adminWss.handleUpgrade(request, socket, head, (ws) => {
          adminWss.emit('connection', ws, request);
        });
      } else {
        socket.destroy();
      }
    });

    let stopDeadman: (() => void) | undefined;
    let stopAICrons: (() => void) | undefined;
    let stopUsageMonitor: (() => void) | undefined;

    server.listen(port, () => {
      console.log(`[howinlens] Server running on port ${port}`);
      console.log(`[howinlens] Dashboard: http://localhost:${port}`);
      console.log(`[howinlens] Provider API: http://localhost:${port}/api/v1/providers/:provider/`);
      console.log(`[howinlens] Admin API: http://localhost:${port}/api/admin/`);
      console.log(`[howinlens] Database:  PostgreSQL`);

      if (!process.env.ADMIN_PASSWORD) {
        console.warn('[howinlens] WARNING: Using default admin password. Set ADMIN_PASSWORD env var.');
      }
      if (!process.env.JWT_SECRET) {
        console.log('[howinlens] JWT secret auto-generated (sessions reset on restart)');
      }

      stopDeadman = startDeadmanSwitch();
      console.log('[howinlens] Dead man\'s switch started');

      stopAICrons = startAICrons();
      console.log('[howinlens] AI intelligence crons started');

      stopUsageMonitor = startUsageMonitor();
      console.log('[howinlens] Usage monitor started');
    });

    const shutdown = async () => {
      console.log('[howinlens] Shutting down...');
      if (stopDeadman) stopDeadman();
      if (stopAICrons) stopAICrons();
      if (stopUsageMonitor) stopUsageMonitor();
      await closeDb();
      server.close();
    };

    process.on('SIGTERM', () => void shutdown());
    process.on('SIGINT', () => void shutdown());
  })();
}
