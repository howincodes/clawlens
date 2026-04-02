import { Router } from 'express';
import type { Request, Response, Router as RouterType } from 'express';
import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import {
  createUser, getUserById, getUserByEmail, getAllUsers, updateUser, deleteUser,
} from '../db/queries/users.js';
import { getSessionsByUser, getSessionById } from '../db/queries/sessions.js';
import { getPromptsByUser } from '../db/queries/prompts.js';
import { getLimitsByUser, createLimit, deleteLimitsByUser } from '../db/queries/limits.js';
import { createSummary, getSummaries, getUserProfile, getAllUserProfiles, getLatestTeamPulse, getTeamPulseHistory } from '../db/queries/ai.js';
import { getUnresolvedTamperAlerts, resolveTamperAlert } from '../db/queries/alerts.js';
import { createWatcherCommand, markWatcherCommandDelivered, getLatestWatcherLogs } from '../db/queries/watcher.js';
import { getModelCredits, getProviderQuotas } from '../db/queries/model-credits.js';
import { getSubscriptions } from '../db/queries/subscriptions.js';
import { getAllRoles, getRoleById, createRole, updateRole, deleteRole, getAllPermissions, getRolePermissions, setRolePermissions, getUserRoles, assignUserRole, removeUserRole, getUserPermissionKeys } from '../db/queries/roles.js';
import { getAllProjects, getProjectById, createProject, updateProject, deleteProject, getProjectMembers, addProjectMember, removeProjectMember, addProjectRepository, getProjectRepositories, removeProjectRepository } from '../db/queries/projects.js';
import {
  createTask, getTaskById, getTasksByProject, updateTask, deleteTask, getSubtasks,
  addTaskComment, getTaskComments, recordTaskActivity, getTaskActivity,
  createMilestone, getMilestonesByProject, updateMilestone, deleteMilestone,
  getStatusConfigs, createStatusConfig, updateStatusConfig, deleteStatusConfig,
  createRequirementInput, getRequirementInput, getRequirementsByProject,
  createAITaskSuggestion, getAITaskSuggestion, getAITaskSuggestionByRequirement, updateAITaskSuggestionStatus,
} from '../db/queries/tasks.js';
import {
  getFileEventsByUser, getAppTrackingByUser, getActivityWindows,
} from '../db/queries/tracking.js';
import {
  getStaleHeartbeats, getWatchEventsByUser,
} from '../db/queries/credentials.js';
import { getDb } from '../db/index.js';
import { sendToWatcher, isWatcherConnected } from '../services/watcher-ws.js';
import { adminAuth, generateToken } from '../middleware/admin-auth.js';
import { getUserTamperStatus } from '../services/tamper.js';
import { generateSummary, isClaudeAvailable } from '../services/claude-ai.js';
import { queueSessionAnalysis, updateUserProfile, generateTeamPulse } from '../services/ai-jobs.js';
import { generateTaskSuggestions } from '../services/task-generation.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Consider a watcher "recently active" if it sent an event within the last 10 minutes. */
function isWatcherRecentlyActive(user: { lastEventAt?: Date | null }): boolean {
  if (!user.lastEventAt) return false;
  const lastEvent = user.lastEventAt.getTime();
  return Date.now() - lastEvent < 600_000; // 10 minutes
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const adminRouter: RouterType = Router();

// ---------------------------------------------------------------------------
// POST /login  — public (no auth)
// ---------------------------------------------------------------------------

adminRouter.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: 'Email and password required' });
      return;
    }

    const user = await getUserByEmail(email);
    if (!user || !user.passwordHash) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const bcrypt = await import('bcryptjs');
    const valid = await bcrypt.default.compare(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const permissionKeys = await getUserPermissionKeys(user.id);
    const userRolesList = await getUserRoles(user.id);
    const primaryRole = userRolesList[0]?.roles?.name ?? 'User';

    const token = generateToken({
      sub: user.id,
      email: user.email,
      role: primaryRole,
      permissions: permissionKeys,
    });

    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: primaryRole } });
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
// GET /auth/me — current user info with roles & permissions
// ---------------------------------------------------------------------------

