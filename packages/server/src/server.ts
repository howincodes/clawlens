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
import { hookRouter } from './routes/hook-api.js';
import { codexRouter } from './routes/codex-api.js';
import { watcherRouter } from './routes/watcher-api.js';
import { startAICrons } from './services/ai-jobs.js';

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
// Hook API routes (Claude Code hook endpoints)
// ---------------------------------------------------------------------------

app.use('/api/v1/hook', hookAuth, hookRouter);
app.use('/api/v1/codex', hookAuth, codexRouter);
app.use('/api/v1/watcher', hookAuth, watcherRouter);

// ---------------------------------------------------------------------------
// Admin API routes (React dashboard endpoints)
// ---------------------------------------------------------------------------

app.use('/api/admin', adminRouter);

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
    initWebSocket(server);
    initWatcherWebSocket(server);

    let stopDeadman: (() => void) | undefined;
    let stopAICrons: (() => void) | undefined;

    server.listen(port, () => {
      console.log(`[howinlens] Server running on port ${port}`);
      console.log(`[howinlens] Dashboard: http://localhost:${port}`);
      console.log(`[howinlens] Hook API:  http://localhost:${port}/api/v1/hook/`);
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
    });

    const shutdown = async () => {
      console.log('[howinlens] Shutting down...');
      if (stopDeadman) stopDeadman();
      if (stopAICrons) stopAICrons();
      await closeDb();
      server.close();
    };

    process.on('SIGTERM', () => void shutdown());
    process.on('SIGINT', () => void shutdown());
  })();
}
