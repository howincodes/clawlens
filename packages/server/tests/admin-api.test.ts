import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import {
  initDb,
  closeDb,
  createUser,
  createSession,
  recordPrompt,
  recordHookEvent,
  getUserById,
  getDb,
  truncateAll,
  type UserRow,
} from '../src/services/db.js';
import { recordMessage } from '../src/db/queries/messages.js';
import { app } from '../src/server.js';

// ---------------------------------------------------------------------------
// Test state
// ---------------------------------------------------------------------------

let user1: UserRow;
let user2: UserRow;
let adminToken: string;

const ADMIN_EMAIL = 'testadmin@howinlens.local';
const ADMIN_PASSWORD = 'testpass123';

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(async () => {
  await initDb();
  await truncateAll();

  // The seed creates an admin user with default password.
  // We need to create our own admin for predictable credentials.
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 4);
  const { createUser: drizzleCreateUser } = await import('../src/db/queries/users.js');
  const adminUser = await drizzleCreateUser({
    name: 'TestAdmin',
    email: ADMIN_EMAIL,
    passwordHash,
    authToken: 'clwt_admin_test_token',
  });

  // Assign Admin role
  const { assignUserRole, getUserPermissionKeys } = await import('../src/db/queries/roles.js');
  const { sql } = await import('drizzle-orm');
  const db = getDb();
  const [adminRole] = await db.execute(sql`SELECT id FROM roles WHERE name = 'Admin' LIMIT 1`) as any[];
  if (adminRole) {
    try { await assignUserRole(adminUser.id, adminRole.id); } catch {}
  }

  user1 = await createUser({
    name: 'Alice',
    auth_token: 'clwt_alice_abc123',
    email: 'alice@test.com',
  });

  user2 = await createUser({
    name: 'Bob',
    auth_token: 'clwt_bob_def456',
    email: 'bob@test.com',
  });

  // Create some test data
  await createSession({
    id: 'sess-001',
    user_id: user1.id,
    model: 'sonnet',
    cwd: '/home/alice/project-a',
  });

  await recordMessage({
    provider: 'claude-code',
    sessionId: 'sess-001',
    userId: user1.id,
    type: 'user',
    content: 'Hello world',
    model: 'sonnet',
    creditCost: 3,
    sourceType: 'hook',
  });

  await recordMessage({
    provider: 'claude-code',
    sessionId: 'sess-001',
    userId: user1.id,
    type: 'user',
    content: 'What is TypeScript?',
    model: 'sonnet',
    creditCost: 3,
    sourceType: 'hook',
  });

  await recordHookEvent({
    userId: user1.id,
    sessionId: 'sess-001',
    eventType: 'SessionStart',
    payload: JSON.stringify({ model: 'sonnet' }),
  });

  // Log in to get admin JWT
  const loginRes = await request(app)
    .post('/api/admin/login')
    .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  adminToken = loginRes.body.token;
});

afterEach(async () => {
  await closeDb();
});

// ---------------------------------------------------------------------------
// Helper for authenticated requests
// ---------------------------------------------------------------------------

function authGet(path: string) {
  return request(app).get(path).set('Authorization', `Bearer ${adminToken}`);
}

function authPost(path: string) {
  return request(app).post(path).set('Authorization', `Bearer ${adminToken}`);
}

function authPut(path: string) {
  return request(app).put(path).set('Authorization', `Bearer ${adminToken}`);
}

function authDelete(path: string) {
  return request(app).delete(path).set('Authorization', `Bearer ${adminToken}`);
}

// ---------------------------------------------------------------------------
// 1. POST /login: correct password -> 200 + token
// ---------------------------------------------------------------------------

