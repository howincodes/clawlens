import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  createSession,
  getSessionById,
  incrementSessionPromptCount,
  updateSessionModel,
} from '../db/queries/sessions.js';
import { recordPrompt, updateLastPromptWithResponse } from '../db/queries/prompts.js';
import { recordHookEvent, recordToolEvent, updateToolEventByToolUseId } from '../db/queries/events.js';
import { touchUserLastEvent, getUserCreditUsage, getUserModelCreditUsage, updateUser } from '../db/queries/users.js';
import { getLimitsByUser } from '../db/queries/limits.js';
import { createSubscription } from '../db/queries/subscriptions.js';
import { getCreditCostFromDb, upsertProviderQuota } from '../db/queries/model-credits.js';
import { broadcast } from '../services/websocket.js';
import {
  CodexSessionStartEvent,
  CodexPromptEvent,
  CodexPreToolUseEvent,
  CodexPostToolUseEvent,
  CodexStopEvent,
} from '../schemas/codex-events.js';

// ---------------------------------------------------------------------------
// Debug logging — enabled by HOWINLENS_DEBUG=1
// ---------------------------------------------------------------------------

const DEBUG = process.env.HOWINLENS_DEBUG === '1' || process.env.HOWINLENS_DEBUG === 'true';

function debug(msg: string): void {
  if (DEBUG) console.log(`[codex-api] ${msg}`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalize Codex subscription plan type. Unlike CC (which only has pro/max),
 * Codex has go/pro/plus/team — pass through as-is, just lowercase.
 */
function normalizeSubscriptionType(raw: string | undefined): string {
  if (!raw) return 'pro';
  return raw.toLowerCase();
}

/**
 * Ensure session exists — auto-create if SessionStart was missed or failed.
 * Uses source='codex'.
 */
async function ensureSession(sessionId: string | undefined, userId: number, model?: string, cwd?: string) {
  if (!sessionId) return;
  const existing = await getSessionById(sessionId);
  if (!existing) {
    try {
      await createSession({ id: sessionId, userId, model: model || 'gpt-5.4', cwd, source: 'codex' });
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

codexRouter.post('/session-start', async (req: Request, res: Response) => {
  debug(`──── /session-start ────`);
  try {
    const user = req.user!;
    const body = req.body;
    console.log(`[codex-api] session-start: user=${user.name}, model=${body.model || '(none)'}, session=${body.session_id}`);
    console.log(`[codex-api] session-start: email=${body.subscription_email || '(none)'}, plan=${body.plan_type || '(none)'}, auth_provider=${body.auth_provider || '(none)'}, org=${body.org_title || '(none)'}`);
    debug(`body keys: ${Object.keys(body).join(', ')}`);

    const parsed = CodexSessionStartEvent.safeParse(body);
    debug(`zod parse: ${parsed.success ? 'OK' : `FAILED — ${JSON.stringify(parsed.error?.issues?.map(i => i.message))}`}`);
    const data = parsed.success ? parsed.data : body;

    // Check user status — killed
    if (user.status === 'killed') {
      debug(`user is KILLED — blocking session`);
      await recordHookEvent({
        userId: user.id,
        sessionId: data.session_id,
        eventType: 'SessionStart',
        payload: JSON.stringify(body),
      });
      await touchUserLastEvent(user.id);
      const resp = { decision: 'block', killed: true, hard: true };
      debug(`responding: ${JSON.stringify(resp)}`);
      res.json(resp);
      return;
    }

    // Check user status — paused
    if (user.status === 'paused') {
      debug(`user is PAUSED — blocking session`);
      await recordHookEvent({
        userId: user.id,
        sessionId: data.session_id,
        eventType: 'SessionStart',
        payload: JSON.stringify(body),
      });
      await touchUserLastEvent(user.id);
      const resp = { decision: 'block' };
      debug(`responding: ${JSON.stringify(resp)}`);
      res.json(resp);
      return;
    }

    // Determine model
    const model = body.model || user.defaultModel || 'gpt-5.4';
    debug(`resolved model: "${model}"`);

    // Create session with source='codex' and extra columns
    debug(`creating session: id=${data.session_id}, userId=${user.id}, model=${model}, source=codex`);
    await createSession({
      id: data.session_id,
      userId: user.id,
      model,
      cwd: data.cwd ?? undefined,
      source: 'codex',
      cliVersion: data.cli_version ?? undefined,
      modelProvider: data.model_provider ?? undefined,
      reasoningEffort: data.reasoning_effort ?? undefined,
    });
    debug(`session created OK`);

    // ── Collect enriched data from client ──
    const userUpdates: Partial<Record<string, unknown>> = {};

    // Update user email from subscription if we don't have it
    if (body.subscription_email && (!user.email || user.email === '')) {
      userUpdates.email = body.subscription_email;
      debug(`will update user email to "${body.subscription_email}"`);
    }

    // Apply user updates if any
    if (Object.keys(userUpdates).length > 0) {
      debug(`updating user: ${JSON.stringify(userUpdates)}`);
      try { await updateUser(user.id, userUpdates as any); debug(`user updated OK`); } catch (e: any) { debug(`user update FAILED: ${e.message}`); }
    }

    // Handle subscription record
    if (body.subscription_email || body.plan_type) {
      const subType = normalizeSubscriptionType(body.plan_type);
      console.log(`[codex-api] subscription: email=${body.subscription_email || user.email}, type=${subType}, plan=${body.plan_type}, org=${body.org_title || '(none)'}, source=codex`);
      try {
        const sub = await createSubscription({
          email: body.subscription_email || user.email || '',
          subscriptionType: subType,
          planName: body.org_title || undefined,
          source: 'codex',
          accountId: body.account_id,
          orgId: body.org_id,
          authProvider: body.auth_provider,
          subscriptionActiveStart: body.subscription_active_start,
          subscriptionActiveUntil: body.subscription_active_until,
        });
        console.log(`[codex-api] subscription created/updated: id=${sub?.id}, email=${sub?.email}`);
        if (sub && !user.subscriptionId) {
          await updateUser(user.id, { subscriptionId: sub.id });
          console.log(`[codex-api] linked subscription ${sub.id} to user ${user.name}`);
        }
      } catch (e: any) { console.error(`[codex-api] subscription FAILED: ${e.message}`); }
    } else {
      console.log(`[codex-api] session-start: NO subscription data (email=${body.subscription_email || 'missing'}, plan_type=${body.plan_type || 'missing'})`);
    }

    // Update last_event_at
    await touchUserLastEvent(user.id);

    // Record full hook event
    debug(`recording hook event`);
    await recordHookEvent({
      userId: user.id,
      sessionId: data.session_id,
      eventType: 'SessionStart',
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

codexRouter.post('/prompt', async (req: Request, res: Response) => {
  debug(`──── /prompt ────`);
  try {
    const user = req.user!;
    const body = req.body;
    console.log(`[codex-api] prompt: user=${user.name}, model=${body.model || '(none)'}, prompt="${(body.prompt || '').slice(0, 80)}", turn=${body.turn_id || '(none)'}`);

    const parsed = CodexPromptEvent.safeParse(body);
    debug(`zod parse: ${parsed.success ? 'OK' : `FAILED — ${JSON.stringify(parsed.error?.issues?.map(i => i.message))}`}`);
    const data = parsed.success ? parsed.data : body;

    // Check user status — killed
    if (user.status === 'killed') {
      debug(`user is KILLED — blocking prompt`);
      try {
        await recordHookEvent({
          userId: user.id,
          sessionId: data.session_id,
          eventType: 'UserPromptSubmit',
          payload: JSON.stringify(body),
        });
      } catch (e: any) { debug(`recording hook event FAILED: ${e.message}`); }
      await touchUserLastEvent(user.id);
      const resp = { decision: 'block', killed: true, hard: true };
      debug(`responding: ${JSON.stringify(resp)}`);
      res.json(resp);
      return;
    }

    // Check user status — paused
    if (user.status === 'paused') {
      debug(`user is PAUSED — blocking prompt`);
      try {
        await recordHookEvent({
          userId: user.id,
          sessionId: data.session_id,
          eventType: 'UserPromptSubmit',
          payload: JSON.stringify(body),
        });
      } catch (e: any) { debug(`recording hook event FAILED: ${e.message}`); }
      await touchUserLastEvent(user.id);
      const resp = { decision: 'block' };
      debug(`responding: ${JSON.stringify(resp)}`);
      res.json(resp);
      return;
    }

    // Ensure session exists
    debug(`ensuring session exists: session_id=${data.session_id}`);
    await ensureSession(data.session_id, user.id, user.defaultModel ?? undefined, data.cwd);
    const session = await getSessionById(data.session_id);
    debug(`session lookup: ${session ? `found (model=${session.model})` : 'NOT FOUND'}`);

    // Prefer body.model > session.model > user.defaultModel
    const model = body.model || session?.model || user.defaultModel || 'gpt-5.4';
    debug(`resolved model: "${model}"`);

    // Update session model if the client reports a different one
    if (body.model && session && body.model !== session.model) {
      debug(`model changed mid-session: "${session.model}" → "${body.model}" — updating session`);
      await updateSessionModel(data.session_id, body.model);
    }

    // Compute credit cost via DB lookup
    const creditCost = await getCreditCostFromDb(model, 'codex');
    debug(`credit cost for ${model}: ${creditCost}`);

    // Check credit limits
    const limits = await getLimitsByUser(user.id);
    debug(`user has ${limits.length} limit rule(s)`);
    let blocked = false;
    let blockReason = '';

    for (const limit of limits) {
      debug(`checking limit: type=${limit.type}, model=${limit.model || '(any)'}, window=${limit.window}, value=${limit.value}`);
      if (limit.type === 'total_credits') {
        const window = limit.window as 'daily' | 'hourly' | 'monthly';
        const usage = await getUserCreditUsage(user.id, window);
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
        const usage = await getUserModelCreditUsage(user.id, limitModel, window);
        debug(`  per_model(${limitModel}): usage=${usage}, limit=${limit.value}, next_cost=${creditCost}, would_exceed=${usage + creditCost > limit.value}`);
        if (usage + creditCost > limit.value) {
          blocked = true;
          blockReason = `Credit limit reached. ${limitModel} ${window} usage: ${usage}/${limit.value}`;
          debug(`  BLOCKED: ${blockReason}`);
          break;
        }
      } else if (limit.type === 'time_of_day') {
        const currentHour = new Date().getHours();
        const startHour = limit.startHour ?? 0;
        const endHour = limit.endHour ?? 24;
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
      console.log(`[codex-api] prompt BLOCKED: user=${user.name}, reason="${blockReason}"`);
      // Record blocked prompt with source/turnId
      await recordPrompt({
        sessionId: data.session_id,
        userId: user.id,
        prompt: data.prompt ?? undefined,
        model,
        creditCost: 0,
        blocked: true,
        blockReason,
        source: 'codex',
        turnId: data.turn_id ?? undefined,
      });

      await recordHookEvent({
        userId: user.id,
        sessionId: data.session_id,
        eventType: 'UserPromptSubmit',
        payload: JSON.stringify(body),
      });
      await touchUserLastEvent(user.id);
      broadcast({ type: 'prompt', user_id: user.id, user_name: user.name, prompt: data.prompt?.slice(0, 100), blocked: true, source: 'codex' });
      const resp = { decision: 'block', reason: blockReason };
      debug(`responding: ${JSON.stringify(resp)}`);
      res.json(resp);
      return;
    }

    // Record prompt (allowed) with source/turnId
    console.log(`[codex-api] prompt ALLOWED: user=${user.name}, model=${model}, credits=${creditCost}`);
    await recordPrompt({
      sessionId: data.session_id,
      userId: user.id,
      prompt: data.prompt ?? undefined,
      model,
      creditCost,
      source: 'codex',
      turnId: data.turn_id ?? undefined,
    });

    // Increment session prompt count and credits
    await incrementSessionPromptCount(data.session_id, creditCost);

    // Update last_event_at
    await touchUserLastEvent(user.id);

    // Record hook event
    await recordHookEvent({
      userId: user.id,
      sessionId: data.session_id,
      eventType: 'UserPromptSubmit',
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

codexRouter.post('/pre-tool-use', async (req: Request, res: Response) => {
  debug(`──── /pre-tool-use ────`);
  try {
    const user = req.user!;
    const body = req.body;
    console.log(`[codex-api] pre-tool: user=${user.name}, tool=${body.tool_name || '(none)'}, cmd="${JSON.stringify(body.tool_input)?.slice(0, 100)}"`);

    const parsed = CodexPreToolUseEvent.safeParse(body);
    debug(`zod parse: ${parsed.success ? 'OK' : `FAILED — ${JSON.stringify(parsed.error?.issues?.map(i => i.message))}`}`);
    const data = parsed.success ? parsed.data : body;

    // Check user status — killed
    if (user.status === 'killed') {
      debug(`user is KILLED — denying tool use`);
      await recordHookEvent({
        userId: user.id,
        sessionId: data.session_id,
        eventType: 'PreToolUse',
        payload: JSON.stringify(body),
      });
      await touchUserLastEvent(user.id);
      const resp = { decision: 'block', killed: true, hard: true };
      debug(`responding: ${JSON.stringify(resp)}`);
      res.json(resp);
      return;
    }

    // Check user status — paused
    if (user.status === 'paused') {
      debug(`user is PAUSED — denying tool use`);
      await recordHookEvent({
        userId: user.id,
        sessionId: data.session_id,
        eventType: 'PreToolUse',
        payload: JSON.stringify(body),
      });
      await touchUserLastEvent(user.id);
      const resp = { decision: 'block' };
      debug(`responding: ${JSON.stringify(resp)}`);
      res.json(resp);
      return;
    }

    // Record tool event with source/toolUseId
    debug(`recording tool event: toolName=${data.tool_name}`);
    await recordToolEvent({
      userId: user.id,
      sessionId: data.session_id ?? undefined,
      toolName: data.tool_name ?? 'unknown',
      toolInput: JSON.stringify(data.tool_input)?.slice(0, 500),
      source: 'codex',
      toolUseId: data.tool_use_id ?? undefined,
    });

    // Update last_event_at
    await touchUserLastEvent(user.id);

    // Record hook event
    await recordHookEvent({
      userId: user.id,
      sessionId: data.session_id,
      eventType: 'PreToolUse',
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

codexRouter.post('/post-tool-use', async (req: Request, res: Response) => {
  debug(`──── /post-tool-use ────`);
  try {
    const user = req.user!;
    const body = req.body;
    console.log(`[codex-api] post-tool: user=${user.name}, tool=${body.tool_name || '(none)'}, tool_use_id=${body.tool_use_id || '(none)'}`);

    const parsed = CodexPostToolUseEvent.safeParse(body);
    debug(`zod parse: ${parsed.success ? 'OK' : 'FAILED'}`);
    const data = parsed.success ? parsed.data : body;

    // Update tool event via toolUseId
    debug(`updating tool event: toolUseId=${data.tool_use_id}`);
    if (data.tool_use_id) {
      const result = await updateToolEventByToolUseId(data.tool_use_id, 'codex', {
        toolOutput: (data.tool_response ?? '').slice(0, 500),
        success: true,
      });
      debug(`tool update: ${result ? 'updated' : 'not found'}`);
    }

    // Update last_event_at
    await touchUserLastEvent(user.id);

    // Record hook event
    await recordHookEvent({
      userId: user.id,
      sessionId: data.session_id,
      eventType: 'PostToolUse',
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

codexRouter.post('/stop', async (req: Request, res: Response) => {
  debug(`──── /stop ────`);
  try {
    const user = req.user!;
    const body = req.body;
    console.log(`[codex-api] stop: user=${user.name}, session=${body.session_id}, response_len=${(body.last_assistant_message || '').length}, tokens=${body.output_tokens || 0}, quota=${body.quota_primary_used_percent ?? 'n/a'}%`);

    const parsed = CodexStopEvent.safeParse(body);
    debug(`zod parse: ${parsed.success ? 'OK' : `FAILED — ${JSON.stringify(parsed.error?.issues?.map(i => i.message))}`}`);
    const data = parsed.success ? parsed.data : body;

    // Ensure session exists + determine model
    debug(`ensuring session: ${data.session_id}`);
    await ensureSession(data.session_id, user.id, user.defaultModel ?? undefined);
    const session = await getSessionById(data.session_id);
    debug(`session lookup: ${session ? `found (model=${session.model})` : 'NOT FOUND'}`);
    const model = session?.model ?? user.defaultModel ?? 'gpt-5.4';

    // Update the latest prompt with response + token counts
    debug(`updating last prompt with response and tokens (model=${model})`);
    const result = await updateLastPromptWithResponse(data.session_id, 'codex', {
      response: data.last_assistant_message ?? undefined,
      model,
      inputTokens: data.input_tokens ?? undefined,
      cachedTokens: data.cached_tokens ?? undefined,
      outputTokens: data.output_tokens ?? undefined,
      reasoningTokens: data.reasoning_tokens ?? undefined,
    });
    debug(`prompt update: ${result ? 'updated' : 'no matching prompt found'}`);

    // Upsert provider quota windows
    if (data.quota_primary_used_percent != null) {
      debug(`upserting primary quota: ${data.quota_primary_used_percent}%`);
      await upsertProviderQuota({
        userId: user.id,
        source: 'codex',
        windowName: 'primary',
        planType: data.quota_plan_type,
        usedPercent: data.quota_primary_used_percent,
        windowMinutes: data.quota_primary_window_minutes,
        resetsAt: data.quota_primary_resets_at,
      });
    }
    if (data.quota_secondary_used_percent != null) {
      debug(`upserting secondary quota: ${data.quota_secondary_used_percent}%`);
      await upsertProviderQuota({
        userId: user.id,
        source: 'codex',
        windowName: 'secondary',
        planType: data.quota_plan_type,
        usedPercent: data.quota_secondary_used_percent,
        windowMinutes: data.quota_secondary_window_minutes,
        resetsAt: data.quota_secondary_resets_at,
      });
    }

    // Update last_event_at
    await touchUserLastEvent(user.id);

    // Record hook event
    await recordHookEvent({
      userId: user.id,
      sessionId: data.session_id,
      eventType: 'Stop',
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
