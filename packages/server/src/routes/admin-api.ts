import { Router } from 'express';
import type { Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import {
  getDb,
  createTeam,
  listTeams,
  createUser,
  getUserById,
  getUsersByTeam,
  updateUser,
  deleteUser,
  getPromptsByUser,
  getSessionsByUser,
  getSessionById,
  getLimitsByUser,
  createLimit,
  deleteLimitsByUser,
  createSummary,
  getUserProfile,
  getAllUserProfiles,
  getLatestTeamPulse,
  getTeamPulseHistory,
  type TeamRow,
  type UserRow,
  getUnresolvedTamperAlerts,
  resolveTamperAlert,
  createWatcherCommand,
  markWatcherCommandDelivered,
  getLatestWatcherLogs,
} from '../services/db.js';
import { sendToWatcher, isWatcherConnected } from '../services/watcher-ws.js';
import { adminAuth, generateToken } from '../middleware/admin-auth.js';
import { getUserTamperStatus, autoResolveInactiveAlerts } from '../services/tamper.js';
import { generateSummary, isClaudeAvailable } from '../services/claude-ai.js';
import { queueSessionAnalysis, updateUserProfile, generateTeamPulse } from '../services/ai-jobs.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Consider a watcher "recently active" if it sent an event within the last 10 minutes. */
function isWatcherRecentlyActive(user: { last_event_at?: string | null }): boolean {
  if (!user.last_event_at) return false;
  const lastEvent = new Date(user.last_event_at).getTime();
  return Date.now() - lastEvent < 600_000; // 10 minutes
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const adminRouter = Router();

// ---------------------------------------------------------------------------
// POST /login  — public (no auth)
// ---------------------------------------------------------------------------

adminRouter.post('/login', (req: Request, res: Response) => {
  try {
    const { password } = req.body;
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin';

    if (password !== adminPassword) {
      res.status(401).json({ error: 'Invalid password' });
      return;
    }

    const token = generateToken({ sub: 'admin', email: 'admin@clawlens.dev', role: 'admin' });
    res.json({ token });
  } catch (err) {
    console.error('[admin-api] login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// All routes below require admin auth
// ---------------------------------------------------------------------------

adminRouter.use(adminAuth);

// ---------------------------------------------------------------------------
// Helper: get or create the default team
// ---------------------------------------------------------------------------

function getOrCreateTeam(): TeamRow {
  const teams = listTeams();
  if (teams.length > 0) return teams[0];
  return createTeam({ name: 'Default Team', slug: 'default' });
}

// ---------------------------------------------------------------------------
// GET /team
// ---------------------------------------------------------------------------

adminRouter.get('/team', (_req: Request, res: Response) => {
  try {
    const team = getOrCreateTeam();
    res.json(team);
  } catch (err) {
    console.error('[admin-api] get team error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// PUT /team
// ---------------------------------------------------------------------------

adminRouter.put('/team', (req: Request, res: Response) => {
  try {
    const team = getOrCreateTeam();
    const db = getDb();
    const { name, slug } = req.body;

    const setClauses: string[] = [];
    const values: unknown[] = [];

    if (name !== undefined) {
      setClauses.push('name = ?');
      values.push(name);
    }
    if (slug !== undefined) {
      setClauses.push('slug = ?');
      values.push(slug);
    }

    if (setClauses.length === 0) {
      res.json(team);
      return;
    }

    values.push(team.id);
    const updated = db
      .prepare(`UPDATE teams SET ${setClauses.join(', ')} WHERE id = ? RETURNING *`)
      .get(...values) as TeamRow;

    res.json(updated);
  } catch (err) {
    console.error('[admin-api] update team error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// PUT /team/password
// ---------------------------------------------------------------------------

adminRouter.put('/team/password', (_req: Request, res: Response) => {
  res.status(501).json({ error: 'Not implemented. Password management via env var ADMIN_PASSWORD. Proper password storage coming in a future release.' });
});

// ---------------------------------------------------------------------------
// GET /users
// ---------------------------------------------------------------------------

adminRouter.get('/users', (_req: Request, res: Response) => {
  try {
    const team = getOrCreateTeam();
    const users = getUsersByTeam(team.id);
    const db = getDb();

    const enriched = users.map((user) => {
      // Claude Code only (exclude Antigravity sessions)
      const ccStats = db
        .prepare(
          `SELECT COUNT(*) as prompt_count,
                  COALESCE(SUM(credit_cost), 0) as total_credits
           FROM prompts
           WHERE user_id = ? AND blocked = 0
           AND session_id NOT IN (SELECT id FROM sessions WHERE source = 'antigravity')`,
        )
        .get(user.id) as { prompt_count: number; total_credits: number };

      // Antigravity only
      const agStats = db
        .prepare(
          `SELECT COUNT(*) as ag_prompt_count
           FROM prompts
           WHERE user_id = ? AND blocked = 0
           AND session_id IN (SELECT id FROM sessions WHERE source = 'antigravity')`,
        )
        .get(user.id) as { ag_prompt_count: number };

      const sessionStats = db
        .prepare(`SELECT COUNT(*) as session_count FROM sessions WHERE user_id = ?`)
        .get(user.id) as { session_count: number };

      // Get most-used model
      const topModelResult = db
        .prepare(
          `SELECT model, COUNT(*) as cnt FROM prompts
           WHERE user_id = ? AND blocked = 0 AND model IS NOT NULL
           GROUP BY model ORDER BY cnt DESC LIMIT 1`,
        )
        .get(user.id) as { model: string; cnt: number } | undefined;

      return {
        ...user,
        prompt_count: ccStats.prompt_count,
        total_credits: ccStats.total_credits,
        ag_prompt_count: agStats.ag_prompt_count,
        session_count: sessionStats.session_count,
        top_model: topModelResult?.model || user.default_model || null,
        last_active: user.last_event_at,
        watcher_connected: isWatcherConnected(user.id) || isWatcherRecentlyActive(user),
      };
    });

    res.json({ data: enriched });
  } catch (err) {
    console.error('[admin-api] list users error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /users
// ---------------------------------------------------------------------------

adminRouter.post('/users', (req: Request, res: Response) => {
  try {
    const team = getOrCreateTeam();
    const { name, slug, limits } = req.body;

    const userSlug = slug || name.toLowerCase().replace(/\s+/g, '_');
    const authToken = `clwt_${userSlug}_${randomBytes(8).toString('hex')}`;

    const user = createUser({
      team_id: team.id,
      name,
      auth_token: authToken,
      email: '',
    });

    // Create limits if provided
    if (limits && Array.isArray(limits)) {
      for (const limit of limits) {
        createLimit({
          user_id: user.id,
          type: limit.type,
          value: limit.value,
          model: limit.model,
          window: limit.window,
          start_hour: limit.start_hour,
          end_hour: limit.end_hour,
          timezone: limit.timezone,
        });
      }
    }

    const serverUrl = process.env.SERVER_URL || 'http://localhost:3000';

    res.status(201).json({
      user,
      auth_token: authToken,
      install_instructions: {
        curl: `curl -fsSL https://raw.githubusercontent.com/howincodes/clawlens/main/scripts/install.sh | bash`,
        server_url: serverUrl,
        token: authToken,
      },
    });
  } catch (err) {
    console.error('[admin-api] create user error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /users/:id
// ---------------------------------------------------------------------------

adminRouter.get('/users/:id', (req: Request, res: Response) => {
  try {
    const user = getUserById(req.params.id);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const limits = getLimitsByUser(user.id);
    const prompts = getPromptsByUser(user.id, 20);
    const sessions = getSessionsByUser(user.id);
    const tamperStatus = getUserTamperStatus(user.id);

    const db = getDb();
    // Claude Code only (exclude Antigravity sessions)
    const stats = db
      .prepare(
        `SELECT COUNT(*) as prompt_count,
                COALESCE(SUM(credit_cost), 0) as total_credits
         FROM prompts
         WHERE user_id = ? AND blocked = 0
         AND session_id NOT IN (SELECT id FROM sessions WHERE source = 'antigravity')`,
      )
      .get(user.id) as { prompt_count: number; total_credits: number };

    // Antigravity only
    const agStats = db
      .prepare(
        `SELECT COUNT(*) as ag_prompt_count
         FROM prompts
         WHERE user_id = ? AND blocked = 0
         AND session_id IN (SELECT id FROM sessions WHERE source = 'antigravity')`,
      )
      .get(user.id) as { ag_prompt_count: number };

    // Get unique devices from hook events (SessionStart sends hostname + platform)
    const devices = db.prepare(
      `SELECT DISTINCT
        json_extract(payload, '$.hostname') as hostname,
        json_extract(payload, '$.platform') as platform
       FROM hook_events
       WHERE user_id = ? AND event_type = 'SessionStart'
       AND json_extract(payload, '$.hostname') IS NOT NULL`
    ).all(user.id) as any[];

    // Enrich devices with last_seen from the most recent SessionStart for each hostname
    for (const device of devices) {
      const latest = db.prepare(
        `SELECT created_at FROM hook_events
         WHERE user_id = ? AND event_type = 'SessionStart'
         AND json_extract(payload, '$.hostname') = ?
         ORDER BY created_at DESC LIMIT 1`
      ).get(user.id, device.hostname) as { created_at: string } | undefined;
      device.last_seen = latest?.created_at || null;
      device.id = `${device.hostname}-${device.platform}`;
    }

    res.json({
      ...user,
      devices,
      limits,
      recent_prompts: prompts,
      sessions,
      tamper_status: tamperStatus,
      prompt_count: stats.prompt_count,
      total_credits: stats.total_credits,
      ag_prompt_count: agStats.ag_prompt_count,
      session_count: sessions.length,
      watcher_connected: isWatcherConnected(user.id) || isWatcherRecentlyActive(user),
    });
  } catch (err) {
    console.error('[admin-api] get user error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// PUT /users/:id
// ---------------------------------------------------------------------------

adminRouter.put('/users/:id', (req: Request, res: Response) => {
  try {
    const user = getUserById(req.params.id);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const { name, status, email, default_model, poll_interval, notification_config, limits } = req.body;

    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (status !== undefined) updates.status = status;
    if (email !== undefined) updates.email = email;
    if (default_model !== undefined) updates.default_model = default_model;
    if (poll_interval !== undefined) updates.poll_interval = poll_interval;
    if (notification_config !== undefined) updates.notification_config = notification_config;

    // If status changed to 'killed', set killed_at
    if (status === 'killed' && user.status !== 'killed') {
      updates.killed_at = new Date().toISOString();
    }
    // If status changed from 'killed' to something else, clear killed_at
    if (status !== undefined && status !== 'killed' && user.killed_at) {
      updates.killed_at = null;
    }

    const updated = updateUser(req.params.id, updates as Parameters<typeof updateUser>[1]);

    // If limits provided, replace them
    if (limits && Array.isArray(limits)) {
      deleteLimitsByUser(req.params.id);
      for (const limit of limits) {
        createLimit({
          user_id: req.params.id,
          type: limit.type,
          value: limit.value,
          model: limit.model,
          window: limit.window,
          start_hour: limit.start_hour,
          end_hour: limit.end_hour,
          timezone: limit.timezone,
        });
      }
    }

    res.json(updated);
  } catch (err) {
    console.error('[admin-api] update user error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /users/:id
// ---------------------------------------------------------------------------

adminRouter.delete('/users/:id', (req: Request, res: Response) => {
  try {
    const userId = req.params.id;
    const user = getUserById(userId);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const db = getDb();

    // Delete related data
    db.prepare('DELETE FROM alerts WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM summaries WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM limits WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM prompts WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM hook_events WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM tool_events WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM subagent_events WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM tamper_alerts WHERE user_id = ?').run(userId);

    // Delete user
    deleteUser(userId);

    res.status(204).send();
  } catch (err) {
    console.error('[admin-api] delete user error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /users/:id/prompts
// ---------------------------------------------------------------------------

adminRouter.get('/users/:id/prompts', (req: Request, res: Response) => {
  try {
    const user = getUserById(req.params.id);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = (page - 1) * limit;

    const db = getDb();

    const total = (
      db.prepare('SELECT COUNT(*) as count FROM prompts WHERE user_id = ?').get(user.id) as {
        count: number;
      }
    ).count;

    const data = db
      .prepare(
        'SELECT * FROM prompts WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
      )
      .all(user.id, limit, offset);

    res.json({ data, total, page, limit });
  } catch (err) {
    console.error('[admin-api] get user prompts error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /users/:id/sessions
// ---------------------------------------------------------------------------

adminRouter.get('/users/:id/sessions', (req: Request, res: Response) => {
  try {
    const user = getUserById(req.params.id);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const sessions = getSessionsByUser(user.id);
    res.json({ data: sessions });
  } catch (err) {
    console.error('[admin-api] get user sessions error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /users/:id/rotate-token
// ---------------------------------------------------------------------------

adminRouter.post('/users/:id/rotate-token', (req: Request, res: Response) => {
  try {
    const user = getUserById(req.params.id);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const slug = user.name.toLowerCase().replace(/\s+/g, '_');
    const newToken = `clwt_${slug}_${randomBytes(8).toString('hex')}`;

    const db = getDb();
    db.prepare('UPDATE users SET auth_token = ? WHERE id = ?').run(newToken, user.id);

    res.json({ auth_token: newToken });
  } catch (err) {
    console.error('[admin-api] rotate token error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /subscriptions
// ---------------------------------------------------------------------------

adminRouter.get('/subscriptions', (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const subscriptions = db
      .prepare(
        `SELECT s.*,
                (SELECT COUNT(*) FROM users u WHERE u.subscription_id = s.id) as user_count,
                (SELECT COUNT(*) FROM prompts p WHERE p.user_id IN (SELECT id FROM users WHERE subscription_id = s.id) AND p.blocked = 0 AND p.session_id NOT IN (SELECT id FROM sessions WHERE source = 'antigravity')) as prompt_count,
                (SELECT COUNT(*) FROM prompts p WHERE p.user_id IN (SELECT id FROM users WHERE subscription_id = s.id) AND p.blocked = 0 AND p.session_id NOT IN (SELECT id FROM sessions WHERE source = 'antigravity')) as total_prompts,
                (SELECT COALESCE(SUM(p.credit_cost), 0) FROM prompts p WHERE p.user_id IN (SELECT id FROM users WHERE subscription_id = s.id) AND p.blocked = 0 AND p.session_id NOT IN (SELECT id FROM sessions WHERE source = 'antigravity')) as total_credits
         FROM subscriptions s
         ORDER BY s.created_at DESC`,
      )
      .all() as any[];

    // Attach linked users to each subscription
    for (const sub of subscriptions) {
      sub.users = db
        .prepare(
          `SELECT u.id, u.name, u.email, u.status, u.default_model,
                  (SELECT COUNT(*) FROM prompts WHERE user_id = u.id AND blocked = 0 AND session_id NOT IN (SELECT id FROM sessions WHERE source = 'antigravity')) as prompt_count,
                  (SELECT COALESCE(SUM(credit_cost), 0) FROM prompts WHERE user_id = u.id AND blocked = 0 AND session_id NOT IN (SELECT id FROM sessions WHERE source = 'antigravity')) as total_credits
           FROM users u WHERE u.subscription_id = ?`,
        )
        .all(sub.id);
    }

    res.json({ data: subscriptions });
  } catch (err) {
    console.error('[admin-api] list subscriptions error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /analytics?days=N
// ---------------------------------------------------------------------------

adminRouter.get('/analytics', (req: Request, res: Response) => {
  try {
    const team = getOrCreateTeam();
    const days = parseInt(req.query.days as string) || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startDateStr = startDate.toISOString();

    const db = getDb();

    // Overview — Claude Code only (exclude Antigravity)
    const overview = db
      .prepare(
        `SELECT COUNT(*) as total_prompts,
                COALESCE(SUM(credit_cost), 0) as total_credits
         FROM prompts
         WHERE user_id IN (SELECT id FROM users WHERE team_id = ?)
         AND created_at >= ?
         AND blocked = 0
         AND session_id NOT IN (SELECT id FROM sessions WHERE source = 'antigravity')`,
      )
      .get(team.id, startDateStr) as { total_prompts: number; total_credits: number };

    // Antigravity prompts
    const agOverview = db
      .prepare(
        `SELECT COUNT(*) as ag_prompts
         FROM prompts
         WHERE user_id IN (SELECT id FROM users WHERE team_id = ?)
         AND created_at >= ?
         AND blocked = 0
         AND session_id IN (SELECT id FROM sessions WHERE source = 'antigravity')`,
      )
      .get(team.id, startDateStr) as { ag_prompts: number };

    const sessionCount = db
      .prepare(
        `SELECT COUNT(*) as total_sessions
         FROM sessions
         WHERE user_id IN (SELECT id FROM users WHERE team_id = ?)
         AND started_at >= ?`,
      )
      .get(team.id, startDateStr) as { total_sessions: number };

    const activeUsersResult = db
      .prepare(
        `SELECT COUNT(DISTINCT user_id) as active_users
         FROM prompts
         WHERE user_id IN (SELECT id FROM users WHERE team_id = ?)
         AND created_at >= ?
         AND blocked = 0`,
      )
      .get(team.id, startDateStr) as { active_users: number };

    // Daily trends
    const daily = db
      .prepare(
        `SELECT date(created_at) as date,
                COUNT(*) as prompts,
                COALESCE(SUM(credit_cost), 0) as credits
         FROM prompts
         WHERE user_id IN (SELECT id FROM users WHERE team_id = ?)
         AND created_at >= ?
         AND blocked = 0
         GROUP BY date(created_at)
         ORDER BY date`,
      )
      .all(team.id, startDateStr);

    // Model distribution
    const models = db
      .prepare(
        `SELECT model,
                COUNT(*) as count,
                COALESCE(SUM(credit_cost), 0) as credits
         FROM prompts
         WHERE user_id IN (SELECT id FROM users WHERE team_id = ?)
         AND created_at >= ?
         AND blocked = 0
         GROUP BY model`,
      )
      .all(team.id, startDateStr);

    res.json({
      overview: {
        total_prompts: overview.total_prompts,
        total_sessions: sessionCount.total_sessions,
        total_credits: overview.total_credits,
        active_users: activeUsersResult.active_users,
        ag_prompts: agOverview.ag_prompts,
      },
      daily,
      models,
    });
  } catch (err) {
    console.error('[admin-api] analytics error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /analytics/users?days=N&sortBy=prompts
// ---------------------------------------------------------------------------

adminRouter.get('/analytics/users', (req: Request, res: Response) => {
  try {
    const team = getOrCreateTeam();
    const days = parseInt(req.query.days as string) || 30;
    const sortBy = (req.query.sortBy as string) || 'prompts';
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startDateStr = startDate.toISOString();

    const db = getDb();

    const data = db
      .prepare(
        `SELECT u.id, u.name, u.email, u.status, u.default_model,
                COUNT(CASE WHEN p.session_id NOT IN (SELECT id FROM sessions WHERE source = 'antigravity') THEN p.id END) as prompts,
                COALESCE(SUM(CASE WHEN p.session_id NOT IN (SELECT id FROM sessions WHERE source = 'antigravity') THEN p.credit_cost ELSE 0 END), 0) as credits,
                COUNT(CASE WHEN p.session_id IN (SELECT id FROM sessions WHERE source = 'antigravity') THEN p.id END) as ag_prompts,
                (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.started_at >= ?) as sessions,
                COALESCE(SUM(CASE WHEN p.session_id NOT IN (SELECT id FROM sessions WHERE source = 'antigravity') THEN p.credit_cost ELSE 0 END), 0) as cost_usd,
                (SELECT model FROM prompts WHERE user_id = u.id AND blocked = 0 AND model IS NOT NULL GROUP BY model ORDER BY COUNT(*) DESC LIMIT 1) as top_model
         FROM users u
         LEFT JOIN prompts p ON p.user_id = u.id AND p.created_at >= ? AND p.blocked = 0
         WHERE u.team_id = ?
         GROUP BY u.id
         ORDER BY ${sortBy === 'credits' ? 'credits' : sortBy === 'sessions' ? 'sessions' : sortBy === 'cost_usd' ? 'cost_usd' : 'prompts'} DESC`,
      )
      .all(startDateStr, startDateStr, team.id);

    res.json({ data });
  } catch (err) {
    console.error('[admin-api] analytics users error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /analytics/projects?days=N
// ---------------------------------------------------------------------------

adminRouter.get('/analytics/projects', (req: Request, res: Response) => {
  try {
    const team = getOrCreateTeam();
    const days = parseInt(req.query.days as string) || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startDateStr = startDate.toISOString();

    const db = getDb();

    const data = db
      .prepare(
        `SELECT s.cwd as project,
                COUNT(p.id) as prompts,
                COALESCE(SUM(p.credit_cost), 0) as credits
         FROM prompts p
         JOIN sessions s ON s.id = p.session_id
         WHERE p.user_id IN (SELECT id FROM users WHERE team_id = ?)
         AND p.created_at >= ?
         AND p.blocked = 0
         GROUP BY s.cwd
         ORDER BY prompts DESC`,
      )
      .all(team.id, startDateStr);

    res.json({ data });
  } catch (err) {
    console.error('[admin-api] analytics projects error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /analytics/costs?days=N
// ---------------------------------------------------------------------------

adminRouter.get('/analytics/costs', (req: Request, res: Response) => {
  try {
    const team = getOrCreateTeam();
    const days = parseInt(req.query.days as string) || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startDateStr = startDate.toISOString();

    const db = getDb();

    const data = db
      .prepare(
        `SELECT model,
                COALESCE(SUM(credit_cost), 0) as credits,
                COUNT(*) as prompts,
                COALESCE(SUM(credit_cost), 0) as cost_usd
         FROM prompts
         WHERE user_id IN (SELECT id FROM users WHERE team_id = ?)
         AND created_at >= ?
         AND blocked = 0
         GROUP BY model
         ORDER BY credits DESC`,
      )
      .all(team.id, startDateStr);

    res.json({ data });
  } catch (err) {
    console.error('[admin-api] analytics costs error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /prompts
// ---------------------------------------------------------------------------

adminRouter.get('/prompts', (req: Request, res: Response) => {
  try {
    const team = getOrCreateTeam();
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = (page - 1) * limit;
    const userId = req.query.user_id as string | undefined;
    const search = req.query.search as string | undefined;

    const db = getDb();

    let whereClause = 'WHERE p.user_id IN (SELECT id FROM users WHERE team_id = ?)';
    const params: unknown[] = [team.id];

    if (userId) {
      whereClause += ' AND p.user_id = ?';
      params.push(userId);
    }

    if (search) {
      whereClause += ' AND p.prompt LIKE ?';
      params.push(`%${search}%`);
    }

    const totalResult = db
      .prepare(`SELECT COUNT(*) as count FROM prompts p ${whereClause}`)
      .get(...params) as { count: number };

    const data = db
      .prepare(
        `SELECT p.* FROM prompts p ${whereClause} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset);

    res.json({ data, total: totalResult.count, page, limit });
  } catch (err) {
    console.error('[admin-api] list prompts error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /summaries
// ---------------------------------------------------------------------------

adminRouter.get('/summaries', (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const data = db
      .prepare('SELECT * FROM summaries ORDER BY created_at DESC')
      .all();

    res.json({ data });
  } catch (err) {
    console.error('[admin-api] list summaries error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /summaries/generate
// ---------------------------------------------------------------------------

adminRouter.post('/summaries/generate', async (req: Request, res: Response) => {
  try {
    // Check if claude CLI is available
    const available = await isClaudeAvailable();
    if (!available) {
      res.status(503).json({ error: 'Claude CLI is not available on this server' });
      return;
    }

    const team = getOrCreateTeam();
    const db = getDb();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const targetUserId = req.body.user_id as string | undefined;

    // If user_id provided, generate for that user only
    let whereClause: string;
    let queryParams: unknown[];
    let summaryUserId: string | undefined;

    if (targetUserId) {
      const targetUser = getUserById(targetUserId);
      if (!targetUser) { res.status(404).json({ error: 'User not found' }); return; }
      whereClause = `p.user_id = ? AND p.created_at >= ?`;
      queryParams = [targetUserId, since];
      summaryUserId = targetUserId;
    } else {
      whereClause = `p.user_id IN (SELECT id FROM users WHERE team_id = ?) AND p.created_at >= ?`;
      queryParams = [team.id, since];
    }

    const recentPrompts = db
      .prepare(
        `SELECT p.prompt, p.model, p.created_at
         FROM prompts p
         WHERE ${whereClause}
         AND p.blocked = 0
         AND p.prompt IS NOT NULL
         ORDER BY p.created_at DESC
         LIMIT 200`,
      )
      .all(...queryParams) as Array<{ prompt: string; model: string; created_at: string }>;

    if (recentPrompts.length === 0) {
      res.json({ status: 'no_data', message: 'No prompts in the last 24 hours to summarize' });
      return;
    }

    // Call AI to generate summary
    const result = await generateSummary(recentPrompts);

    // Save result to DB
    const summary = createSummary({
      user_id: summaryUserId,
      period: 'daily',
      summary: result.summary,
      categories: JSON.stringify(result.categories),
      topics: JSON.stringify(result.topics),
      risk_level: result.risk_level,
    });

    res.json({ status: 'complete', summary });
  } catch (err) {
    console.error('[admin-api] generate summary error:', err);
    res.status(500).json({ error: 'Failed to generate summary' });
  }
});

// ---------------------------------------------------------------------------
// GET /audit-log
// ---------------------------------------------------------------------------

adminRouter.get('/audit-log', (req: Request, res: Response) => {
  try {
    const team = getOrCreateTeam();
    const limit = parseInt(req.query.limit as string) || 100;

    const db = getDb();
    const data = db
      .prepare(
        `SELECT he.* FROM hook_events he
         WHERE he.user_id IN (SELECT id FROM users WHERE team_id = ?)
         ORDER BY he.created_at DESC
         LIMIT ?`,
      )
      .all(team.id, limit);

    res.json({ data });
  } catch (err) {
    console.error('[admin-api] audit log error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /tamper-alerts
// ---------------------------------------------------------------------------

adminRouter.get('/tamper-alerts', (req: Request, res: Response) => {
  try {
    const team = getOrCreateTeam();
    const users = getUsersByTeam(team.id);
    const userMap = new Map(users.map((u) => [u.id, u]));

    const alerts = getUnresolvedTamperAlerts();
    const enriched = alerts
      .filter((a) => userMap.has(a.user_id))
      .map((a) => ({
        ...a,
        user_name: userMap.get(a.user_id)?.name || 'Unknown',
      }));

    res.json({ data: enriched });
  } catch (err) {
    console.error('[admin-api] tamper alerts error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /tamper-alerts/:id/resolve
// ---------------------------------------------------------------------------

adminRouter.post('/tamper-alerts/:id/resolve', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: 'Invalid alert ID' });
      return;
    }
    const resolved = resolveTamperAlert(id);
    if (!resolved) {
      res.status(404).json({ error: 'Alert not found' });
      return;
    }
    res.json({ status: 'resolved' });
  } catch (err) {
    console.error('[admin-api] resolve tamper alert error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /users/:id/watcher/command — Queue a command for the user's watcher
// ---------------------------------------------------------------------------

adminRouter.post('/users/:id/watcher/command', (req: Request, res: Response) => {
  try {
    const user = getUserById(req.params.id);
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }

    const { command, message } = req.body;
    if (!command) { res.status(400).json({ error: 'command required' }); return; }

    const payload = message ? JSON.stringify({ message }) : undefined;
    const cmd = createWatcherCommand({ user_id: user.id, command, payload });

    // Try instant delivery via WebSocket
    const delivered = sendToWatcher(user.id, command, message ? { message } : undefined);
    if (delivered) {
      markWatcherCommandDelivered(cmd.id);
    }

    res.json({ id: cmd.id, delivered, status: delivered ? 'delivered' : 'queued' });
  } catch (err) {
    console.error('[admin-api] watcher command error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /users/:id/watcher/logs — View most recent uploaded logs (or history)
// ---------------------------------------------------------------------------

adminRouter.get('/users/:id/watcher/logs', (req: Request, res: Response) => {
  try {
    const user = getUserById(req.params.id);
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }

    if (req.query.history === 'true') {
      const db = getDb();
      const history = db.prepare(
        `SELECT id, uploaded_at,
                LENGTH(hook_log) as hook_log_size,
                LENGTH(watcher_log) as watcher_log_size
         FROM watcher_logs WHERE user_id = ? ORDER BY id DESC LIMIT 10`
      ).all(user.id);
      res.json({ data: history });
      return;
    }

    const logs = getLatestWatcherLogs(user.id);
    res.json({ data: logs || null });
  } catch (err) {
    console.error('[admin-api] watcher logs error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /users/:id/watcher/logs/:logId — View a specific log entry
// ---------------------------------------------------------------------------

adminRouter.get('/users/:id/watcher/logs/:logId', (req: Request, res: Response) => {
  try {
    const user = getUserById(req.params.id);
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }

    const db = getDb();
    const log = db.prepare(
      `SELECT * FROM watcher_logs WHERE id = ? AND user_id = ?`
    ).get(req.params.logId, user.id);

    if (!log) { res.status(404).json({ error: 'Log entry not found' }); return; }
    res.json({ data: log });
  } catch (err) {
    console.error('[admin-api] watcher log entry error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /users/:id/watcher/status — Watcher connection status
// ---------------------------------------------------------------------------

adminRouter.get('/users/:id/watcher/status', (req: Request, res: Response) => {
  try {
    const user = getUserById(req.params.id);
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }

    // Ensure timestamp has 'Z' suffix so the dashboard parses it as UTC
    const lastEvent = user.last_event_at;
    const formattedLastEvent = lastEvent && !lastEvent.endsWith('Z') ? lastEvent + 'Z' : lastEvent;

    res.json({
      connected: isWatcherConnected(user.id) || isWatcherRecentlyActive(user),
      ws_connected: isWatcherConnected(user.id),
      recently_active: isWatcherRecentlyActive(user),
      last_event_at: formattedLastEvent,
    });
  } catch (err) {
    console.error('[admin-api] watcher status error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /events/recent — Polling fallback for Live Feed when WebSocket unavailable
// ---------------------------------------------------------------------------

adminRouter.get('/events/recent', (req: Request, res: Response) => {
  try {
    const team = getOrCreateTeam();
    const since = req.query.since as string || new Date(Date.now() - 30000).toISOString(); // default: last 30s
    const db = getDb();

    const events = db.prepare(
      `SELECT he.*, u.name as user_name
       FROM hook_events he
       LEFT JOIN users u ON he.user_id = u.id
       WHERE u.team_id = ? AND he.created_at > ?
       ORDER BY he.created_at DESC
       LIMIT 20`
    ).all(team.id, since);

    res.json({ data: events, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('[admin-api] events/recent error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /sessions/:id/analyze — manually trigger session analysis
// ---------------------------------------------------------------------------

adminRouter.post('/sessions/:id/analyze', async (req: Request, res: Response) => {
  try {
    const session = getSessionById(req.params.id);
    if (!session) { res.status(404).json({ error: 'Session not found' }); return; }

    // Clear existing analysis to force re-analysis
    const db = getDb();
    db.prepare('UPDATE sessions SET ai_analyzed_at = NULL WHERE id = ?').run(req.params.id);

    queueSessionAnalysis(req.params.id, session.user_id);
    res.json({ status: 'queued' });
  } catch (err) {
    console.error('[admin-api] session analyze error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /users/:id/profile — get user's AI profile
// ---------------------------------------------------------------------------

adminRouter.get('/users/:id/profile', (req: Request, res: Response) => {
  try {
    const user = getUserById(req.params.id);
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }
    const profile = getUserProfile(user.id);
    if (!profile) { res.json({ data: null }); return; }
    res.json({ data: { ...profile, profile: JSON.parse(profile.profile) } });
  } catch (err) {
    console.error('[admin-api] user profile error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /users/:id/profile/update — force regenerate profile
// ---------------------------------------------------------------------------

adminRouter.post('/users/:id/profile/update', async (req: Request, res: Response) => {
  try {
    const user = getUserById(req.params.id);
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }
    await updateUserProfile(user.id);
    const profile = getUserProfile(user.id);
    res.json({ status: 'complete', data: profile ? { ...profile, profile: JSON.parse(profile.profile) } : null });
  } catch (err) {
    console.error('[admin-api] profile update error:', err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// ---------------------------------------------------------------------------
// GET /profiles — list all user profiles
// ---------------------------------------------------------------------------

adminRouter.get('/profiles', (req: Request, res: Response) => {
  try {
    const team = getOrCreateTeam();
    const profiles = getAllUserProfiles(team.id);
    const data = profiles.map(p => ({ ...p, profile: JSON.parse(p.profile) }));
    res.json({ data });
  } catch (err) {
    console.error('[admin-api] profiles list error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /pulse/generate — generate team pulse now
// ---------------------------------------------------------------------------

adminRouter.post('/pulse/generate', async (req: Request, res: Response) => {
  try {
    const team = getOrCreateTeam();
    await generateTeamPulse(team.id);
    const pulse = getLatestTeamPulse(team.id);
    res.json({ status: 'complete', data: pulse ? { ...pulse, pulse: JSON.parse(pulse.pulse) } : null });
  } catch (err) {
    console.error('[admin-api] pulse generate error:', err);
    res.status(500).json({ error: 'Failed to generate pulse' });
  }
});

// ---------------------------------------------------------------------------
// GET /pulse — get latest pulse
// ---------------------------------------------------------------------------

adminRouter.get('/pulse', (req: Request, res: Response) => {
  try {
    const team = getOrCreateTeam();
    const pulse = getLatestTeamPulse(team.id);
    res.json({ data: pulse ? { ...pulse, pulse: JSON.parse(pulse.pulse) } : null });
  } catch (err) {
    console.error('[admin-api] pulse error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /pulse/history — get previous pulses
// ---------------------------------------------------------------------------

adminRouter.get('/pulse/history', (req: Request, res: Response) => {
  try {
    const team = getOrCreateTeam();
    const limit = parseInt(req.query.limit as string) || 10;
    const pulses = getTeamPulseHistory(team.id, limit);
    const data = pulses.map(p => ({ ...p, pulse: JSON.parse(p.pulse) }));
    res.json({ data });
  } catch (err) {
    console.error('[admin-api] pulse history error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /sessions/analyzed — list sessions with AI analysis data
// ---------------------------------------------------------------------------

adminRouter.get('/sessions/analyzed', (req: Request, res: Response) => {
  try {
    const team = getOrCreateTeam();
    const days = parseInt(req.query.days as string) || 7;
    const userId = req.query.user_id as string | undefined;
    const minScore = parseInt(req.query.min_score as string) || 0;
    const limit = parseInt(req.query.limit as string) || 50;
    const since = new Date(Date.now() - days * 86400000).toISOString();

    const db = getDb();
    let where = `s.user_id IN (SELECT id FROM users WHERE team_id = ?) AND s.started_at >= ?`;
    const params: unknown[] = [team.id, since];

    if (userId) { where += ' AND s.user_id = ?'; params.push(userId); }
    if (minScore > 0) { where += ' AND s.ai_productivity_score >= ?'; params.push(minScore); }

    const sessions = db.prepare(
      `SELECT s.*, u.name as user_name FROM sessions s LEFT JOIN users u ON s.user_id = u.id WHERE ${where} ORDER BY s.started_at DESC LIMIT ?`
    ).all(...params, limit);

    res.json({ data: sessions });
  } catch (err) {
    console.error('[admin-api] analyzed sessions error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
