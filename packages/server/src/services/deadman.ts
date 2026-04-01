import cron from 'node-cron';
import {
  getAllUsers,
  createTamperAlert,
  getUnresolvedTamperAlerts,
} from '../db/queries/index.js';

// Default threshold: 8 hours (in milliseconds)
const DEFAULT_THRESHOLD_MS = 8 * 60 * 60 * 1000;

export interface DeadmanConfig {
  checkIntervalCron?: string; // cron expression, default: '*/5 * * * *' (every 5 min)
  thresholdMs?: number; // ms without events before flagging, default: 8 hours
}

/**
 * Run a single dead man's switch check (useful for tests).
 * For each active user: if last_event_at is older than threshold, create an "inactive" tamper alert
 * (but only if there isn't already an unresolved "inactive" alert for that user).
 */
export async function runDeadmanCheck(thresholdMs?: number): Promise<{
  checked: number;
  flagged: number[];
}> {
  const threshold = thresholdMs ?? DEFAULT_THRESHOLD_MS;
  const now = Date.now();
  let checked = 0;
  const flagged: number[] = [];

  const users = await getAllUsers();

  for (const user of users) {
    // Only check active users
    if (user.status !== 'active') continue;

    checked++;

    // If lastEventAt is null, skip (never connected, not an alert)
    if (!user.lastEventAt) continue;

    const lastEventTime = new Date(user.lastEventAt).getTime();
    const elapsed = now - lastEventTime;

    if (elapsed > threshold) {
      // Check if there's already an unresolved 'inactive' alert for this user
      const existingAlerts = await getUnresolvedTamperAlerts(user.id);
      const hasInactiveAlert = existingAlerts.some(
        (a) => a.alertType === 'inactive',
      );

      if (!hasInactiveAlert) {
        await createTamperAlert({
          userId: user.id,
          alertType: 'inactive',
          details: JSON.stringify({
            lastEventAt: user.lastEventAt,
            thresholdHours: threshold / 3600000,
          }),
        });
      }

      flagged.push(user.id);
    }
  }

  return { checked, flagged };
}

/**
 * Start the dead man's switch background job.
 * Returns a stop function to cancel the cron job.
 */
export function startDeadmanSwitch(config?: DeadmanConfig): () => void {
  const cronExpression = config?.checkIntervalCron ?? '*/5 * * * *';
  const thresholdMs = config?.thresholdMs;

  const task = cron.schedule(cronExpression, async () => {
    try {
      await runDeadmanCheck(thresholdMs);
    } catch (err) {
      console.error('[deadman] Check failed:', err);
    }
  });

  return () => {
    task.stop();
  };
}
