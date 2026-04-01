import cron from 'node-cron';
import https from 'node:https';
import {
  getActiveSubscriptionCredentials,
  recordUsageSnapshot,
  getActiveAssignment,
  releaseCredentialFromUser,
  assignCredentialToUser,
  getLeastUsedCredential,
  getLatestUsageSnapshot,
  updateSubscriptionCredential,
} from '../db/queries/credentials.js';
import { getAllUsers } from '../db/queries/users.js';
import { broadcast } from './websocket.js';

const DEBUG = process.env.HOWINLENS_DEBUG === '1' || process.env.HOWINLENS_DEBUG === 'true';

function debug(msg: string) {
  if (DEBUG) console.log(`[usage-monitor] ${msg}`);
}

/**
 * Check usage for a single subscription credential by making a minimal API call
 * and reading rate limit headers (same technique as Claude Usage Tracker app).
 */
async function checkSubscriptionUsage(accessToken: string): Promise<{
  fiveHourUtilization: number;
  sevenDayUtilization: number;
  fiveHourResetsAt: Date | null;
  sevenDayResetsAt: Date | null;
  opusWeeklyUtilization: number;
  sonnetWeeklyUtilization: number;
} | null> {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'hi' }],
    });

    const options = {
      hostname: 'api.anthropic.com',
      port: 443,
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'oauth-2025-04-20',
        'User-Agent': 'claude-code/2.1.5',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      const headers = res.headers;
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode && (res.statusCode === 401 || res.statusCode === 403 || res.statusCode >= 500)) {
          console.error(`[usage-monitor] API returned ${res.statusCode} for credential check`);
          resolve(null);
          return;
        }

        const u5h = parseFloat(headers['anthropic-ratelimit-unified-5h-utilization'] as string || '0');
        const u7d = parseFloat(headers['anthropic-ratelimit-unified-7d-utilization'] as string || '0');
        const r5h = parseInt(headers['anthropic-ratelimit-unified-5h-reset'] as string || '0', 10);
        const r7d = parseInt(headers['anthropic-ratelimit-unified-7d-reset'] as string || '0', 10);

        // Per-model breakdown (Phase 1, Item 5)
        const opusUtil = parseFloat(headers['anthropic-ratelimit-unified-opus-utilization'] as string || '0');
        const sonnetUtil = parseFloat(headers['anthropic-ratelimit-unified-sonnet-utilization'] as string || '0');

        resolve({
          fiveHourUtilization: u5h,
          sevenDayUtilization: u7d,
          fiveHourResetsAt: r5h ? new Date(r5h * 1000) : null,
          sevenDayResetsAt: r7d ? new Date(r7d * 1000) : null,
          opusWeeklyUtilization: opusUtil,
          sonnetWeeklyUtilization: sonnetUtil,
        });
      });
    });

    req.on('error', (err) => {
      console.error('[usage-monitor] API request failed:', err.message);
      resolve(null);
    });

    req.setTimeout(15000, () => {
      req.destroy();
      resolve(null);
    });

    req.write(body);
    req.end();
  });
}

/**
 * Poll all active subscriptions and record usage snapshots.
 */
