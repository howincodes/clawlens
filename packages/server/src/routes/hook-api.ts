import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  createSession,
  recordPrompt,
  recordHookEvent,
  recordToolEvent,
  recordSubagentEvent,
  touchUserLastEvent,
  createTamperAlert,
  getUserCreditUsage,
  getUserModelCreditUsage,
  getSessionById,
  incrementSessionPromptCount,
  endSession,
  getLimitsByUser,
  getDb,
  type LimitRow,
} from '../services/db.js';
import { autoResolveInactiveAlerts } from '../services/tamper.js';
import { broadcast } from '../services/websocket.js';
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
// Helpers
// ---------------------------------------------------------------------------

function getCreditCost(model: string | undefined): number {
  if (!model) return 3; // default to sonnet cost
  const m = model.toLowerCase();
  if (m.includes('opus')) return 10;
  if (m.includes('haiku')) return 1;
  return 3; // sonnet and everything else
}

function getWindowStart(window: string): string {
  const now = new Date();
  if (window === 'hourly') {
    now.setMinutes(0, 0, 0);
  } else if (window === 'daily') {
    now.setHours(0, 0, 0, 0);
  } else if (window === 'monthly') {
    now.setDate(1);
    now.setHours(0, 0, 0, 0);
  }
  return now.toISOString();
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const hookRouter = Router();

// ---------------------------------------------------------------------------
// POST /session-start
// ---------------------------------------------------------------------------

hookRouter.post('/session-start', (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const body = req.body;
    const parsed = SessionStartEvent.safeParse(body);
    const data = parsed.success ? parsed.data : body;

    // Check user status
    if (user.status === 'killed') {
      recordHookEvent({
        user_id: user.id,
        session_id: data.session_id,
        event_type: 'SessionStart',
        payload: JSON.stringify(body),
      });
      touchUserLastEvent(user.id);
    autoResolveInactiveAlerts(user.id);
      res.json({
        continue: false,
        stopReason: 'Account suspended by admin. Contact your team lead.',
      });
      return;
    }

    if (user.status === 'paused') {
      recordHookEvent({
        user_id: user.id,
        session_id: data.session_id,
        event_type: 'SessionStart',
        payload: JSON.stringify(body),
      });
      touchUserLastEvent(user.id);
    autoResolveInactiveAlerts(user.id);
      res.json({
        continue: false,
        stopReason: 'Account paused by admin. Contact your team lead.',
      });
      return;
    }

    // Create session
    createSession({
      id: data.session_id,
      user_id: user.id,
      model: data.model,
      cwd: data.cwd,
    });

    // Update last_event_at
    touchUserLastEvent(user.id);
    autoResolveInactiveAlerts(user.id);

    // Record hook event
    recordHookEvent({
      user_id: user.id,
      session_id: data.session_id,
      event_type: 'SessionStart',
      payload: JSON.stringify(body),
    });

    broadcast({ type: 'session_start', user_id: user.id, user_name: user.name, model: data.model });

    res.json({});
  } catch (err) {
    console.error('[hook-api] session-start error:', err);
    res.json({});
  }
});

// ---------------------------------------------------------------------------
// POST /prompt
// ---------------------------------------------------------------------------

