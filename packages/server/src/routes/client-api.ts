import { Router } from 'express';
import type { Request, Response, Router as RouterType } from 'express';
import {
  upsertHeartbeat, getHeartbeat, getLatestWatchEvent, recordWatchEvent,
  getActiveAssignment, assignCredentialToUser, releaseCredentialFromUser,
  getLeastUsedCredential, getSubscriptionCredentialById,
  upsertSessionRawJsonl,
} from '../db/queries/credentials.js';
import { upsertMessageByUuid } from '../db/queries/messages.js';
import { getCreditCostFromDb } from '../db/queries/model-credits.js';
import { getTasksByUser, getTaskById, updateTask } from '../db/queries/tasks.js';
import { getProjectDirectories, linkProjectDirectory, getProjectDirectoryByPath } from '../db/queries/tracking.js';
import { recordFileEvents } from '../db/queries/tracking.js';
import { recordAppTracking } from '../db/queries/tracking.js';
import { updateUser } from '../db/queries/users.js';
import { getProjectById, getProjectByRepoUrl } from '../db/queries/projects.js';
import { getLatestUsageSnapshot } from '../db/queries/credentials.js';
import { generateStatuslineConfig } from '../services/statusline.js';
import { decrypt, isEncryptionConfigured } from '../services/encryption.js';

/**
 * Build the full credential payload (tokens + oauthAccount) from a credential row.
 * Decrypts encrypted tokens if encryption is configured, falls back to plaintext columns.
 */
