import cron from 'node-cron';
import https from 'node:https';
import {
  getActiveSubscriptionCredentials,
  recordUsageSnapshot,
  recordUsagePoll,
  getAssignmentsByCredential,
  getActiveAssignment,
  releaseCredentialFromUser,
  assignCredentialToUser,
  getLeastUsedCredential,
  getLatestUsageSnapshot,
  updateSubscriptionCredential,
  markCredentialNeedsReauth,
} from '../db/queries/credentials.js';
import { getAllUsers } from '../db/queries/users.js';
import { broadcast } from './websocket.js';
import { fetchUsage, refreshAccessToken } from './oauth.js';
import { decrypt, encrypt, isEncryptionConfigured } from './encryption.js';

const DEBUG = process.env.HOWINLENS_DEBUG === '1' || process.env.HOWINLENS_DEBUG === 'true';

function debug(msg: string) {
  if (DEBUG) console.log(`[usage-monitor] ${msg}`);
}

// ---------------------------------------------------------------------------
// Primary usage check via /api/oauth/usage endpoint
// ---------------------------------------------------------------------------

async function checkSubscriptionUsagePrimary(accessToken: string): Promise<{
  fiveHourUtilization: number;
  sevenDayUtilization: number;
  fiveHourResetsAt: Date | null;
  sevenDayResetsAt: Date | null;
  opusWeeklyUtilization: number;
  sonnetWeeklyUtilization: number;
} | null> {
  const usageData = await fetchUsage(accessToken);
  if (!usageData) return null;

  // Usage endpoint returns percentages (12.0 = 12%), normalize to fractions (0.12)
  // for consistency with existing thresholds (0.85 for auto-rotate, etc.)
  return {
    fiveHourUtilization: (usageData.five_hour?.utilization ?? 0) / 100,
    sevenDayUtilization: (usageData.seven_day?.utilization ?? 0) / 100,
    fiveHourResetsAt: usageData.five_hour?.resets_at ? new Date(usageData.five_hour.resets_at) : null,
    sevenDayResetsAt: usageData.seven_day?.resets_at ? new Date(usageData.seven_day.resets_at) : null,
    opusWeeklyUtilization: (usageData.seven_day_opus?.utilization ?? 0) / 100,
    sonnetWeeklyUtilization: (usageData.seven_day_sonnet?.utilization ?? 0) / 100,
  };
}

// ---------------------------------------------------------------------------
// Fallback: haiku method (reading rate-limit headers)
// ---------------------------------------------------------------------------

async function checkSubscriptionUsageFallback(accessToken: string): Promise<{
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

    const req = https.request({
      hostname: 'api.anthropic.com',
      port: 443,
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'oauth-2025-04-20',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      const headers = res.headers;
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode && (res.statusCode === 401 || res.statusCode === 403 || res.statusCode >= 500)) {
          resolve(null);
          return;
        }
        resolve({
          fiveHourUtilization: parseFloat(headers['anthropic-ratelimit-unified-5h-utilization'] as string || '0'),
          sevenDayUtilization: parseFloat(headers['anthropic-ratelimit-unified-7d-utilization'] as string || '0'),
          fiveHourResetsAt: (() => { const v = parseInt(headers['anthropic-ratelimit-unified-5h-reset'] as string || '0', 10); return v ? new Date(v * 1000) : null; })(),
          sevenDayResetsAt: (() => { const v = parseInt(headers['anthropic-ratelimit-unified-7d-reset'] as string || '0', 10); return v ? new Date(v * 1000) : null; })(),
          opusWeeklyUtilization: parseFloat(headers['anthropic-ratelimit-unified-opus-utilization'] as string || '0'),
          sonnetWeeklyUtilization: parseFloat(headers['anthropic-ratelimit-unified-sonnet-utilization'] as string || '0'),
        });
      });
    });

    req.on('error', () => resolve(null));
    req.setTimeout(15000, () => { req.destroy(); resolve(null); });
    req.write(body);
    req.end();
  });
}

/**
 * Check usage — primary endpoint with fallback to haiku method.
 */