async function pollAllSubscriptions() {
  // Refresh any tokens that are about to expire (Phase 1, Item 1)
  await refreshExpiredTokens();

  const credentials = await getActiveSubscriptionCredentials();
  debug(`Polling ${credentials.length} active subscription(s)`);

  // Check for expiring tokens — 24h warning (Phase 1, Item 4)
  for (const cred of credentials) {
    if (!cred.expiresAt) continue;
    const hoursLeft = (cred.expiresAt.getTime() - Date.now()) / (60 * 60 * 1000);
    if (hoursLeft > 0 && hoursLeft <= 24) {
      broadcast({
        type: 'token_expiry_warning',
        credentialId: cred.id,
        email: cred.email,
        hoursLeft: Math.round(hoursLeft),
      });
    }
  }

  for (const cred of credentials) {
    if (!cred.accessToken) {
      debug(`Skipping credential ${cred.id} (${cred.email}): no access token`);
      continue;
    }

    try {
      const usage = await checkSubscriptionUsage(cred.accessToken);
      if (!usage) {
        debug(`Failed to get usage for credential ${cred.id} (${cred.email})`);
        continue;
      }

      debug(`Credential ${cred.id} (${cred.email}): 5h=${(usage.fiveHourUtilization * 100).toFixed(0)}%, 7d=${(usage.sevenDayUtilization * 100).toFixed(0)}%, opus=${(usage.opusWeeklyUtilization * 100).toFixed(0)}%, sonnet=${(usage.sonnetWeeklyUtilization * 100).toFixed(0)}%`);

      await recordUsageSnapshot({
        credentialId: cred.id,
        fiveHourUtilization: usage.fiveHourUtilization,
        sevenDayUtilization: usage.sevenDayUtilization,
        fiveHourResetsAt: usage.fiveHourResetsAt ?? undefined,
        sevenDayResetsAt: usage.sevenDayResetsAt ?? undefined,
        opusWeeklyUtilization: usage.opusWeeklyUtilization,
        sonnetWeeklyUtilization: usage.sonnetWeeklyUtilization,
      });

      // Auto-start session reset if 5h drops to 0% (Phase 1, Item 7)
      await autoStartSessionIfNeeded(cred, usage.fiveHourUtilization);

      // Alert if approaching limit (80%+)
      if (usage.fiveHourUtilization >= 0.8) {
        console.log(`[usage-monitor] WARNING: Subscription ${cred.email} at ${(usage.fiveHourUtilization * 100).toFixed(0)}% (5h window)`);
        broadcast({
          type: 'subscription_alert',
          credentialId: cred.id,
          email: cred.email,
          fiveHourUtilization: usage.fiveHourUtilization,
          sevenDayUtilization: usage.sevenDayUtilization,
        });
      }

      // Auto-rotate if above 85%
      if (usage.fiveHourUtilization >= 0.85) {
        await autoRotateUsers(cred.id);
      }
    } catch (err) {
      console.error(`[usage-monitor] Error processing credential ${cred.id} (${cred.email}):`, err);
      continue;
    }
  }
}

/**
 * Auto-rotate users off a subscription that's approaching its limit.
 * Move them to the least-used subscription.
 */
async function autoRotateUsers(exhaustedCredentialId: number) {
  const leastUsed = await getLeastUsedCredential();
  if (!leastUsed || leastUsed.id === exhaustedCredentialId) {
    debug('No alternative subscription available for rotation');
    return;
  }

  // Check that the target subscription is actually less used
  const targetSnapshot = await getLatestUsageSnapshot(leastUsed.id);
  if (targetSnapshot && targetSnapshot.fiveHourUtilization && targetSnapshot.fiveHourUtilization >= 0.7) {
    debug('Target subscription is also heavily used, skipping rotation');
    return;
  }

  const users = await getAllUsers();
  for (const user of users) {
    const assignment = await getActiveAssignment(user.id);
    if (assignment && assignment.credentialId === exhaustedCredentialId) {
      debug(`Rotating user ${user.name} (${user.id}) from credential ${exhaustedCredentialId} to ${leastUsed.id}`);
      await releaseCredentialFromUser(user.id);
      await assignCredentialToUser(leastUsed.id, user.id);

      broadcast({
        type: 'credential_rotated',
        userId: user.id,
        userName: user.name,
        fromCredentialId: exhaustedCredentialId,
        toCredentialId: leastUsed.id,
      });
    }
  }
}

/**
 * Check Claude system status.
 */
async function checkClaudeStatus(): Promise<{ status: string; description: string } | null> {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'status.claude.com',
      path: '/api/v2/status.json',
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const indicator = json?.status?.indicator || 'unknown';
          const description = json?.status?.description || 'Unknown';
          resolve({ status: indicator, description });
        } catch {
          resolve(null);
        }
      });
    });

    req.on('error', () => resolve(null));
    req.setTimeout(10000, () => { req.destroy(); resolve(null); });
    req.end();
  });
}

