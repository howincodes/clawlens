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