hookRouter.post('/prompt', (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const body = req.body;
    const parsed = UserPromptSubmitEvent.safeParse(body);
    const data = parsed.success ? parsed.data : body;

    // Check user status
    if (user.status === 'killed' || user.status === 'paused') {
      recordPrompt({
        session_id: data.session_id,
        user_id: user.id,
        prompt: data.prompt,
        model: user.default_model ?? undefined,
        credit_cost: 0,
        blocked: true,
        block_reason: 'Account suspended.',
      });
      recordHookEvent({
        user_id: user.id,
        session_id: data.session_id,
        event_type: 'UserPromptSubmit',
        payload: JSON.stringify(body),
      });
      touchUserLastEvent(user.id);
    autoResolveInactiveAlerts(user.id);
      res.json({ decision: 'block', reason: 'Account suspended.' });
      return;
    }

    // Determine model
    const session = getSessionById(data.session_id);
    const model = session?.model ?? user.default_model ?? 'sonnet';

    // Compute credit cost
    const creditCost = getCreditCost(model);

    // Check credit limits
    const limits = getLimitsByUser(user.id);
    let blocked = false;
    let blockReason = '';

    for (const limit of limits) {
      if (limit.type === 'total_credits') {
        const window = limit.window as 'daily' | 'hourly' | 'monthly';
        const usage = getUserCreditUsage(user.id, window);
        if (usage + creditCost > limit.value) {
          blocked = true;
          blockReason = `Credit limit reached. ${window} usage: ${usage}/${limit.value}`;
          break;
        }
      } else if (limit.type === 'per_model') {
        const window = limit.window as 'daily' | 'hourly' | 'monthly';
        const limitModel = limit.model ?? model;
        const usage = getUserModelCreditUsage(user.id, limitModel, window);
        if (usage + creditCost > limit.value) {
          blocked = true;
          blockReason = `Credit limit reached. ${limitModel} ${window} usage: ${usage}/${limit.value}`;
          break;
        }
      } else if (limit.type === 'time_of_day') {
        const currentHour = new Date().getHours();
        const startHour = limit.start_hour ?? 0;
        const endHour = limit.end_hour ?? 24;
        if (currentHour >= startHour && currentHour < endHour) {
          blocked = true;
          blockReason = `Usage blocked during hours ${startHour}-${endHour}.`;
          break;
        }
      }
    }

    if (blocked) {
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
    autoResolveInactiveAlerts(user.id);
      broadcast({ type: 'prompt', user_id: user.id, user_name: user.name, prompt: data.prompt?.slice(0, 100), blocked: true });
      res.json({ decision: 'block', reason: blockReason });
      return;
    }

    // Record prompt (allowed)
    recordPrompt({
      session_id: data.session_id,
      user_id: user.id,
      prompt: data.prompt,
      model,
      credit_cost: creditCost,
    });

    // Update last_event_at
    touchUserLastEvent(user.id);
    autoResolveInactiveAlerts(user.id);

    // Record hook event
    recordHookEvent({
      user_id: user.id,
      session_id: data.session_id,
      event_type: 'UserPromptSubmit',
      payload: JSON.stringify(body),
    });

    broadcast({ type: 'prompt', user_id: user.id, user_name: user.name, prompt: data.prompt?.slice(0, 100), blocked: false });

    res.json({});
  } catch (err) {
    console.error('[hook-api] prompt error:', err);
    res.json({});
  }
});

// ---------------------------------------------------------------------------
// POST /pre-tool
// ---------------------------------------------------------------------------

hookRouter.post('/pre-tool', (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const body = req.body;
    const parsed = PreToolUseEvent.safeParse(body);
    const data = parsed.success ? parsed.data : body;

    // Check user status
    if (user.status === 'killed' || user.status === 'paused') {
      recordHookEvent({
        user_id: user.id,
        session_id: data.session_id,
        event_type: 'PreToolUse',
        payload: JSON.stringify(body),
      });
      touchUserLastEvent(user.id);
    autoResolveInactiveAlerts(user.id);
      res.json({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: 'Account suspended.',
        },
      });
      return;
    }

    // Record tool event
    recordToolEvent({
      user_id: user.id,
      session_id: data.session_id,
      tool_name: data.tool_name ?? 'unknown',
      tool_input: JSON.stringify(data.tool_input)?.slice(0, 500),
    });

    // Update last_event_at
    touchUserLastEvent(user.id);
    autoResolveInactiveAlerts(user.id);

    // Record hook event
    recordHookEvent({
      user_id: user.id,
      session_id: data.session_id,
      event_type: 'PreToolUse',
      payload: JSON.stringify(body),
    });

    broadcast({ type: 'tool_use', user_id: user.id, user_name: user.name, tool_name: data.tool_name });

    res.json({});
  } catch (err) {
    console.error('[hook-api] pre-tool error:', err);
    res.json({});
  }
});

