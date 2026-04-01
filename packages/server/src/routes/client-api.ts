import { Router } from 'express';
import type { Request, Response, Router as RouterType } from 'express';
import {
  upsertHeartbeat, getHeartbeat, getLatestWatchEvent, recordWatchEvent,
  getActiveAssignment, assignCredentialToUser, releaseCredentialFromUser,
  getLeastUsedCredential, getSubscriptionCredentialById,
  recordConversationMessages, getConversationsByUser,
  upsertSessionRawJsonl,
} from '../db/queries/credentials.js';
import { getTasksByUser, getTaskById, updateTask } from '../db/queries/tasks.js';
import { getProjectDirectories, linkProjectDirectory, getProjectDirectoryByPath } from '../db/queries/tracking.js';
import { recordFileEvents } from '../db/queries/tracking.js';
import { recordAppTracking } from '../db/queries/tracking.js';
import { updateUser } from '../db/queries/users.js';
import { getProjectById } from '../db/queries/projects.js';

export const clientRouter: RouterType = Router();

// POST /heartbeat — client pings every 30s
clientRouter.post('/heartbeat', async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { clientVersion, platform, watchStatus, activeTaskId } = req.body;
    const heartbeat = await upsertHeartbeat({
      userId: user.id,
      clientVersion,
      platform,
      watchStatus,
      activeTaskId,
    });
    res.json({ ok: true, heartbeat });
  } catch (err) {
    console.error('[client-api] heartbeat error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /watch/on — punch in / start tracking
clientRouter.post('/watch/on', async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { source, latitude, longitude } = req.body;

    // Record watch event
    await recordWatchEvent({ userId: user.id, type: 'on', source, latitude, longitude });

    // Assign credential if not already assigned
    let assignment = await getActiveAssignment(user.id);
    let credential = null;

    if (!assignment) {
      // Find least-used subscription credential and assign
      const leastUsed = await getLeastUsedCredential();
      if (leastUsed) {
        assignment = await assignCredentialToUser(leastUsed.id as number, user.id);
        credential = leastUsed;
      }
    } else {
      credential = await getSubscriptionCredentialById(assignment.credentialId);
    }

    res.json({
      ok: true,
      watchStatus: 'on',
      credential: credential ? {
        accessToken: credential.accessToken,
        refreshToken: credential.refreshToken,
        expiresAt: credential.expiresAt,
        subscriptionType: credential.subscriptionType,
      } : null,
    });
  } catch (err) {
    console.error('[client-api] watch/on error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /watch/off — punch out / stop tracking
clientRouter.post('/watch/off', async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { source, latitude, longitude } = req.body;

    // Record watch event
    await recordWatchEvent({ userId: user.id, type: 'off', source, latitude, longitude });

    // Release credential
    await releaseCredentialFromUser(user.id);

    res.json({ ok: true, watchStatus: 'off' });
  } catch (err) {
    console.error('[client-api] watch/off error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /status — current user status
clientRouter.get('/status', async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const heartbeat = await getHeartbeat(user.id);
    const watchEvent = await getLatestWatchEvent(user.id);
    const assignment = await getActiveAssignment(user.id);

    let credential = null;
    if (assignment) {
      credential = await getSubscriptionCredentialById(assignment.credentialId);
    }

    res.json({
      user: { id: user.id, name: user.name, email: user.email, status: user.status },
      watchStatus: heartbeat?.watchStatus || 'off',
      lastWatchEvent: watchEvent,
      credential: credential ? {
        email: credential.email,
        subscriptionType: credential.subscriptionType,
        expiresAt: credential.expiresAt,
      } : null,
      heartbeat: heartbeat ? { lastPingAt: heartbeat.lastPingAt, platform: heartbeat.platform, clientVersion: heartbeat.clientVersion } : null,
    });
  } catch (err) {
    console.error('[client-api] status error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /credential — get assigned credential for local machine
clientRouter.get('/credential', async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const assignment = await getActiveAssignment(user.id);

    if (!assignment) {
      return res.json({ credential: null });
    }

    const credential = await getSubscriptionCredentialById(assignment.credentialId);
    if (!credential) {
      return res.json({ credential: null });
    }

    res.json({
      credential: {
        accessToken: credential.accessToken,
        refreshToken: credential.refreshToken,
        expiresAt: credential.expiresAt,
        orgId: credential.orgId,
        subscriptionType: credential.subscriptionType,
        rateLimitTier: credential.rateLimitTier,
      },
    });
  } catch (err) {
    console.error('[client-api] credential error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /conversations — sync JSONL conversation data
clientRouter.post('/conversations', async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { messages } = req.body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.json({ ok: true, synced: 0 });
    }

    const valid = messages.every((m: any) => m.type && typeof m.type === 'string');
    if (!valid) {
      return res.status(400).json({ error: 'Each message must have a type field' });
    }

    const enriched = messages.map((m: any) => ({
      userId: user.id,
      sessionId: m.sessionId,
      type: m.type,
      messageContent: m.messageContent || m.content,
      model: m.model,
      inputTokens: m.inputTokens,
      outputTokens: m.outputTokens,
      cachedTokens: m.cachedTokens,
      cwd: m.cwd,
      gitBranch: m.gitBranch,
      timestamp: m.timestamp ? new Date(m.timestamp) : new Date(),
    }));

    await recordConversationMessages(enriched);
    res.json({ ok: true, synced: enriched.length });
  } catch (err) {
    console.error('[client-api] conversations error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /file-events — batch sync file change events
clientRouter.post('/file-events', async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { events } = req.body;

    if (!Array.isArray(events) || events.length === 0) {
      return res.json({ ok: true, synced: 0 });
    }

    const valid = events.every((e: any) => e.filePath && e.eventType);
    if (!valid) {
      return res.status(400).json({ error: 'Each event must have filePath and eventType' });
    }

    const enriched = events.map((e: any) => ({
      userId: user.id,
      projectId: e.projectId,
      filePath: e.filePath,
      eventType: e.eventType,
      sizeDelta: e.sizeDelta,
      timestamp: e.timestamp ? new Date(e.timestamp) : new Date(),
    }));

    await recordFileEvents(enriched);
    res.json({ ok: true, synced: enriched.length });
  } catch (err) {
    console.error('[client-api] file-events error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /app-tracking — sync app usage data
clientRouter.post('/app-tracking', async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { appName, windowTitle, startedAt, durationSeconds, date } = req.body;

    await recordAppTracking({
      userId: user.id,
      appName,
      windowTitle,
      startedAt: new Date(startedAt),
      durationSeconds,
      date: date || new Date().toISOString().slice(0, 10),
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('[client-api] app-tracking error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /project-directories — get known project directories for user
clientRouter.get('/project-directories', async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const dirs = await getProjectDirectories(user.id);
    res.json(dirs);
  } catch (err) {
    console.error('[client-api] project-directories error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /project-directories — register a discovered project directory
clientRouter.post('/project-directories', async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { projectId, localPath, discoveredVia } = req.body;

    if (!projectId || !localPath) {
      return res.status(400).json({ error: 'projectId and localPath required' });
    }

    // Verify project exists
    const project = await getProjectById(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Check if already linked
    const existing = await getProjectDirectoryByPath(user.id, localPath);
    if (existing) {
      return res.json({ ok: true, directory: existing, existing: true });
    }

    const dir = await linkProjectDirectory({ userId: user.id, projectId, localPath, discoveredVia });
    res.json({ ok: true, directory: dir });
  } catch (err) {
    console.error('[client-api] project-directories create error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /tasks — my assigned tasks
clientRouter.get('/tasks', async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const tasks = await getTasksByUser(user.id);
    res.json(tasks);
  } catch (err) {
    console.error('[client-api] tasks error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /tasks/:id/status — quick status update from client
clientRouter.put('/tasks/:id/status', async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const taskId = parseInt(req.params.id as string);
    const { status } = req.body;

    const existing = await getTaskById(taskId);
    if (!existing) return res.status(404).json({ error: 'Task not found' });
    if (existing.assigneeId !== user.id) return res.status(403).json({ error: 'Not your task' });

    const task = await updateTask(taskId, { status, updatedAt: new Date() });
    res.json(task);
  } catch (err) {
    console.error('[client-api] task status update error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /active-task — set active task
clientRouter.put('/active-task', async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { taskId } = req.body;
    await upsertHeartbeat({ userId: user.id, activeTaskId: taskId || null });
    res.json({ ok: true, activeTaskId: taskId });
  } catch (err) {
    console.error('[client-api] active-task error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /session-jsonl — sync raw JSONL session data (full session replay)
clientRouter.post('/session-jsonl', async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { sessionId, projectPath, rawContent, lineCount, lastOffset } = req.body;

    if (!sessionId || !rawContent) {
      return res.status(400).json({ error: 'sessionId and rawContent required' });
    }

    const result = await upsertSessionRawJsonl({
      userId: user.id,
      sessionId,
      projectPath,
      rawContent,
      lineCount,
      lastOffset,
    });

    res.json({ ok: true, id: result.id });
  } catch (err) {
    console.error('[client-api] session-jsonl error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
