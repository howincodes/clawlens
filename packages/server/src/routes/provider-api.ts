import { Router } from 'express';
import type { Request, Response, Router as RouterType } from 'express';
import { getAdapter } from '../providers/registry.js';
import { processSessionStart, processPrompt, processStop } from '../providers/pipeline.js';
import { endSession } from '../db/queries/sessions.js';
import { recordHookEvent } from '../db/queries/events.js';
import { recordMessage, messageExistsForSession } from '../db/queries/messages.js';
import { touchUserLastEvent } from '../db/queries/users.js';
import { upsertAntigravitySession, updateSessionCwd } from '../db/queries/sessions.js';
import { queueSessionAnalysis } from '../services/ai-jobs.js';
import { recordToolEvent } from '../db/queries/events.js';

// ---------------------------------------------------------------------------
// Debug
// ---------------------------------------------------------------------------

const DEBUG = process.env.HOWINLENS_DEBUG === '1' || process.env.HOWINLENS_DEBUG === 'true';
function debug(msg: string): void {
  if (DEBUG) console.log(`[provider-api] ${msg}`);
}

// ---------------------------------------------------------------------------
// Antigravity model mapping (CC-specific)
// ---------------------------------------------------------------------------

const ANTIGRAVITY_MODEL_MAP: Record<string, string> = {
  MODEL_PLACEHOLDER_M37: 'AG-Gemini 3.1 Pro',
  MODEL_PLACEHOLDER_M36: 'AG-Gemini 3.1 Pro (Low)',
  MODEL_PLACEHOLDER_M47: 'AG-Gemini 3 Flash',
  MODEL_PLACEHOLDER_M35: 'AG-Sonnet',
  MODEL_PLACEHOLDER_M26: 'AG-Opus',
  MODEL_PLACEHOLDER_M25: 'AG-Gemini 2.5 Flash',
  MODEL_OPENAI_GPT_OSS_120B_MEDIUM: 'AG-GPT-OSS',
};

function resolveAntigravityModel(raw: string | undefined, dynamicMap: Record<string, string>): string {
  if (!raw) return 'AG-Unknown';
  const mapped = dynamicMap[raw] || ANTIGRAVITY_MODEL_MAP[raw] || raw;
  if (!mapped.startsWith('AG-')) return 'AG-' + mapped;
  return mapped;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const providerRouter: RouterType = Router({ mergeParams: true });

// Middleware: resolve provider adapter from :provider param or _providerSlug fallback
providerRouter.use((req: Request, res: Response, next) => {
  const slug = (req.params.provider as string) || (req as any)._providerSlug as string;
  if (!slug) {
    res.status(400).json({ error: 'Provider slug required' });
    return;
  }
  const adapter = getAdapter(slug);
  if (!adapter) {
    res.status(404).json({ error: `Unknown provider: ${slug}` });
    return;
  }
  req.providerAdapter = adapter;
  next();
});

// ---------------------------------------------------------------------------
// HIGH-VALUE ENDPOINTS — full pipeline processing
// ---------------------------------------------------------------------------

// POST /session-start
providerRouter.post('/session-start', async (req: Request, res: Response) => {
  try {
    const result = await processSessionStart(req.providerAdapter!, req.user!, req.body);
    res.json(result);
  } catch (err: any) {
    console.error(`[provider-api] session-start error:`, err);
    res.json(req.providerAdapter!.formatSessionAllow());
  }
});

// POST /prompt
providerRouter.post('/prompt', async (req: Request, res: Response) => {
  try {
    const result = await processPrompt(req.providerAdapter!, req.user!, req.body);
    res.json(result);
  } catch (err: any) {
    console.error(`[provider-api] prompt error:`, err);
    res.json(req.providerAdapter!.formatPromptAllow());
  }
});

// POST /stop
providerRouter.post('/stop', async (req: Request, res: Response) => {
  try {
    const result = await processStop(req.providerAdapter!, req.user!, req.body);
    res.json(result);
  } catch (err: any) {
    console.error(`[provider-api] stop error:`, err);
    res.json({});
  }
});

// POST /session-end (CC-only meaningful, others just ack)
providerRouter.post('/session-end', async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const slug = req.providerAdapter!.slug;
    const sessionId = req.body.session_id;
    const reason = req.body.reason ?? 'unknown';

    await endSession(sessionId, reason);
    queueSessionAnalysis(sessionId, user.id);
    await touchUserLastEvent(user.id);
    await recordHookEvent({ userId: user.id, sessionId, eventType: 'SessionEnd', payload: JSON.stringify(req.body), source: slug });

    res.json({});
  } catch (err: any) {
    console.error(`[provider-api] session-end error:`, err);
    res.json({});
  }
});

