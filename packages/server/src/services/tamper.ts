import {
  getUserById,
  updateUser,
  createTamperAlert,
  getUnresolvedTamperAlerts,
  resolveTamperAlert,
} from '../db/queries/index.js';

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
export async function checkHookIntegrity(
  userId: number,
  reportedHash: string | undefined,
): Promise<boolean> {
  const user = await getUserById(userId);
  if (!user) return true; // user not found, nothing to compare

  const storedHash = user.hookIntegrityHash;

  // If no hash reported, nothing to check
  if (!reportedHash) return true;

  // If no previous hash stored, store the new one and return OK
  if (!storedHash) {
    await updateUser(userId, { hookIntegrityHash: reportedHash });
    return true;
  }

  // Compare hashes
  if (storedHash === reportedHash) {
    return true;
  }

  // Hash mismatch — tamper detected
  await createTamperAlert({
    userId,
    alertType: 'hooks_modified',
    details: JSON.stringify({
      previousHash: storedHash,
      reportedHash,
    }),
  });

  // Update stored hash to the new value
  await updateUser(userId, { hookIntegrityHash: reportedHash });

  return false;
}

/**
 * Get the tamper status for a user.
 * Returns a summary object for the dashboard.
 */
export async function getUserTamperStatus(userId: number): Promise<{
  status: 'ok' | 'inactive' | 'tampered';
  unresolvedAlerts: number;
  lastEventAt: Date | null;
}> {
  const user = await getUserById(userId);
  const lastEventAt = user?.lastEventAt ?? null;

  const alerts = await getUnresolvedTamperAlerts(userId);
  const unresolvedAlerts = alerts.length;

  // Check for tamper-level alerts
  const hasTamper = alerts.some(
    (a) => a.alertType === 'hooks_modified' || a.alertType === 'config_changed',
  );

  if (hasTamper) {
    return { status: 'tampered', unresolvedAlerts, lastEventAt };
  }

  // Check for inactive alerts
  const hasInactive = alerts.some((a) => a.alertType === 'inactive');

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
export async function autoResolveInactiveAlerts(userId: number): Promise<number> {
  const alerts = await getUnresolvedTamperAlerts(userId);
  let resolved = 0;

  for (const alert of alerts) {
    if (alert.alertType === 'inactive') {
      await resolveTamperAlert(alert.id);
      resolved++;
    }
  }

  return resolved;
}
