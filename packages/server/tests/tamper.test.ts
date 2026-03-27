import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  initDb,
  closeDb,
  getDb,
  createTeam,
  createUser,
  touchUserLastEvent,
  createTamperAlert,
  getUnresolvedTamperAlerts,
  getUserById,
  updateUser,
  type TeamRow,
  type UserRow,
} from '../src/services/db.js';
import { runDeadmanCheck } from '../src/services/deadman.js';
import {
  checkHookIntegrity,
  getUserTamperStatus,
  autoResolveInactiveAlerts,
} from '../src/services/tamper.js';

// ---------------------------------------------------------------------------
// Fresh in-memory DB before each test
// ---------------------------------------------------------------------------

let team: TeamRow;

beforeEach(() => {
  initDb(':memory:');
  team = createTeam({ name: 'Tamper Test Team', slug: 'tamper-test' });
});

afterEach(() => {
  closeDb();
});

// ---------------------------------------------------------------------------
// Helper: set last_event_at to an arbitrary time in the past
// ---------------------------------------------------------------------------

function setLastEventAt(userId: string, hoursAgo: number): void {
  const db = getDb();
  const pastDate = new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString();
  db.prepare(`UPDATE users SET last_event_at = ? WHERE id = ?`).run(
    pastDate,
    userId,
  );
}

// ---------------------------------------------------------------------------
// Dead man's switch: runDeadmanCheck
// ---------------------------------------------------------------------------

describe('runDeadmanCheck', () => {
  it('should return checked:0, flagged:[] when no users exist', () => {
    const result = runDeadmanCheck();
    expect(result.checked).toBe(0);
    expect(result.flagged).toEqual([]);
  });

  it('should not flag active user with recent event', () => {
    const user = createUser({
      team_id: team.id,
      name: 'Recent User',
      auth_token: 'tok-recent',
    });
    touchUserLastEvent(user.id);

    const result = runDeadmanCheck();
    expect(result.checked).toBe(1);
    expect(result.flagged).toEqual([]);
  });

  it('should flag active user with old event', () => {
    const user = createUser({
      team_id: team.id,
      name: 'Old User',
      auth_token: 'tok-old',
    });
    // Set last_event_at to 10 hours ago (default threshold is 8 hours)
    setLastEventAt(user.id, 10);

    const result = runDeadmanCheck();
    expect(result.checked).toBe(1);
    expect(result.flagged).toEqual([user.id]);

    // Verify a tamper alert was created
    const alerts = getUnresolvedTamperAlerts(user.id);
    expect(alerts.length).toBe(1);
    expect(alerts[0].alert_type).toBe('inactive');
    const details = JSON.parse(alerts[0].details!);
    expect(details.threshold_hours).toBe(8);
  });

  it('should not duplicate alert if user already has unresolved inactive alert', () => {
    const user = createUser({
      team_id: team.id,
      name: 'Dup User',
      auth_token: 'tok-dup',
    });
    setLastEventAt(user.id, 10);

    // Create an existing inactive alert
    createTamperAlert({
      user_id: user.id,
      alert_type: 'inactive',
      details: JSON.stringify({ last_event_at: 'old', threshold_hours: 8 }),
    });

    const result = runDeadmanCheck();
    expect(result.checked).toBe(1);
    expect(result.flagged).toEqual([user.id]);

    // Should still be only 1 alert (not duplicated)
    const alerts = getUnresolvedTamperAlerts(user.id);
    const inactiveAlerts = alerts.filter((a) => a.alert_type === 'inactive');
    expect(inactiveAlerts.length).toBe(1);
  });

  it('should not flag killed user with old event', () => {
    const user = createUser({
      team_id: team.id,
      name: 'Killed User',
      auth_token: 'tok-killed-dm',
    });
    setLastEventAt(user.id, 10);

    // Set status to killed
    const db = getDb();
    db.prepare(`UPDATE users SET status = 'killed' WHERE id = ?`).run(user.id);

    const result = runDeadmanCheck();
    expect(result.checked).toBe(0); // killed users are skipped entirely
    expect(result.flagged).toEqual([]);
  });

  it('should skip active user with null last_event_at (never connected)', () => {
    createUser({
      team_id: team.id,
      name: 'Never Connected',
      auth_token: 'tok-never',
    });

    const result = runDeadmanCheck();
    expect(result.checked).toBe(1);
    expect(result.flagged).toEqual([]);

    // No alerts should be created
    const alerts = getUnresolvedTamperAlerts();
    expect(alerts.length).toBe(0);
  });

  it('should respect custom threshold', () => {
    const user = createUser({
      team_id: team.id,
      name: 'Custom Threshold',
      auth_token: 'tok-custom',
    });
    // Set last_event_at to 2 hours ago
    setLastEventAt(user.id, 2);

    // With default 8-hour threshold, should not be flagged
    const result1 = runDeadmanCheck();
    expect(result1.flagged).toEqual([]);

    // With 1-hour threshold, should be flagged
    const result2 = runDeadmanCheck(1 * 60 * 60 * 1000);
    expect(result2.flagged).toEqual([user.id]);
  });
});