async function checkSubscriptionUsage(accessToken: string): Promise<{
  fiveHourUtilization: number;
  sevenDayUtilization: number;
  fiveHourResetsAt: Date | null;
  sevenDayResetsAt: Date | null;
  opusWeeklyUtilization: number;
  sonnetWeeklyUtilization: number;
} | null> {
  // Try primary (GET /api/oauth/usage)
  const primary = await checkSubscriptionUsagePrimary(accessToken);
  if (primary) {
    debug('Usage fetched via primary endpoint (/api/oauth/usage)');
    return primary;
  }

  // Fallback to haiku method
  debug('Primary usage endpoint failed, falling back to haiku method');
  const fallback = await checkSubscriptionUsageFallback(accessToken);
  if (fallback) {
    debug('Usage fetched via fallback (haiku headers)');
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Get decrypted access token from credential
// ---------------------------------------------------------------------------

function getAccessToken(cred: any): string | null {
  // Prefer encrypted token
  if (cred.encryptedAccessToken && isEncryptionConfigured()) {
    try { return decrypt(cred.encryptedAccessToken); } catch {}
  }
  // Fall back to plaintext (deprecated)
  return cred.accessToken ?? null;
}

function getRefreshToken(cred: any): string | null {
  if (cred.encryptedRefreshToken && isEncryptionConfigured()) {
    try { return decrypt(cred.encryptedRefreshToken); } catch {}
  }
  return cred.refreshToken ?? null;
}

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

/**
 * Refresh tokens that are expiring within 1 hour.
 * CRITICAL: refresh_token rotates — must save the new one.
 */
async function refreshExpiredTokens() {
  if (!isEncryptionConfigured()) {
    debug('Encryption not configured, skipping token refresh');
    return;
  }

  const credentials = await getActiveSubscriptionCredentials();
  for (const cred of credentials) {
    if (!cred.expiresAt) continue;

    const expiresIn = cred.expiresAt.getTime() - Date.now();
    if (expiresIn > 60 * 60 * 1000) continue; // More than 1 hour left, skip

    const refreshToken = getRefreshToken(cred);
    if (!refreshToken) {
      debug(`Skipping refresh for ${cred.email}: no refresh token`);
      continue;
    }

    debug(`Token for ${cred.email} expires in ${Math.round(expiresIn / 60000)} min, refreshing...`);

    try {
      const tokenResponse = await refreshAccessToken(refreshToken);

      // Encrypt new tokens (refresh token has ROTATED)
      const newExpiresAt = new Date(Date.now() + tokenResponse.expires_in * 1000);
      const encryptedAccessToken = encrypt(tokenResponse.access_token);
      const encryptedRefreshToken = encrypt(tokenResponse.refresh_token);
      const encryptedRawResponse = encrypt(JSON.stringify(tokenResponse));

      await updateSubscriptionCredential(cred.id, {
        encryptedAccessToken,
        encryptedRefreshToken,
        encryptedRawResponse,
        expiresAt: newExpiresAt,
        lastRefreshedAt: new Date(),
        needsReauth: false,
      });

      debug(`Token refreshed for ${cred.email}, new expiry: ${newExpiresAt.toISOString()}`);

      // Push updated credential to assigned users
      const assignments = await getAssignmentsByCredential(cred.id);
      for (const a of assignments) {
        if (a.status !== 'active') continue;
        try {
          const { sendToWatcher } = await import('./watcher-ws.js');
          sendToWatcher(a.userId, 'credential_update', {
            claudeAiOauth: {
              accessToken: tokenResponse.access_token,
              refreshToken: tokenResponse.refresh_token,
              expiresAt: Date.now() + tokenResponse.expires_in * 1000,
              scopes: (tokenResponse.scope ?? '').split(' '),
              subscriptionType: cred.subscriptionType,
              rateLimitTier: cred.rateLimitTier,
            },
            oauthAccount: {
              accountUuid: cred.accountUuid,
              emailAddress: tokenResponse.account?.email_address ?? cred.email,
              organizationUuid: cred.orgId,
              displayName: cred.displayName,
              organizationName: cred.organizationName,
            },
          });
        } catch {}
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[usage-monitor] Token refresh FAILED for ${cred.email}: ${msg}`);

      // If 401/403, mark as needs re-auth
      if (msg.includes('401') || msg.includes('403') || msg.includes('revoked')) {
        await markCredentialNeedsReauth(cred.id);
        broadcast({
          type: 'needs_reauth',
          credentialId: cred.id,
          email: cred.email,
          reason: msg,
        });
        console.log(`[usage-monitor] Credential ${cred.email} marked as needs re-auth`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Poll all subscriptions
// ---------------------------------------------------------------------------

async function pollAllSubscriptions() {
  await refreshExpiredTokens();

  const credentials = await getActiveSubscriptionCredentials();
  debug(`Polling ${credentials.length} active subscription(s)`);

  // Check for expiring tokens — 24h warning
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
    const accessToken = getAccessToken(cred);
    if (!accessToken) {
      debug(`Skipping credential ${cred.id} (${cred.email}): no access token`);
      continue;
    }

    try {
      const usage = await checkSubscriptionUsage(accessToken);
      if (!usage) {
        debug(`Failed to get usage for credential ${cred.id} (${cred.email})`);
        continue;
      }

      debug(`Credential ${cred.id} (${cred.email}): 5h=${(usage.fiveHourUtilization * 100).toFixed(0)}%, 7d=${(usage.sevenDayUtilization * 100).toFixed(0)}%`);

      await recordUsageSnapshot({
        credentialId: cred.id,
        fiveHourUtilization: usage.fiveHourUtilization,
        sevenDayUtilization: usage.sevenDayUtilization,
        fiveHourResetsAt: usage.fiveHourResetsAt ?? undefined,
        sevenDayResetsAt: usage.sevenDayResetsAt ?? undefined,
        opusWeeklyUtilization: usage.opusWeeklyUtilization,
        sonnetWeeklyUtilization: usage.sonnetWeeklyUtilization,
      });

      const assignments = await getAssignmentsByCredential(cred.id);
      const activeUserIds = assignments.filter(a => a.status === 'active').map(a => a.userId).join(',');
      await recordUsagePoll({
        credentialId: cred.id,
        fiveHourUtilization: usage.fiveHourUtilization,
        sevenDayUtilization: usage.sevenDayUtilization,
        opusWeeklyUtilization: usage.opusWeeklyUtilization,
        sonnetWeeklyUtilization: usage.sonnetWeeklyUtilization,
        fiveHourResetsAt: usage.fiveHourResetsAt ?? undefined,
        sevenDayResetsAt: usage.sevenDayResetsAt ?? undefined,
        assignedUserIds: activeUserIds,
      });

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
    }
  }
}

// ---------------------------------------------------------------------------
// Auto-rotation
// ---------------------------------------------------------------------------

async function autoRotateUsers(exhaustedCredentialId: number) {
  const leastUsed = await getLeastUsedCredential();
  if (!leastUsed || leastUsed.id === exhaustedCredentialId) {
    debug('No alternative subscription available for rotation');
    return;
  }

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

// ---------------------------------------------------------------------------
// Claude status check
// ---------------------------------------------------------------------------

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
          resolve({ status: json?.status?.indicator || 'unknown', description: json?.status?.description || 'Unknown' });
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(10000, () => { req.destroy(); resolve(null); });
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Cron setup
// ---------------------------------------------------------------------------

let cronTask: cron.ScheduledTask | null = null;
let refreshCronTask: cron.ScheduledTask | null = null;

export function startUsageMonitor(): () => void {
  console.log('[usage-monitor] Starting subscription usage monitor');

  // Run immediately on start
  pollAllSubscriptions().catch(err => {
    console.error('[usage-monitor] Initial poll failed:', err);
  });

  // Usage poll: every 60 seconds
  cronTask = cron.schedule('* * * * *', async () => {
    try { await pollAllSubscriptions(); } catch (err) {
      console.error('[usage-monitor] Poll failed:', err);
    }
  });

  // Proactive token refresh: every 6 hours
  refreshCronTask = cron.schedule('0 */6 * * *', async () => {
    try {
      debug('Running proactive token refresh (6h cycle)');
      await refreshExpiredTokens();
    } catch (err) {
      console.error('[usage-monitor] Proactive refresh failed:', err);
    }
  });

  return () => {
    if (cronTask) { cronTask.stop(); cronTask = null; }
    if (refreshCronTask) { refreshCronTask.stop(); refreshCronTask = null; }
    console.log('[usage-monitor] Stopped');
  };
}

// ---------------------------------------------------------------------------
// Pace projection — 6-tier
// ---------------------------------------------------------------------------

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

export { checkClaudeStatus, checkSubscriptionUsage, pollAllSubscriptions };