let cronTask: cron.ScheduledTask | null = null;

/**
 * Start the usage monitoring cron job.
 * Runs every 60 seconds.
 */
export function startUsageMonitor(): () => void {
  console.log('[usage-monitor] Starting subscription usage monitor');

  // Run immediately on start
  pollAllSubscriptions().catch(err => {
    console.error('[usage-monitor] Initial poll failed:', err);
  });

  // Then every 60 seconds
  cronTask = cron.schedule('* * * * *', async () => {
    try {
      await pollAllSubscriptions();
    } catch (err) {
      console.error('[usage-monitor] Poll failed:', err);
    }
  });

  return () => {
    if (cronTask) {
      cronTask.stop();
      cronTask = null;
    }
    console.log('[usage-monitor] Stopped');
  };
}

// ---------------------------------------------------------------------------
// Token refresh flow (Phase 1, Item 1)
// ---------------------------------------------------------------------------

/**
 * Check all credentials for tokens expiring within 30 minutes and log warnings.
 * Actual OAuth token refresh will be implemented when testing with real credentials.
 */
async function refreshExpiredTokens() {
  const credentials = await getActiveSubscriptionCredentials();
  for (const cred of credentials) {
    if (!cred.expiresAt || !cred.refreshToken) continue;
    const expiresIn = cred.expiresAt.getTime() - Date.now();
    if (expiresIn > 30 * 60 * 1000) continue; // More than 30 min left, skip

    debug(`Token for ${cred.email} expires in ${Math.round(expiresIn / 60000)} min, refreshing...`);
    // Note: Actual OAuth refresh requires knowing the token endpoint
    // For now, log the warning. Real refresh will be implemented when we test with real tokens.
    console.log(`[usage-monitor] WARNING: Token for ${cred.email} is expiring soon. Manual refresh needed.`);
    // TODO: Implement actual OAuth token refresh when testing with real credentials
  }
}

// ---------------------------------------------------------------------------
// Pace projection — 6-tier (Phase 1, Item 6)
// ---------------------------------------------------------------------------

/**
 * Calculate projected usage pace based on current utilization and elapsed
 * fraction of the rate-limit window.
 */
export function calculatePace(utilization: number, elapsedFraction: number): {
  tier: 'comfortable' | 'on_track' | 'warming' | 'pressing' | 'critical' | 'runaway';
  projectedEndUsage: number;
} {
  if (elapsedFraction < 0.03 || utilization === 0) {
    return { tier: 'comfortable', projectedEndUsage: 0 };
  }
  const projected = utilization / elapsedFraction;
  if (projected < 0.5) return { tier: 'comfortable', projectedEndUsage: projected };
  if (projected < 0.75) return { tier: 'on_track', projectedEndUsage: projected };
  if (projected < 0.9) return { tier: 'warming', projectedEndUsage: projected };
  if (projected < 1.0) return { tier: 'pressing', projectedEndUsage: projected };
  if (projected < 1.2) return { tier: 'critical', projectedEndUsage: projected };
  return { tier: 'runaway', projectedEndUsage: projected };
}

// ---------------------------------------------------------------------------
// Auto-start session reset (Phase 1, Item 7)
// ---------------------------------------------------------------------------

/**
 * When the 5h utilization drops to 0%, the checkSubscriptionUsage call already
 * sends a haiku message which starts a new session window. Log the event.
 */
async function autoStartSessionIfNeeded(cred: any, utilization: number) {
  if (utilization > 0) return; // Not at 0%, no need to reset
  if (!cred.accessToken) return;

  debug(`Credential ${cred.email}: 5h at 0%, auto-starting session...`);
  // The usage check itself already sends a minimal message (haiku, 1 token)
  // which starts a new session window. So this is already handled by the
  // checkSubscriptionUsage call. Log it.
  console.log(`[usage-monitor] Session auto-started for ${cred.email} (5h window reset)`);
}

export { checkClaudeStatus, checkSubscriptionUsage, pollAllSubscriptions };