adminRouter.get('/auth/me', async (req: Request, res: Response) => {
  try {
    const user = await getUserById(req.admin!.sub);
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }
    const rolesList = await getUserRoles(user.id);
    const perms = await getUserPermissionKeys(user.id);
    res.json({ user: { id: user.id, name: user.name, email: user.email }, roles: rolesList, permissions: perms });
  } catch (err) {
    console.error('[admin-api] auth/me error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// PUT /auth/update-profile — update current user's profile/password
// ---------------------------------------------------------------------------

adminRouter.put('/auth/update-profile', async (req: Request, res: Response) => {
  try {
    const userId = req.admin!.sub;
    const { name, email, currentPassword, newPassword } = req.body;

    const user = await getUserById(userId);
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }

    const updates: Record<string, unknown> = {};
    if (name) updates.name = name;
    if (email) updates.email = email;

    if (newPassword) {
      if (!currentPassword) { res.status(400).json({ error: 'Current password required' }); return; }
      const bcrypt = await import('bcryptjs');
      const valid = user.passwordHash ? await bcrypt.default.compare(currentPassword, user.passwordHash) : false;
      if (!valid) { res.status(400).json({ error: 'Current password is incorrect' }); return; }
      updates.passwordHash = await bcrypt.default.hash(newPassword, 12);
    }

    if (Object.keys(updates).length > 0) {
      await updateUser(userId, updates);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[admin-api] update profile error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /users
// ---------------------------------------------------------------------------

adminRouter.get('/users', async (_req: Request, res: Response) => {
  try {
    const users = await getAllUsers();
    const db = getDb();

    const enriched = await Promise.all(users.map(async (user) => {
      const { passwordHash: _, ...safeUser } = user;

      try {
        // Claude Code only (exclude Antigravity sessions)
        const [ccStats] = await db.execute<{ prompt_count: number; total_credits: number }>(sql`
          SELECT COUNT(*) as prompt_count,
                 COALESCE(SUM(credit_cost), 0) as total_credits
          FROM prompts
          WHERE user_id = ${user.id} AND blocked = false
          AND session_id NOT IN (SELECT id FROM sessions WHERE source = 'antigravity')
        `);

        // Antigravity only
        const [agStats] = await db.execute<{ ag_prompt_count: number }>(sql`
          SELECT COUNT(*) as ag_prompt_count
          FROM prompts
          WHERE user_id = ${user.id} AND blocked = false
          AND session_id IN (SELECT id FROM sessions WHERE source = 'antigravity')
        `);

        // Codex only
        const [codexStats] = await db.execute<{ prompts: number; credits: number }>(sql`
          SELECT COUNT(*) as prompts, COALESCE(SUM(credit_cost), 0) as credits
          FROM prompts WHERE user_id = ${user.id} AND source = 'codex' AND blocked = false
        `);

        const [sessionStats] = await db.execute<{ session_count: number }>(sql`
          SELECT COUNT(*) as session_count FROM sessions WHERE user_id = ${user.id}
        `);

        // Get most-used model
        const topModelResults = await db.execute<{ model: string; cnt: number }>(sql`
          SELECT model, COUNT(*) as cnt FROM prompts
          WHERE user_id = ${user.id} AND blocked = false AND model IS NOT NULL
          GROUP BY model ORDER BY cnt DESC LIMIT 1
        `);
        const topModelResult = topModelResults[0];

        // Get user roles
        const userRolesList = await getUserRoles(user.id);
        const primaryRole = userRolesList[0]?.roles?.name ?? null;

        return {
          ...safeUser,
          prompt_count: Number(ccStats?.prompt_count ?? 0),
          total_credits: Number(ccStats?.total_credits ?? 0),
          ag_prompt_count: Number(agStats?.ag_prompt_count ?? 0),
          codex_prompts: Number(codexStats?.prompts ?? 0),
          codex_credits: Number(codexStats?.credits ?? 0),
          session_count: Number(sessionStats?.session_count ?? 0),
          top_model: topModelResult?.model || user.defaultModel || null,
          last_active: user.lastEventAt,
          watcher_connected: isWatcherConnected(user.id) || isWatcherRecentlyActive(user),
          role: primaryRole,
        };
      } catch (enrichErr) {
        console.error(`[admin-api] enrichment error for user ${user.id}:`, enrichErr);
        return {
          ...safeUser,
          prompt_count: 0,
          total_credits: 0,
          ag_prompt_count: 0,
          codex_prompts: 0,
          codex_credits: 0,
          session_count: 0,
          top_model: user.defaultModel || null,
          last_active: user.lastEventAt,
          watcher_connected: false,
          role: null,
        };
      }
    }));

    res.json({ data: enriched });
  } catch (err) {
    console.error('[admin-api] list users error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /users
// ---------------------------------------------------------------------------

adminRouter.post('/users', async (req: Request, res: Response) => {
  try {
    const { name, slug, email, password, roleId, githubId, limits: limitsInput } = req.body;

    const userSlug = slug || name.toLowerCase().replace(/\s+/g, '_');
    const authToken = `clwt_${userSlug}_${randomBytes(8).toString('hex')}`;

    let passwordHash: string | undefined;
    if (password) {
      const bcrypt = await import('bcryptjs');
      passwordHash = await bcrypt.default.hash(password, 12);
    }

    const user = await createUser({
      name,
      authToken,
      email: email || '',
      passwordHash,
      githubId: githubId || undefined,
    });

    // Assign role if provided
    if (roleId) {
      await assignUserRole(user.id, roleId, undefined, (req as any).admin?.sub);
    }

    // Create limits if provided
    if (limitsInput && Array.isArray(limitsInput)) {
      for (const limit of limitsInput) {
        await createLimit({
          userId: user.id,
          type: limit.type,
          value: limit.value,
          model: limit.model,
          window: limit.window,
          startHour: limit.start_hour,
          endHour: limit.end_hour,
          timezone: limit.timezone,
        });
      }
    }

    const serverUrl = process.env.SERVER_URL || 'http://localhost:3000';
    const { passwordHash: _ph, ...userWithoutPassword } = user;

    res.status(201).json({
      user: userWithoutPassword,
      auth_token: authToken,
      install_instructions: {
        curl: `curl -fsSL https://raw.githubusercontent.com/howincodes/howinlens/main/scripts/install.sh | bash`,
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

adminRouter.get('/users/:id', async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.id as string, 10);
    if (isNaN(userId)) { res.status(400).json({ error: 'Invalid user ID' }); return; }

    const user = await getUserById(userId);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const limits = await getLimitsByUser(user.id);
    const prompts = await getPromptsByUser(user.id, 20);
    const sessions = await getSessionsByUser(user.id);
    const tamperStatus = await getUserTamperStatus(user.id);

    const db = getDb();
    // Claude Code only (exclude Antigravity sessions)
    const [stats] = await db.execute<{ prompt_count: number; total_credits: number }>(sql`
      SELECT COUNT(*) as prompt_count,
             COALESCE(SUM(credit_cost), 0) as total_credits
      FROM prompts
      WHERE user_id = ${user.id} AND blocked = false
      AND session_id NOT IN (SELECT id FROM sessions WHERE source = 'antigravity')
    `);

    // Antigravity only
    const [agStats] = await db.execute<{ ag_prompt_count: number }>(sql`
      SELECT COUNT(*) as ag_prompt_count
      FROM prompts
      WHERE user_id = ${user.id} AND blocked = false
      AND session_id IN (SELECT id FROM sessions WHERE source = 'antigravity')
    `);

    // Codex only
    const [codexStats] = await db.execute<{ prompts: number; credits: number }>(sql`
      SELECT COUNT(*) as prompts, COALESCE(SUM(credit_cost), 0) as credits
      FROM prompts WHERE user_id = ${user.id} AND source = 'codex' AND blocked = false
    `);

    // Get unique devices from hook events (SessionStart sends hostname + platform)
    const devices = await db.execute<{ hostname: string; platform: string }>(sql`
      SELECT DISTINCT
        payload::jsonb->>'hostname' as hostname,
        payload::jsonb->>'platform' as platform
      FROM hook_events
      WHERE user_id = ${user.id} AND event_type = 'SessionStart'
      AND payload::jsonb->>'hostname' IS NOT NULL
    `) as any[];

    // Enrich devices with last_seen from the most recent SessionStart for each hostname
    for (const device of devices) {
      const [latest] = await db.execute<{ created_at: string }>(sql`
        SELECT created_at FROM hook_events
        WHERE user_id = ${user.id} AND event_type = 'SessionStart'
        AND payload::jsonb->>'hostname' = ${device.hostname}
        ORDER BY created_at DESC LIMIT 1
      `);
      device.last_seen = latest?.created_at || null;
      device.id = `${device.hostname}-${device.platform}`;
    }

    const { passwordHash: _ph, ...safeUser } = user;

    res.json({
      ...safeUser,
      devices,
      limits,
      recent_prompts: prompts,
      sessions,
      tamper_status: tamperStatus,
      prompt_count: Number(stats?.prompt_count ?? 0),
      total_credits: Number(stats?.total_credits ?? 0),
      ag_prompt_count: Number(agStats?.ag_prompt_count ?? 0),
      codex_prompts: Number(codexStats?.prompts ?? 0),
      codex_credits: Number(codexStats?.credits ?? 0),
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

adminRouter.put('/users/:id', async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.id as string, 10);
    if (isNaN(userId)) { res.status(400).json({ error: 'Invalid user ID' }); return; }

    const user = await getUserById(userId);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const { name, status, email, default_model, poll_interval, notification_config, limits: limitsInput } = req.body;

    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (status !== undefined) updates.status = status;
    if (email !== undefined) updates.email = email;
    if (default_model !== undefined) updates.defaultModel = default_model;
    if (poll_interval !== undefined) updates.pollInterval = poll_interval;
    if (notification_config !== undefined) updates.notificationConfig = notification_config;

    // If status changed to 'killed', set killedAt
    if (status === 'killed' && user.status !== 'killed') {
      updates.killedAt = new Date();
    }
    // If status changed from 'killed' to something else, clear killedAt
    if (status !== undefined && status !== 'killed' && user.killedAt) {
      updates.killedAt = null;
    }

    const updated = await updateUser(userId, updates as Parameters<typeof updateUser>[1]);

    // If limits provided, replace them
    if (limitsInput && Array.isArray(limitsInput)) {
      await deleteLimitsByUser(userId);
      for (const limit of limitsInput) {
        await createLimit({
          userId,
          type: limit.type,
          value: limit.value,
          model: limit.model,
          window: limit.window,
          startHour: limit.start_hour,
          endHour: limit.end_hour,
          timezone: limit.timezone,
        });
      }
    }

    const { passwordHash: _ph, ...safeUpdated } = updated;
    res.json(safeUpdated);
  } catch (err) {
    console.error('[admin-api] update user error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /users/:id
// ---------------------------------------------------------------------------

adminRouter.delete('/users/:id', async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.id as string, 10);
    if (isNaN(userId)) { res.status(400).json({ error: 'Invalid user ID' }); return; }

    const user = await getUserById(userId);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const db = getDb();

    // Delete related data
    await db.execute(sql`DELETE FROM alerts WHERE user_id = ${userId}`);
    await db.execute(sql`DELETE FROM summaries WHERE user_id = ${userId}`);
    await db.execute(sql`DELETE FROM limits WHERE user_id = ${userId}`);
    await db.execute(sql`DELETE FROM prompts WHERE user_id = ${userId}`);
    await db.execute(sql`DELETE FROM sessions WHERE user_id = ${userId}`);
    await db.execute(sql`DELETE FROM hook_events WHERE user_id = ${userId}`);
    await db.execute(sql`DELETE FROM tool_events WHERE user_id = ${userId}`);
    await db.execute(sql`DELETE FROM subagent_events WHERE user_id = ${userId}`);
    await db.execute(sql`DELETE FROM tamper_alerts WHERE user_id = ${userId}`);

    // Delete user
    await deleteUser(userId);

    res.status(204).send();
  } catch (err) {
    console.error('[admin-api] delete user error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /users/:id/prompts
// ---------------------------------------------------------------------------

adminRouter.get('/users/:id/prompts', async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.id as string, 10);
    if (isNaN(userId)) { res.status(400).json({ error: 'Invalid user ID' }); return; }

    const user = await getUserById(userId);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = (page - 1) * limit;
    const source = req.query.source as string | undefined;

    const db = getDb();

    let totalResult;
    let data;

    if (source) {
      totalResult = await db.execute<{ count: number }>(sql`
        SELECT COUNT(*) as count FROM prompts WHERE user_id = ${user.id} AND source = ${source}
      `);
      data = await db.execute(sql`
        SELECT id, session_id, user_id, prompt, model, credit_cost,
               blocked, block_reason, created_at, turn_id,
               input_tokens, output_tokens, cached_tokens, reasoning_tokens, source
        FROM prompts WHERE user_id = ${user.id} AND source = ${source}
        ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}
      `);
    } else {
      totalResult = await db.execute<{ count: number }>(sql`
        SELECT COUNT(*) as count FROM prompts WHERE user_id = ${user.id}
      `);
      data = await db.execute(sql`
        SELECT id, session_id, user_id, prompt, model, credit_cost,
               blocked, block_reason, created_at, turn_id,
               input_tokens, output_tokens, cached_tokens, reasoning_tokens, source
        FROM prompts WHERE user_id = ${user.id}
        ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}
      `);
    }

    const total = Number(totalResult[0]?.count ?? 0);
    res.json({ data, total, page, limit });
  } catch (err) {
    console.error('[admin-api] get user prompts error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /users/:id/sessions
// ---------------------------------------------------------------------------

adminRouter.get('/users/:id/sessions', async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.id as string, 10);
    if (isNaN(userId)) { res.status(400).json({ error: 'Invalid user ID' }); return; }

    const user = await getUserById(userId);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const sessions = await getSessionsByUser(user.id);
    res.json({ data: sessions });
  } catch (err) {
    console.error('[admin-api] get user sessions error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /users/:id/rotate-token
// ---------------------------------------------------------------------------

adminRouter.post('/users/:id/rotate-token', async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.id as string, 10);
    if (isNaN(userId)) { res.status(400).json({ error: 'Invalid user ID' }); return; }

    const user = await getUserById(userId);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const slug = user.name.toLowerCase().replace(/\s+/g, '_');
    const newToken = `clwt_${slug}_${randomBytes(8).toString('hex')}`;

    await updateUser(user.id, { authToken: newToken });

    res.json({ auth_token: newToken });
  } catch (err) {
    console.error('[admin-api] rotate token error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /subscriptions
// ---------------------------------------------------------------------------

adminRouter.get('/subscriptions', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const source = req.query.source as string | undefined;

    const subscriptionsList = await getSubscriptions(source || undefined);

    const enriched = await Promise.all(subscriptionsList.map(async (sub: any) => {
      const subSource = sub.source || 'claude_code';

      // Find users by email match
      const linkedUsers = await db.execute(sql`
        SELECT id, name, email, status, default_model FROM users WHERE email = ${sub.email}
      `) as any[];

      // Build source-aware prompt filter
      let promptSourceFilter;
      if (subSource === 'codex') {
        promptSourceFilter = sql`AND source = 'codex'`;
      } else if (subSource === 'antigravity') {
        promptSourceFilter = sql`AND source = 'antigravity'`;
      } else {
        promptSourceFilter = sql`AND (source IS NULL OR source = 'claude_code')`;
      }

      const userIds = linkedUsers.map((u: any) => u.id);
      let totalPrompts = 0;
      let totalCredits = 0;

      if (userIds.length > 0) {
        // Build IN clause for user IDs
        const [aggStats] = await db.execute<{ prompt_count: number; total_credits: number }>(sql`
          SELECT COUNT(*) as prompt_count, COALESCE(SUM(credit_cost), 0) as total_credits
          FROM prompts WHERE user_id = ANY(${userIds}) AND blocked = false ${promptSourceFilter}
        `);
        totalPrompts = Number(aggStats?.prompt_count ?? 0);
        totalCredits = Number(aggStats?.total_credits ?? 0);

        // Per-user stats
        for (const u of linkedUsers) {
          const [uStats] = await db.execute<{ prompts: number; credits: number }>(sql`
            SELECT COUNT(*) as prompts, COALESCE(SUM(credit_cost), 0) as credits
            FROM prompts WHERE user_id = ${u.id} AND blocked = false ${promptSourceFilter}
          `);
          u.prompt_count = Number(uStats?.prompts ?? 0);
          u.total_credits = Number(uStats?.credits ?? 0);
        }
      }

      return {
        ...sub,
        users: linkedUsers,
        total_prompts: totalPrompts,
        prompt_count: totalPrompts,
        total_credits: totalCredits,
      };
    }));

    res.json({ data: enriched });
  } catch (err) {
    console.error('[admin-api] list subscriptions error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /analytics?days=N
// ---------------------------------------------------------------------------

adminRouter.get('/analytics', async (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const source = req.query.source as string | undefined;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const db = getDb();

    // Overview — with optional source filter (falls back to CC-only when no source)
    let overview;
    if (source) {
      [overview] = await db.execute<{ total_prompts: number; total_credits: number }>(sql`
        SELECT COUNT(*) as total_prompts,
               COALESCE(SUM(credit_cost), 0) as total_credits
        FROM prompts
        WHERE created_at >= ${startDate}
        AND blocked = false
        AND source = ${source}
      `);
    } else {
      [overview] = await db.execute<{ total_prompts: number; total_credits: number }>(sql`
        SELECT COUNT(*) as total_prompts,
               COALESCE(SUM(credit_cost), 0) as total_credits
        FROM prompts
        WHERE created_at >= ${startDate}
        AND blocked = false
        AND session_id NOT IN (SELECT id FROM sessions WHERE source = 'antigravity')
      `);
    }

    // Antigravity prompts
    const [agOverview] = await db.execute<{ ag_prompts: number }>(sql`
      SELECT COUNT(*) as ag_prompts
      FROM prompts
      WHERE created_at >= ${startDate}
      AND blocked = false
      AND session_id IN (SELECT id FROM sessions WHERE source = 'antigravity')
    `);

    // Sessions — filter by source if provided
    let sessionCount;
    if (source) {
      [sessionCount] = await db.execute<{ total_sessions: number }>(sql`
        SELECT COUNT(*) as total_sessions
        FROM sessions
        WHERE started_at >= ${startDate}
        AND source = ${source}
      `);
    } else {
      [sessionCount] = await db.execute<{ total_sessions: number }>(sql`
        SELECT COUNT(*) as total_sessions
        FROM sessions
        WHERE started_at >= ${startDate}
      `);
    }

    // Active users — filter by source if provided
    let activeUsersResult;
    if (source) {
      [activeUsersResult] = await db.execute<{ active_users: number }>(sql`
        SELECT COUNT(DISTINCT user_id) as active_users
        FROM prompts
        WHERE created_at >= ${startDate}
        AND blocked = false
        AND source = ${source}
      `);
    } else {
      [activeUsersResult] = await db.execute<{ active_users: number }>(sql`
        SELECT COUNT(DISTINCT user_id) as active_users
        FROM prompts
        WHERE created_at >= ${startDate}
        AND blocked = false
      `);
    }

    // Daily trends — filter by source if provided
    let daily;
    if (source) {
      daily = await db.execute(sql`
        SELECT created_at::date as date,
               COUNT(*) as prompts,
               COALESCE(SUM(credit_cost), 0) as credits
        FROM prompts
        WHERE created_at >= ${startDate}
        AND blocked = false
        AND source = ${source}
        GROUP BY created_at::date ORDER BY date
      `);
    } else {
      daily = await db.execute(sql`
        SELECT created_at::date as date,
               COUNT(*) as prompts,
               COALESCE(SUM(credit_cost), 0) as credits
        FROM prompts
        WHERE created_at >= ${startDate}
        AND blocked = false
        GROUP BY created_at::date ORDER BY date
      `);
    }

    // Model distribution — filter by source if provided
    let models;
    if (source) {
      models = await db.execute(sql`
        SELECT model,
               COUNT(*) as count,
               COALESCE(SUM(credit_cost), 0) as credits
        FROM prompts
        WHERE created_at >= ${startDate}
        AND blocked = false
        AND source = ${source}
        GROUP BY model
      `);
    } else {
      models = await db.execute(sql`
        SELECT model,
               COUNT(*) as count,
               COALESCE(SUM(credit_cost), 0) as credits
        FROM prompts
        WHERE created_at >= ${startDate}
        AND blocked = false
        GROUP BY model
      `);
    }

    res.json({
      overview: {
        total_prompts: Number(overview?.total_prompts ?? 0),
        total_sessions: Number(sessionCount?.total_sessions ?? 0),
        total_credits: Number(overview?.total_credits ?? 0),
        active_users: Number(activeUsersResult?.active_users ?? 0),
        ag_prompts: Number(agOverview?.ag_prompts ?? 0),
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

adminRouter.get('/analytics/users', async (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const sortBy = (req.query.sortBy as string) || 'prompts';
    const source = req.query.source as string | undefined;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const db = getDb();

    const orderColumn = sortBy === 'credits' ? 'credits' : sortBy === 'sessions' ? 'sessions' : sortBy === 'cost_usd' ? 'cost_usd' : 'prompts';

    // Build base query with or without source filter
    let data;
    if (source) {
      data = await db.execute(sql`
        SELECT u.id, u.name, u.email, u.status, u.default_model,
               COUNT(CASE WHEN p.source IS NULL OR p.source = 'claude_code' THEN p.id END) as prompts,
               COALESCE(SUM(CASE WHEN p.source IS NULL OR p.source = 'claude_code' THEN p.credit_cost ELSE 0 END), 0) as credits,
               COUNT(CASE WHEN p.source = 'antigravity' THEN p.id END) as ag_prompts,
               COUNT(CASE WHEN p.source = 'codex' THEN p.id END) as codex_prompts,
               COALESCE(SUM(CASE WHEN p.source = 'codex' THEN p.credit_cost ELSE 0 END), 0) as codex_credits,
               (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.started_at >= ${startDate}) as sessions,
               COALESCE(SUM(CASE WHEN p.source IS NULL OR p.source = 'claude_code' THEN p.credit_cost ELSE 0 END), 0) as cost_usd,
               (SELECT model FROM prompts WHERE user_id = u.id AND blocked = false AND model IS NOT NULL GROUP BY model ORDER BY COUNT(*) DESC LIMIT 1) as top_model
        FROM users u
        LEFT JOIN prompts p ON p.user_id = u.id AND p.created_at >= ${startDate} AND p.blocked = false AND p.source = ${source}
        GROUP BY u.id
        ORDER BY ${sql.raw(orderColumn)} DESC
      `);
    } else {
      data = await db.execute(sql`
        SELECT u.id, u.name, u.email, u.status, u.default_model,
               COUNT(CASE WHEN p.source IS NULL OR p.source = 'claude_code' THEN p.id END) as prompts,
               COALESCE(SUM(CASE WHEN p.source IS NULL OR p.source = 'claude_code' THEN p.credit_cost ELSE 0 END), 0) as credits,
               COUNT(CASE WHEN p.source = 'antigravity' THEN p.id END) as ag_prompts,
               COUNT(CASE WHEN p.source = 'codex' THEN p.id END) as codex_prompts,
               COALESCE(SUM(CASE WHEN p.source = 'codex' THEN p.credit_cost ELSE 0 END), 0) as codex_credits,
               (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.started_at >= ${startDate}) as sessions,
               COALESCE(SUM(CASE WHEN p.source IS NULL OR p.source = 'claude_code' THEN p.credit_cost ELSE 0 END), 0) as cost_usd,
               (SELECT model FROM prompts WHERE user_id = u.id AND blocked = false AND model IS NOT NULL GROUP BY model ORDER BY COUNT(*) DESC LIMIT 1) as top_model
        FROM users u
        LEFT JOIN prompts p ON p.user_id = u.id AND p.created_at >= ${startDate} AND p.blocked = false
        GROUP BY u.id
        ORDER BY ${sql.raw(orderColumn)} DESC
      `);
    }

    res.json({ data });
  } catch (err) {
    console.error('[admin-api] analytics users error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /analytics/projects?days=N
// ---------------------------------------------------------------------------

adminRouter.get('/analytics/projects', async (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const source = req.query.source as string | undefined;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const db = getDb();

    let data;
    if (source) {
      data = await db.execute(sql`
        SELECT s.cwd as project,
               COUNT(p.id) as prompts,
               COALESCE(SUM(p.credit_cost), 0) as credits
        FROM prompts p
        JOIN sessions s ON s.id = p.session_id
        WHERE p.created_at >= ${startDate}
        AND p.blocked = false
        AND p.source = ${source}
        GROUP BY s.cwd
        ORDER BY prompts DESC
      `);
    } else {
      data = await db.execute(sql`
        SELECT s.cwd as project,
               COUNT(p.id) as prompts,
               COALESCE(SUM(p.credit_cost), 0) as credits
        FROM prompts p
        JOIN sessions s ON s.id = p.session_id
        WHERE p.created_at >= ${startDate}
        AND p.blocked = false
        GROUP BY s.cwd
        ORDER BY prompts DESC
      `);
    }

    res.json({ data });
  } catch (err) {
    console.error('[admin-api] analytics projects error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /analytics/costs?days=N
// ---------------------------------------------------------------------------

adminRouter.get('/analytics/costs', async (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const source = req.query.source as string | undefined;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const db = getDb();

    let data;
    if (source) {
      data = await db.execute(sql`
        SELECT model,
               COALESCE(SUM(credit_cost), 0) as credits,
               COUNT(*) as prompts,
               COALESCE(SUM(credit_cost), 0) as cost_usd
        FROM prompts
        WHERE created_at >= ${startDate}
        AND blocked = false
        AND source = ${source}
        GROUP BY model
        ORDER BY credits DESC
      `);
    } else {
      data = await db.execute(sql`
        SELECT model,
               COALESCE(SUM(credit_cost), 0) as credits,
               COUNT(*) as prompts,
               COALESCE(SUM(credit_cost), 0) as cost_usd
        FROM prompts
        WHERE created_at >= ${startDate}
        AND blocked = false
        GROUP BY model
        ORDER BY credits DESC
      `);
    }

    res.json({ data });
  } catch (err) {
    console.error('[admin-api] analytics costs error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /prompts
// ---------------------------------------------------------------------------

adminRouter.get('/prompts', async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = (page - 1) * limit;
    const userId = req.query.user_id as string | undefined;
    const search = req.query.search as string | undefined;
    const source = req.query.source as string | undefined;

    const db = getDb();

    // Build dynamic conditions
    const conditions: ReturnType<typeof sql>[] = [];
    if (userId) {
      conditions.push(sql`p.user_id = ${parseInt(userId, 10)}`);
    }
    if (search) {
      conditions.push(sql`p.prompt ILIKE ${'%' + search + '%'}`);
    }
    if (source) {
      conditions.push(sql`p.source = ${source}`);
    }

    const whereClause = conditions.length > 0
      ? sql`WHERE ${sql.join(conditions, sql` AND `)}`
      : sql``;

    const totalResult = await db.execute<{ count: number }>(sql`
      SELECT COUNT(*) as count FROM prompts p ${whereClause}
    `);

    const data = await db.execute(sql`
      SELECT p.id, p.session_id, p.user_id, p.prompt, p.model, p.credit_cost,
             p.blocked, p.block_reason, p.created_at, p.turn_id,
             p.input_tokens, p.output_tokens, p.cached_tokens, p.reasoning_tokens, p.source
      FROM prompts p ${whereClause} ORDER BY p.created_at DESC LIMIT ${limit} OFFSET ${offset}
    `);

    res.json({ data, total: Number(totalResult[0]?.count ?? 0), page, limit });
  } catch (err) {
    console.error('[admin-api] list prompts error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /summaries
// ---------------------------------------------------------------------------

adminRouter.get('/summaries', async (_req: Request, res: Response) => {
  try {
    const data = await getSummaries();
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

    const db = getDb();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const targetUserId = req.body.user_id as string | undefined;

    let recentPrompts;
    let summaryUserId: number | undefined;

    if (targetUserId) {
      const parsedId = parseInt(targetUserId, 10);
      const targetUser = await getUserById(parsedId);
      if (!targetUser) { res.status(404).json({ error: 'User not found' }); return; }
      summaryUserId = parsedId;
      recentPrompts = await db.execute<{ prompt: string; model: string; created_at: string }>(sql`
        SELECT prompt, model, created_at
        FROM prompts
        WHERE user_id = ${parsedId}
        AND created_at >= ${since}
        AND blocked = false
        AND prompt IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 200
      `);
    } else {
      recentPrompts = await db.execute<{ prompt: string; model: string; created_at: string }>(sql`
        SELECT prompt, model, created_at
        FROM prompts
        WHERE created_at >= ${since}
        AND blocked = false
        AND prompt IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 200
      `);
    }

    if (recentPrompts.length === 0) {
      res.json({ status: 'no_data', message: 'No prompts in the last 24 hours to summarize' });
      return;
    }

    // Call AI to generate summary
    const result = await generateSummary(recentPrompts as any);

    // Save result to DB
    const summary = await createSummary({
      userId: summaryUserId,
      period: 'daily',
      summary: result.summary,
      categories: JSON.stringify(result.categories),
      topics: JSON.stringify(result.topics),
      riskLevel: result.risk_level,
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

adminRouter.get('/audit-log', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;

    const db = getDb();
    const data = await db.execute(sql`
      SELECT he.* FROM hook_events he
      ORDER BY he.created_at DESC
      LIMIT ${limit}
    `);

    res.json({ data });
  } catch (err) {
    console.error('[admin-api] audit log error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /tamper-alerts
// ---------------------------------------------------------------------------

adminRouter.get('/tamper-alerts', async (req: Request, res: Response) => {
  try {
    const users = await getAllUsers();
    const userMap = new Map(users.map((u) => [u.id, u]));

    const alerts = await getUnresolvedTamperAlerts();
    const enriched = alerts
      .filter((a) => userMap.has(a.userId))
      .map((a) => ({
        ...a,
        user_name: userMap.get(a.userId)?.name || 'Unknown',
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

adminRouter.post('/tamper-alerts/:id/resolve', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: 'Invalid alert ID' });
      return;
    }
    const resolved = await resolveTamperAlert(id);
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

adminRouter.post('/users/:id/watcher/command', async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.id as string, 10);
    if (isNaN(userId)) { res.status(400).json({ error: 'Invalid user ID' }); return; }

    const user = await getUserById(userId);
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }

    const { command, message } = req.body;
    if (!command) { res.status(400).json({ error: 'command required' }); return; }

    const payload = message ? JSON.stringify({ message }) : undefined;
    const cmd = await createWatcherCommand({ userId: user.id, command, payload });

    // Try instant delivery via WebSocket
    const delivered = sendToWatcher(user.id, command, message ? { message } : undefined);
    if (delivered) {
      await markWatcherCommandDelivered(cmd.id);
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

adminRouter.get('/users/:id/watcher/logs', async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.id as string, 10);
    if (isNaN(userId)) { res.status(400).json({ error: 'Invalid user ID' }); return; }

    const user = await getUserById(userId);
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }

    if (req.query.history === 'true') {
      const db = getDb();
      const history = await db.execute(sql`
        SELECT id, uploaded_at,
               LENGTH(hook_log) as hook_log_size,
               LENGTH(watcher_log) as watcher_log_size
        FROM watcher_logs WHERE user_id = ${user.id} ORDER BY id DESC LIMIT 10
      `);
      res.json({ data: history });
      return;
    }

    const logs = await getLatestWatcherLogs(user.id);
    res.json({ data: logs || null });
  } catch (err) {
    console.error('[admin-api] watcher logs error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /users/:id/watcher/logs/:logId — View a specific log entry
// ---------------------------------------------------------------------------

adminRouter.get('/users/:id/watcher/logs/:logId', async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.id as string, 10);
    if (isNaN(userId)) { res.status(400).json({ error: 'Invalid user ID' }); return; }

    const user = await getUserById(userId);
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }

    const db = getDb();
    const logId = parseInt(req.params.logId as string, 10);
    const results = await db.execute(sql`
      SELECT * FROM watcher_logs WHERE id = ${logId} AND user_id = ${user.id}
    `);
    const log = results[0];

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

adminRouter.get('/users/:id/watcher/status', async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.id as string, 10);
    if (isNaN(userId)) { res.status(400).json({ error: 'Invalid user ID' }); return; }

    const user = await getUserById(userId);
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }

    // lastEventAt is a Date object from Drizzle
    const lastEvent = user.lastEventAt;
    const formattedLastEvent = lastEvent ? lastEvent.toISOString() : null;

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

adminRouter.get('/events/recent', async (req: Request, res: Response) => {
  try {
    const since = req.query.since as string || new Date(Date.now() - 30000).toISOString(); // default: last 30s
    const db = getDb();

    const events = await db.execute(sql`
      SELECT he.*, u.name as user_name
      FROM hook_events he
      LEFT JOIN users u ON he.user_id = u.id
      WHERE he.created_at > ${since}
      ORDER BY he.created_at DESC
      LIMIT 20
    `);

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
    const sessionId = req.params.id as string;
    const session = await getSessionById(sessionId);
    if (!session) { res.status(404).json({ error: 'Session not found' }); return; }

    // Clear existing analysis to force re-analysis
    const db = getDb();
    await db.execute(sql`UPDATE sessions SET ai_analyzed_at = NULL WHERE id = ${sessionId}`);

    queueSessionAnalysis(sessionId, session.userId);
    res.json({ status: 'queued' });
  } catch (err) {
    console.error('[admin-api] session analyze error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /users/:id/profile — get user's AI profile
// ---------------------------------------------------------------------------

adminRouter.get('/users/:id/profile', async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.id as string, 10);
    if (isNaN(userId)) { res.status(400).json({ error: 'Invalid user ID' }); return; }

    const user = await getUserById(userId);
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }
    const profile = await getUserProfile(user.id);
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
    const userId = parseInt(req.params.id as string, 10);
    if (isNaN(userId)) { res.status(400).json({ error: 'Invalid user ID' }); return; }

    const user = await getUserById(userId);
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }
    await updateUserProfile(user.id);
    const profile = await getUserProfile(user.id);
    res.json({ status: 'complete', data: profile ? { ...profile, profile: JSON.parse(profile.profile) } : null });
  } catch (err) {
    console.error('[admin-api] profile update error:', err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// ---------------------------------------------------------------------------
// GET /profiles — list all user profiles
// ---------------------------------------------------------------------------

adminRouter.get('/profiles', async (_req: Request, res: Response) => {
  try {
    const profiles = await getAllUserProfiles();
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

adminRouter.post('/pulse/generate', async (_req: Request, res: Response) => {
  try {
    await generateTeamPulse();
    const pulse = await getLatestTeamPulse();
    res.json({ status: 'complete', data: pulse ? { ...pulse, pulse: JSON.parse(pulse.pulse) } : null });
  } catch (err) {
    console.error('[admin-api] pulse generate error:', err);
    res.status(500).json({ error: 'Failed to generate pulse' });
  }
});

// ---------------------------------------------------------------------------
// GET /pulse — get latest pulse
// ---------------------------------------------------------------------------

adminRouter.get('/pulse', async (_req: Request, res: Response) => {
  try {
    const pulse = await getLatestTeamPulse();
    res.json({ data: pulse ? { ...pulse, pulse: JSON.parse(pulse.pulse) } : null });
  } catch (err) {
    console.error('[admin-api] pulse error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /pulse/history — get previous pulses
// ---------------------------------------------------------------------------

adminRouter.get('/pulse/history', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const pulses = await getTeamPulseHistory(limit);
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

adminRouter.get('/sessions/analyzed', async (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 7;
    const userId = req.query.user_id as string | undefined;
    const minScore = parseInt(req.query.min_score as string) || 0;
    const limit = parseInt(req.query.limit as string) || 50;
    const since = new Date(Date.now() - days * 86400000);

    const db = getDb();

    const conditions: ReturnType<typeof sql>[] = [
      sql`s.started_at >= ${since}`,
    ];

    if (userId) { conditions.push(sql`s.user_id = ${parseInt(userId, 10)}`); }
    if (minScore > 0) { conditions.push(sql`s.ai_productivity_score >= ${minScore}`); }

    const whereClause = sql`WHERE ${sql.join(conditions, sql` AND `)}`;

    const sessions = await db.execute(sql`
      SELECT s.*, u.name as user_name FROM sessions s LEFT JOIN users u ON s.user_id = u.id ${whereClause} ORDER BY s.started_at DESC LIMIT ${limit}
    `);

    res.json({ data: sessions });
  } catch (err) {
    console.error('[admin-api] analyzed sessions error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /model-credits — list all model credit weights
// ---------------------------------------------------------------------------

adminRouter.get('/model-credits', async (req: Request, res: Response) => {
  try {
    const source = req.query.source as string | undefined;
    const credits = await getModelCredits(source || undefined);
    res.json({ data: credits });
  } catch (err: any) {
    console.error('[admin-api] model-credits error:', err);
    res.status(500).json({ error: 'Failed to load model credits' });
  }
});

// ---------------------------------------------------------------------------
// PUT /model-credits/:id — update a credit weight
// ---------------------------------------------------------------------------

adminRouter.put('/model-credits/:id', async (req: Request, res: Response) => {
  try {
    const { credits, tier } = req.body;
    const db = getDb();
    const creditId = parseInt(req.params.id as string, 10);
    const results = await db.execute(sql`SELECT * FROM model_credits WHERE id = ${creditId}`);
    const existing = results[0] as any;
    if (!existing) { res.status(404).json({ error: 'Not found' }); return; }
    await db.execute(sql`
      UPDATE model_credits SET credits = ${credits ?? existing.credits}, tier = ${tier ?? existing.tier} WHERE id = ${creditId}
    `);
    res.json({ success: true });
  } catch (err: any) {
    console.error('[admin-api] update model-credit error:', err);
    res.status(500).json({ error: 'Failed to update' });
  }
});

// ---------------------------------------------------------------------------
// GET /provider-quotas/:userId — provider quota windows for a user
// ---------------------------------------------------------------------------

adminRouter.get('/provider-quotas/:userId', async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.userId as string, 10);
    if (isNaN(userId)) { res.status(400).json({ error: 'Invalid user ID' }); return; }
    const source = (req.query.source as string) || 'codex';
    const quotas = await getProviderQuotas(userId, source);
    res.json({ data: quotas });
  } catch (err: any) {
    console.error('[admin-api] provider-quotas error:', err);
    res.status(500).json({ error: 'Failed to load quotas' });
  }
});

// ---------------------------------------------------------------------------
// Roles & Permissions
// ---------------------------------------------------------------------------

adminRouter.get('/roles', async (_req: Request, res: Response) => {
  try {
    const rolesList = await getAllRoles();
    res.json(rolesList);
  } catch (err) {
    console.error('[admin-api] list roles error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

adminRouter.post('/roles', async (req: Request, res: Response) => {
  try {
    const role = await createRole(req.body);
    res.json(role);
  } catch (err) {
    console.error('[admin-api] create role error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

adminRouter.put('/roles/:id', async (req: Request, res: Response) => {
  try {
    const role = await updateRole(parseInt(req.params.id as string), req.body);
    if (!role) return res.status(404).json({ error: 'Role not found' });
    res.json(role);
  } catch (err) {
    console.error('[admin-api] update role error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

adminRouter.delete('/roles/:id', async (req: Request, res: Response) => {
  try {
    const deleted = await deleteRole(parseInt(req.params.id as string));
    if (!deleted) return res.status(404).json({ error: 'Role not found or is system role' });
    res.json({ success: true });
  } catch (err) {
    console.error('[admin-api] delete role error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

adminRouter.get('/permissions', async (_req: Request, res: Response) => {
  try {
    const perms = await getAllPermissions();
    res.json(perms);
  } catch (err) {
    console.error('[admin-api] list permissions error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

adminRouter.get('/roles/:id/permissions', async (req: Request, res: Response) => {
  try {
    const perms = await getRolePermissions(parseInt(req.params.id as string));
    res.json(perms);
  } catch (err) {
    console.error('[admin-api] get role permissions error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

adminRouter.put('/roles/:id/permissions', async (req: Request, res: Response) => {
  try {
    await setRolePermissions(parseInt(req.params.id as string), req.body.permissionIds);
    const perms = await getRolePermissions(parseInt(req.params.id as string));
    res.json(perms);
  } catch (err) {
    console.error('[admin-api] set role permissions error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

adminRouter.get('/projects', async (_req: Request, res: Response) => {
  try {
    const projectsList = await getAllProjects();
    res.json(projectsList);
  } catch (err) {
    console.error('[admin-api] list projects error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

adminRouter.post('/projects', async (req: Request, res: Response) => {
  try {
    const project = await createProject({ ...req.body, createdBy: req.admin?.sub });
    res.json(project);
  } catch (err) {
    console.error('[admin-api] create project error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

adminRouter.get('/projects/:id', async (req: Request, res: Response) => {
  try {
    const project = await getProjectById(parseInt(req.params.id as string));
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json(project);
  } catch (err) {
    console.error('[admin-api] get project error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

adminRouter.put('/projects/:id', async (req: Request, res: Response) => {
  try {
    const project = await updateProject(parseInt(req.params.id as string), req.body);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json(project);
  } catch (err) {
    console.error('[admin-api] update project error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

adminRouter.delete('/projects/:id', async (req: Request, res: Response) => {
  try {
    const deleted = await deleteProject(parseInt(req.params.id as string));
    if (!deleted) return res.status(404).json({ error: 'Project not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('[admin-api] delete project error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

adminRouter.get('/projects/:id/members', async (req: Request, res: Response) => {
  try {
    const members = await getProjectMembers(parseInt(req.params.id as string));
    res.json(members);
  } catch (err) {
    console.error('[admin-api] get project members error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

adminRouter.post('/projects/:id/members', async (req: Request, res: Response) => {
  try {
    const member = await addProjectMember({ projectId: parseInt(req.params.id as string), ...req.body, addedBy: req.admin?.sub });
    res.json(member);
  } catch (err) {
    console.error('[admin-api] add project member error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

adminRouter.delete('/projects/:id/members/:userId', async (req: Request, res: Response) => {
  try {
    const removed = await removeProjectMember(parseInt(req.params.id as string), parseInt(req.params.userId as string));
    if (!removed) return res.status(404).json({ error: 'Member not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('[admin-api] remove project member error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Project Repositories ──

adminRouter.get('/projects/:id/repositories', adminAuth, async (req: Request, res: Response) => {
  try {
    const repos = await getProjectRepositories(parseInt(req.params.id as string));
    res.json(repos);
  } catch (err) {
    console.error('[admin-api] list repositories error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

adminRouter.post('/projects/:id/repositories', adminAuth, async (req: Request, res: Response) => {
  try {
    const repo = await addProjectRepository({ projectId: parseInt(req.params.id as string), ...req.body });
    res.json(repo);
  } catch (err) {
    console.error('[admin-api] add repository error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

adminRouter.delete('/repositories/:id', adminAuth, async (req: Request, res: Response) => {
  try {
    const deleted = await removeProjectRepository(parseInt(req.params.id as string));
    if (!deleted) return res.status(404).json({ error: 'Repository not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('[admin-api] remove repository error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Tasks ──

adminRouter.get('/tasks', adminAuth, async (req: Request, res: Response) => {
  try {
    const { projectId, status, assigneeId, milestoneId } = req.query;
    if (!projectId) return res.status(400).json({ error: 'projectId required' });
    const tasks = await getTasksByProject(parseInt(projectId as string), {
      status: status as string,
      assigneeId: assigneeId ? parseInt(assigneeId as string) : undefined,
      milestoneId: milestoneId ? parseInt(milestoneId as string) : undefined,
    });
    res.json(tasks);
  } catch (err) {
    console.error('[admin-api] list tasks error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

adminRouter.post('/tasks', adminAuth, async (req: Request, res: Response) => {
  try {
    const task = await createTask({ ...req.body, createdBy: req.admin?.sub });
    if (req.body.assigneeId) {
      await recordTaskActivity({ taskId: task.id, userId: req.admin!.sub, action: 'assigned', newValue: String(req.body.assigneeId) });
    }
    await recordTaskActivity({ taskId: task.id, userId: req.admin!.sub, action: 'created' });
    res.json(task);
  } catch (err) {
    console.error('[admin-api] create task error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

adminRouter.get('/tasks/:id', adminAuth, async (req: Request, res: Response) => {
  try {
    const task = await getTaskById(parseInt(req.params.id as string));
    if (!task) return res.status(404).json({ error: 'Task not found' });
    const comments = await getTaskComments(task.id);
    const activity = await getTaskActivity(task.id);
    const subtasks = await getSubtasks(task.id);
    res.json({ ...task, comments, activity, subtasks });
  } catch (err) {
    console.error('[admin-api] get task error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

adminRouter.put('/tasks/:id', adminAuth, async (req: Request, res: Response) => {
  try {
    const taskId = parseInt(req.params.id as string);
    const old = await getTaskById(taskId);
    if (!old) return res.status(404).json({ error: 'Task not found' });

    const task = await updateTask(taskId, { ...req.body, updatedAt: new Date() });

    // Record activity for changed fields
    if (req.body.status && req.body.status !== old.status) {
      await recordTaskActivity({ taskId, userId: req.admin!.sub, action: 'status_changed', oldValue: old.status, newValue: req.body.status });
    }
    if (req.body.assigneeId !== undefined && req.body.assigneeId !== old.assigneeId) {
      await recordTaskActivity({ taskId, userId: req.admin!.sub, action: 'assigned', oldValue: old.assigneeId ? String(old.assigneeId) : undefined, newValue: String(req.body.assigneeId) });
    }
    if (req.body.priority && req.body.priority !== old.priority) {
      await recordTaskActivity({ taskId, userId: req.admin!.sub, action: 'priority_changed', oldValue: old.priority || undefined, newValue: req.body.priority });
    }

    res.json(task);
  } catch (err) {
    console.error('[admin-api] update task error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

adminRouter.delete('/tasks/:id', adminAuth, async (req: Request, res: Response) => {
  try {
    const deleted = await deleteTask(parseInt(req.params.id as string));
    if (!deleted) return res.status(404).json({ error: 'Task not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('[admin-api] delete task error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

adminRouter.post('/tasks/:id/comments', adminAuth, async (req: Request, res: Response) => {
  try {
    const comment = await addTaskComment({ taskId: parseInt(req.params.id as string), userId: req.admin!.sub, content: req.body.content });
    await recordTaskActivity({ taskId: parseInt(req.params.id as string), userId: req.admin!.sub, action: 'commented' });
    res.json(comment);
  } catch (err) {
    console.error('[admin-api] add comment error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

adminRouter.get('/tasks/:id/activity', adminAuth, async (req: Request, res: Response) => {
  try {
    const activity = await getTaskActivity(parseInt(req.params.id as string));
    res.json(activity);
  } catch (err) {
    console.error('[admin-api] get activity error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

adminRouter.put('/tasks/:id/assign', adminAuth, async (req: Request, res: Response) => {
  try {
    const taskId = parseInt(req.params.id as string);
    const old = await getTaskById(taskId);
    if (!old) return res.status(404).json({ error: 'Task not found' });
    const task = await updateTask(taskId, { assigneeId: req.body.assigneeId, updatedAt: new Date() });
    await recordTaskActivity({ taskId, userId: req.admin!.sub, action: 'assigned', oldValue: old.assigneeId ? String(old.assigneeId) : undefined, newValue: String(req.body.assigneeId) });
    res.json(task);
  } catch (err) {
    console.error('[admin-api] assign task error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

adminRouter.put('/tasks/:id/status', adminAuth, async (req: Request, res: Response) => {
  try {
    const taskId = parseInt(req.params.id as string);
    const old = await getTaskById(taskId);
    if (!old) return res.status(404).json({ error: 'Task not found' });
    const task = await updateTask(taskId, { status: req.body.status, updatedAt: new Date() });
    await recordTaskActivity({ taskId, userId: req.admin!.sub, action: 'status_changed', oldValue: old.status, newValue: req.body.status });
    res.json(task);
  } catch (err) {
    console.error('[admin-api] change status error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Milestones ──

adminRouter.get('/projects/:id/milestones', adminAuth, async (req: Request, res: Response) => {
  try {
    const milestones = await getMilestonesByProject(parseInt(req.params.id as string));
    res.json(milestones);
  } catch (err) {
    console.error('[admin-api] list milestones error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

adminRouter.post('/projects/:id/milestones', adminAuth, async (req: Request, res: Response) => {
  try {
    const milestone = await createMilestone({ projectId: parseInt(req.params.id as string), ...req.body });
    res.json(milestone);
  } catch (err) {
    console.error('[admin-api] create milestone error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

adminRouter.put('/milestones/:id', adminAuth, async (req: Request, res: Response) => {
  try {
    const milestone = await updateMilestone(parseInt(req.params.id as string), req.body);
    if (!milestone) return res.status(404).json({ error: 'Milestone not found' });
    res.json(milestone);
  } catch (err) {
    console.error('[admin-api] update milestone error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

adminRouter.delete('/milestones/:id', adminAuth, async (req: Request, res: Response) => {
  try {
    const deleted = await deleteMilestone(parseInt(req.params.id as string));
    if (!deleted) return res.status(404).json({ error: 'Milestone not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('[admin-api] delete milestone error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Task Status Configs ──

adminRouter.get('/projects/:id/statuses', adminAuth, async (req: Request, res: Response) => {
  try {
    const statuses = await getStatusConfigs(parseInt(req.params.id as string));
    res.json(statuses);
  } catch (err) {
    console.error('[admin-api] list statuses error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

adminRouter.post('/projects/:id/statuses', adminAuth, async (req: Request, res: Response) => {
  try {
    const status = await createStatusConfig({ projectId: parseInt(req.params.id as string), ...req.body });
    res.json(status);
  } catch (err) {
    console.error('[admin-api] create status error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

adminRouter.put('/statuses/:id', adminAuth, async (req: Request, res: Response) => {
  try {
    const status = await updateStatusConfig(parseInt(req.params.id as string), req.body);
    if (!status) return res.status(404).json({ error: 'Status not found' });
    res.json(status);
  } catch (err) {
    console.error('[admin-api] update status error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

adminRouter.delete('/statuses/:id', adminAuth, async (req: Request, res: Response) => {
  try {
    const deleted = await deleteStatusConfig(parseInt(req.params.id as string));
    if (!deleted) return res.status(404).json({ error: 'Status not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('[admin-api] delete status error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── AI Requirements & Task Generation ──

adminRouter.post('/requirements', adminAuth, async (req: Request, res: Response) => {
  try {
    const input = await createRequirementInput({ ...req.body, createdBy: req.admin?.sub });

    // Trigger AI task generation in background (don't await — let it run async)
    generateTaskSuggestions(input.id).catch(err => {
      console.error('[admin-api] Background task generation failed:', err);
    });

    res.json(input);
  } catch (err) {
    console.error('[admin-api] create requirement error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

adminRouter.get('/requirements/:id/suggestions', adminAuth, async (req: Request, res: Response) => {
  try {
    const suggestion = await getAITaskSuggestionByRequirement(parseInt(req.params.id as string));
    res.json(suggestion || { status: 'not_generated' });
  } catch (err) {
    console.error('[admin-api] get suggestions error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

adminRouter.post('/requirements/:id/approve', adminAuth, async (req: Request, res: Response) => {
  try {
    const requirementId = parseInt(req.params.id as string);
    const suggestion = await getAITaskSuggestionByRequirement(requirementId);
    if (!suggestion) return res.status(404).json({ error: 'Suggestion not found' });

    if (suggestion.status !== 'pending') {
      return res.status(400).json({ error: 'Suggestion already processed' });
    }

    // Create tasks from approved suggestions
    const suggestedTasks = suggestion.suggestedTasks as any[];
    const createdTasks = [];
    if (Array.isArray(suggestedTasks)) {
      for (const st of suggestedTasks) {
        const task = await createTask({
          projectId: suggestion.projectId,
          title: st.title,
          description: st.description,
          priority: st.priority,
          effort: st.effort,
          assigneeId: st.suggestedAssigneeId || st.assigneeId,
          createdBy: req.admin!.sub,
        });
        await recordTaskActivity({ taskId: task.id, userId: req.admin!.sub, action: 'created' });
        createdTasks.push(task);
      }
    }

    await updateAITaskSuggestionStatus(suggestion.id, 'approved', req.admin!.sub);
    res.json({ success: true, tasksCreated: createdTasks.length, tasks: createdTasks });
  } catch (err) {
    console.error('[admin-api] approve suggestions error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

adminRouter.post('/requirements/:id/reject', adminAuth, async (req: Request, res: Response) => {
  try {
    const requirementId = parseInt(req.params.id as string);
    const suggestion = await getAITaskSuggestionByRequirement(requirementId);
    if (!suggestion) return res.status(404).json({ error: 'Suggestion not found' });

    await updateAITaskSuggestionStatus(suggestion.id, 'rejected', req.admin!.sub);
    res.json({ success: true });
  } catch (err) {
    console.error('[admin-api] reject suggestions error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Activity Tracking (Admin view) ──

adminRouter.get('/activity/:userId', adminAuth, async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.userId as string);
    const since = req.query.since ? new Date(req.query.since as string) : undefined;
    const fileEvents = await getFileEventsByUser(userId, since);
    const appTracking = await getAppTrackingByUser(userId);
    const watchEvents = await getWatchEventsByUser(userId);
    res.json({ fileEvents, appTracking, watchEvents });
  } catch (err) {
    console.error('[admin-api] activity error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

adminRouter.get('/activity/windows/:userId', adminAuth, async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.userId as string);
    const date = req.query.date as string | undefined;
    const windows = await getActivityWindows(userId, date);
    res.json(windows);
  } catch (err) {
    console.error('[admin-api] activity windows error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
