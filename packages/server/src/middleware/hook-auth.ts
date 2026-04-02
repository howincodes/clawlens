import type { Request, Response, NextFunction } from 'express';
import { getUserByToken } from '../db/queries/index.js';
import type { users } from '../db/schema/index.js';
import type { InferSelectModel } from 'drizzle-orm';
import type { ProviderAdapter } from '../providers/types.js';

type UserRow = InferSelectModel<typeof users>;

// ---------------------------------------------------------------------------
// Augment Express Request to carry authenticated user + provider adapter
// ---------------------------------------------------------------------------

declare global {
  namespace Express {
    interface Request {
      user?: UserRow;
      providerAdapter?: ProviderAdapter;
    }
  }
}

// ---------------------------------------------------------------------------
// Debug logging — enabled by HOWINLENS_DEBUG=1
// ---------------------------------------------------------------------------

const DEBUG = process.env.HOWINLENS_DEBUG === '1' || process.env.HOWINLENS_DEBUG === 'true';

function debug(msg: string): void {
  if (DEBUG) console.log(`[hook-auth] ${msg}`);
}

// ---------------------------------------------------------------------------
// hookAuth middleware
//
// Expects:  Authorization: Bearer <auth_token>
// On success: attaches req.user
// On failure: responds with 401
// ---------------------------------------------------------------------------

export async function hookAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  debug(`── auth check for ${req.method} ${req.path}`);
  debug(`Authorization header: ${authHeader ? authHeader.slice(0, 15) + '...' : '(missing)'}`);

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    debug('REJECTED: missing or malformed Authorization header');
    res.status(401).json({ error: 'Missing or malformed Authorization header' });
    return;
  }

  const token = authHeader.slice(7);

  if (!token) {
    debug('REJECTED: empty bearer token');
    res.status(401).json({ error: 'Empty bearer token' });
    return;
  }

  debug(`token: ${token.slice(0, 8)}... (${token.length} chars)`);

  const user = await getUserByToken(token);

  if (!user) {
    debug(`REJECTED: no user found for token ${token.slice(0, 8)}...`);
    res.status(401).json({ error: 'Invalid token' });
    return;
  }

  debug(`user found: id=${user.id}, name=${user.name}, status=${user.status}`);

  req.user = user;
  next();
}
