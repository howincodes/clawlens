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
// hookAuth middleware
//
// Expects:  Authorization: Bearer <auth_token>
// On success: attaches req.user and req.team
// On failure: responds with 401
// ---------------------------------------------------------------------------

export function hookAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or malformed Authorization header' });
    return;
  }

  const token = authHeader.slice(7); // strip "Bearer "

  if (!token) {
    res.status(401).json({ error: 'Empty bearer token' });
    return;
  }

  const user = getUserByToken(token);

  if (!user) {
    res.status(401).json({ error: 'Invalid token' });
    return;
  }

  // NOTE: We do NOT block killed users here. The hook endpoints need to
  // authenticate killed users so they can return {"continue": false} or
  // {"decision": "block"} — which is how the kill switch works.
  // Status checking happens inside each route handler.

  const team = getTeamById(user.team_id);

  if (!team) {
    res.status(401).json({ error: 'User team not found' });
    return;
  }

  req.user = user;
  req.team = team;

  next();
}
