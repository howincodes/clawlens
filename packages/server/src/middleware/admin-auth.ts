import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// ---------------------------------------------------------------------------
// JWT secret — use env var in production, fallback for dev
// ---------------------------------------------------------------------------

const JWT_SECRET = process.env.JWT_SECRET ?? 'clawlens-dev-secret-change-me';
const TOKEN_EXPIRY = '24h';

// ---------------------------------------------------------------------------
// Augment Express Request to carry decoded admin payload
// ---------------------------------------------------------------------------

export interface AdminPayload {
  sub: string;       // admin user id
  email: string;
  role: string;      // 'admin' | 'super_admin'
  iat?: number;
  exp?: number;
}

declare global {
  namespace Express {
    interface Request {
      admin?: AdminPayload;
    }
  }
}

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------

/**
 * Generate a signed JWT for an admin user.
 */
export function generateToken(payload: Omit<AdminPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

/**
 * Verify and decode a JWT token.
 * Returns the decoded payload, or throws if invalid/expired.
 */
export function verifyToken(token: string): AdminPayload {
  return jwt.verify(token, JWT_SECRET) as AdminPayload;
}

// ---------------------------------------------------------------------------
// adminAuth middleware
//
// Expects:  Authorization: Bearer <jwt_token>
// On success: attaches req.admin
// On failure: responds with 401
// ---------------------------------------------------------------------------

export function adminAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or malformed Authorization header' });
    return;
  }

  const token = authHeader.slice(7);

  if (!token) {
    res.status(401).json({ error: 'Empty bearer token' });
    return;
  }

  try {
    const decoded = verifyToken(token);
    req.admin = decoded;
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: 'Token expired' });
      return;
    }
    if (err instanceof jwt.JsonWebTokenError) {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }
    res.status(401).json({ error: 'Authentication failed' });
  }
}
