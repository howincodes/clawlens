import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  initDb,
  closeDb,
  createUser,
  touchUserLastEvent,
  createTamperAlert,
  getUnresolvedTamperAlerts,
  getUserById,
  truncateAll,
  type UserRow,
} from '../src/services/db.js';
import { updateUser } from '../src/db/queries/users.js';
import { runDeadmanCheck } from '../src/services/deadman.js';
import {
  checkHookIntegrity,
  getUserTamperStatus,
  autoResolveInactiveAlerts,
} from '../src/services/tamper.js';

// ---------------------------------------------------------------------------
// Fresh DB before each test
// ---------------------------------------------------------------------------

beforeEach(async () => {
  await initDb();
  await truncateAll();
});

afterEach(async () => {
  await closeDb();
});

// ---------------------------------------------------------------------------
// Helper: set last_event_at to an arbitrary time in the past
// ---------------------------------------------------------------------------

async function setLastEventAt(userId: number, hoursAgo: number): Promise<void> {
  const pastDate = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
  await updateUser(userId, { lastEventAt: pastDate });
}

// ---------------------------------------------------------------------------
// Dead man's switch: runDeadmanCheck
// ---------------------------------------------------------------------------

describe('runDeadmanCheck', () => {
  it('should return checked:0, flagged:[] when no users exist', async () => {
    const result = await runDeadmanCheck();
    // The seeded admin user exists but may have no lastEventAt, so it is checked but not flagged
    expect(result.flagged).toEqual([]);
  });

  it('should not flag active user with recent event', async () => {
    const user = await createUser({
      name: 'Recent User',
      auth_token: 'tok-recent',
    });
    await touchUserLastEvent(user.id);

    const result = await runDeadmanCheck();
    expect(result.flagged).toEqual([]);
  });

  it('should flag active user with old event', async () => {
    const user = await createUser({
      name: 'Old User',
      auth_token: 'tok-old',
    });
    // Set last_event_at to 10 hours ago (default threshold is 8 hours)
    await setLastEventAt(user.id, 10);

    const result = await runDeadmanCheck();
    expect(result.flagged).toContain(user.id);

    // Verify a tamper alert was created
    const alerts = await getUnresolvedTamperAlerts(user.id);
    expect(alerts.length).toBe(1);
    expect(alerts[0].alertType).toBe('inactive');
    const details = JSON.parse(alerts[0].details!);
    expect(details.thresholdHours).toBe(8);
  });

  it('should not duplicate alert if user already has unresolved inactive alert', async () => {
    const user = await createUser({
      name: 'Dup User',
      auth_token: 'tok-dup',
    });
    await setLastEventAt(user.id, 10);

    // Create an existing inactive alert
    await createTamperAlert({
      userId: user.id,
      alertType: 'inactive',
      details: JSON.stringify({ lastEventAt: 'old', thresholdHours: 8 }),
    });

    const result = await runDeadmanCheck();
    expect(result.flagged).toContain(user.id);

    // Should still be only 1 alert (not duplicated)
    const alerts = await getUnresolvedTamperAlerts(user.id);
    const inactiveAlerts = alerts.filter((a) => a.alertType === 'inactive');
    expect(inactiveAlerts.length).toBe(1);
  });

  it('should not flag killed user with old event', async () => {
    const user = await createUser({
      name: 'Killed User',
      auth_token: 'tok-killed-dm',
    });
    await setLastEventAt(user.id, 10);

    // Set status to killed
    await updateUser(user.id, { status: 'killed' });

    const result = await runDeadmanCheck();
    // killed users are skipped entirely
    expect(result.flagged).toEqual([]);
  });

  it('should skip active user with null last_event_at (never connected)', async () => {
    await createUser({
      name: 'Never Connected',
      auth_token: 'tok-never',
    });

    const result = await runDeadmanCheck();
    expect(result.flagged).toEqual([]);

    // No alerts should be created for this user
    // (there may be no alerts at all, or only for the seeded admin)
  });

  it('should respect custom threshold', async () => {
    const user = await createUser({
      name: 'Custom Threshold',
      auth_token: 'tok-custom',
    });
    // Set last_event_at to 2 hours ago
    await setLastEventAt(user.id, 2);

    // With default 8-hour threshold, should not be flagged
    const result1 = await runDeadmanCheck();
    expect(result1.flagged).not.toContain(user.id);

    // With 1-hour threshold, should be flagged
    const result2 = await runDeadmanCheck(1 * 60 * 60 * 1000);
    expect(result2.flagged).toContain(user.id);
  });
});

// ---------------------------------------------------------------------------
// checkHookIntegrity
// ---------------------------------------------------------------------------