describe('POST /api/admin/login', () => {
  it('should return 200 and a token with correct credentials', async () => {
    const res = await request(app)
      .post('/api/admin/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(typeof res.body.token).toBe('string');
  });

  it('should return 401 with wrong password', async () => {
    const res = await request(app)
      .post('/api/admin/login')
      .send({ email: ADMIN_EMAIL, password: 'wrong-password' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 12. Unauthenticated requests -> 401
// ---------------------------------------------------------------------------

describe('Unauthenticated requests', () => {
  it('should return 401 for GET /users without auth', async () => {
    const res = await request(app).get('/api/admin/users');
    expect(res.status).toBe(401);
  });

  it('should return 401 for GET /analytics without auth', async () => {
    const res = await request(app).get('/api/admin/analytics');
    expect(res.status).toBe(401);
  });

  it('should return 401 for GET /messages without auth', async () => {
    const res = await request(app).get('/api/admin/messages');
    expect(res.status).toBe(401);
  });

  it('should return 401 with invalid token', async () => {
    const res = await request(app)
      .get('/api/admin/users')
      .set('Authorization', 'Bearer invalid-jwt-token');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// 3. GET /users: returns user list with enrichments
// ---------------------------------------------------------------------------

describe('GET /api/admin/users', () => {
  it('should return enriched user list', async () => {
    const res = await authGet('/api/admin/users');

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(Array.isArray(res.body.data)).toBe(true);
    // At least user1 + user2 + admin
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);

    // Find alice in the response
    const alice = res.body.data.find((u: Record<string, unknown>) => u.name === 'Alice');
    expect(alice).toBeDefined();
    expect(alice.prompt_count).toBe(2);
    expect(alice.total_credits).toBe(6);
    expect(alice.session_count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 4. POST /users: creates user with token
// ---------------------------------------------------------------------------

describe('POST /api/admin/users', () => {
  it('should create a new user with auth token', async () => {
    const res = await authPost('/api/admin/users').send({
      name: 'Charlie',
      slug: 'charlie',
    });

    expect(res.status).toBe(201);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.name).toBe('Charlie');
    expect(res.body.auth_token).toBeDefined();
    expect(res.body.auth_token).toMatch(/^clwt_charlie_/);
    expect(res.body.install_instructions).toBeDefined();
    expect(res.body.install_instructions.curl).toContain('install.sh');
    expect(res.body.install_instructions.token).toBe(res.body.auth_token);
  });

  it('should create user with limits', async () => {
    const res = await authPost('/api/admin/users').send({
      name: 'Dave',
      slug: 'dave',
      limits: [
        { type: 'total_credits', value: 100, window: 'daily' },
      ],
    });

    expect(res.status).toBe(201);
    expect(res.body.user).toBeDefined();

    // Verify limits were created
    const { getLimitsByUser } = await import('../src/db/queries/limits.js');
    const limits = await getLimitsByUser(res.body.user.id);
    expect(limits.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 5. GET /users/:id: returns enriched user
// ---------------------------------------------------------------------------

describe('GET /api/admin/users/:id', () => {
  it('should return enriched user with stats', async () => {
    const res = await authGet(`/api/admin/users/${user1.id}`);

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Alice');
    expect(res.body.prompt_count).toBe(2);
    expect(res.body.total_credits).toBe(6);
    expect(res.body.session_count).toBe(1);
    expect(res.body.sessions).toBeDefined();
    expect(res.body.recent_messages).toBeDefined();
    expect(res.body.tamper_status).toBeDefined();
    expect(res.body.limits).toBeDefined();
  });

  it('should return 404 for non-existent user', async () => {
    const res = await authGet('/api/admin/users/999999');
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// 6. PUT /users/:id: updates status
// ---------------------------------------------------------------------------

describe('PUT /api/admin/users/:id', () => {
  it('should update user name', async () => {
    const res = await authPut(`/api/admin/users/${user1.id}`).send({
      name: 'Alice Updated',
    });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Alice Updated');
  });

  it('should set killedAt when status set to killed', async () => {
    const res = await authPut(`/api/admin/users/${user1.id}`).send({
      status: 'killed',
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('killed');
    expect(res.body.killedAt).toBeDefined();
  });

  it('should clear killedAt when status changed from killed', async () => {
    // First kill the user
    await authPut(`/api/admin/users/${user1.id}`).send({ status: 'killed' });

    // Then reactivate
    const res = await authPut(`/api/admin/users/${user1.id}`).send({
      status: 'active',
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('active');
    expect(res.body.killedAt).toBeNull();
  });

  it('should replace limits when provided', async () => {
    const res = await authPut(`/api/admin/users/${user1.id}`).send({
      name: 'Alice',
      limits: [
        { type: 'total_credits', value: 50, window: 'daily' },
        { type: 'per_model', value: 20, model: 'opus', window: 'daily' },
      ],
    });

    expect(res.status).toBe(200);

    const { getLimitsByUser } = await import('../src/db/queries/limits.js');
    const limits = await getLimitsByUser(user1.id);
    expect(limits.length).toBe(2);
  });

  it('should return 404 for non-existent user', async () => {
    const res = await authPut('/api/admin/users/999999').send({
      name: 'Ghost',
    });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// 7. DELETE /users/:id: removes user
// ---------------------------------------------------------------------------

describe('DELETE /api/admin/users/:id', () => {
  it('should delete user and related data', async () => {
    const res = await authDelete(`/api/admin/users/${user1.id}`);

    expect(res.status).toBe(204);

    // Verify user is gone
    const user = await getUserById(user1.id);
    expect(user).toBeUndefined();
  });

  it('should return 404 for non-existent user', async () => {
    const res = await authDelete('/api/admin/users/999999');
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// 8. POST /users/:id/rotate-token: generates new token
// ---------------------------------------------------------------------------

describe('POST /api/admin/users/:id/rotate-token', () => {
  it('should generate a new auth token', async () => {
    const oldToken = user1.authToken;

    const res = await authPost(`/api/admin/users/${user1.id}/rotate-token`);

    expect(res.status).toBe(200);
    expect(res.body.auth_token).toBeDefined();
    expect(res.body.auth_token).not.toBe(oldToken);
    expect(res.body.auth_token).toMatch(/^clwt_alice_/);

    // Verify the token was updated in DB
    const updated = await getUserById(user1.id);
    expect(updated!.authToken).toBe(res.body.auth_token);
  });

  it('should return 404 for non-existent user', async () => {
    const res = await authPost('/api/admin/users/999999/rotate-token');
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// 9. GET /analytics: returns overview data
// ---------------------------------------------------------------------------

describe('GET /api/admin/analytics', () => {
  it('should return overview, daily, and models data', async () => {
    const res = await authGet('/api/admin/analytics?days=30');

    expect(res.status).toBe(200);
    expect(res.body.overview).toBeDefined();
    expect(res.body.overview.total_prompts).toBe(2);
    expect(res.body.overview.total_credits).toBe(6);
    expect(res.body.overview.total_sessions).toBe(1);
    expect(res.body.overview.active_users).toBe(1);
    expect(res.body.daily).toBeDefined();
    expect(Array.isArray(res.body.daily)).toBe(true);
    expect(res.body.models).toBeDefined();
    expect(Array.isArray(res.body.models)).toBe(true);
  });

  it('should default to 30 days if no days param', async () => {
    const res = await authGet('/api/admin/analytics');
    expect(res.status).toBe(200);
    expect(res.body.overview).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// GET /analytics/users
// ---------------------------------------------------------------------------

describe('GET /api/admin/analytics/users', () => {
  it('should return per-user analytics', async () => {
    const res = await authGet('/api/admin/analytics/users?days=30');

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(Array.isArray(res.body.data)).toBe(true);

    const alice = res.body.data.find((u: Record<string, unknown>) => u.name === 'Alice');
    expect(alice).toBeDefined();
    expect(Number(alice.prompts)).toBe(2);
    expect(Number(alice.credits)).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// GET /analytics/projects
// ---------------------------------------------------------------------------

describe('GET /api/admin/analytics/projects', () => {
  it('should return per-project analytics', async () => {
    const res = await authGet('/api/admin/analytics/projects?days=30');

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GET /analytics/costs
// ---------------------------------------------------------------------------

describe('GET /api/admin/analytics/costs', () => {
  it('should return per-model cost breakdown', async () => {
    const res = await authGet('/api/admin/analytics/costs?days=30');

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 10. GET /messages: returns paginated messages
// ---------------------------------------------------------------------------

describe('GET /api/admin/messages', () => {
  it('should return paginated messages', async () => {
    const res = await authGet('/api/admin/messages');

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.total).toBe(2);
    expect(res.body.page).toBe(1);
    expect(res.body.limit).toBe(50);
  });

  it('should filter by user_id', async () => {
    const res = await authGet(`/api/admin/messages?user_id=${user1.id}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(2);
  });

  it('should filter by search', async () => {
    const res = await authGet('/api/admin/messages?search=TypeScript');

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].content).toContain('TypeScript');
  });

  it('should paginate', async () => {
    const res = await authGet('/api/admin/messages?page=1&limit=1');

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.total).toBe(2);
    expect(res.body.page).toBe(1);
    expect(res.body.limit).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 11. GET /audit-log: returns hook events
// ---------------------------------------------------------------------------

describe('GET /api/admin/audit-log', () => {
  it('should return hook events', async () => {
    const res = await authGet('/api/admin/audit-log');

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);

    const event = res.body.data[0];
    expect(event.event_type).toBe('SessionStart');
    expect(event.user_id).toBe(user1.id);
  });
});

// ---------------------------------------------------------------------------
// GET /subscriptions
// ---------------------------------------------------------------------------

describe('GET /api/admin/subscriptions', () => {
  it('should return subscriptions list', async () => {
    const res = await authGet('/api/admin/subscriptions');

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GET /summaries
// ---------------------------------------------------------------------------

describe('GET /api/admin/summaries', () => {
  it('should return summaries list', async () => {
    const res = await authGet('/api/admin/summaries');

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GET /users/:id/messages
// ---------------------------------------------------------------------------

describe('GET /api/admin/users/:id/messages', () => {
  it('should return paginated messages for user', async () => {
    const res = await authGet(`/api/admin/users/${user1.id}/messages`);

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.length).toBe(2);
    expect(res.body.total).toBe(2);
    expect(res.body.page).toBe(1);
  });

  it('should return 404 for non-existent user', async () => {
    const res = await authGet('/api/admin/users/999999/messages');
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /users/:id/sessions
// ---------------------------------------------------------------------------

describe('GET /api/admin/users/:id/sessions', () => {
  it('should return sessions for user', async () => {
    const res = await authGet(`/api/admin/users/${user1.id}/sessions`);

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].id).toBe('sess-001');
  });

  it('should return 404 for non-existent user', async () => {
    const res = await authGet('/api/admin/users/999999/sessions');
    expect(res.status).toBe(404);
  });
});
