import { Router } from 'express';
import type { Request, Response, Router as RouterType } from 'express';
import { adminAuth } from '../middleware/admin-auth.js';
import {
  createSubscriptionCredential, getAllSubscriptionCredentials,
  getSubscriptionCredentialById, updateSubscriptionCredential,
  deleteSubscriptionCredential, getActiveSubscriptionCredentials,
  getAssignmentsByCredential, getLatestUsageSnapshot,
  getUsageSnapshots, releaseCredentialFromUser,
  getLeastUsedCredential, assignCredentialToUser,
} from '../db/queries/credentials.js';
import { getUserById } from '../db/queries/users.js';
import { sendToWatcher } from '../services/watcher-ws.js';

export const subscriptionRouter: RouterType = Router();

// All routes require admin auth
subscriptionRouter.use(adminAuth);

// GET /credentials — list all subscription credentials
subscriptionRouter.get('/credentials', async (_req: Request, res: Response) => {
  try {
    const credentials = await getAllSubscriptionCredentials();
    // Attach latest usage snapshot to each
    const withUsage = await Promise.all(credentials.map(async (c) => {
      const snapshot = await getLatestUsageSnapshot(c.id);
      const assignments = await getAssignmentsByCredential(c.id);
      const activeAssignments = assignments.filter(a => a.status === 'active');
      return {
        ...c,
        accessToken: undefined, // don't expose tokens to dashboard
        refreshToken: undefined,
        usage: snapshot,
        activeUsers: activeAssignments.length,
        assignments: await Promise.all(activeAssignments.map(async (a) => {
          const user = await getUserById(a.userId);
          return { userId: a.userId, userName: user?.name, assignedAt: a.assignedAt };
        })),
      };
    }));
    res.json(withUsage);
  } catch (err) {
    console.error('[subscription-api] list credentials error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /credentials — add subscription credential
subscriptionRouter.post('/credentials', async (req: Request, res: Response) => {
  try {
    const credential = await createSubscriptionCredential(req.body);
    res.json({ ...credential, accessToken: undefined, refreshToken: undefined });
  } catch (err) {
    console.error('[subscription-api] create credential error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /credentials/:id — get single credential with usage history
subscriptionRouter.get('/credentials/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const credential = await getSubscriptionCredentialById(id);
    if (!credential) return res.status(404).json({ error: 'Not found' });

    const snapshots = await getUsageSnapshots(id, 100);
    const assignments = await getAssignmentsByCredential(id);

    res.json({
      ...credential,
      accessToken: undefined,
      refreshToken: undefined,
      usageHistory: snapshots,
      assignments,
    });
  } catch (err) {
    console.error('[subscription-api] get credential error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /credentials/:id — update credential
subscriptionRouter.put('/credentials/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const credential = await updateSubscriptionCredential(id, req.body);
    if (!credential) return res.status(404).json({ error: 'Not found' });
    res.json({ ...credential, accessToken: undefined, refreshToken: undefined });
  } catch (err) {
    console.error('[subscription-api] update credential error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /credentials/:id — remove credential
subscriptionRouter.delete('/credentials/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const deleted = await deleteSubscriptionCredential(id);
    if (!deleted) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('[subscription-api] delete credential error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /usage — all subscriptions with live usage
subscriptionRouter.get('/usage', async (_req: Request, res: Response) => {
  try {
    const credentials = await getActiveSubscriptionCredentials();
    const usage = await Promise.all(credentials.map(async (c) => {
      const snapshot = await getLatestUsageSnapshot(c.id);
      return {
        id: c.id,
        email: c.email,
        subscriptionType: c.subscriptionType,
        usage: snapshot,
      };
    }));
    res.json(usage);
  } catch (err) {
    console.error('[subscription-api] usage error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /kill/:userId — revoke credential from user immediately
subscriptionRouter.post('/kill/:userId', async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.userId as string);
    await releaseCredentialFromUser(userId);

    // Push WebSocket command to the watcher so the client learns immediately
    try { sendToWatcher(userId, 'credential_revoked'); } catch {}

    res.json({ success: true, message: 'Credential revoked' });
  } catch (err) {
    console.error('[subscription-api] kill error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /rotate — manually trigger rotation for a user
subscriptionRouter.post('/rotate', async (req: Request, res: Response) => {
  try {
    const { userId } = req.body;
    // Release current
    await releaseCredentialFromUser(userId);
    // Find least used and assign
    const leastUsed = await getLeastUsedCredential();
    if (!leastUsed) {
      return res.status(400).json({ error: 'No available subscription credentials' });
    }
    const assignment = await assignCredentialToUser(leastUsed.id as number, userId);
    res.json({ success: true, credential: { email: leastUsed.email, subscriptionType: leastUsed.subscriptionType }, assignment });
  } catch (err) {
    console.error('[subscription-api] rotate error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /efficiency — subscription efficiency report (Phase 1, Item 8)
subscriptionRouter.get('/efficiency', async (_req: Request, res: Response) => {
  try {
    const credentials = await getActiveSubscriptionCredentials();
    const allAssignments = [];
    for (const cred of credentials) {
      const assignments = await getAssignmentsByCredential(cred.id);
      const activeAssignments = assignments.filter((a: any) => a.status === 'active');
      for (const a of activeAssignments) {
        const user = await getUserById(a.userId);
        const snapshot = await getLatestUsageSnapshot(cred.id);
        allAssignments.push({
          userId: a.userId,
          userName: user?.name,
          credentialEmail: cred.email,
          fiveHourUtilization: snapshot?.fiveHourUtilization || 0,
          sevenDayUtilization: snapshot?.sevenDayUtilization || 0,
        });
      }
    }
    res.json(allAssignments);
  } catch (err) {
    console.error('[subscription-api] efficiency error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
