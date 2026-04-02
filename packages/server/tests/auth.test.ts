import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import {
  initDb,
  closeDb,
  getDb,
  createTeam,
  createUser,
  truncateAll,
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
  let validToken: string;

  beforeEach(async () => {
    await initDb();
    await truncateAll();
    validToken = 'tok-valid-hook';
    await createUser({
      name: 'Hook User',
      auth_token: validToken,
    });
  });

  afterEach(async () => {
    await closeDb();
  });

  it('should pass with a valid token and attach user', async () => {
    const req = mockReq({
      headers: { authorization: `Bearer ${validToken}` },
    });
    const res = mockRes();
    const next = mockNext();

    await hookAuth(req, res, next);

    expect(next.called).toBe(true);
    expect(req.user).toBeDefined();
    expect(req.user!.name).toBe('Hook User');
  });

  it('should return 401 when Authorization header is missing', async () => {
    const req = mockReq({ headers: {} });
    const res = mockRes();
    const next = mockNext();

    await hookAuth(req, res, next);

    expect(next.called).toBe(false);
    expect(res._status).toBe(401);
    expect((res._json as { error: string }).error).toMatch(/Missing/);
  });

  it('should return 401 when Authorization header uses wrong scheme', async () => {
    const req = mockReq({
      headers: { authorization: `Basic ${validToken}` },
    });
    const res = mockRes();
    const next = mockNext();

    await hookAuth(req, res, next);

    expect(next.called).toBe(false);
    expect(res._status).toBe(401);
  });

  it('should return 401 when token is empty', async () => {
    const req = mockReq({
      headers: { authorization: 'Bearer ' },
    });
    const res = mockRes();
    const next = mockNext();

    await hookAuth(req, res, next);

    expect(next.called).toBe(false);
    expect(res._status).toBe(401);
    expect((res._json as { error: string }).error).toMatch(/Empty/);
  });

  it('should return 401 when token is invalid', async () => {
    const req = mockReq({
      headers: { authorization: 'Bearer tok-does-not-exist' },
    });
    const res = mockRes();
    const next = mockNext();

    await hookAuth(req, res, next);

    expect(next.called).toBe(false);
    expect(res._status).toBe(401);
    expect((res._json as { error: string }).error).toMatch(/Invalid/);
  });

  it('should pass through killed users (status checked in route handlers)', async () => {
    const killedToken = 'tok-killed';
    const user = await createUser({
      name: 'Killed User',
      auth_token: killedToken,
    });
    const { updateUser } = await import('../src/db/queries/users.js');
    await updateUser(user.id, { status: 'killed' });

    const req = mockReq({
      headers: { authorization: `Bearer ${killedToken}` },
    });
    const res = mockRes();
    const next = mockNext();

    await hookAuth(req, res, next);

    expect(next.called).toBe(true);
    expect(req.user).toBeDefined();
    expect(req.user!.status).toBe('killed');
  });
});

// ---------------------------------------------------------------------------
// adminAuth middleware tests
// ---------------------------------------------------------------------------

describe('adminAuth', () => {
  const adminPayload = {
    sub: 1,
    email: 'admin@example.com',
    role: 'admin',
    permissions: [] as string[],
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
    expect(req.admin!.sub).toBe(1);
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
      process.env.JWT_SECRET ?? 'test-jwt-secret',
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
      sub: 1,
      email: 'test@example.com',
      role: 'admin',
      permissions: [],
    });
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3);
  });

  it('verifyToken should decode a valid JWT', () => {
    const token = generateToken({
      sub: 1,
      email: 'test@example.com',
      role: 'super_admin',
      permissions: ['users.manage'],
    });
    const decoded = verifyToken(token);
    expect(decoded.sub).toBe(1);
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
      { sub: 1, email: 'x@x.com', role: 'admin', permissions: [] },
      process.env.JWT_SECRET ?? 'test-jwt-secret',
      { expiresIn: '0s' },
    );
    expect(() => verifyToken(token)).toThrow();
  });
});
