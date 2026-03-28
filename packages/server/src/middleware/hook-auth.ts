import type { Request, Response, NextFunction } from 'express';
import { getUserByToken, getTeamById, type UserRow, type TeamRow } from '../services/db.js';

// ---------------------------------------------------------------------------
// Augment Express Request to carry authenticated user and team
// ---------------------------------------------------------------------------

declare global {
  namespace Express {
    interface Request {
      user?: UserRow;
      team?: TeamRow;
    }
  }
}

// ---------------------------------------------------------------------------
// Debug logging — enabled by CLAWLENS_DEBUG=1
// ---------------------------------------------------------------------------

const DEBUG = process.env.CLAWLENS_DEBUG === '1' || process.env.CLAWLENS_DEBUG === 'true';

function debug(msg: string): void {
  if (DEBUG) console.log(`[hook-auth] ${msg}`);
}

// ---------------------------------------------------------------------------
// hookAuth middleware
//
// Expects:  Authorization: Bearer <auth_token>
// On success: attaches req.user and req.team
// On failure: responds with 401
// ---------------------------------------------------------------------------

export function hookAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  debug(`── auth check for ${req.method} ${req.path}`);
  debug(`Authorization header: ${authHeader ? authHeader.slice(0, 15) + '...' : '(missing)'}`);

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    debug(`REJECTED: missing or malformed Authorization header`);
    res.status(401).json({ error: 'Missing or malformed Authorization header' });
    return;
  }

  const token = authHeader.slice(7); // strip "Bearer "

  if (!token) {
    debug(`REJECTED: empty bearer token`);
    res.status(401).json({ error: 'Empty bearer token' });
    return;
  }

  debug(`token: ${token.slice(0, 8)}... (${token.length} chars)`);

  const user = getUserByToken(token);

  if (!user) {
    debug(`REJECTED: no user found for token ${token.slice(0, 8)}...`);
    res.status(401).json({ error: 'Invalid token' });
    return;
  }

  debug(`user found: id=${user.id}, name=${user.name}, status=${user.status}, team_id=${user.team_id}`);

  // NOTE: We do NOT block killed users here. The hook endpoints need to
  // authenticate killed users so they can return {"continue": false} or
  // {"decision": "block"} — which is how the kill switch works.
  // Status checking happens inside each route handler.

  const team = getTeamById(user.team_id);

  if (!team) {
    debug(`REJECTED: team not found for team_id=${user.team_id}`);
    res.status(401).json({ error: 'User team not found' });
    return;
  }

  debug(`team found: id=${team.id}, name=${team.name}`);
  debug(`auth OK — proceeding to handler`);

  req.user = user;
  req.team = team;

  next();
}