// ---------------------------------------------------------------------------
// checkHookIntegrity
// ---------------------------------------------------------------------------

describe('checkHookIntegrity', () => {
  it('should return true when hash matches stored hash', () => {
    const user = createUser({
      team_id: team.id,
      name: 'Hash Match',
      auth_token: 'tok-hash-match',
    });
    updateUser(user.id, { hook_integrity_hash: 'abc123' });

    const ok = checkHookIntegrity(user.id, 'abc123');
    expect(ok).toBe(true);

    // No tamper alert created
    const alerts = getUnresolvedTamperAlerts(user.id);
    expect(alerts.length).toBe(0);
  });

  it('should return false and create alert when hash mismatches', () => {
    const user = createUser({
      team_id: team.id,
      name: 'Hash Mismatch',
      auth_token: 'tok-hash-mismatch',
    });
    updateUser(user.id, { hook_integrity_hash: 'abc123' });

    const ok = checkHookIntegrity(user.id, 'xyz789');
    expect(ok).toBe(false);

    // Tamper alert should be created
    const alerts = getUnresolvedTamperAlerts(user.id);
    expect(alerts.length).toBe(1);
    expect(alerts[0].alert_type).toBe('hooks_modified');
    const details = JSON.parse(alerts[0].details!);
    expect(details.previous_hash).toBe('abc123');
    expect(details.reported_hash).toBe('xyz789');

    // Hash should be updated to the new value
    const refreshed = getUserById(user.id);
    expect(refreshed!.hook_integrity_hash).toBe('xyz789');
  });

  it('should store hash and return true when no previous hash exists', () => {
    const user = createUser({
      team_id: team.id,
      name: 'No Hash',
      auth_token: 'tok-no-hash',
    });
    // Ensure no hash is stored
    expect(user.hook_integrity_hash).toBeNull();

    const ok = checkHookIntegrity(user.id, 'first-hash');
    expect(ok).toBe(true);

    // Hash should now be stored
    const refreshed = getUserById(user.id);
    expect(refreshed!.hook_integrity_hash).toBe('first-hash');

    // No alert created
    const alerts = getUnresolvedTamperAlerts(user.id);
    expect(alerts.length).toBe(0);
  });

  it('should return true when no hash is reported', () => {
    const user = createUser({
      team_id: team.id,
      name: 'No Reported Hash',
      auth_token: 'tok-no-reported',
    });
    updateUser(user.id, { hook_integrity_hash: 'stored-hash' });

    const ok = checkHookIntegrity(user.id, undefined);
    expect(ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getUserTamperStatus
// ---------------------------------------------------------------------------

describe('getUserTamperStatus', () => {
  it('should return ok when no alerts exist', () => {
    const user = createUser({
      team_id: team.id,
      name: 'Clean User',
      auth_token: 'tok-clean',
    });
    touchUserLastEvent(user.id);

    const status = getUserTamperStatus(user.id);
    expect(status.status).toBe('ok');
    expect(status.unresolvedAlerts).toBe(0);
    expect(status.lastEventAt).toBeTruthy();
  });

  it('should return inactive when user has inactive alert', () => {
    const user = createUser({
      team_id: team.id,
      name: 'Inactive User',
      auth_token: 'tok-inactive-status',
    });
    touchUserLastEvent(user.id);

    createTamperAlert({
      user_id: user.id,
      alert_type: 'inactive',
    });

    const status = getUserTamperStatus(user.id);
    expect(status.status).toBe('inactive');
    expect(status.unresolvedAlerts).toBe(1);
  });

  it('should return tampered when user has hooks_modified alert', () => {
    const user = createUser({
      team_id: team.id,
      name: 'Tampered User',
      auth_token: 'tok-tampered-status',
    });

    createTamperAlert({
      user_id: user.id,
      alert_type: 'hooks_modified',
    });

    const status = getUserTamperStatus(user.id);
    expect(status.status).toBe('tampered');
    expect(status.unresolvedAlerts).toBe(1);
  });

  it('should return tampered when user has config_changed alert', () => {
    const user = createUser({
      team_id: team.id,
      name: 'Config User',
      auth_token: 'tok-config-status',
    });

    createTamperAlert({
      user_id: user.id,
      alert_type: 'config_changed',
    });

    const status = getUserTamperStatus(user.id);
    expect(status.status).toBe('tampered');
    expect(status.unresolvedAlerts).toBe(1);
  });

  it('should prioritize tampered over inactive', () => {
    const user = createUser({
      team_id: team.id,
      name: 'Both User',
      auth_token: 'tok-both-status',
    });

    createTamperAlert({
      user_id: user.id,
      alert_type: 'inactive',
    });
    createTamperAlert({
      user_id: user.id,
      alert_type: 'hooks_modified',
    });

    const status = getUserTamperStatus(user.id);
    expect(status.status).toBe('tampered');
    expect(status.unresolvedAlerts).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// autoResolveInactiveAlerts
// ---------------------------------------------------------------------------

describe('autoResolveInactiveAlerts', () => {
  it('should resolve inactive alerts', () => {
    const user = createUser({
      team_id: team.id,
      name: 'Resolve User',
      auth_token: 'tok-resolve',
    });

    createTamperAlert({
      user_id: user.id,
      alert_type: 'inactive',
    });
    createTamperAlert({
      user_id: user.id,
      alert_type: 'inactive',
    });

    const resolved = autoResolveInactiveAlerts(user.id);
    expect(resolved).toBe(2);

    // No more unresolved inactive alerts
    const alerts = getUnresolvedTamperAlerts(user.id);
    const inactiveAlerts = alerts.filter((a) => a.alert_type === 'inactive');
    expect(inactiveAlerts.length).toBe(0);
  });

  it('should not resolve non-inactive alerts', () => {
    const user = createUser({
      team_id: team.id,
      name: 'Keep User',
      auth_token: 'tok-keep',
    });

    createTamperAlert({
      user_id: user.id,
      alert_type: 'hooks_modified',
    });
    createTamperAlert({
      user_id: user.id,
      alert_type: 'config_changed',
    });
    createTamperAlert({
      user_id: user.id,
      alert_type: 'inactive',
    });

    const resolved = autoResolveInactiveAlerts(user.id);
    expect(resolved).toBe(1);

    // hooks_modified and config_changed should still be unresolved
    const alerts = getUnresolvedTamperAlerts(user.id);
    expect(alerts.length).toBe(2);
    expect(alerts.some((a) => a.alert_type === 'hooks_modified')).toBe(true);
    expect(alerts.some((a) => a.alert_type === 'config_changed')).toBe(true);
  });

  it('should return 0 when no inactive alerts exist', () => {
    const user = createUser({
      team_id: team.id,
      name: 'No Inactive',
      auth_token: 'tok-no-inactive',
    });

    createTamperAlert({
      user_id: user.id,
      alert_type: 'hooks_modified',
    });

    const resolved = autoResolveInactiveAlerts(user.id);
    expect(resolved).toBe(0);

    // hooks_modified should still be unresolved
    const alerts = getUnresolvedTamperAlerts(user.id);
    expect(alerts.length).toBe(1);
  });
});
