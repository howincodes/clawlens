import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { initDb } from './services/db.js';
import { hookAuth } from './middleware/hook-auth.js';
import { hookRouter } from './routes/hook-api.js';
import { adminRouter } from './routes/admin-api.js';

// ---------------------------------------------------------------------------
// Express app setup
// ---------------------------------------------------------------------------

const app = express();

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
// Initialize database
// In test mode, tests call initDb(':memory:') themselves before importing app.
// ---------------------------------------------------------------------------

const dbPath = process.env.DB_PATH ?? path.join(process.cwd(), 'data', 'clawlens.db');

if (process.env.NODE_ENV !== 'test') {
  initDb(dbPath);
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

app.get('/health', (_req, res) => {
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
// Start
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT ?? '3000', 10);

// Only listen when run directly (not when imported for tests)
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`[clawlens] Server listening on port ${PORT}`);
    console.log(`[clawlens] Database: ${dbPath}`);
  });
}

export { app };