function buildCredentialPayload(credential: any) {
  let accessToken = credential.accessToken;
  let refreshToken = credential.refreshToken;

  // Prefer encrypted tokens (Phase 1)
  if (isEncryptionConfigured()) {
    if (credential.encryptedAccessToken) {
      try { accessToken = decrypt(credential.encryptedAccessToken); } catch {}
    }
    if (credential.encryptedRefreshToken) {
      try { refreshToken = decrypt(credential.encryptedRefreshToken); } catch {}
    }
  }

  return {
    claudeAiOauth: {
      accessToken,
      refreshToken,
      expiresAt: credential.expiresAt ? new Date(credential.expiresAt).getTime() : Date.now() + 28800000,
      scopes: credential.scopes
        ? credential.scopes.split(' ')
        : ['user:file_upload', 'user:inference', 'user:mcp_servers', 'user:profile', 'user:sessions:claude_code'],
      subscriptionType: credential.subscriptionType || 'team',
      rateLimitTier: credential.rateLimitTier || 'default_raven',
    },
    oauthAccount: {
      accountUuid: credential.accountUuid || '',
      emailAddress: credential.email || '',
      organizationUuid: credential.orgId || '',
      displayName: credential.displayName || '',
      organizationName: credential.organizationName || '',
    },
  };
}

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
      credential: credential ? buildCredentialPayload(credential) : null,
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

    const snapshot = assignment ? await getLatestUsageSnapshot(assignment.credentialId) : null;
    const statusline = snapshot ? generateStatuslineConfig({
      fiveHourUtilization: snapshot.fiveHourUtilization || 0,
      sevenDayUtilization: snapshot.sevenDayUtilization || 0,
      subscriptionEmail: credential?.email || '',
      watchStatus: heartbeat?.watchStatus || 'off',
    }) : null;

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
      statusline,
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
      credential: buildCredentialPayload(credential),
    });
  } catch (err) {
    console.error('[client-api] credential error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /conversations — sync JSONL conversation data into unified messages table
clientRouter.post('/conversations', async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { messages: msgs } = req.body;

    if (!Array.isArray(msgs) || msgs.length === 0) {
      return res.json({ ok: true, synced: 0 });
    }

    // ── Server-side filtering ──
    // Only store real user prompts and assistant responses with actual text.
    // Reject: meta messages, slash commands, system XML, thinking-only assistants.
    const valid = msgs.filter((m: any) => {
      if (!m.uuid || !m.type) return false;

      const content = (m.messageContent || m.content || '').trim();

      if (m.type === 'user') {
        // Skip meta messages (slash commands, system caveats, command stdout)
        if (m.isMeta) return false;
        if (content.startsWith('<local-command')) return false;
        if (content.startsWith('<command-name')) return false;
        if (!content) return false;
        return true;
      }

      if (m.type === 'assistant') {
        // Skip thinking-only assistants (no text content)
        if (!content) return false;
        return true;
      }

      return false;
    });

    if (valid.length === 0) {
      return res.json({ ok: true, synced: 0 });
    }

    let synced = 0;
    for (const m of valid) {
      const content = (m.messageContent || m.content || '').trim();
      const model = m.model || m.rawModel;
      const creditCost = model ? await getCreditCostFromDb(model, m.provider || 'claude-code') : 0;

      await upsertMessageByUuid({
        uuid: m.uuid,
        parentUuid: m.parentUuid,
        provider: m.provider || 'claude-code',
        sessionId: m.sessionId,
        userId: user.id,
        type: m.type,
        content,
        model,
        rawModel: m.rawModel,
        inputTokens: m.inputTokens,
        outputTokens: m.outputTokens,
        cachedTokens: m.cachedTokens,
        cacheCreationTokens: m.cacheCreationTokens,
        creditCost,
        cwd: m.cwd,
        gitBranch: m.gitBranch,
        sourceType: m.sourceType || 'jsonl',
        timestamp: m.timestamp ? new Date(m.timestamp) : new Date(),
      });
      synced++;
    }

    res.json({ ok: true, synced });
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
// Accepts either { projectId, localPath } or { localPath, remoteUrl, discoveredVia }
// When remoteUrl is provided without projectId, auto-matches against project_repositories
clientRouter.post('/project-directories', async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { localPath, discoveredVia, remoteUrl } = req.body;
    let { projectId } = req.body;

    if (!localPath) {
      return res.status(400).json({ error: 'localPath is required' });
    }

    // Check if already linked
    const existing = await getProjectDirectoryByPath(user.id, localPath);
    if (existing) {
      return res.json({ ok: true, directory: existing, existing: true });
    }

    // Auto-match by remoteUrl if projectId not provided
    if (!projectId && remoteUrl) {
      const matched = await getProjectByRepoUrl(remoteUrl);
      if (matched) {
        projectId = matched.id;
      }
    }

    // If still no projectId, store as unlinked discovery (no project association)
    if (!projectId) {
      return res.json({ ok: true, matched: false, message: 'No matching project found for this repository' });
    }

    // Verify project exists
    const project = await getProjectById(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
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

// POST /session-jsonl — sync raw JSONL session data
// Single endpoint: stores raw content for replay AND extracts messages for analytics.
// Client just sends raw lines — all parsing/filtering happens here.
clientRouter.post('/session-jsonl', async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { sessionId, projectPath, rawContent, lineCount, lastOffset } = req.body;

    if (!sessionId || !rawContent) {
      return res.status(400).json({ error: 'sessionId and rawContent required' });
    }

    // 1. Store raw content for session replay
    const result = await upsertSessionRawJsonl({
      userId: user.id,
      sessionId,
      projectPath,
      rawContent,
      lineCount,
      lastOffset,
    });

    // 2. Parse lines and extract messages into the messages table
    let extracted = 0;
    const lines = rawContent.split('\n').filter((l: string) => l.trim());

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (!parsed.uuid || !parsed.type) continue;

        const type = parsed.type as string;
        const content = extractContent(parsed);

        // ── Filter: only store real user prompts and assistant text responses ──
        if (type === 'user') {
          if (parsed.isMeta) continue;
          if (!content) continue;
          if (content.startsWith('<local-command')) continue;
          if (content.startsWith('<command-name')) continue;
        } else if (type === 'assistant') {
          if (!content) continue; // thinking-only blocks
        } else {
          continue; // skip system, attachment, permission-mode, etc.
        }

        // Extract model and tokens
        const model = parsed.message?.model || null;
        const usage = parsed.message?.usage;
        const creditCost = model ? await getCreditCostFromDb(model, 'claude-code') : 0;

        await upsertMessageByUuid({
          uuid: parsed.uuid,
          parentUuid: parsed.parentUuid || null,
          provider: 'claude-code',
          sessionId: parsed.sessionId || sessionId,
          userId: user.id,
          type,
          content,
          model,
          rawModel: model,
          inputTokens: usage?.input_tokens,
          outputTokens: usage?.output_tokens,
          cachedTokens: usage?.cache_read_input_tokens || 0,
          cacheCreationTokens: usage?.cache_creation_input_tokens || 0,
          creditCost,
          cwd: parsed.cwd,
          gitBranch: parsed.gitBranch,
          sourceType: 'jsonl',
          timestamp: parsed.timestamp ? new Date(parsed.timestamp) : new Date(),
        });
        extracted++;
      } catch {
        // Malformed line — skip, raw content still stored
      }
    }

    res.json({ ok: true, id: result.id, extracted });
  } catch (err) {
    console.error('[client-api] session-jsonl error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Extract text content from a JSONL line's message field.
 * Handles both string content (user) and content blocks array (assistant).
 */
function extractContent(parsed: any): string {
  const messageContent = parsed.message?.content;
  if (typeof messageContent === 'string') return messageContent.trim();
  if (Array.isArray(messageContent)) {
    return messageContent
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('\n')
      .trim();
  }
  return '';
}