// ---------------------------------------------------------------------------
// POST /stop
// ---------------------------------------------------------------------------

hookRouter.post('/stop', (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const body = req.body;
    const parsed = StopEvent.safeParse(body);
    const data = parsed.success ? parsed.data : body;

    // Extract response
    const response = (data.last_assistant_message ?? '').slice(0, 10000);

    // Determine model from session
    const session = getSessionById(data.session_id);
    const model = session?.model ?? user.default_model ?? 'sonnet';

    // Compute credit cost
    const creditCost = getCreditCost(model);

    // Update the most recent unresponded prompt for this session,
    // or create a new entry if none found
    const db = getDb();
    const lastPrompt = db
      .prepare(
        `SELECT id FROM prompts WHERE session_id = ? AND response IS NULL ORDER BY created_at DESC LIMIT 1`,
      )
      .get(data.session_id) as { id: number } | undefined;

    if (lastPrompt) {
      db.prepare(
        `UPDATE prompts SET response = ?, credit_cost = ?, model = ? WHERE id = ?`,
      ).run(response, creditCost, model, lastPrompt.id);
    } else {
      recordPrompt({
        session_id: data.session_id,
        user_id: user.id,
        response,
        model,
        credit_cost: creditCost,
      });
    }

    // Increment session prompt count and credits
    incrementSessionPromptCount(data.session_id, creditCost);

    // Update last_event_at
    touchUserLastEvent(user.id);
    autoResolveInactiveAlerts(user.id);

    // Record hook event
    recordHookEvent({
      user_id: user.id,
      session_id: data.session_id,
      event_type: 'Stop',
      payload: JSON.stringify(body),
    });

    broadcast({ type: 'stop', user_id: user.id, user_name: user.name, model });

    res.json({});
  } catch (err) {
    console.error('[hook-api] stop error:', err);
    res.json({});
  }
});

// ---------------------------------------------------------------------------
// POST /stop-error
// ---------------------------------------------------------------------------

hookRouter.post('/stop-error', (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const body = req.body;
    const parsed = StopFailureEvent.safeParse(body);
    const data = parsed.success ? parsed.data : body;

    // Record hook event with error details
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
    autoResolveInactiveAlerts(user.id);

    res.json({});
  } catch (err) {
    console.error('[hook-api] stop-error error:', err);
    res.json({});
  }
});

// ---------------------------------------------------------------------------
// POST /session-end
// ---------------------------------------------------------------------------

hookRouter.post('/session-end', (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const body = req.body;
    const parsed = SessionEndEvent.safeParse(body);
    const data = parsed.success ? parsed.data : body;

    // End session
    endSession(data.session_id, data.reason ?? 'unknown');

    // Update last_event_at
    touchUserLastEvent(user.id);
    autoResolveInactiveAlerts(user.id);

    // Record hook event
    recordHookEvent({
      user_id: user.id,
      session_id: data.session_id,
      event_type: 'SessionEnd',
      payload: JSON.stringify(body),
    });

    res.json({});
  } catch (err) {
    console.error('[hook-api] session-end error:', err);
    res.json({});
  }
});

// ---------------------------------------------------------------------------
// POST /post-tool
// ---------------------------------------------------------------------------

hookRouter.post('/post-tool', (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const body = req.body;
    const parsed = PostToolUseEvent.safeParse(body);
    const data = parsed.success ? parsed.data : body;

    // Record tool event with success
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
    autoResolveInactiveAlerts(user.id);

    // Record hook event
    recordHookEvent({
      user_id: user.id,
      session_id: data.session_id,
      event_type: 'PostToolUse',
      payload: JSON.stringify(body),
    });

    res.json({});
  } catch (err) {
    console.error('[hook-api] post-tool error:', err);
    res.json({});
  }
});

