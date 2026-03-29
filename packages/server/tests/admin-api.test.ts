import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import {
  initDb,
  closeDb,
  createTeam,
  createUser,
  createSession,
  recordPrompt,
  recordHookEvent,
  getUserById,
  getDb,
  type TeamRow,
  type UserRow,
} from '../src/services/db.js';
import { app } from '../src/server.js';

// ---------------------------------------------------------------------------
// Test state
// ---------------------------------------------------------------------------

let team: TeamRow;
let user1: UserRow;
let user2: UserRow;
let adminToken: string;

const ADMIN_PASSWORD = 'admin';

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(async () => {
  initDb(':memory:');

  team = createTeam({ name: 'Test Team', slug: 'test-team' });

  user1 = createUser({
    team_id: team.id,
    name: 'Alice',
    auth_token: 'clwt_alice_abc123',
    email: 'alice@test.com',
  });

  user2 = createUser({
    team_id: team.id,
    name: 'Bob',
    auth_token: 'clwt_bob_def456',
    email: 'bob@test.com',
  });

  // Create some test data
  const session = createSession({
    id: 'sess-001',
    user_id: user1.id,
    model: 'sonnet',
    cwd: '/home/alice/project-a',
  });

  recordPrompt({
    session_id: 'sess-001',
    user_id: user1.id,
    prompt: 'Hello world',
    response: 'Hi there!',
    model: 'sonnet',
    credit_cost: 3,
  });

  recordPrompt({
    session_id: 'sess-001',
    user_id: user1.id,
    prompt: 'What is TypeScript?',
    response: 'A typed superset of JavaScript.',
    model: 'sonnet',
    credit_cost: 3,
  });

  recordHookEvent({
    user_id: user1.id,
    session_id: 'sess-001',
    event_type: 'SessionStart',
    payload: JSON.stringify({ model: 'sonnet' }),
  });

  // Log in to get admin JWT
  const loginRes = await request(app)
    .post('/api/admin/login')
    .send({ password: ADMIN_PASSWORD });

  adminToken = loginRes.body.token;
});

