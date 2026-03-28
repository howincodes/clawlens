import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync } from 'node:fs';

import { initDb, getDb, closeDb } from './services/db.js';
import { initWebSocket } from './services/websocket.js';
import { hookAuth } from './middleware/hook-auth.js';
import { adminRouter } from './routes/admin-api.js';
import { hookRouter } from './routes/hook-api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Express app setup
// ---------------------------------------------------------------------------

export const app = express();

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
  const port = parseInt(process.env.PORT ?? '3000', 10);
  const dbPath = process.env.DB_PATH ?? path.join(__dirname, '..', 'clawlens.db');

  // Ensure the directory exists
  mkdirSync(path.dirname(dbPath), { recursive: true });

  initDb(dbPath);

  const server = createServer(app);
  initWebSocket(server);

  server.listen(port, () => {
    console.log(`[clawlens] Server running on port ${port}`);
    console.log(`[clawlens] Dashboard: http://localhost:${port}`);
    console.log(`[clawlens] Hook API:  http://localhost:${port}/api/v1/hook/`);
    console.log(`[clawlens] Admin API: http://localhost:${port}/api/admin/`);
    console.log(`[clawlens] Database:  ${dbPath}`);

    if (!process.env.ADMIN_PASSWORD) {
      console.warn('[clawlens] WARNING: Using default admin password. Set ADMIN_PASSWORD env var for production.');
    }
    if (!process.env.JWT_SECRET) {
      console.log('[clawlens] JWT secret auto-generated (sessions reset on restart)');
    }
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('[clawlens] Shutting down...');
    try {
      getDb().pragma('wal_checkpoint(FULL)');
    } catch {}
    closeDb();
    server.close();
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
