import { Router } from 'express';
import type { Request, Response, Router as RouterType } from 'express';
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
  createSubscription,
  updateUser,
  upsertAntigravitySession,
  updateSessionModel,
  updateLastPromptModel,
  promptExistsForSession,
} from '../db/queries/index.js';
import { getCreditCostFromDb } from '../db/queries/model-credits.js';
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
  CwdChangedEvent,
} from '../schemas/hook-events.js';

// ---------------------------------------------------------------------------
// Debug logging — enabled by HOWINLENS_DEBUG=1
// ---------------------------------------------------------------------------

const DEBUG = process.env.HOWINLENS_DEBUG === '1' || process.env.HOWINLENS_DEBUG === 'true';

function debug(msg: string): void {
  if (DEBUG) console.log(`[hook-api] ${msg}`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalize Antigravity model placeholders to human-readable names.
 * The LS API returns MODEL_PLACEHOLDER_M37 etc. Map known ones, pass through the rest.
 * This map is updated as new models are discovered from user devices.
 */
const ANTIGRAVITY_MODEL_MAP: Record<string, string> = {
  MODEL_PLACEHOLDER_M37: 'AG-Gemini 3.1 Pro',
  MODEL_PLACEHOLDER_M36: 'AG-Gemini 3.1 Pro (Low)',
  MODEL_PLACEHOLDER_M47: 'AG-Gemini 3 Flash',
  MODEL_PLACEHOLDER_M35: 'AG-Sonnet',
  MODEL_PLACEHOLDER_M26: 'AG-Opus',
  MODEL_PLACEHOLDER_M25: 'AG-Gemini 2.5 Flash',
  MODEL_OPENAI_GPT_OSS_120B_MEDIUM: 'AG-GPT-OSS',
};

function normalizeAntigravityModel(raw: string | undefined): string {
  if (!raw) return 'AG-Unknown';
  if (raw.startsWith('MODEL_PLACEHOLDER_') || raw.startsWith('MODEL_OPENAI_')) {
    return ANTIGRAVITY_MODEL_MAP[raw] || 'AG-' + raw;
  }
  // If it's already a known name but from Antigravity, prefix it
  if (!raw.startsWith('AG-')) return 'AG-' + raw;
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
async function ensureSession(sessionId: string | undefined, userId: number, model?: string, cwd?: string) {
  if (!sessionId) return;
  const existing = await getSessionById(sessionId);
  if (!existing) {
    try {
      await createSession({ id: sessionId, userId, model: model || 'sonnet', cwd });
    } catch {}
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const hookRouter: RouterType = Router();

// ---------------------------------------------------------------------------
// POST /session-start
// ---------------------------------------------------------------------------

hookRouter.post('/session-start', async (req: Request, res: Response) => {
  debug(`──── /session-start ────`);
  try {
    const user = req.user!;
    const body = req.body;
    debug(`user: id=${user.id}, name=${user.name}, status=${user.status}, email=${user.email || '(none)'}, default_model=${user.defaultModel || '(none)'}`);
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
      await recordHookEvent({
        userId: user.id,
        sessionId: data.session_id,
        eventType: 'SessionStart',
        payload: JSON.stringify(body),
      });
      await touchUserLastEvent(user.id);
      const resp = { continue: false, stopReason: 'Account suspended by admin. Contact your team lead.' };
      debug(`responding: ${JSON.stringify(resp)}`);
      res.json(resp);
      return;
    }

    if (user.status === 'paused') {
      debug(`user is PAUSED — blocking session`);
      await recordHookEvent({
        userId: user.id,
        sessionId: data.session_id,
        eventType: 'SessionStart',
        payload: JSON.stringify(body),
      });
      await touchUserLastEvent(user.id);
      const resp = { continue: false, stopReason: 'Account paused by admin. Contact your team lead.' };
      debug(`responding: ${JSON.stringify(resp)}`);
      res.json(resp);
      return;
    }

    // Determine model — from hook JSON, enriched field, or user default
    const model = body.model || body.detected_model || user.defaultModel || 'sonnet';
    debug(`resolved model: "${model}" (body.model=${body.model || '(none)'}, body.detected_model=${body.detected_model || '(none)'}, user.defaultModel=${user.defaultModel || '(none)'})`);

    // Create session
    debug(`creating session: id=${data.session_id}, userId=${user.id}, model=${model}, cwd=${data.cwd || '(none)'}`);
    await createSession({
      id: data.session_id,
      userId: user.id,
      model,
      cwd: data.cwd,
    });
    debug(`session created OK`);

    // ── Collect ALL enriched data from client ──
    const userUpdates: Partial<{
      email: string;
      defaultModel: string;
    }> = {};

    // Update user email from subscription if we don't have it
    if (body.subscription_email && (!user.email || user.email === '')) {
      userUpdates.email = body.subscription_email;
      debug(`will update user email to "${body.subscription_email}"`);
    }

    // Update default model based on what client detected
    if (body.detected_model && body.detected_model !== user.defaultModel) {
      userUpdates.defaultModel = body.detected_model;
      debug(`will update user defaultModel to "${body.detected_model}"`);
    }

    // Apply user updates if any
    if (Object.keys(userUpdates).length > 0) {
      debug(`updating user: ${JSON.stringify(userUpdates)}`);
      try { await updateUser(user.id, userUpdates); debug(`user updated OK`); } catch (e: any) { debug(`user update FAILED: ${e.message}`); }
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
        const sub = await createSubscription({
          email: body.subscription_email || user.email || '',
          subscriptionType: finalSubType,
          planName: body.org_name || undefined,
        });
        debug(`subscription result: ${sub ? `id=${sub.id}` : '(null)'}`);
        if (sub && !user.subscriptionId) {
          await updateUser(user.id, { subscriptionId: sub.id });
          debug(`linked subscription ${sub.id} to user`);
        }
      } catch (e: any) { debug(`subscription FAILED: ${e.message}`); }
    }

    // Update last_event_at
    await touchUserLastEvent(user.id);

    // Record full hook event (includes all device info, subscription, etc.)
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

hookRouter.post('/prompt', async (req: Request, res: Response) => {
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
        await recordPrompt({
          sessionId: data.session_id,
          userId: user.id,
          prompt: data.prompt,
          model: user.defaultModel ?? undefined,
          creditCost: 0,
          blocked: true,
          blockReason: 'Account suspended.',
        });
        debug(`blocked prompt recorded`);
      } catch (e: any) { debug(`recording blocked prompt FAILED (expected if no session): ${e.message}`); }
      try {
        await recordHookEvent({
          userId: user.id,
          sessionId: data.session_id,
          eventType: 'UserPromptSubmit',
          payload: JSON.stringify(body),
        });
      } catch (e: any) { debug(`recording hook event FAILED: ${e.message}`); }
      await touchUserLastEvent(user.id);
      const resp = { decision: 'block', reason: 'Account suspended.' };
      debug(`responding: ${JSON.stringify(resp)}`);
      res.json(resp);
      return;
    }

    // Ensure session exists (auto-create if SessionStart was missed or failed)
    debug(`ensuring session exists: session_id=${data.session_id}`);
    await ensureSession(data.session_id, user.id, user.defaultModel ?? undefined, data.cwd);
    const session = await getSessionById(data.session_id);
    debug(`session lookup: ${session ? `found (model=${session.model})` : 'NOT FOUND (even after ensureSession!)'}`);
    // Prefer body.model (fresh from client) > session.model > user.defaultModel
    const model = body.model || session?.model || user.defaultModel || 'sonnet';
    debug(`resolved model: "${model}" (body.model=${body.model || '(none)'}, session.model=${session?.model || '(none)'})`);

    // Update session model if the client reports a different one (user ran /model)
    if (body.model && session && body.model !== session.model) {
      debug(`model changed mid-session: "${session.model}" → "${body.model}" — updating session`);
      await updateSessionModel(data.session_id, body.model);
    }

    // Compute credit cost from DB
    const creditCost = await getCreditCostFromDb(model, 'claude_code');
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
      await recordPrompt({
        sessionId: data.session_id,
        userId: user.id,
        prompt: data.prompt,
        model,
        creditCost: 0,
        blocked: true,
        blockReason,
      });
      await recordHookEvent({
        userId: user.id,
        sessionId: data.session_id,
        eventType: 'UserPromptSubmit',
        payload: JSON.stringify(body),
      });
      await touchUserLastEvent(user.id);
      broadcast({ type: 'prompt', user_id: user.id, user_name: user.name, prompt: data.prompt?.slice(0, 100), blocked: true });
      const resp = { decision: 'block', reason: blockReason };
      debug(`responding: ${JSON.stringify(resp)}`);
      res.json(resp);
      return;
    }

    // Record prompt (allowed)
    debug(`prompt ALLOWED — recording with credit_cost=${creditCost}`);
    await recordPrompt({
      sessionId: data.session_id,
      userId: user.id,
      prompt: data.prompt,
      model,
      creditCost,
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

hookRouter.post('/pre-tool', async (req: Request, res: Response) => {
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
      await recordHookEvent({
        userId: user.id,
        sessionId: data.session_id,
        eventType: 'PreToolUse',
        payload: JSON.stringify(body),
      });
      await touchUserLastEvent(user.id);
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
    await recordToolEvent({
      userId: user.id,
      sessionId: data.session_id,
      toolName: data.tool_name ?? 'unknown',
      toolInput: JSON.stringify(data.tool_input)?.slice(0, 500),
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

hookRouter.post('/stop', async (req: Request, res: Response) => {
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
    await ensureSession(data.session_id, user.id, user.defaultModel ?? undefined);
    const session = await getSessionById(data.session_id);
    debug(`session lookup: ${session ? `found (model=${session.model})` : 'NOT FOUND'}`);
    const model = session?.model ?? user.defaultModel ?? 'sonnet';

    // Update model on the most recent prompt (don't store response text)
    debug(`updating last prompt model (model=${model})`);
    await updateLastPromptModel(data.session_id, model);

    // Update last_event_at
    await touchUserLastEvent(user.id);

    // Record hook event
    await recordHookEvent({
      userId: user.id,
      sessionId: data.session_id,
      eventType: 'Stop',
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

hookRouter.post('/stop-error', async (req: Request, res: Response) => {
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
    await recordHookEvent({
      userId: user.id,
      sessionId: data.session_id,
      eventType: 'StopFailure',
      payload: JSON.stringify({
        error: data.error,
        error_details: data.error_details,
        ...body,
      }),
    });

    // Update last_event_at
    await touchUserLastEvent(user.id);

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

hookRouter.post('/session-end', async (req: Request, res: Response) => {
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
    await endSession(data.session_id, data.reason ?? 'unknown');

    // Queue AI analysis for the completed session
    queueSessionAnalysis(data.session_id, user.id);

    // Update last_event_at
    await touchUserLastEvent(user.id);

    // Record hook event
    await recordHookEvent({
      userId: user.id,
      sessionId: data.session_id,
      eventType: 'SessionEnd',
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

hookRouter.post('/post-tool', async (req: Request, res: Response) => {
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
    await recordToolEvent({
      userId: user.id,
      sessionId: data.session_id,
      toolName: data.tool_name ?? 'unknown',
      toolInput: JSON.stringify(data.tool_input)?.slice(0, 500),
      toolOutput: JSON.stringify(data.tool_response)?.slice(0, 500),
      success: true,
    });

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
    console.error('[hook-api] post-tool error:', err);
    res.json({});
  }
});

// ---------------------------------------------------------------------------
// POST /subagent-start
// ---------------------------------------------------------------------------

hookRouter.post('/subagent-start', async (req: Request, res: Response) => {
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
    await recordSubagentEvent({
      userId: user.id,
      sessionId: data.session_id,
      agentId: data.agent_id,
      agentType: data.agent_type,
    });

    // Update last_event_at
    await touchUserLastEvent(user.id);

    // Record hook event
    await recordHookEvent({
      userId: user.id,
      sessionId: data.session_id,
      eventType: 'SubagentStart',
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

hookRouter.post('/post-tool-failure', async (req: Request, res: Response) => {
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
    await recordToolEvent({
      userId: user.id,
      sessionId: data.session_id,
      toolName: data.tool_name ?? 'unknown',
      toolOutput: (data.error ?? '').slice(0, 500),
      success: false,
    });

    // Update last_event_at
    await touchUserLastEvent(user.id);

    // Record hook event
    await recordHookEvent({
      userId: user.id,
      sessionId: data.session_id,
      eventType: 'PostToolUseFailure',
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

hookRouter.post('/config-change', async (req: Request, res: Response) => {
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
    await recordHookEvent({
      userId: user.id,
      sessionId: data.session_id,
      eventType: 'ConfigChange',
      payload: JSON.stringify(body),
    });

    debug(`config change recorded (source=${data.source}, file=${data.file_path})`);

    // Update last_event_at
    await touchUserLastEvent(user.id);

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

hookRouter.post('/file-changed', async (req: Request, res: Response) => {
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
    await recordHookEvent({
      userId: user.id,
      sessionId: data.session_id,
      eventType: 'FileChanged',
      payload: JSON.stringify(body),
    });

    debug(`file change recorded (file=${data.file_path}, event=${data.event})`);

    // Update last_event_at
    await touchUserLastEvent(user.id);

    debug(`responding: {} (OK)`);
    res.json({});
  } catch (err: any) {
    debug(`ERROR: ${err.stack || err.message}`);
    console.error('[hook-api] file-changed error:', err);
    res.json({});
  }
});

// ---------------------------------------------------------------------------
// POST /cwd-changed
// ---------------------------------------------------------------------------

hookRouter.post('/cwd-changed', async (req: Request, res: Response) => {
  debug(`──── /cwd-changed ────`);
  try {
    const user = req.user!;
    const body = req.body;
    debug(`user: id=${user.id}, name=${user.name}`);
    debug(`body.cwd=${body.cwd || '(none)'}, body.previous_cwd=${body.previous_cwd || '(none)'}`);

    const parsed = CwdChangedEvent.safeParse(body);
    debug(`zod parse: ${parsed.success ? 'OK' : 'FAILED'}`);
    const data = parsed.success ? parsed.data : body;

    await touchUserLastEvent(user.id);
    await recordHookEvent({
      userId: user.id,
      sessionId: data.session_id,
      eventType: 'CwdChanged',
      payload: JSON.stringify(body),
      source: 'claude_code',
    });

    // Update session cwd if we have a session
    if (data.session_id && data.cwd) {
      try {
        const { updateSessionCwd } = await import('../db/queries/sessions.js');
        await updateSessionCwd(data.session_id, data.cwd);
        debug(`updated session cwd to "${data.cwd}"`);
      } catch (e: any) {
        debug(`failed to update session cwd: ${e.message}`);
      }
    }

    debug(`responding: {} (OK)`);
    res.json({});
  } catch (err: any) {
    debug(`ERROR: ${err.stack || err.message}`);
    console.error('[hook-api] cwd-changed error:', err);
    res.json({});
  }
});

// ---------------------------------------------------------------------------
// POST /antigravity-sync
// ---------------------------------------------------------------------------

hookRouter.post('/antigravity-sync', async (req: Request, res: Response) => {
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

    // Use dynamic map for this request — always ensure AG- prefix
    const resolveModel = (raw: string | undefined): string => {
      if (!raw) return 'AG-Unknown';
      // Check client-provided mapping first
      const mapped = dynamicMap[raw] || ANTIGRAVITY_MODEL_MAP[raw] || raw;
      // Ensure AG- prefix
      if (!mapped.startsWith('AG-')) return 'AG-' + mapped;
      return mapped;
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
      await upsertAntigravitySession({
        id: cascadeId,
        userId: user.id,
        model,
        cwd,
        promptCount: conv.step_count,
        title: conv.title,
      });

      // Process messages (with dedup — skip if prompt already exists for this session)
      for (const msg of conv.messages || []) {
        if (msg.role === 'user' && msg.content) {
          const exists = await promptExistsForSession(cascadeId, msg.content);
          if (!exists) {
            await recordPrompt({
              sessionId: cascadeId,
              userId: user.id,
              prompt: msg.content,
              model: (msg.model && resolveModel(msg.model) !== 'AG-Unknown') ? resolveModel(msg.model) : model || 'AG-Unknown',
              creditCost: 0,
              source: 'antigravity',
            });
          }
        } else if (msg.role === 'tool' && msg.tool_name) {
          await recordToolEvent({
            userId: user.id,
            sessionId: cascadeId,
            toolName: msg.tool_name,
            toolInput: msg.content?.slice(0, 500),
          });
        }
      }

      synced++;
    }

    await touchUserLastEvent(user.id);
    debug(`synced ${synced} conversations`);
    res.json({ ok: true, synced });
  } catch (err: any) {
    debug(`ERROR: ${err.stack || err.message}`);
    console.error('[hook-api] antigravity-sync error:', err);
    res.json({ ok: false, synced: 0 });
  }
});
