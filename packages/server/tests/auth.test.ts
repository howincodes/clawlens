import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import {
  initDb,
  getDb,
  closeDb,
  createTeam,
  createUser,
} from '../src/services/db.js';
import { hookAuth } from '../src/middleware/hook-auth.js';
import {
  adminAuth,
  generateToken,
  verifyToken,
} from '../src/middleware/admin-auth.js';
import jwt from 'jsonwebtoken';

// ---------------------------------------------------------------------------
// Test helpers — mock Express req/res/next
// ---------------------------------------------------------------------------

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    ...overrides,
  } as Request;
}

function mockRes(): Response & { _status: number; _json: unknown } {
  const res = {
    _status: 200,
    _json: null as unknown,
    status(code: number) {
      res._status = code;
      return res;
    },
    json(body: unknown) {
      res._json = body;
      return res;
    },
  };
  return res as unknown as Response & { _status: number; _json: unknown };
}

function mockNext(): NextFunction & { called: boolean } {
  const fn = (() => {
    fn.called = true;
  }) as NextFunction & { called: boolean };
  fn.called = false;
  return fn;
}

// ---------------------------------------------------------------------------
// hookAuth middleware tests
// ---------------------------------------------------------------------------

describe('hookAuth', () => {
  let teamId: string;
  let validToken: string;

  beforeEach(() => {
    initDb(':memory:');
    const team = createTeam({ name: 'Auth Team', slug: 'auth-team' });
    teamId = team.id;
    validToken = 'tok-valid-hook';
    createUser({
      team_id: teamId,
      name: 'Hook User',
      auth_token: validToken,
    });
  });

  afterEach(() => {
    closeDb();
  });

  it('should pass with a valid token and attach user/team', () => {
    const req = mockReq({
      headers: { authorization: `Bearer ${validToken}` },
    });
    const res = mockRes();
    const next = mockNext();

    hookAuth(req, res, next);

    expect(next.called).toBe(true);
    expect(req.user).toBeDefined();
    expect(req.user!.name).toBe('Hook User');
    expect(req.team).toBeDefined();
    expect(req.team!.id).toBe(teamId);
  });

  it('should return 401 when Authorization header is missing', () => {
    const req = mockReq({ headers: {} });
    const res = mockRes();
    const next = mockNext();

    hookAuth(req, res, next);

    expect(next.called).toBe(false);
    expect(res._status).toBe(401);
    expect((res._json as { error: string }).error).toMatch(/Missing/);
  });

  it('should return 401 when Authorization header uses wrong scheme', () => {
    const req = mockReq({
      headers: { authorization: `Basic ${validToken}` },
    });
    const res = mockRes();
    const next = mockNext();

    hookAuth(req, res, next);

    expect(next.called).toBe(false);
    expect(res._status).toBe(401);
  });

  it('should return 401 when token is empty', () => {
    const req = mockReq({
      headers: { authorization: 'Bearer ' },
    });
    const res = mockRes();
    const next = mockNext();

    hookAuth(req, res, next);

    expect(next.called).toBe(false);
    expect(res._status).toBe(401);
    expect((res._json as { error: string }).error).toMatch(/Empty/);
  });

  it('should return 401 when token is invalid', () => {
    const req = mockReq({
      headers: { authorization: 'Bearer tok-does-not-exist' },
    });
    const res = mockRes();
    const next = mockNext();

    hookAuth(req, res, next);

    expect(next.called).toBe(false);
    expect(res._status).toBe(401);
    expect((res._json as { error: string }).error).toMatch(/Invalid/);
  });

  it('should return 403 when user status is killed', () => {
    const killedToken = 'tok-killed';
    const user = createUser({
      team_id: teamId,
      name: 'Killed User',
      auth_token: killedToken,
    });
    // Manually update status to killed via the already-imported getDb
    const database = getDb();
    database.prepare(`UPDATE users SET status = 'killed' WHERE id = ?`).run(user.id);

    const req = mockReq({
      headers: { authorization: `Bearer ${killedToken}` },
    });
    const res = mockRes();
    const next = mockNext();

    hookAuth(req, res, next);

    expect(next.called).toBe(false);
    expect(res._status).toBe(403);
    expect((res._json as { error: string }).error).toMatch(/killed/);
  });
});

