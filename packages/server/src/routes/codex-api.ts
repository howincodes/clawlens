import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  createSubscription,
  recordHookEvent,
  recordPrompt,
  touchUserLastEvent,
  getUserCreditUsage,
  getUserModelCreditUsage,
  getSessionById,
  incrementSessionPromptCount,
  getLimitsByUser,
  getDb,
  updateUser,
  getCreditCostFromDb,
  upsertProviderQuota,
} from '../services/db.js';
import { broadcast } from '../services/websocket.js';
import {
  CodexSessionStartEvent,
  CodexPromptEvent,
  CodexPreToolUseEvent,
  CodexPostToolUseEvent,
  CodexStopEvent,
} from '../schemas/codex-events.js';

// ---------------------------------------------------------------------------
// Debug logging — enabled by CLAWLENS_DEBUG=1
// ---------------------------------------------------------------------------

const DEBUG = process.env.CLAWLENS_DEBUG === '1' || process.env.CLAWLENS_DEBUG === 'true';

function debug(msg: string): void {
  if (DEBUG) console.log(`[codex-api] ${msg}`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalize raw subscription type strings into clean plan names.
 */
function normalizeSubscriptionType(raw: string | undefined): string {
  const lower = String(raw || '').toLowerCase();
  if (lower.includes('max')) return 'max';
  return 'pro';
}

/**
 * Ensure session exists — auto-create if SessionStart was missed or failed.
 * Uses direct INSERT with source='codex' columns.
 */
function ensureSession(sessionId: string | undefined, userId: string, model?: string, cwd?: string) {
  if (!sessionId) return;
  const existing = getSessionById(sessionId);
  if (!existing) {
    try {
      const db = getDb();
      db.prepare(
        `INSERT INTO sessions (id, user_id, model, cwd, source) VALUES (?, ?, ?, ?, 'codex')`,
      ).run(sessionId, userId, model || 'gpt-5.4', cwd ?? null);
    } catch {}
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const codexRouter = Router();

// ---------------------------------------------------------------------------
// POST /session-start
// ---------------------------------------------------------------------------

codexRouter.post('/session-start', (req: Request, res: Response) => {
  debug(`──── /session-start ────`);
  try {
    const user = req.user!;
    const body = req.body;
    debug(`user: id=${user.id}, name=${user.name}, status=${user.status}`);
    debug(`body keys: ${Object.keys(body).join(', ')}`);
    debug(`body.session_id=${body.session_id}, body.model=${body.model || '(none)'}`);

    const parsed = CodexSessionStartEvent.safeParse(body);
    debug(`zod parse: ${parsed.success ? 'OK' : `FAILED — ${JSON.stringify(parsed.error?.issues?.map(i => i.message))}`}`);
    const data = parsed.success ? parsed.data : body;

    // Check user status — killed
    if (user.status === 'killed') {
      debug(`user is KILLED — blocking session`);
      recordHookEvent({
        user_id: user.id,
        session_id: data.session_id,
        event_type: 'SessionStart',
        payload: JSON.stringify(body),
      });
      touchUserLastEvent(user.id);
      const resp = { decision: 'block', killed: true, hard: true };
      debug(`responding: ${JSON.stringify(resp)}`);
      res.json(resp);
      return;
    }

    // Check user status — paused
    if (user.status === 'paused') {
      debug(`user is PAUSED — blocking session`);
      recordHookEvent({
        user_id: user.id,
        session_id: data.session_id,
        event_type: 'SessionStart',
        payload: JSON.stringify(body),
      });
      touchUserLastEvent(user.id);
      const resp = { decision: 'block' };
      debug(`responding: ${JSON.stringify(resp)}`);
      res.json(resp);
      return;
    }

    // Determine model
    const model = body.model || user.default_model || 'gpt-5.4';
    debug(`resolved model: "${model}"`);

    // Create session with source='codex' and extra columns
    debug(`creating session: id=${data.session_id}, user_id=${user.id}, model=${model}, source=codex`);
    const db = getDb();
    db.prepare(
      `INSERT INTO sessions (id, user_id, model, cwd, source, cli_version, model_provider, reasoning_effort)
       VALUES (?, ?, ?, ?, 'codex', ?, ?, ?)`,
    ).run(
      data.session_id,
      user.id,
      model,
      data.cwd ?? null,
      data.cli_version ?? null,
      data.model_provider ?? null,
      data.reasoning_effort ?? null,
    );
    debug(`session created OK`);

    // ── Collect enriched data from client ──
    const userUpdates: Record<string, string> = {};

    // Update user email from subscription if we don't have it
    if (body.subscription_email && (!user.email || user.email === '')) {
      userUpdates.email = body.subscription_email;
      debug(`will update user email to "${body.subscription_email}"`);
    }

    // Apply user updates if any
    if (Object.keys(userUpdates).length > 0) {
      debug(`updating user: ${JSON.stringify(userUpdates)}`);
      try { updateUser(user.id, userUpdates); debug(`user updated OK`); } catch (e: any) { debug(`user update FAILED: ${e.message}`); }
    }

    // Handle subscription record
    if (body.subscription_email || body.plan_type) {
      const subType = normalizeSubscriptionType(body.plan_type);

      debug(`creating/updating subscription: email=${body.subscription_email || user.email}, type=${subType}, org=${body.org_title}`);
      try {
        const sub = createSubscription({
          email: body.subscription_email || user.email || '',
          subscription_type: subType,
          plan_name: body.org_title || undefined,
          source: 'codex',
          account_id: body.account_id,
          org_id: body.org_id,
          auth_provider: body.auth_provider,
        });
        debug(`subscription result: ${sub ? `id=${sub.id}` : '(null)'}`);
        if (sub && !user.subscription_id) {
          updateUser(user.id, { subscription_id: String(sub.id) });
          debug(`linked subscription ${sub.id} to user`);
        }
      } catch (e: any) { debug(`subscription FAILED: ${e.message}`); }
    }

    // Update last_event_at
    touchUserLastEvent(user.id);

    // Record full hook event
    debug(`recording hook event`);
    recordHookEvent({
      user_id: user.id,
      session_id: data.session_id,
      event_type: 'SessionStart',
      payload: JSON.stringify(body),
    });

    debug(`broadcasting session_start`);
    broadcast({
      type: 'session_start',
      user_id: user.id,
      user_name: user.name,
      model,
      source: 'codex',
      hostname: body.hostname,
      platform: body.platform,
    });

    debug(`responding: {} (allow)`);
    res.json({});
  } catch (err: any) {
    debug(`ERROR: ${err.stack || err.message}`);
    console.error('[codex-api] session-start error:', err);
    res.json({});
  }
});

// ---------------------------------------------------------------------------
// POST /prompt
// ---------------------------------------------------------------------------

codexRouter.post('/prompt', (req: Request, res: Response) => {
  debug(`──── /prompt ────`);
  try {
    const user = req.user!;
    const body = req.body;
    debug(`user: id=${user.id}, name=${user.name}, status=${user.status}`);
    debug(`body.session_id=${body.session_id}, body.prompt=${(body.prompt || '').slice(0, 100)}...`);

    const parsed = CodexPromptEvent.safeParse(body);
    debug(`zod parse: ${parsed.success ? 'OK' : `FAILED — ${JSON.stringify(parsed.error?.issues?.map(i => i.message))}`}`);
    const data = parsed.success ? parsed.data : body;

    // Check user status — killed
    if (user.status === 'killed') {
      debug(`user is KILLED — blocking prompt`);
      try {
        recordHookEvent({
          user_id: user.id,
          session_id: data.session_id,
          event_type: 'UserPromptSubmit',
          payload: JSON.stringify(body),
        });
      } catch (e: any) { debug(`recording hook event FAILED: ${e.message}`); }
      touchUserLastEvent(user.id);
      const resp = { decision: 'block', killed: true, hard: true };
      debug(`responding: ${JSON.stringify(resp)}`);
      res.json(resp);
      return;
    }

    // Check user status — paused
    if (user.status === 'paused') {
      debug(`user is PAUSED — blocking prompt`);
      try {
        recordHookEvent({
          user_id: user.id,
          session_id: data.session_id,
          event_type: 'UserPromptSubmit',
          payload: JSON.stringify(body),
        });
      } catch (e: any) { debug(`recording hook event FAILED: ${e.message}`); }
      touchUserLastEvent(user.id);
      const resp = { decision: 'block' };
      debug(`responding: ${JSON.stringify(resp)}`);
      res.json(resp);
      return;
    }

    // Ensure session exists
    debug(`ensuring session exists: session_id=${data.session_id}`);
    ensureSession(data.session_id, user.id, user.default_model, data.cwd);
    const session = getSessionById(data.session_id);
    debug(`session lookup: ${session ? `found (model=${session.model})` : 'NOT FOUND'}`);

    // Prefer body.model > session.model > user.default_model
    const model = body.model || session?.model || user.default_model || 'gpt-5.4';
    debug(`resolved model: "${model}"`);

    // Update session model if the client reports a different one
    if (body.model && session && body.model !== session.model) {
      debug(`model changed mid-session: "${session.model}" → "${body.model}" — updating session`);
      const db = getDb();
      db.prepare('UPDATE sessions SET model = ? WHERE id = ?').run(body.model, data.session_id);
    }

    // Compute credit cost via DB lookup
    const creditCost = getCreditCostFromDb(model, 'codex');
    debug(`credit cost for ${model}: ${creditCost}`);

    // Check credit limits
    const limits = getLimitsByUser(user.id);
    debug(`user has ${limits.length} limit rule(s)`);
    let blocked = false;
    let blockReason = '';

    for (const limit of limits) {
      debug(`checking limit: type=${limit.type}, model=${limit.model || '(any)'}, window=${limit.window}, value=${limit.value}`);
      if (limit.type === 'total_credits') {
        const window = limit.window as 'daily' | 'hourly' | 'monthly';
        const usage = getUserCreditUsage(user.id, window);
        debug(`  total_credits: usage=${usage}, limit=${limit.value}, next_cost=${creditCost}, would_exceed=${usage + creditCost > limit.value}`);
        if (usage + creditCost > limit.value) {
          blocked = true;
          blockReason = `Credit limit reached. ${window} usage: ${usage}/${limit.value}`;
          debug(`  BLOCKED: ${blockReason}`);
          break;
        }
      } else if (limit.type === 'per_model') {
        if (!limit.model) { debug(`  skipping per_model limit with no model`); continue; }
        const window = limit.window as 'daily' | 'hourly' | 'monthly';
        const limitModel = limit.model;
        const usage = getUserModelCreditUsage(user.id, limitModel, window);
        debug(`  per_model(${limitModel}): usage=${usage}, limit=${limit.value}, next_cost=${creditCost}, would_exceed=${usage + creditCost > limit.value}`);
        if (usage + creditCost > limit.value) {
          blocked = true;
          blockReason = `Credit limit reached. ${limitModel} ${window} usage: ${usage}/${limit.value}`;
          debug(`  BLOCKED: ${blockReason}`);
          break;
        }
      } else if (limit.type === 'time_of_day') {
        const currentHour = new Date().getHours();
        const startHour = limit.start_hour ?? 0;
        const endHour = limit.end_hour ?? 24;
        debug(`  time_of_day: current_hour=${currentHour}, blocked_range=${startHour}-${endHour}`);
        if (currentHour >= startHour && currentHour < endHour) {
          blocked = true;
          blockReason = `Usage blocked during hours ${startHour}-${endHour}.`;
          debug(`  BLOCKED: ${blockReason}`);
          break;
        }
      }
    }

    if (blocked) {
      debug(`prompt BLOCKED — recording and responding`);
      // Record blocked prompt with source/turn_id via direct INSERT
      const db = getDb();
      db.prepare(
        `INSERT INTO prompts (session_id, user_id, prompt, model, credit_cost, blocked, block_reason, source, turn_id)
         VALUES (?, ?, ?, ?, 0, 1, ?, 'codex', ?)`,
      ).run(data.session_id, user.id, data.prompt ?? null, model, blockReason, data.turn_id ?? null);

      recordHookEvent({
        user_id: user.id,
        session_id: data.session_id,
        event_type: 'UserPromptSubmit',
        payload: JSON.stringify(body),
      });
      touchUserLastEvent(user.id);
      broadcast({ type: 'prompt', user_id: user.id, user_name: user.name, prompt: data.prompt?.slice(0, 100), blocked: true, source: 'codex' });
      const resp = { decision: 'block', reason: blockReason };
      debug(`responding: ${JSON.stringify(resp)}`);
      res.json(resp);
      return;
    }

    // Record prompt (allowed) with source/turn_id via direct INSERT
    debug(`prompt ALLOWED — recording with credit_cost=${creditCost}`);
    const db = getDb();
    db.prepare(
      `INSERT INTO prompts (session_id, user_id, prompt, model, credit_cost, source, turn_id)
       VALUES (?, ?, ?, ?, ?, 'codex', ?)`,
    ).run(data.session_id, user.id, data.prompt ?? null, model, creditCost, data.turn_id ?? null);

    // Increment session prompt count and credits
    incrementSessionPromptCount(data.session_id, creditCost);

    // Update last_event_at
    touchUserLastEvent(user.id);

    // Record hook event
    recordHookEvent({
      user_id: user.id,
      session_id: data.session_id,
      event_type: 'UserPromptSubmit',
      payload: JSON.stringify(body),
    });

    broadcast({ type: 'prompt', user_id: user.id, user_name: user.name, prompt: data.prompt?.slice(0, 100), blocked: false, source: 'codex' });

    debug(`responding: {} (allow)`);
    res.json({});
  } catch (err: any) {
    debug(`ERROR: ${err.stack || err.message}`);
    console.error('[codex-api] prompt error:', err);
    res.json({});
  }
});

// ---------------------------------------------------------------------------
// POST /pre-tool-use
// ---------------------------------------------------------------------------

codexRouter.post('/pre-tool-use', (req: Request, res: Response) => {
  debug(`──── /pre-tool-use ────`);
  try {
    const user = req.user!;
    const body = req.body;
    debug(`user: id=${user.id}, name=${user.name}, status=${user.status}`);
    debug(`body.tool_name=${body.tool_name || '(none)'}, body.session_id=${body.session_id}`);

    const parsed = CodexPreToolUseEvent.safeParse(body);
    debug(`zod parse: ${parsed.success ? 'OK' : `FAILED — ${JSON.stringify(parsed.error?.issues?.map(i => i.message))}`}`);
    const data = parsed.success ? parsed.data : body;

    // Check user status — killed
    if (user.status === 'killed') {
      debug(`user is KILLED — denying tool use`);
      recordHookEvent({
        user_id: user.id,
        session_id: data.session_id,
        event_type: 'PreToolUse',
        payload: JSON.stringify(body),
      });
      touchUserLastEvent(user.id);
      const resp = { decision: 'block', killed: true, hard: true };
      debug(`responding: ${JSON.stringify(resp)}`);
      res.json(resp);
      return;
    }

    // Check user status — paused
    if (user.status === 'paused') {
      debug(`user is PAUSED — denying tool use`);
      recordHookEvent({
        user_id: user.id,
        session_id: data.session_id,
        event_type: 'PreToolUse',
        payload: JSON.stringify(body),
      });
      touchUserLastEvent(user.id);
      const resp = { decision: 'block' };
      debug(`responding: ${JSON.stringify(resp)}`);
      res.json(resp);
      return;
    }

    // Record tool event with source/tool_use_id via direct INSERT
    debug(`recording tool event: tool_name=${data.tool_name}`);
    const db = getDb();
    db.prepare(
      `INSERT INTO tool_events (user_id, session_id, tool_name, tool_input, source, tool_use_id)
       VALUES (?, ?, ?, ?, 'codex', ?)`,
    ).run(
      user.id,
      data.session_id ?? null,
      data.tool_name ?? 'unknown',
      JSON.stringify(data.tool_input)?.slice(0, 500),
      data.tool_use_id ?? null,
    );

    // Update last_event_at
    touchUserLastEvent(user.id);

    // Record hook event
    recordHookEvent({
      user_id: user.id,
      session_id: data.session_id,
      event_type: 'PreToolUse',
      payload: JSON.stringify(body),
    });

    broadcast({ type: 'tool_use', user_id: user.id, user_name: user.name, tool_name: data.tool_name, source: 'codex' });

    debug(`responding: {} (allow)`);
    res.json({});
  } catch (err: any) {
    debug(`ERROR: ${err.stack || err.message}`);
    console.error('[codex-api] pre-tool-use error:', err);
    res.json({});
  }
});

// ---------------------------------------------------------------------------
// POST /post-tool-use
// ---------------------------------------------------------------------------

codexRouter.post('/post-tool-use', (req: Request, res: Response) => {
  debug(`──── /post-tool-use ────`);
  try {
    const user = req.user!;
    const body = req.body;
    debug(`user: id=${user.id}, tool_name=${body.tool_name || '(none)'}, tool_use_id=${body.tool_use_id || '(none)'}`);

    const parsed = CodexPostToolUseEvent.safeParse(body);
    debug(`zod parse: ${parsed.success ? 'OK' : 'FAILED'}`);
    const data = parsed.success ? parsed.data : body;

    // Update tool event via tool_use_id
    debug(`updating tool event: tool_use_id=${data.tool_use_id}`);
    const db = getDb();
    const result = db.prepare(
      `UPDATE tool_events SET tool_output = ?, success = 1 WHERE tool_use_id = ? AND source = 'codex'`,
    ).run(
      (data.tool_response ?? '').slice(0, 500),
      data.tool_use_id ?? null,
    );
    debug(`tool update: changes=${result.changes}`);

    // Update last_event_at
    touchUserLastEvent(user.id);

    // Record hook event
    recordHookEvent({
      user_id: user.id,
      session_id: data.session_id,
      event_type: 'PostToolUse',
      payload: JSON.stringify(body),
    });

    debug(`responding: {} (OK)`);
    res.json({});
  } catch (err: any) {
    debug(`ERROR: ${err.stack || err.message}`);
    console.error('[codex-api] post-tool-use error:', err);
    res.json({});
  }
});

// ---------------------------------------------------------------------------
// POST /stop
// ---------------------------------------------------------------------------

codexRouter.post('/stop', (req: Request, res: Response) => {
  debug(`──── /stop ────`);
  try {
    const user = req.user!;
    const body = req.body;
    debug(`user: id=${user.id}, name=${user.name}`);
    debug(`body.session_id=${body.session_id}`);
    debug(`body.last_assistant_message length: ${(body.last_assistant_message || '').length}`);

    const parsed = CodexStopEvent.safeParse(body);
    debug(`zod parse: ${parsed.success ? 'OK' : `FAILED — ${JSON.stringify(parsed.error?.issues?.map(i => i.message))}`}`);
    const data = parsed.success ? parsed.data : body;

    // Ensure session exists + determine model
    debug(`ensuring session: ${data.session_id}`);
    ensureSession(data.session_id, user.id, user.default_model);
    const session = getSessionById(data.session_id);
    debug(`session lookup: ${session ? `found (model=${session.model})` : 'NOT FOUND'}`);
    const model = session?.model ?? user.default_model ?? 'gpt-5.4';

    // Update the latest prompt with response + token counts
    debug(`updating last prompt with response and tokens (model=${model})`);
    const db = getDb();
    const result = db.prepare(
      `UPDATE prompts SET response = ?, model = ?,
         input_tokens = ?, cached_tokens = ?, output_tokens = ?, reasoning_tokens = ?
       WHERE session_id = ? AND source = 'codex' AND response IS NULL
       ORDER BY id DESC LIMIT 1`,
    ).run(
      data.last_assistant_message ?? null,
      model,
      data.input_tokens ?? null,
      data.cached_tokens ?? null,
      data.output_tokens ?? null,
      data.reasoning_tokens ?? null,
      data.session_id,
    );
    debug(`prompt update: changes=${result.changes}`);

    // Upsert provider quota windows
    if (data.quota_primary_used_percent != null) {
      debug(`upserting primary quota: ${data.quota_primary_used_percent}%`);
      upsertProviderQuota({
        user_id: user.id,
        source: 'codex',
        window_name: 'primary',
        plan_type: data.quota_plan_type,
        used_percent: data.quota_primary_used_percent,
        window_minutes: data.quota_primary_window_minutes,
        resets_at: data.quota_primary_resets_at,
      });
    }
    if (data.quota_secondary_used_percent != null) {
      debug(`upserting secondary quota: ${data.quota_secondary_used_percent}%`);
      upsertProviderQuota({
        user_id: user.id,
        source: 'codex',
        window_name: 'secondary',
        plan_type: data.quota_plan_type,
        used_percent: data.quota_secondary_used_percent,
        window_minutes: data.quota_secondary_window_minutes,
        resets_at: data.quota_secondary_resets_at,
      });
    }

    // Update last_event_at
    touchUserLastEvent(user.id);

    // Record hook event
    recordHookEvent({
      user_id: user.id,
      session_id: data.session_id,
      event_type: 'Stop',
      payload: JSON.stringify(body),
    });

    broadcast({ type: 'stop', user_id: user.id, user_name: user.name, model, source: 'codex' });

    debug(`responding: {} (OK)`);
    res.json({});
  } catch (err: any) {
    debug(`ERROR: ${err.stack || err.message}`);
    console.error('[codex-api] stop error:', err);
    res.json({});
  }
});
