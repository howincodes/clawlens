import type { ProviderAdapter, UserRow } from './types.js';
import {
  createSession,
  getSessionById,
  incrementSessionPromptCount,
  updateSessionModel,
} from '../db/queries/sessions.js';
import { recordMessage } from '../db/queries/messages.js';
import { recordHookEvent } from '../db/queries/events.js';
import { touchUserLastEvent, updateUser, getUserCreditUsage, getUserModelCreditUsage } from '../db/queries/users.js';
import { getLimitsByUser } from '../db/queries/limits.js';
import { getCreditCostFromDb } from '../db/queries/model-credits.js';
import { createSubscription } from '../db/queries/subscriptions.js';
import { broadcast } from '../services/websocket.js';

// ---------------------------------------------------------------------------
// Debug logging
// ---------------------------------------------------------------------------

const DEBUG = process.env.HOWINLENS_DEBUG === '1' || process.env.HOWINLENS_DEBUG === 'true';

function debug(provider: string, msg: string): void {
  if (DEBUG) console.log(`[pipeline:${provider}] ${msg}`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function ensureSession(sessionId: string | undefined, userId: number, source: string, model?: string, cwd?: string) {
  if (!sessionId) return;
  const existing = await getSessionById(sessionId);
  if (!existing) {
    try {
      await createSession({ id: sessionId, userId, model: model || 'sonnet', cwd, source });
    } catch { /* ignore dup key */ }
  }
}

// ---------------------------------------------------------------------------
// processSessionStart
// ---------------------------------------------------------------------------

export async function processSessionStart(
  adapter: ProviderAdapter,
  user: UserRow,
  rawBody: unknown,
): Promise<object> {
  const body = rawBody as Record<string, unknown>;
  const slug = adapter.slug;
  debug(slug, `session-start: user=${user.name}`);

  // Check user status
  if (user.status === 'killed') {
    await recordHookEvent({ userId: user.id, sessionId: body.session_id as string, eventType: 'SessionStart', payload: JSON.stringify(body), source: slug });
    await touchUserLastEvent(user.id);
    return adapter.formatSessionKill();
  }
  if (user.status === 'paused') {
    await recordHookEvent({ userId: user.id, sessionId: body.session_id as string, eventType: 'SessionStart', payload: JSON.stringify(body), source: slug });
    await touchUserLastEvent(user.id);
    return adapter.formatSessionPause();
  }

  const data = adapter.normalizeSessionStart(rawBody);
  const model = data.model || user.defaultModel || adapter.defaultModel;

  // Create session
  await createSession({
    id: data.sessionId,
    userId: user.id,
    model,
    cwd: data.cwd,
    source: slug,
    cliVersion: data.cliVersion,
    modelProvider: data.modelProvider,
    reasoningEffort: data.reasoningEffort,
  });

  // User updates (email, model)
  const userUpdates: Partial<{ email: string; defaultModel: string }> = {};
  if (data.subscriptionEmail && (!user.email || user.email === '')) {
    userUpdates.email = data.subscriptionEmail;
  }
  if (body.detected_model && body.detected_model !== user.defaultModel) {
    userUpdates.defaultModel = body.detected_model as string;
  }
  if (Object.keys(userUpdates).length > 0) {
    try { await updateUser(user.id, userUpdates); } catch {}
  }

  // Handle subscription
  if (data.subscriptionEmail || data.subscriptionType) {
    let subType = adapter.normalizeSubscriptionType(data.subscriptionType);
    // Cross-check: opus model but pro plan → likely Max
    if (subType === 'pro' && model && model.toLowerCase().includes('opus')) {
      subType = 'max';
    }
    try {
      const sub = await createSubscription({
        email: data.subscriptionEmail || user.email || '',
        subscriptionType: subType,
        planName: data.orgName,
        source: slug,
        accountId: data.accountId,
        orgId: data.orgId,
        authProvider: data.authProvider,
        subscriptionActiveStart: data.subscriptionActiveStart,
        subscriptionActiveUntil: data.subscriptionActiveUntil,
      });
      if (sub && !user.subscriptionId) {
        await updateUser(user.id, { subscriptionId: sub.id });
      }
    } catch {}
  }

  await touchUserLastEvent(user.id);
  await recordHookEvent({ userId: user.id, sessionId: data.sessionId, eventType: 'SessionStart', payload: JSON.stringify(body), source: slug });
  broadcast({ type: 'session_start', user_id: user.id, user_name: user.name, model, source: slug });

  return adapter.formatSessionAllow();
}

// ---------------------------------------------------------------------------
// processPrompt
// ---------------------------------------------------------------------------

export async function processPrompt(
  adapter: ProviderAdapter,
  user: UserRow,
  rawBody: unknown,
): Promise<object> {
  const body = rawBody as Record<string, unknown>;
  const slug = adapter.slug;
  debug(slug, `prompt: user=${user.name}`);

  // Check user status
  if (user.status === 'killed' || user.status === 'paused') {
    try {
      await recordMessage({
        provider: slug,
        sessionId: body.session_id as string,
        userId: user.id,
        type: 'user',
        content: body.prompt as string,
        model: user.defaultModel ?? undefined,
        creditCost: 0,
        blocked: true,
        blockReason: 'Account suspended.',
        sourceType: 'hook',
      });
    } catch {}
    try {
      await recordHookEvent({ userId: user.id, sessionId: body.session_id as string, eventType: 'UserPromptSubmit', payload: JSON.stringify(body), source: slug });
    } catch {}
    await touchUserLastEvent(user.id);
    return user.status === 'killed' ? adapter.formatPromptKill() : adapter.formatPromptBlock('Account suspended.');
  }

  const data = adapter.normalizePrompt(rawBody);

  // Ensure session exists
  await ensureSession(data.sessionId, user.id, slug, user.defaultModel ?? undefined, data.cwd);
  const session = await getSessionById(data.sessionId);
  const model = data.model || session?.model || user.defaultModel || adapter.defaultModel;

  // Update session model if changed mid-session
  if (data.model && session && data.model !== session.model) {
    await updateSessionModel(data.sessionId, data.model);
  }

  // Credit cost
  const creditCost = await getCreditCostFromDb(model, slug);

  // Check credit limits
  const limits = await getLimitsByUser(user.id);
  let blocked = false;
  let blockReason = '';

  for (const limit of limits) {
    if (limit.type === 'total_credits') {
      const window = limit.window as 'daily' | 'hourly' | 'monthly';
      const usage = await getUserCreditUsage(user.id, window);
      if (usage + creditCost > limit.value) {
        blocked = true;
        blockReason = `Credit limit reached. ${window} usage: ${usage}/${limit.value}`;
        break;
      }
    } else if (limit.type === 'per_model') {
      if (!limit.model) continue;
      const window = limit.window as 'daily' | 'hourly' | 'monthly';
      const usage = await getUserModelCreditUsage(user.id, limit.model, window);
      if (usage + creditCost > limit.value) {
        blocked = true;
        blockReason = `Credit limit reached. ${limit.model} ${window} usage: ${usage}/${limit.value}`;
        break;
      }
    } else if (limit.type === 'time_of_day') {
      const currentHour = new Date().getHours();
      const startHour = limit.startHour ?? 0;
      const endHour = limit.endHour ?? 24;
      if (currentHour >= startHour && currentHour < endHour) {
        blocked = true;
        blockReason = `Usage blocked during hours ${startHour}-${endHour}.`;
        break;
      }
    }
  }

  if (blocked) {
    await recordMessage({
      provider: slug,
      sessionId: data.sessionId,
      userId: user.id,
      type: 'user',
      content: data.prompt,
      model,
      creditCost: 0,
      blocked: true,
      blockReason,
      sourceType: 'hook',
      turnId: data.turnId,
    });
    await recordHookEvent({ userId: user.id, sessionId: data.sessionId, eventType: 'UserPromptSubmit', payload: JSON.stringify(body), source: slug });
    await touchUserLastEvent(user.id);
    broadcast({ type: 'prompt', user_id: user.id, user_name: user.name, prompt: data.prompt?.slice(0, 100), blocked: true, source: slug });
    return adapter.formatPromptBlock(blockReason);
  }

  // Record allowed prompt
  await recordMessage({
    provider: slug,
    sessionId: data.sessionId,
    userId: user.id,
    type: 'user',
    content: data.prompt,
    model,
    creditCost,
    sourceType: 'hook',
    turnId: data.turnId,
  });

  await incrementSessionPromptCount(data.sessionId, creditCost);
  await touchUserLastEvent(user.id);
  await recordHookEvent({ userId: user.id, sessionId: data.sessionId, eventType: 'UserPromptSubmit', payload: JSON.stringify(body), source: slug });
  broadcast({ type: 'prompt', user_id: user.id, user_name: user.name, prompt: data.prompt?.slice(0, 100), blocked: false, source: slug });

  return adapter.formatPromptAllow();
}

// ---------------------------------------------------------------------------
// processStop
// ---------------------------------------------------------------------------

export async function processStop(
  adapter: ProviderAdapter,
  user: UserRow,
  rawBody: unknown,
): Promise<object> {
  const body = rawBody as Record<string, unknown>;
  const slug = adapter.slug;
  debug(slug, `stop: user=${user.name}`);

  const data = adapter.normalizeStop(rawBody);

  await ensureSession(data.sessionId, user.id, slug, user.defaultModel ?? undefined);
  const session = await getSessionById(data.sessionId);
  const model = data.model || session?.model || user.defaultModel || adapter.defaultModel;

  // Attach resolved model for adapter use
  data.model = model;

  // Provider-specific stop handling
  if (adapter.onStop) {
    await adapter.onStop(data, user.id);
  }

  await touchUserLastEvent(user.id);
  await recordHookEvent({ userId: user.id, sessionId: data.sessionId, eventType: 'Stop', payload: JSON.stringify(body), source: slug });
  broadcast({ type: 'stop', user_id: user.id, user_name: user.name, model, source: slug });

  return {};
}
