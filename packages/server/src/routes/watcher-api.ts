import { Router } from 'express';
import type { Request, Response } from 'express';
import { getPendingWatcherCommands, markWatcherCommandDelivered, saveWatcherLogs } from '../db/queries/watcher.js';
import { touchUserLastEvent, updateUser, getUserCreditUsage } from '../db/queries/users.js';
import { getLimitsByUser } from '../db/queries/limits.js';
import { createSubscription } from '../db/queries/subscriptions.js';

// ---------------------------------------------------------------------------
// Debug logging — enabled by HOWINLENS_DEBUG=1
// ---------------------------------------------------------------------------

const DEBUG = process.env.HOWINLENS_DEBUG === '1' || process.env.HOWINLENS_DEBUG === 'true';

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

watcherRouter.post('/sync', async (req: Request, res: Response) => {
  debug(`──── /sync ────`);
  try {
    const user = req.user!;
    const body = req.body;
    debug(`user: id=${user.id}, name=${user.name}, status=${user.status}`);
    debug(`body keys: ${Object.keys(body).join(', ')}`);

    // 1. Update user's last_event_at
    await touchUserLastEvent(user.id);
    debug(`touched last_event_at`);

    // 2. Update user's defaultModel and email if provided
    const userUpdates: Partial<Record<string, unknown>> = {};

    if (body.model && body.model !== user.defaultModel) {
      userUpdates.defaultModel = body.model;
      debug(`will update defaultModel to "${body.model}"`);
    }

    if (body.subscription_email) {
      if (!user.email || user.email === '') {
        userUpdates.email = body.subscription_email;
        debug(`will update email to "${body.subscription_email}"`);
      }

      // Update subscription from watcher (watcher runs claude auth status with fresh data)
      if (body.subscription_type) {
        const lower = String(body.subscription_type).toLowerCase();
        const subType = lower.includes('max') ? 'max' : 'pro';
        debug(`watcher subscription update: raw=${body.subscription_type}, normalized=${subType}`);
        try {
          const sub = await createSubscription({
            email: body.subscription_email,
            subscriptionType: subType,
          });
          if (sub && !user.subscriptionId) {
            await updateUser(user.id, { subscriptionId: sub.id });
            debug(`linked subscription ${sub.id} to user`);
          }
        } catch (e: any) { debug(`subscription update failed: ${e.message}`); }
      }
    }

    if (Object.keys(userUpdates).length > 0) {
      debug(`updating user: ${JSON.stringify(userUpdates)}`);
      try {
        await updateUser(user.id, userUpdates as any);
        debug(`user updated OK`);
      } catch (e: any) {
        debug(`user update FAILED: ${e.message}`);
      }
    }

    // 3. Get user's limits
    const limits = await getLimitsByUser(user.id);
    debug(`user has ${limits.length} limit(s)`);

    // 4. Calculate credit usage
    let creditUsed = 0;
    let creditLimit = 0;
    let creditPercent = 0;

    const dailyCreditLimit = limits.find((l) => l.type === 'total_credits' && l.window === 'daily');
    if (dailyCreditLimit) {
      creditUsed = await getUserCreditUsage(user.id, 'daily');
      creditLimit = dailyCreditLimit.value;
      creditPercent = creditLimit > 0 ? Math.round((creditUsed / creditLimit) * 100) : 0;
      debug(`credit usage: ${creditUsed}/${creditLimit} (${creditPercent}%)`);
    } else {
      debug(`no daily total_credits limit found`);
    }

    // 5. Get pending commands, mark each as delivered
    const pendingCommands = await getPendingWatcherCommands(user.id);
    debug(`pending commands: ${pendingCommands.length}`);

    const commands = [];
    for (const cmd of pendingCommands) {
      await markWatcherCommandDelivered(cmd.id);
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

      commands.push({
        id: cmd.id,
        type: cmd.command,
        ...parsedPayload,
      });
    }

    // 6. Parse user's notification preferences (default all ON)
    let notifications = { on_stop: true, on_block: true, on_credit_warning: true, on_kill: true, sound: true };
    if (user.notificationConfig) {
      try { notifications = { ...notifications, ...JSON.parse(user.notificationConfig) }; } catch {}
    }

    // 7. Build response
    const response = {
      status: user.status === 'active' ? 'active' : user.status,
      poll_interval_ms: user.pollInterval || 30000,
      antigravity_collection: user.antigravityCollection == null ? true : user.antigravityCollection,
      antigravity_interval: user.antigravityInterval || 120000,
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
      notifications,
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

watcherRouter.post('/logs', async (req: Request, res: Response) => {
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
      debug(`hook_log: ${hookLog!.length} bytes (truncated from ${body.hook_log.length})`);
    } else {
      debug(`hook_log: not provided or not a string`);
    }

    if (typeof body.watcher_log === 'string') {
      watcherLog = body.watcher_log.slice(0, MAX_LOG_BYTES);
      debug(`watcher_log: ${watcherLog!.length} bytes (truncated from ${body.watcher_log.length})`);
    } else {
      debug(`watcher_log: not provided or not a string`);
    }

    // 2. Save logs
    await saveWatcherLogs({
      userId: user.id,
      hookLog,
      watcherLog,
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