afterEach(() => {
  closeDb();
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
  it('should return 200 and a token with correct password', async () => {
    const res = await request(app)
      .post('/api/admin/login')
      .send({ password: ADMIN_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(typeof res.body.token).toBe('string');
  });

  // 2. POST /login: wrong password -> 401
  it('should return 401 with wrong password', async () => {
    const res = await request(app)
      .post('/api/admin/login')
      .send({ password: 'wrong-password' });

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

  it('should return 401 for GET /prompts without auth', async () => {
    const res = await request(app).get('/api/admin/prompts');
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
    expect(res.body.data.length).toBe(2);

    // Find alice in the response
    const alice = res.body.data.find((u: Record<string, unknown>) => u.name === 'Alice');
    expect(alice).toBeDefined();
    expect(alice.prompt_count).toBe(2);
    expect(alice.total_credits).toBe(6);
    expect(alice.session_count).toBe(1);
    expect(alice.top_model).toBeDefined();
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
    const db = getDb();
    const limits = db
      .prepare('SELECT * FROM limits WHERE user_id = ?')
      .all(res.body.user.id);
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
    expect(res.body.recent_prompts).toBeDefined();
    expect(res.body.tamper_status).toBeDefined();
    expect(res.body.limits).toBeDefined();
  });

  it('should return 404 for non-existent user', async () => {
    const res = await authGet('/api/admin/users/nonexistent-id');
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

  it('should set killed_at when status set to killed', async () => {
    const res = await authPut(`/api/admin/users/${user1.id}`).send({
      status: 'killed',
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('killed');
    expect(res.body.killed_at).toBeDefined();
  });

  it('should clear killed_at when status changed from killed', async () => {
    // First kill the user
    await authPut(`/api/admin/users/${user1.id}`).send({ status: 'killed' });

    // Then reactivate
    const res = await authPut(`/api/admin/users/${user1.id}`).send({
      status: 'active',
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('active');
    expect(res.body.killed_at).toBeNull();
  });

  it('should replace limits when provided', async () => {
    const res = await authPut(`/api/admin/users/${user1.id}`).send({
      limits: [
        { type: 'total_credits', value: 50, window: 'daily' },
        { type: 'per_model', value: 20, model: 'opus', window: 'daily' },
      ],
    });

    expect(res.status).toBe(200);

    const db = getDb();
    const limits = db
      .prepare('SELECT * FROM limits WHERE user_id = ?')
      .all(user1.id);
    expect(limits.length).toBe(2);
  });

  it('should return 404 for non-existent user', async () => {
    const res = await authPut('/api/admin/users/nonexistent-id').send({
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
    const user = getUserById(user1.id);
    expect(user).toBeUndefined();

    // Verify related data is gone
    const db = getDb();
    const prompts = db
      .prepare('SELECT COUNT(*) as count FROM prompts WHERE user_id = ?')
      .get(user1.id) as { count: number };
    expect(prompts.count).toBe(0);

    const sessions = db
      .prepare('SELECT COUNT(*) as count FROM sessions WHERE user_id = ?')
      .get(user1.id) as { count: number };
    expect(sessions.count).toBe(0);

    const hookEvents = db
      .prepare('SELECT COUNT(*) as count FROM hook_events WHERE user_id = ?')
      .get(user1.id) as { count: number };
    expect(hookEvents.count).toBe(0);
  });

  it('should return 404 for non-existent user', async () => {
    const res = await authDelete('/api/admin/users/nonexistent-id');
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// 8. POST /users/:id/rotate-token: generates new token
// ---------------------------------------------------------------------------

describe('POST /api/admin/users/:id/rotate-token', () => {
  it('should generate a new auth token', async () => {
    const oldToken = user1.auth_token;

    const res = await authPost(`/api/admin/users/${user1.id}/rotate-token`);

    expect(res.status).toBe(200);
    expect(res.body.auth_token).toBeDefined();
    expect(res.body.auth_token).not.toBe(oldToken);
    expect(res.body.auth_token).toMatch(/^clwt_alice_/);

    // Verify the token was updated in DB
    const updated = getUserById(user1.id);
    expect(updated!.auth_token).toBe(res.body.auth_token);
  });

  it('should return 404 for non-existent user', async () => {
    const res = await authPost('/api/admin/users/nonexistent-id/rotate-token');
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
    expect(alice.prompts).toBe(2);
    expect(alice.credits).toBe(6);
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

    if (res.body.data.length > 0) {
      const project = res.body.data[0];
      expect(project.project).toBeDefined();
      expect(project.prompts).toBeDefined();
      expect(project.credits).toBeDefined();
    }
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

    if (res.body.data.length > 0) {
      const model = res.body.data[0];
      expect(model.model).toBeDefined();
      expect(model.credits).toBeDefined();
      expect(model.prompts).toBeDefined();
      expect(model.cost_usd).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// 10. GET /prompts: returns paginated prompts
// ---------------------------------------------------------------------------

describe('GET /api/admin/prompts', () => {
  it('should return paginated prompts', async () => {
    const res = await authGet('/api/admin/prompts');

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.total).toBe(2);
    expect(res.body.page).toBe(1);
    expect(res.body.limit).toBe(50);
  });

  it('should filter by user_id', async () => {
    const res = await authGet(`/api/admin/prompts?user_id=${user1.id}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(2);
  });

  it('should filter by search', async () => {
    const res = await authGet('/api/admin/prompts?search=TypeScript');

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].prompt).toContain('TypeScript');
  });

  it('should paginate', async () => {
    const res = await authGet('/api/admin/prompts?page=1&limit=1');

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
// GET /team
// ---------------------------------------------------------------------------

describe('GET /api/admin/team', () => {
  it('should return team info', async () => {
    const res = await authGet('/api/admin/team');

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Test Team');
    expect(res.body.slug).toBe('test-team');
    expect(res.body.id).toBe(team.id);
  });
});

// ---------------------------------------------------------------------------
// PUT /team
// ---------------------------------------------------------------------------

describe('PUT /api/admin/team', () => {
  it('should update team name', async () => {
    const res = await authPut('/api/admin/team').send({
      name: 'Updated Team',
    });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Updated Team');
    expect(res.body.slug).toBe('test-team'); // unchanged
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
// POST /summaries/generate
// ---------------------------------------------------------------------------

describe('POST /api/admin/summaries/generate', () => {
  it('should return no_data when there are no recent prompts', async () => {
    // Clear all prompts so the endpoint hits the no_data path
    const db = getDb();
    db.prepare('DELETE FROM prompts').run();

    const res = await authPost('/api/admin/summaries/generate').send({});

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('no_data');
    expect(res.body.message).toContain('No prompts');
  });
});

// ---------------------------------------------------------------------------
// GET /users/:id/prompts
// ---------------------------------------------------------------------------

describe('GET /api/admin/users/:id/prompts', () => {
  it('should return paginated prompts for user', async () => {
    const res = await authGet(`/api/admin/users/${user1.id}/prompts`);

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.length).toBe(2);
    expect(res.body.total).toBe(2);
    expect(res.body.page).toBe(1);
  });

  it('should return 404 for non-existent user', async () => {
    const res = await authGet('/api/admin/users/nonexistent-id/prompts');
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
    const res = await authGet('/api/admin/users/nonexistent-id/sessions');
    expect(res.status).toBe(404);
  });
});
