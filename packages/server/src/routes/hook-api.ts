import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  createSession,
  recordPrompt,
  recordHookEvent,
  recordToolEvent,
  recordSubagentEvent,
  touchUserLastEvent,
  getUserCreditUsage,
  getUserModelCreditUsage,
  getSessionById,
  incrementSessionPromptCount,
  endSession,
  getLimitsByUser,
  getDb,
  createSubscription,
  updateUser,
  upsertAntigravitySession,
  type LimitRow,
} from '../services/db.js';
import { broadcast } from '../services/websocket.js';
import { queueSessionAnalysis } from '../services/ai-jobs.js';
import {
  SessionStartEvent,
  UserPromptSubmitEvent,
  PreToolUseEvent,
  PostToolUseEvent,
  PostToolUseFailureEvent,
  StopEvent,
  StopFailureEvent,
  SessionEndEvent,
  SubagentStartEvent,
  ConfigChangeEvent,
  FileChangedEvent,
} from '../schemas/hook-events.js';

// ---------------------------------------------------------------------------
// Debug logging — enabled by CLAWLENS_DEBUG=1
// ---------------------------------------------------------------------------

const DEBUG = process.env.CLAWLENS_DEBUG === '1' || process.env.CLAWLENS_DEBUG === 'true';

function debug(msg: string): void {
  if (DEBUG) console.log(`[hook-api] ${msg}`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getCreditCost(model: string | undefined): number {
  if (!model) return 3; // default to sonnet cost
  const m = model.toLowerCase();
  if (m.includes('opus')) return 10;
  if (m.includes('haiku')) return 1;
  return 3; // sonnet and everything else
}

/**
 * Normalize Antigravity model placeholders to human-readable names.
 * The LS API returns MODEL_PLACEHOLDER_M37 etc. Map known ones, pass through the rest.
 * This map is updated as new models are discovered from user devices.
 */
const ANTIGRAVITY_MODEL_MAP: Record<string, string> = {
  MODEL_PLACEHOLDER_M37: 'Gemini 3.1 Pro (High)',
  MODEL_PLACEHOLDER_M36: 'Gemini 3.1 Pro (Low)',
  MODEL_PLACEHOLDER_M47: 'Gemini 3 Flash',
  MODEL_PLACEHOLDER_M35: 'Claude Sonnet 4.6',
  MODEL_PLACEHOLDER_M26: 'Claude Opus 4.6',
  MODEL_PLACEHOLDER_M25: 'Gemini 2.5 Flash',
  MODEL_OPENAI_GPT_OSS_120B_MEDIUM: 'GPT-OSS 120B',
};

function normalizeAntigravityModel(raw: string | undefined): string {
  if (!raw) return 'Antigravity';
  if (raw.startsWith('MODEL_PLACEHOLDER_') || raw.startsWith('MODEL_OPENAI_')) {
    return ANTIGRAVITY_MODEL_MAP[raw] || raw;
  }
  return raw;
}

/**
 * Normalize raw subscription type strings (e.g. "STRIPE_SUBSCRIPTION")
 * into clean plan names for display and storage.
 */
function normalizeSubscriptionType(raw: string | undefined): string {
  const lower = String(raw || '').toLowerCase();
  if (lower.includes('max')) return 'max';
  return 'pro';
}

/**
 * Ensure session exists — auto-create if SessionStart was missed or failed.
 * This prevents FK constraint errors on prompts/tools referencing unknown sessions.
 */
function ensureSession(sessionId: string | undefined, userId: string, model?: string, cwd?: string) {
  if (!sessionId) return;
  const existing = getSessionById(sessionId);
  if (!existing) {
    try {
      createSession({ id: sessionId, user_id: userId, model: model || 'sonnet', cwd });
    } catch {}
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const hookRouter = Router();

// ---------------------------------------------------------------------------
// POST /session-start
// ---------------------------------------------------------------------------

hookRouter.post('/session-start', (req: Request, res: Response) => {
  debug(`──── /session-start ────`);
  try {
    const user = req.user!;
    const body = req.body;
    debug(`user: id=${user.id}, name=${user.name}, status=${user.status}, email=${user.email || '(none)'}, default_model=${user.default_model || '(none)'}`);
    debug(`body keys: ${Object.keys(body).join(', ')}`);
    debug(`body.session_id=${body.session_id}, body.model=${body.model || '(none)'}, body.detected_model=${body.detected_model || '(none)'}`);
    debug(`body.subscription_email=${body.subscription_email || '(none)'}, body.subscription_type=${body.subscription_type || '(none)'}`);
    debug(`body.org_name=${body.org_name || '(none)'}, body.hostname=${body.hostname || '(none)'}, body.platform=${body.platform || '(none)'}`);

    const parsed = SessionStartEvent.safeParse(body);
    debug(`zod parse: ${parsed.success ? 'OK' : `FAILED — ${JSON.stringify(parsed.error?.issues?.map(i => i.message))}`}`);
    const data = parsed.success ? parsed.data : body;

    // Check user status
    if (user.status === 'killed') {
      debug(`user is KILLED — blocking session`);
      recordHookEvent({
        user_id: user.id,
        session_id: data.session_id,
        event_type: 'SessionStart',
        payload: JSON.stringify(body),
      });
      touchUserLastEvent(user.id);
      const resp = { continue: false, stopReason: 'Account suspended by admin. Contact your team lead.' };
      debug(`responding: ${JSON.stringify(resp)}`);
      res.json(resp);
      return;
    }

    if (user.status === 'paused') {
      debug(`user is PAUSED — blocking session`);
      recordHookEvent({
        user_id: user.id,
        session_id: data.session_id,
        event_type: 'SessionStart',
        payload: JSON.stringify(body),
      });
      touchUserLastEvent(user.id);
      const resp = { continue: false, stopReason: 'Account paused by admin. Contact your team lead.' };
      debug(`responding: ${JSON.stringify(resp)}`);
      res.json(resp);
      return;
    }

    // Determine model — from hook JSON, enriched field, or user default
    const model = body.model || body.detected_model || user.default_model || 'sonnet';
    debug(`resolved model: "${model}" (body.model=${body.model || '(none)'}, body.detected_model=${body.detected_model || '(none)'}, user.default_model=${user.default_model || '(none)'})`);

    // Create session
    debug(`creating session: id=${data.session_id}, user_id=${user.id}, model=${model}, cwd=${data.cwd || '(none)'}`);
    createSession({
      id: data.session_id,
      user_id: user.id,
      model,
      cwd: data.cwd,
    });
    debug(`session created OK`);

    // ── Collect ALL enriched data from client ──
    const userUpdates: Record<string, string> = {};

    // Update user email from subscription if we don't have it
    if (body.subscription_email && (!user.email || user.email === '')) {
      userUpdates.email = body.subscription_email;
      debug(`will update user email to "${body.subscription_email}"`);
    }

    // Update default model based on what client detected
    if (body.detected_model && body.detected_model !== user.default_model) {
      userUpdates.default_model = body.detected_model;
      debug(`will update user default_model to "${body.detected_model}"`);
    }

    // Apply user updates if any
    if (Object.keys(userUpdates).length > 0) {
      debug(`updating user: ${JSON.stringify(userUpdates)}`);
      try { updateUser(user.id, userUpdates); debug(`user updated OK`); } catch (e: any) { debug(`user update FAILED: ${e.message}`); }
    }

    // Handle subscription record
    if (body.subscription_email || body.subscription_type) {
      const subType = normalizeSubscriptionType(body.subscription_type);

      // Cross-check: if model is opus but subscription says pro, it's likely a Max plan
      // (Pro users can't use Opus as default — they need Max)
      let finalSubType = subType;
      if (subType === 'pro' && model && model.toLowerCase().includes('opus')) {
        finalSubType = 'max';
        debug(`subscription cross-check: model is opus, overriding pro → max`);
      }

      debug(`creating/updating subscription: email=${body.subscription_email || user.email}, type=${finalSubType} (raw: ${body.subscription_type}, after cross-check), org=${body.org_name}`);
      try {
        const sub = createSubscription({
          email: body.subscription_email || user.email || '',
          subscription_type: finalSubType,
          plan_name: body.org_name || undefined,
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

    // Record full hook event (includes all device info, subscription, etc.)
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
      subscription_email: body.subscription_email,
      hostname: body.hostname,
      platform: body.platform,
    });

    debug(`responding: {} (allow)`);
    res.json({});
  } catch (err: any) {
    debug(`ERROR: ${err.stack || err.message}`);
    console.error('[hook-api] session-start error:', err);
    res.json({});
  }
});

// ---------------------------------------------------------------------------
// POST /prompt
// ---------------------------------------------------------------------------

hookRouter.post('/prompt', (req: Request, res: Response) => {
  debug(`──── /prompt ────`);
  try {
    const user = req.user!;
    const body = req.body;
    debug(`user: id=${user.id}, name=${user.name}, status=${user.status}`);
    debug(`body keys: ${Object.keys(body).join(', ')}`);
    debug(`body.session_id=${body.session_id}, body.prompt=${(body.prompt || '').slice(0, 100)}...`);

    const parsed = UserPromptSubmitEvent.safeParse(body);
    debug(`zod parse: ${parsed.success ? 'OK' : `FAILED — ${JSON.stringify(parsed.error?.issues?.map(i => i.message))}`}`);
    const data = parsed.success ? parsed.data : body;

    // Check user status
    if (user.status === 'killed' || user.status === 'paused') {
      debug(`user is ${user.status} — blocking prompt`);
      // Recording is best-effort — FK may fail if session doesn't exist
      try {
        recordPrompt({
          session_id: data.session_id,
          user_id: user.id,
          prompt: data.prompt,
          model: user.default_model ?? undefined,
          credit_cost: 0,
          blocked: true,
          block_reason: 'Account suspended.',
        });
        debug(`blocked prompt recorded`);
      } catch (e: any) { debug(`recording blocked prompt FAILED (expected if no session): ${e.message}`); }
      try {
        recordHookEvent({
          user_id: user.id,
          session_id: data.session_id,
          event_type: 'UserPromptSubmit',
          payload: JSON.stringify(body),
        });
      } catch (e: any) { debug(`recording hook event FAILED: ${e.message}`); }
      touchUserLastEvent(user.id);
      const resp = { decision: 'block', reason: 'Account suspended.' };
      debug(`responding: ${JSON.stringify(resp)}`);
      res.json(resp);
      return;
    }

    // Ensure session exists (auto-create if SessionStart was missed or failed)
    debug(`ensuring session exists: session_id=${data.session_id}`);
    ensureSession(data.session_id, user.id, user.default_model, data.cwd);
    const session = getSessionById(data.session_id);
    debug(`session lookup: ${session ? `found (model=${session.model})` : 'NOT FOUND (even after ensureSession!)'}`);
    // Prefer body.model (fresh from client) > session.model > user.default_model
    const model = body.model || session?.model || user.default_model || 'sonnet';
    debug(`resolved model: "${model}" (body.model=${body.model || '(none)'}, session.model=${session?.model || '(none)'})`);

    // Update session model if the client reports a different one (user ran /model)
    if (body.model && session && body.model !== session.model) {
      debug(`model changed mid-session: "${session.model}" → "${body.model}" — updating session`);
      const db = getDb();
      db.prepare('UPDATE sessions SET model = ? WHERE id = ?').run(body.model, data.session_id);
    }

    // Compute credit cost
    const creditCost = getCreditCost(model);
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
        debug(`  time_of_day: current_hour=${currentHour}, blocked_range=${startHour}-${endHour}, in_range=${currentHour >= startHour && currentHour < endHour}`);
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
      recordPrompt({
        session_id: data.session_id,
        user_id: user.id,
        prompt: data.prompt,
        model,
        credit_cost: 0,
        blocked: true,
        block_reason: blockReason,
      });
      recordHookEvent({
        user_id: user.id,
        session_id: data.session_id,
        event_type: 'UserPromptSubmit',
        payload: JSON.stringify(body),
      });
      touchUserLastEvent(user.id);
      broadcast({ type: 'prompt', user_id: user.id, user_name: user.name, prompt: data.prompt?.slice(0, 100), blocked: true });
      const resp = { decision: 'block', reason: blockReason };
      debug(`responding: ${JSON.stringify(resp)}`);
      res.json(resp);
      return;
    }

    // Record prompt (allowed)
    debug(`prompt ALLOWED — recording with credit_cost=${creditCost}`);
    recordPrompt({
      session_id: data.session_id,
      user_id: user.id,
      prompt: data.prompt,
      model,
      credit_cost: creditCost,
    });

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

    broadcast({ type: 'prompt', user_id: user.id, user_name: user.name, prompt: data.prompt?.slice(0, 100), blocked: false });

    debug(`responding: {} (allow)`);
    res.json({});
  } catch (err: any) {
    debug(`ERROR: ${err.stack || err.message}`);
    console.error('[hook-api] prompt error:', err);
    res.json({});
  }
});

// ---------------------------------------------------------------------------
// POST /pre-tool
// ---------------------------------------------------------------------------

hookRouter.post('/pre-tool', (req: Request, res: Response) => {
  debug(`──── /pre-tool ────`);
  try {
    const user = req.user!;
    const body = req.body;
    debug(`user: id=${user.id}, name=${user.name}, status=${user.status}`);
    debug(`body.tool_name=${body.tool_name || '(none)'}, body.session_id=${body.session_id}`);

    const parsed = PreToolUseEvent.safeParse(body);
    debug(`zod parse: ${parsed.success ? 'OK' : `FAILED — ${JSON.stringify(parsed.error?.issues?.map(i => i.message))}`}`);
    const data = parsed.success ? parsed.data : body;

    // Check user status
    if (user.status === 'killed' || user.status === 'paused') {
      debug(`user is ${user.status} — denying tool use`);
      recordHookEvent({
        user_id: user.id,
        session_id: data.session_id,
        event_type: 'PreToolUse',
        payload: JSON.stringify(body),
      });
      touchUserLastEvent(user.id);
      const resp = {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: 'Account suspended.',
        },
      };
      debug(`responding: ${JSON.stringify(resp)}`);
      res.json(resp);
      return;
    }

    // Record tool event
    debug(`recording tool event: tool_name=${data.tool_name}`);
    recordToolEvent({
      user_id: user.id,
      session_id: data.session_id,
      tool_name: data.tool_name ?? 'unknown',
      tool_input: JSON.stringify(data.tool_input)?.slice(0, 500),
    });

    // Update last_event_at
    touchUserLastEvent(user.id);

    // Record hook event
    recordHookEvent({
      user_id: user.id,
      session_id: data.session_id,
      event_type: 'PreToolUse',
      payload: JSON.stringify(body),
    });

    broadcast({ type: 'tool_use', user_id: user.id, user_name: user.name, tool_name: data.tool_name });

    debug(`responding: {} (allow)`);
    res.json({});
  } catch (err: any) {
    debug(`ERROR: ${err.stack || err.message}`);
    console.error('[hook-api] pre-tool error:', err);
    res.json({});
  }
});

// ---------------------------------------------------------------------------
// POST /stop
// ---------------------------------------------------------------------------

hookRouter.post('/stop', (req: Request, res: Response) => {
  debug(`──── /stop ────`);
  try {
    const user = req.user!;
    const body = req.body;
    debug(`user: id=${user.id}, name=${user.name}`);
    debug(`body.session_id=${body.session_id}`);
    debug(`body.last_assistant_message length: ${(body.last_assistant_message || '').length}`);

    const parsed = StopEvent.safeParse(body);
    debug(`zod parse: ${parsed.success ? 'OK' : `FAILED — ${JSON.stringify(parsed.error?.issues?.map(i => i.message))}`}`);
    const data = parsed.success ? parsed.data : body;

    // Ensure session exists + determine model
    debug(`ensuring session: ${data.session_id}`);
    ensureSession(data.session_id, user.id, user.default_model);
    const session = getSessionById(data.session_id);
    debug(`session lookup: ${session ? `found (model=${session.model})` : 'NOT FOUND'}`);
    const model = session?.model ?? user.default_model ?? 'sonnet';

    // Update model on the most recent prompt (don't store response text)
    debug(`updating last prompt model (model=${model})`);
    const db = getDb();
    const result = db.prepare(
      `UPDATE prompts SET model = ? WHERE session_id = ? AND response IS NULL ORDER BY id DESC LIMIT 1`,
    ).run(model, data.session_id);
    debug(`prompt update: changes=${result.changes}`);

    // Update last_event_at
    touchUserLastEvent(user.id);

    // Record hook event
    recordHookEvent({
      user_id: user.id,
      session_id: data.session_id,
      event_type: 'Stop',
      payload: JSON.stringify(body),
    });

    broadcast({ type: 'stop', user_id: user.id, user_name: user.name, model });

    debug(`responding: {} (OK)`);
    res.json({});
  } catch (err: any) {
    debug(`ERROR: ${err.stack || err.message}`);
    console.error('[hook-api] stop error:', err);
    res.json({});
  }
});

// ---------------------------------------------------------------------------
// POST /stop-error
// ---------------------------------------------------------------------------

hookRouter.post('/stop-error', (req: Request, res: Response) => {
  debug(`──── /stop-error ────`);
  try {
    const user = req.user!;
    const body = req.body;
    debug(`user: id=${user.id}, name=${user.name}`);
    debug(`body.session_id=${body.session_id}, body.error=${body.error || '(none)'}`);

    const parsed = StopFailureEvent.safeParse(body);
    debug(`zod parse: ${parsed.success ? 'OK' : 'FAILED'}`);
    const data = parsed.success ? parsed.data : body;

    // Record hook event with error details
    debug(`recording StopFailure event`);
    recordHookEvent({
      user_id: user.id,
      session_id: data.session_id,
      event_type: 'StopFailure',
      payload: JSON.stringify({
        error: data.error,
        error_details: data.error_details,
        ...body,
      }),
    });

    // Update last_event_at
    touchUserLastEvent(user.id);

    debug(`responding: {} (OK)`);
    res.json({});
  } catch (err: any) {
    debug(`ERROR: ${err.stack || err.message}`);
    console.error('[hook-api] stop-error error:', err);
    res.json({});
  }
});

// ---------------------------------------------------------------------------
// POST /session-end
// ---------------------------------------------------------------------------

hookRouter.post('/session-end', (req: Request, res: Response) => {
  debug(`──── /session-end ────`);
  try {
    const user = req.user!;
    const body = req.body;
    debug(`user: id=${user.id}, name=${user.name}`);
    debug(`body.session_id=${body.session_id}, body.reason=${body.reason || '(none)'}`);

    const parsed = SessionEndEvent.safeParse(body);
    debug(`zod parse: ${parsed.success ? 'OK' : 'FAILED'}`);
    const data = parsed.success ? parsed.data : body;

    // End session
    debug(`ending session: ${data.session_id}, reason=${data.reason ?? 'unknown'}`);
    endSession(data.session_id, data.reason ?? 'unknown');

    // Queue AI analysis for the completed session
    queueSessionAnalysis(data.session_id, user.id);

    // Update last_event_at
    touchUserLastEvent(user.id);

    // Record hook event
    recordHookEvent({
      user_id: user.id,
      session_id: data.session_id,
      event_type: 'SessionEnd',
      payload: JSON.stringify(body),
    });

    debug(`responding: {} (OK)`);
    res.json({});
  } catch (err: any) {
    debug(`ERROR: ${err.stack || err.message}`);
    console.error('[hook-api] session-end error:', err);
    res.json({});
  }
});

// ---------------------------------------------------------------------------
// POST /post-tool
// ---------------------------------------------------------------------------

hookRouter.post('/post-tool', (req: Request, res: Response) => {
  debug(`──── /post-tool ────`);
  try {
    const user = req.user!;
    const body = req.body;
    debug(`user: id=${user.id}, tool_name=${body.tool_name || '(none)'}, session_id=${body.session_id}`);

    const parsed = PostToolUseEvent.safeParse(body);
    debug(`zod parse: ${parsed.success ? 'OK' : 'FAILED'}`);
    const data = parsed.success ? parsed.data : body;

    // Record tool event with success
    debug(`recording tool event (success): ${data.tool_name}`);
    recordToolEvent({
      user_id: user.id,
      session_id: data.session_id,
      tool_name: data.tool_name ?? 'unknown',
      tool_input: JSON.stringify(data.tool_input)?.slice(0, 500),
      tool_output: JSON.stringify(data.tool_response)?.slice(0, 500),
      success: true,
    });

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
    console.error('[hook-api] post-tool error:', err);
    res.json({});
  }
});

// ---------------------------------------------------------------------------
// POST /subagent-start
// ---------------------------------------------------------------------------

hookRouter.post('/subagent-start', (req: Request, res: Response) => {
  debug(`──── /subagent-start ────`);
  try {
    const user = req.user!;
    const body = req.body;
    debug(`user: id=${user.id}, agent_type=${body.agent_type || '(none)'}, agent_id=${body.agent_id || '(none)'}`);

    const parsed = SubagentStartEvent.safeParse(body);
    debug(`zod parse: ${parsed.success ? 'OK' : 'FAILED'}`);
    const data = parsed.success ? parsed.data : body;

    // Record subagent event
    debug(`recording subagent event`);
    recordSubagentEvent({
      user_id: user.id,
      session_id: data.session_id,
      agent_id: data.agent_id,
      agent_type: data.agent_type,
    });

    // Update last_event_at
    touchUserLastEvent(user.id);

    // Record hook event
    recordHookEvent({
      user_id: user.id,
      session_id: data.session_id,
      event_type: 'SubagentStart',
      payload: JSON.stringify(body),
    });

    debug(`responding: {} (OK)`);
    res.json({});
  } catch (err: any) {
    debug(`ERROR: ${err.stack || err.message}`);
    console.error('[hook-api] subagent-start error:', err);
    res.json({});
  }
});

// ---------------------------------------------------------------------------
// POST /post-tool-failure
// ---------------------------------------------------------------------------

hookRouter.post('/post-tool-failure', (req: Request, res: Response) => {
  debug(`──── /post-tool-failure ────`);
  try {
    const user = req.user!;
    const body = req.body;
    debug(`user: id=${user.id}, tool_name=${body.tool_name || '(none)'}, error=${(body.error || '').slice(0, 200)}`);

    const parsed = PostToolUseFailureEvent.safeParse(body);
    debug(`zod parse: ${parsed.success ? 'OK' : 'FAILED'}`);
    const data = parsed.success ? parsed.data : body;

    // Record tool event with failure
    debug(`recording tool event (failure): ${data.tool_name}`);
    recordToolEvent({
      user_id: user.id,
      session_id: data.session_id,
      tool_name: data.tool_name ?? 'unknown',
      tool_output: (data.error ?? '').slice(0, 500),
      success: false,
    });

    // Update last_event_at
    touchUserLastEvent(user.id);

    // Record hook event
    recordHookEvent({
      user_id: user.id,
      session_id: data.session_id,
      event_type: 'PostToolUseFailure',
      payload: JSON.stringify(body),
    });

    debug(`responding: {} (OK)`);
    res.json({});
  } catch (err: any) {
    debug(`ERROR: ${err.stack || err.message}`);
    console.error('[hook-api] post-tool-failure error:', err);
    res.json({});
  }
});

// ---------------------------------------------------------------------------
// POST /config-change
// ---------------------------------------------------------------------------

hookRouter.post('/config-change', (req: Request, res: Response) => {
  debug(`──── /config-change ────`);
  try {
    const user = req.user!;
    const body = req.body;
    debug(`user: id=${user.id}, name=${user.name}`);
    debug(`body.source=${body.source || '(none)'}, body.file_path=${body.file_path || '(none)'}`);

    const parsed = ConfigChangeEvent.safeParse(body);
    debug(`zod parse: ${parsed.success ? 'OK' : 'FAILED'}`);
    const data = parsed.success ? parsed.data : body;

    // Record hook event
    debug(`recording ConfigChange event`);
    recordHookEvent({
      user_id: user.id,
      session_id: data.session_id,
      event_type: 'ConfigChange',
      payload: JSON.stringify(body),
    });

    debug(`config change recorded (source=${data.source}, file=${data.file_path})`);

    // Update last_event_at
    touchUserLastEvent(user.id);

    debug(`responding: {} (OK)`);
    res.json({});
  } catch (err: any) {
    debug(`ERROR: ${err.stack || err.message}`);
    console.error('[hook-api] config-change error:', err);
    res.json({});
  }
});

// ---------------------------------------------------------------------------
// POST /file-changed
// ---------------------------------------------------------------------------

hookRouter.post('/file-changed', (req: Request, res: Response) => {
  debug(`──── /file-changed ────`);
  try {
    const user = req.user!;
    const body = req.body;
    debug(`user: id=${user.id}, name=${user.name}`);
    debug(`body.file_path=${body.file_path || '(none)'}, body.event=${body.event || '(none)'}`);

    const parsed = FileChangedEvent.safeParse(body);
    debug(`zod parse: ${parsed.success ? 'OK' : 'FAILED'}`);
    const data = parsed.success ? parsed.data : body;

    // Record hook event
    debug(`recording FileChanged event`);
    recordHookEvent({
      user_id: user.id,
      session_id: data.session_id,
      event_type: 'FileChanged',
      payload: JSON.stringify(body),
    });

    debug(`file change recorded (file=${data.file_path}, event=${data.event})`);

    // Update last_event_at
    touchUserLastEvent(user.id);

    debug(`responding: {} (OK)`);
    res.json({});
  } catch (err: any) {
    debug(`ERROR: ${err.stack || err.message}`);
    console.error('[hook-api] file-changed error:', err);
    res.json({});
  }
});

// ---------------------------------------------------------------------------
// POST /antigravity-sync
// ---------------------------------------------------------------------------

hookRouter.post('/antigravity-sync', (req: Request, res: Response) => {
  debug(`──── /antigravity-sync ────`);
  try {
    const user = req.user!;
    const { conversations, model_mapping } = req.body;
    debug(`user: ${user.name}, conversations: ${conversations?.length || 0}`);

    // Client can send model_mapping from GetUserStatus — merge with our known map
    const dynamicMap: Record<string, string> = { ...ANTIGRAVITY_MODEL_MAP };
    if (model_mapping && typeof model_mapping === 'object') {
      Object.assign(dynamicMap, model_mapping);
      debug(`received ${Object.keys(model_mapping).length} model mapping(s) from client`);
    }

    // Use dynamic map for this request
    const resolveModel = (raw: string | undefined): string => {
      if (!raw) return 'Antigravity';
      return dynamicMap[raw] || ANTIGRAVITY_MODEL_MAP[raw] || raw;
    };

    if (!Array.isArray(conversations)) {
      res.json({ ok: true, synced: 0 });
      return;
    }

    let synced = 0;

    for (const conv of conversations) {
      const cascadeId = conv.cascade_id;
      if (!cascadeId) continue;

      // Extract first workspace as cwd
      let cwd: string | undefined;
      if (Array.isArray(conv.workspaces) && conv.workspaces.length > 0) {
        cwd = String(conv.workspaces[0]).replace('file://', '');
      }

      // Find first assistant model
      let model: string | undefined;
      for (const msg of conv.messages || []) {
        if (msg.role === 'assistant' && msg.model) {
          model = resolveModel(String(msg.model));
          break;
        }
      }

      // Upsert session
      upsertAntigravitySession({
        id: cascadeId,
        user_id: user.id,
        model,
        cwd,
        prompt_count: conv.step_count,
        title: conv.title,
      });

      // Process messages (with dedup — skip if prompt already exists for this session)
      const db = getDb();
      for (const msg of conv.messages || []) {
        if (msg.role === 'user' && msg.content) {
          const existing = db.prepare(
            `SELECT id FROM prompts WHERE session_id = ? AND prompt = ? LIMIT 1`
          ).get(cascadeId, msg.content);
          if (!existing) {
            recordPrompt({
              session_id: cascadeId,
              user_id: user.id,
              prompt: msg.content,
              model: (msg.model && resolveModel(msg.model) !== 'Antigravity') ? resolveModel(msg.model) : model || 'Antigravity',
              credit_cost: 0,
            });
          }
        } else if (msg.role === 'assistant' && msg.content) {
          // Response storage disabled — uncomment to enable in future
          // db.prepare(
          //   `UPDATE prompts SET response = ?, model = COALESCE(?, model) WHERE session_id = ? AND response IS NULL ORDER BY id DESC LIMIT 1`
          // ).run(msg.content, msg.model, cascadeId);
        } else if (msg.role === 'tool' && msg.tool_name) {
          recordToolEvent({
            user_id: user.id,
            session_id: cascadeId,
            tool_name: msg.tool_name,
            tool_input: msg.content?.slice(0, 500),
          });
        }
      }

      synced++;
    }

    touchUserLastEvent(user.id);
    debug(`synced ${synced} conversations`);
    res.json({ ok: true, synced });
  } catch (err: any) {
    debug(`ERROR: ${err.stack || err.message}`);
    console.error('[hook-api] antigravity-sync error:', err);
    res.json({ ok: false, synced: 0 });
  }
});
