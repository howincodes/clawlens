import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  touchUserLastEvent,
  updateUser,
  getLimitsByUser,
  getUserCreditUsage,
  getPendingWatcherCommands,
  markWatcherCommandDelivered,
  saveWatcherLogs,
} from '../services/db.js';

// ---------------------------------------------------------------------------
// Debug logging — enabled by CLAWLENS_DEBUG=1
// ---------------------------------------------------------------------------

const DEBUG = process.env.CLAWLENS_DEBUG === '1' || process.env.CLAWLENS_DEBUG === 'true';

function debug(msg: string): void {
  if (DEBUG) console.log(`[watcher-api] ${msg}`);
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_LOG_BYTES = 512 * 1024; // 512 KB

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const watcherRouter = Router();

// ---------------------------------------------------------------------------
// POST /sync — Poll fallback for watcher
// ---------------------------------------------------------------------------

watcherRouter.post('/sync', (req: Request, res: Response) => {
  debug(`──── /sync ────`);
  try {
    const user = req.user!;
    const body = req.body;
    debug(`user: id=${user.id}, name=${user.name}, status=${user.status}`);
    debug(`body keys: ${Object.keys(body).join(', ')}`);

    // 1. Update user's last_event_at
    touchUserLastEvent(user.id);
    debug(`touched last_event_at`);

    // 2. Update user's default_model and email if provided
    const userUpdates: Record<string, string> = {};

    if (body.model && body.model !== user.default_model) {
      userUpdates.default_model = body.model;
      debug(`will update default_model to "${body.model}"`);
    }

    if (body.subscription_email && (!user.email || user.email === '')) {
      userUpdates.email = body.subscription_email;
      debug(`will update email to "${body.subscription_email}"`);
    }

    if (Object.keys(userUpdates).length > 0) {
      debug(`updating user: ${JSON.stringify(userUpdates)}`);
      try {
        updateUser(user.id, userUpdates);
        debug(`user updated OK`);
      } catch (e: any) {
        debug(`user update FAILED: ${e.message}`);
      }
    }

    // 3. Get user's limits
    const limits = getLimitsByUser(user.id);
    debug(`user has ${limits.length} limit(s)`);

    // 4. Calculate credit usage
    let creditUsed = 0;
    let creditLimit = 0;
    let creditPercent = 0;

    const dailyCreditLimit = limits.find((l) => l.type === 'total_credits' && l.window === 'daily');
    if (dailyCreditLimit) {
      creditUsed = getUserCreditUsage(user.id, 'daily');
      creditLimit = dailyCreditLimit.value;
      creditPercent = creditLimit > 0 ? Math.round((creditUsed / creditLimit) * 100) : 0;
      debug(`credit usage: ${creditUsed}/${creditLimit} (${creditPercent}%)`);
    } else {
      debug(`no daily total_credits limit found`);
    }

    // 5. Get pending commands, mark each as delivered
    const pendingCommands = getPendingWatcherCommands(user.id);
    debug(`pending commands: ${pendingCommands.length}`);

    const commands = pendingCommands.map((cmd) => {
      markWatcherCommandDelivered(cmd.id);
      debug(`marked command ${cmd.id} as delivered`);

      // Parse payload JSON and spread into command object
      let parsedPayload: Record<string, unknown> = {};
      if (cmd.payload) {
        try {
          parsedPayload = JSON.parse(cmd.payload);
        } catch {
          debug(`failed to parse payload for command ${cmd.id}`);
        }
      }

      return {
        id: cmd.id,
        type: cmd.command,
        ...parsedPayload,
      };
    });

    // 6. Build response
    const response = {
      status: user.status === 'active' ? 'active' : user.status,
      poll_interval_ms: 300000,
      limits: limits.map((l) => ({
        id: l.id,
        type: l.type,
        model: l.model,
        value: l.value,
        window: l.window,
      })),
      credit_usage: {
        used: creditUsed,
        limit: creditLimit,
        percent: creditPercent,
      },
      commands,
    };

    debug(`responding: status=${response.status}, commands=${commands.length}, credit=${creditPercent}%`);
    res.json(response);
  } catch (err: any) {
    debug(`ERROR: ${err.stack || err.message}`);
    console.error('[watcher-api] sync error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /logs — Log upload from watcher
// ---------------------------------------------------------------------------

watcherRouter.post('/logs', (req: Request, res: Response) => {
  debug(`──── /logs ────`);
  try {
    const user = req.user!;
    const body = req.body;
    debug(`user: id=${user.id}, name=${user.name}`);

    // 1. Validate and truncate log content
    let hookLog: string | undefined;
    let watcherLog: string | undefined;

    if (typeof body.hook_log === 'string') {
      hookLog = body.hook_log.slice(0, MAX_LOG_BYTES);
      debug(`hook_log: ${hookLog.length} bytes (truncated from ${body.hook_log.length})`);
    } else {
      debug(`hook_log: not provided or not a string`);
    }

    if (typeof body.watcher_log === 'string') {
      watcherLog = body.watcher_log.slice(0, MAX_LOG_BYTES);
      debug(`watcher_log: ${watcherLog.length} bytes (truncated from ${body.watcher_log.length})`);
    } else {
      debug(`watcher_log: not provided or not a string`);
    }

    // 2. Save logs
    saveWatcherLogs({
      user_id: user.id,
      hook_log: hookLog,
      watcher_log: watcherLog,
    });
    debug(`logs saved`);

    // 3. Return success
    res.json({ ok: true });
  } catch (err: any) {
    debug(`ERROR: ${err.stack || err.message}`);
    console.error('[watcher-api] logs error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