// ---------------------------------------------------------------------------
// POST /subagent-start
// ---------------------------------------------------------------------------

hookRouter.post('/subagent-start', (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const body = req.body;
    const parsed = SubagentStartEvent.safeParse(body);
    const data = parsed.success ? parsed.data : body;

    // Record subagent event
    recordSubagentEvent({
      user_id: user.id,
      session_id: data.session_id,
      agent_id: data.agent_id,
      agent_type: data.agent_type,
    });

    // Update last_event_at
    touchUserLastEvent(user.id);
    autoResolveInactiveAlerts(user.id);

    // Record hook event
    recordHookEvent({
      user_id: user.id,
      session_id: data.session_id,
      event_type: 'SubagentStart',
      payload: JSON.stringify(body),
    });

    res.json({});
  } catch (err) {
    console.error('[hook-api] subagent-start error:', err);
    res.json({});
  }
});

// ---------------------------------------------------------------------------
// POST /post-tool-failure
// ---------------------------------------------------------------------------

hookRouter.post('/post-tool-failure', (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const body = req.body;
    const parsed = PostToolUseFailureEvent.safeParse(body);
    const data = parsed.success ? parsed.data : body;

    // Record tool event with failure
    recordToolEvent({
      user_id: user.id,
      session_id: data.session_id,
      tool_name: data.tool_name ?? 'unknown',
      tool_output: (data.error ?? '').slice(0, 500),
      success: false,
    });

    // Update last_event_at
    touchUserLastEvent(user.id);
    autoResolveInactiveAlerts(user.id);

    // Record hook event
    recordHookEvent({
      user_id: user.id,
      session_id: data.session_id,
      event_type: 'PostToolUseFailure',
      payload: JSON.stringify(body),
    });

    res.json({});
  } catch (err) {
    console.error('[hook-api] post-tool-failure error:', err);
    res.json({});
  }
});

// ---------------------------------------------------------------------------
// POST /config-change
// ---------------------------------------------------------------------------

hookRouter.post('/config-change', (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const body = req.body;
    const parsed = ConfigChangeEvent.safeParse(body);
    const data = parsed.success ? parsed.data : body;

    // Record hook event
    recordHookEvent({
      user_id: user.id,
      session_id: data.session_id,
      event_type: 'ConfigChange',
      payload: JSON.stringify(body),
    });

    // If source contains 'settings' -> create tamper alert
    if (data.source && String(data.source).includes('settings')) {
      createTamperAlert({
        user_id: user.id,
        alert_type: 'config_changed',
        details: JSON.stringify({
          source: data.source,
          file_path: data.file_path,
        }),
      });
    }

    // Update last_event_at
    touchUserLastEvent(user.id);
    autoResolveInactiveAlerts(user.id);

    res.json({});
  } catch (err) {
    console.error('[hook-api] config-change error:', err);
    res.json({});
  }
});

// ---------------------------------------------------------------------------
// POST /file-changed
// ---------------------------------------------------------------------------

hookRouter.post('/file-changed', (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const body = req.body;
    const parsed = FileChangedEvent.safeParse(body);
    const data = parsed.success ? parsed.data : body;

    // Record hook event
    recordHookEvent({
      user_id: user.id,
      session_id: data.session_id,
      event_type: 'FileChanged',
      payload: JSON.stringify(body),
    });

    // Create tamper alert
    createTamperAlert({
      user_id: user.id,
      alert_type: 'file_changed',
      details: JSON.stringify({
        file_path: data.file_path,
        event: data.event,
      }),
    });

    // Update last_event_at
    touchUserLastEvent(user.id);
    autoResolveInactiveAlerts(user.id);

    res.json({});
  } catch (err) {
    console.error('[hook-api] file-changed error:', err);
    res.json({});
  }
});