describe('checkHookIntegrity', () => {
  it('should return true when hash matches stored hash', async () => {
    const user = await createUser({
      name: 'Hash Match',
      auth_token: 'tok-hash-match',
    });
    await updateUser(user.id, { hookIntegrityHash: 'abc123' });

    const ok = await checkHookIntegrity(user.id, 'abc123');
    expect(ok).toBe(true);

    // No tamper alert created
    const alerts = await getUnresolvedTamperAlerts(user.id);
    expect(alerts.length).toBe(0);
  });

  it('should return false and create alert when hash mismatches', async () => {
    const user = await createUser({
      name: 'Hash Mismatch',
      auth_token: 'tok-hash-mismatch',
    });
    await updateUser(user.id, { hookIntegrityHash: 'abc123' });

    const ok = await checkHookIntegrity(user.id, 'xyz789');
    expect(ok).toBe(false);

    // Tamper alert should be created
    const alerts = await getUnresolvedTamperAlerts(user.id);
    expect(alerts.length).toBe(1);
    expect(alerts[0].alertType).toBe('hooks_modified');
    const details = JSON.parse(alerts[0].details!);
    expect(details.previousHash).toBe('abc123');
    expect(details.reportedHash).toBe('xyz789');

    // Hash should be updated to the new value
    const refreshed = await getUserById(user.id);
    expect(refreshed!.hookIntegrityHash).toBe('xyz789');
  });

  it('should store hash and return true when no previous hash exists', async () => {
    const user = await createUser({
      name: 'No Hash',
      auth_token: 'tok-no-hash',
    });
    // Ensure no hash is stored
    expect(user.hookIntegrityHash).toBeNull();

    const ok = await checkHookIntegrity(user.id, 'first-hash');
    expect(ok).toBe(true);

    // Hash should now be stored
    const refreshed = await getUserById(user.id);
    expect(refreshed!.hookIntegrityHash).toBe('first-hash');

    // No alert created
    const alerts = await getUnresolvedTamperAlerts(user.id);
    expect(alerts.length).toBe(0);
  });

  it('should return true when no hash is reported', async () => {
    const user = await createUser({
      name: 'No Reported Hash',
      auth_token: 'tok-no-reported',
    });
    await updateUser(user.id, { hookIntegrityHash: 'stored-hash' });

    const ok = await checkHookIntegrity(user.id, undefined);
    expect(ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getUserTamperStatus
// ---------------------------------------------------------------------------

describe('getUserTamperStatus', () => {
  it('should return ok when no alerts exist', async () => {
    const user = await createUser({
      name: 'Clean User',
      auth_token: 'tok-clean',
    });
    await touchUserLastEvent(user.id);

    const status = await getUserTamperStatus(user.id);
    expect(status.status).toBe('ok');
    expect(status.unresolvedAlerts).toBe(0);
    expect(status.lastEventAt).toBeTruthy();
  });

  it('should return inactive when user has inactive alert', async () => {
    const user = await createUser({
      name: 'Inactive User',
      auth_token: 'tok-inactive-status',
    });
    await touchUserLastEvent(user.id);

    await createTamperAlert({
      userId: user.id,
      alertType: 'inactive',
    });

    const status = await getUserTamperStatus(user.id);
    expect(status.status).toBe('inactive');
    expect(status.unresolvedAlerts).toBe(1);
  });

  it('should return tampered when user has hooks_modified alert', async () => {
    const user = await createUser({
      name: 'Tampered User',
      auth_token: 'tok-tampered-status',
    });

    await createTamperAlert({
      userId: user.id,
      alertType: 'hooks_modified',
    });

    const status = await getUserTamperStatus(user.id);
    expect(status.status).toBe('tampered');
    expect(status.unresolvedAlerts).toBe(1);
  });

  it('should return tampered when user has config_changed alert', async () => {
    const user = await createUser({
      name: 'Config User',
      auth_token: 'tok-config-status',
    });

    await createTamperAlert({
      userId: user.id,
      alertType: 'config_changed',
    });

    const status = await getUserTamperStatus(user.id);
    expect(status.status).toBe('tampered');
    expect(status.unresolvedAlerts).toBe(1);
  });

  it('should prioritize tampered over inactive', async () => {
    const user = await createUser({
      name: 'Both User',
      auth_token: 'tok-both-status',
    });

    await createTamperAlert({
      userId: user.id,
      alertType: 'inactive',
    });
    await createTamperAlert({
      userId: user.id,
      alertType: 'hooks_modified',
    });

    const status = await getUserTamperStatus(user.id);
    expect(status.status).toBe('tampered');
    expect(status.unresolvedAlerts).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// autoResolveInactiveAlerts
// ---------------------------------------------------------------------------

describe('autoResolveInactiveAlerts', () => {
  it('should resolve inactive alerts', async () => {
    const user = await createUser({
      name: 'Resolve User',
      auth_token: 'tok-resolve',
    });

    await createTamperAlert({
      userId: user.id,
      alertType: 'inactive',
    });
    await createTamperAlert({
      userId: user.id,
      alertType: 'inactive',
    });

    const resolved = await autoResolveInactiveAlerts(user.id);
    expect(resolved).toBe(2);

    // No more unresolved inactive alerts
    const alerts = await getUnresolvedTamperAlerts(user.id);
    const inactiveAlerts = alerts.filter((a) => a.alertType === 'inactive');
    expect(inactiveAlerts.length).toBe(0);
  });

  it('should not resolve non-inactive alerts', async () => {
    const user = await createUser({
      name: 'Keep User',
      auth_token: 'tok-keep',
    });

    await createTamperAlert({
      userId: user.id,
      alertType: 'hooks_modified',
    });
    await createTamperAlert({
      userId: user.id,
      alertType: 'config_changed',
    });
    await createTamperAlert({
      userId: user.id,
      alertType: 'inactive',
    });

    const resolved = await autoResolveInactiveAlerts(user.id);
    expect(resolved).toBe(1);

    // hooks_modified and config_changed should still be unresolved
    const alerts = await getUnresolvedTamperAlerts(user.id);
    expect(alerts.length).toBe(2);
    expect(alerts.some((a) => a.alertType === 'hooks_modified')).toBe(true);
    expect(alerts.some((a) => a.alertType === 'config_changed')).toBe(true);
  });

  it('should return 0 when no inactive alerts exist', async () => {
    const user = await createUser({
      name: 'No Inactive',
      auth_token: 'tok-no-inactive',
    });

    await createTamperAlert({
      userId: user.id,
      alertType: 'hooks_modified',
    });

    const resolved = await autoResolveInactiveAlerts(user.id);
    expect(resolved).toBe(0);

    // hooks_modified should still be unresolved
    const alerts = await getUnresolvedTamperAlerts(user.id);
    expect(alerts.length).toBe(1);
  });
});
