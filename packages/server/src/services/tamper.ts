import {
  getUserById,
  updateUser,
  createTamperAlert,
  getUnresolvedTamperAlerts,
  resolveTamperAlert,
} from './db.js';

/**
 * Check if a user's hook integrity hash has changed.
 * Called from the session-start hook endpoint.
 *
 * Compares reported hash with stored hash.
 * If different and stored hash exists, creates a 'hooks_modified' tamper alert.
 * Updates stored hash to the new value.
 *
 * @returns true if integrity is OK, false if tampered
 */
export function checkHookIntegrity(
  userId: string,
  reportedHash: string | undefined,
): boolean {
  const user = getUserById(userId);
  if (!user) return true; // user not found, nothing to compare

  const storedHash = user.hook_integrity_hash;

  // If no hash reported, nothing to check
  if (!reportedHash) return true;

  // If no previous hash stored, store the new one and return OK
  if (!storedHash) {
    updateUser(userId, { hook_integrity_hash: reportedHash });
    return true;
  }

  // Compare hashes
  if (storedHash === reportedHash) {
    return true;
  }

  // Hash mismatch — tamper detected
  createTamperAlert({
    user_id: userId,
    alert_type: 'hooks_modified',
    details: JSON.stringify({
      previous_hash: storedHash,
      reported_hash: reportedHash,
    }),
  });

  // Update stored hash to the new value
  updateUser(userId, { hook_integrity_hash: reportedHash });

  return false;
}

/**
 * Get the tamper status for a user.
 * Returns a summary object for the dashboard.
 */
export function getUserTamperStatus(userId: string): {
  status: 'ok' | 'inactive' | 'tampered';
  unresolvedAlerts: number;
  lastEventAt: string | null;
} {
  const user = getUserById(userId);
  const lastEventAt = user?.last_event_at ?? null;

  const alerts = getUnresolvedTamperAlerts(userId);
  const unresolvedAlerts = alerts.length;

  // Check for tamper-level alerts
  const hasTamper = alerts.some(
    (a) => a.alert_type === 'hooks_modified' || a.alert_type === 'config_changed',
  );

  if (hasTamper) {
    return { status: 'tampered', unresolvedAlerts, lastEventAt };
  }

  // Check for inactive alerts
  const hasInactive = alerts.some((a) => a.alert_type === 'inactive');

  if (hasInactive) {
    return { status: 'inactive', unresolvedAlerts, lastEventAt };
  }

  return { status: 'ok', unresolvedAlerts, lastEventAt };
}

/**
 * Auto-resolve 'inactive' alerts when user becomes active again.
 * Called from touchUserLastEvent or from hook endpoints.
 *
 * @returns count of resolved alerts
 */
export function autoResolveInactiveAlerts(userId: string): number {
  const alerts = getUnresolvedTamperAlerts(userId);
  let resolved = 0;

  for (const alert of alerts) {
    if (alert.alert_type === 'inactive') {
      resolveTamperAlert(alert.id);
      resolved++;
    }
  }

  return resolved;
}