// POST /config-change (CC-only, tamper detection)
providerRouter.post('/config-change', async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const slug = req.providerAdapter!.slug;
    await recordHookEvent({ userId: user.id, sessionId: req.body.session_id, eventType: 'ConfigChange', payload: JSON.stringify(req.body), source: slug });
    await touchUserLastEvent(user.id);
    res.json({});
  } catch (err: any) {
    console.error(`[provider-api] config-change error:`, err);
    res.json({});
  }
});

// ---------------------------------------------------------------------------
// PASSTHROUGH ENDPOINTS — just return {}
// JSONL watcher is the source of truth for tool/conversation data
// ---------------------------------------------------------------------------

const passthroughHandler = async (_req: Request, res: Response) => {
  res.json({});
};

providerRouter.post('/pre-tool', passthroughHandler);
providerRouter.post('/pre-tool-use', passthroughHandler);
providerRouter.post('/post-tool', passthroughHandler);
providerRouter.post('/post-tool-use', passthroughHandler);
providerRouter.post('/stop-error', passthroughHandler);
providerRouter.post('/subagent-start', passthroughHandler);
providerRouter.post('/post-tool-failure', passthroughHandler);
providerRouter.post('/file-changed', passthroughHandler);

// POST /cwd-changed — passthrough but optionally update session cwd
providerRouter.post('/cwd-changed', async (req: Request, res: Response) => {
  try {
    const sessionId = req.body.session_id;
    const cwd = req.body.cwd;
    if (sessionId && cwd) {
      await updateSessionCwd(sessionId, cwd);
    }
    await touchUserLastEvent(req.user!.id);
    res.json({});
  } catch {
    res.json({});
  }
});

// ---------------------------------------------------------------------------
// PROVIDER-SPECIFIC ENDPOINTS
// ---------------------------------------------------------------------------

// POST /antigravity-sync (CC provider only — batch sync from Antigravity)
providerRouter.post('/antigravity-sync', async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { conversations, model_mapping } = req.body;
    debug(`antigravity-sync: user=${user.name}, conversations=${conversations?.length || 0}`);

    const dynamicMap: Record<string, string> = { ...ANTIGRAVITY_MODEL_MAP };
    if (model_mapping && typeof model_mapping === 'object') {
      Object.assign(dynamicMap, model_mapping);
    }

    if (!Array.isArray(conversations)) {
      res.json({ ok: true, synced: 0 });
      return;
    }

    let synced = 0;

    for (const conv of conversations) {
      const cascadeId = conv.cascade_id;
      if (!cascadeId) continue;

      let cwd: string | undefined;
      if (Array.isArray(conv.workspaces) && conv.workspaces.length > 0) {
        cwd = String(conv.workspaces[0]).replace('file://', '');
      }

      let model: string | undefined;
      for (const msg of conv.messages || []) {
        if (msg.role === 'assistant' && msg.model) {
          model = resolveAntigravityModel(String(msg.model), dynamicMap);
          break;
        }
      }

      await upsertAntigravitySession({
        id: cascadeId,
        userId: user.id,
        model,
        cwd,
        promptCount: conv.step_count,
        title: conv.title,
      });

      for (const msg of conv.messages || []) {
        if (msg.role === 'user' && msg.content) {
          const exists = await messageExistsForSession(cascadeId, msg.content);
          if (!exists) {
            await recordMessage({
              provider: 'antigravity',
              sessionId: cascadeId,
              userId: user.id,
              type: 'user',
              content: msg.content,
              model: (msg.model && resolveAntigravityModel(msg.model, dynamicMap) !== 'AG-Unknown')
                ? resolveAntigravityModel(msg.model, dynamicMap)
                : model || 'AG-Unknown',
              creditCost: 0,
              sourceType: 'extension',
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
    res.json({ ok: true, synced });
  } catch (err: any) {
    console.error('[provider-api] antigravity-sync error:', err);
    res.json({ ok: false, synced: 0 });
  }
});
