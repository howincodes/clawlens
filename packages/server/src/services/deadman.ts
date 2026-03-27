import cron from 'node-cron';
import {
  listTeams,
  getUsersByTeam,
  createTamperAlert,
  getUnresolvedTamperAlerts,
} from './db.js';

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
export function runDeadmanCheck(thresholdMs?: number): {
  checked: number;
  flagged: string[];
} {
  const threshold = thresholdMs ?? DEFAULT_THRESHOLD_MS;
  const now = Date.now();
  let checked = 0;
  const flagged: string[] = [];

  const teams = listTeams();

  for (const team of teams) {
    const users = getUsersByTeam(team.id);

    for (const user of users) {
      // Only check active users
      if (user.status !== 'active') continue;

      checked++;

      // If last_event_at is null, skip (never connected, not an alert)
      if (!user.last_event_at) continue;

      const lastEventTime = new Date(user.last_event_at).getTime();
      const elapsed = now - lastEventTime;

      if (elapsed > threshold) {
        // Check if there's already an unresolved 'inactive' alert for this user
        const existingAlerts = getUnresolvedTamperAlerts(user.id);
        const hasInactiveAlert = existingAlerts.some(
          (a) => a.alert_type === 'inactive',
        );

        if (!hasInactiveAlert) {
          createTamperAlert({
            user_id: user.id,
            alert_type: 'inactive',
            details: JSON.stringify({
              last_event_at: user.last_event_at,
              threshold_hours: threshold / 3600000,
            }),
          });
        }

        flagged.push(user.id);
      }
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

  const task = cron.schedule(cronExpression, () => {
    try {
      runDeadmanCheck(thresholdMs);
    } catch (err) {
      console.error('[deadman] Check failed:', err);
    }
  });

  return () => {
    task.stop();
  };
}