// ---------------------------------------------------------------------------
// adminAuth middleware tests
// ---------------------------------------------------------------------------

describe('adminAuth', () => {
  const adminPayload = {
    sub: 'admin-001',
    email: 'admin@example.com',
    role: 'admin',
  };

  it('should pass with a valid JWT and attach admin payload', () => {
    const token = generateToken(adminPayload);
    const req = mockReq({
      headers: { authorization: `Bearer ${token}` },
    });
    const res = mockRes();
    const next = mockNext();

    adminAuth(req, res, next);

    expect(next.called).toBe(true);
    expect(req.admin).toBeDefined();
    expect(req.admin!.sub).toBe('admin-001');
    expect(req.admin!.email).toBe('admin@example.com');
    expect(req.admin!.role).toBe('admin');
  });

  it('should return 401 when Authorization header is missing', () => {
    const req = mockReq({ headers: {} });
    const res = mockRes();
    const next = mockNext();

    adminAuth(req, res, next);

    expect(next.called).toBe(false);
    expect(res._status).toBe(401);
    expect((res._json as { error: string }).error).toMatch(/Missing/);
  });

  it('should return 401 when token is empty', () => {
    const req = mockReq({
      headers: { authorization: 'Bearer ' },
    });
    const res = mockRes();
    const next = mockNext();

    adminAuth(req, res, next);

    expect(next.called).toBe(false);
    expect(res._status).toBe(401);
    expect((res._json as { error: string }).error).toMatch(/Empty/);
  });

  it('should return 401 for an invalid JWT', () => {
    const req = mockReq({
      headers: { authorization: 'Bearer not.a.valid.jwt' },
    });
    const res = mockRes();
    const next = mockNext();

    adminAuth(req, res, next);

    expect(next.called).toBe(false);
    expect(res._status).toBe(401);
    expect((res._json as { error: string }).error).toMatch(/Invalid/);
  });

  it('should return 401 for an expired JWT', () => {
    // Sign a token that already expired
    const expiredToken = jwt.sign(
      adminPayload,
      process.env.JWT_SECRET ?? 'clawlens-dev-secret-change-me',
      { expiresIn: '0s' },
    );

    const req = mockReq({
      headers: { authorization: `Bearer ${expiredToken}` },
    });
    const res = mockRes();
    const next = mockNext();

    adminAuth(req, res, next);

    expect(next.called).toBe(false);
    expect(res._status).toBe(401);
    expect((res._json as { error: string }).error).toMatch(/expired/i);
  });

  it('should return 401 for a JWT signed with the wrong secret', () => {
    const wrongToken = jwt.sign(adminPayload, 'wrong-secret', {
      expiresIn: '1h',
    });

    const req = mockReq({
      headers: { authorization: `Bearer ${wrongToken}` },
    });
    const res = mockRes();
    const next = mockNext();

    adminAuth(req, res, next);

    expect(next.called).toBe(false);
    expect(res._status).toBe(401);
    expect((res._json as { error: string }).error).toMatch(/Invalid/);
  });
});

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------

describe('token helpers', () => {
  it('generateToken should produce a valid JWT', () => {
    const token = generateToken({
      sub: 'test-admin',
      email: 'test@example.com',
      role: 'admin',
    });
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3);
  });

  it('verifyToken should decode a valid JWT', () => {
    const token = generateToken({
      sub: 'test-admin',
      email: 'test@example.com',
      role: 'super_admin',
    });
    const decoded = verifyToken(token);
    expect(decoded.sub).toBe('test-admin');
    expect(decoded.email).toBe('test@example.com');
    expect(decoded.role).toBe('super_admin');
    expect(decoded.iat).toBeDefined();
    expect(decoded.exp).toBeDefined();
  });

  it('verifyToken should throw for invalid token', () => {
    expect(() => verifyToken('garbage')).toThrow();
  });

  it('verifyToken should throw for expired token', () => {
    const token = jwt.sign(
      { sub: 'x', email: 'x@x.com', role: 'admin' },
      process.env.JWT_SECRET ?? 'clawlens-dev-secret-change-me',
      { expiresIn: '0s' },
    );
    expect(() => verifyToken(token)).toThrow();
  });
});
