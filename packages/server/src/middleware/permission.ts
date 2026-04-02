import type { Request, Response, NextFunction } from 'express';
import { getUserPermissionKeys } from '../db/queries/roles.js';

/**
 * Require ALL of the given permission keys.
 * Usage: router.post('/endpoint', requirePermission('users.manage'), handler)
 */
export function requirePermission(...requiredKeys: string[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const userId = req.user?.id ?? (req as any).admin?.sub;
    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const userPerms = await getUserPermissionKeys(userId as number);
    const hasAll = requiredKeys.every(k => userPerms.includes(k));
    if (!hasAll) {
      res.status(403).json({ error: 'Insufficient permissions', required: requiredKeys });
      return;
    }
    next();
  };
}

/**
 * Require ANY ONE of the given permission keys.
 */
export function requireAnyPermission(...keys: string[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const userId = req.user?.id ?? (req as any).admin?.sub;
    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const userPerms = await getUserPermissionKeys(userId as number);
    const hasAny = keys.some(k => userPerms.includes(k));
    if (!hasAny) {
      res.status(403).json({ error: 'Insufficient permissions', required: keys });
      return;
    }
    next();
  };
}
