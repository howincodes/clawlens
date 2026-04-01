import { eq, and, desc } from 'drizzle-orm';
import { getDb } from '../index.js';
import { roles, permissions, rolePermissions, userRoles } from '../schema/index.js';

export async function getAllRoles() {
  const db = getDb();
  return db.select().from(roles).orderBy(desc(roles.createdAt));
}

export async function getRoleById(id: number) {
  const db = getDb();
  const [role] = await db.select().from(roles).where(eq(roles.id, id));
  return role;
}

export async function createRole(params: {
  name: string;
  description?: string;
  isSystem?: boolean;
}) {
  const db = getDb();
  const [role] = await db.insert(roles).values(params).returning();
  return role;
}

export async function updateRole(id: number, params: { name?: string; description?: string }) {
  const db = getDb();
  const [role] = await db
    .update(roles)
    .set(params)
    .where(eq(roles.id, id))
    .returning();
  return role;
}

export async function deleteRole(id: number): Promise<boolean> {
  const db = getDb();
  const result = await db.delete(roles).where(eq(roles.id, id)).returning();
  return result.length > 0;
}

export async function getAllPermissions() {
  const db = getDb();
  return db.select().from(permissions);
}

export async function getRolePermissions(roleId: number) {
  const db = getDb();
  return db
    .select()
    .from(rolePermissions)
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(eq(rolePermissions.roleId, roleId));
}

export async function setRolePermissions(roleId: number, permissionIds: number[]) {
  const db = getDb();
  await db.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
  if (permissionIds.length > 0) {
    await db
      .insert(rolePermissions)
      .values(permissionIds.map((pid) => ({ roleId, permissionId: pid })));
  }
}

export async function getUserRoles(userId: number) {
  const db = getDb();
  return db
    .select()
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(eq(userRoles.userId, userId));
}

export async function assignUserRole(
  userId: number,
  roleId: number,
  projectId?: number,
  assignedBy?: number,
) {
  const db = getDb();
  const [result] = await db
    .insert(userRoles)
    .values({
      userId,
      roleId,
      projectId: projectId ?? 0,
      assignedBy,
    })
    .onConflictDoUpdate({
      target: [userRoles.userId, userRoles.roleId, userRoles.projectId],
      set: { assignedBy, assignedAt: new Date() },
    })
    .returning();
  return result;
}

export async function removeUserRole(
  userId: number,
  roleId: number,
  projectId?: number,
): Promise<boolean> {
  const db = getDb();
  const result = await db
    .delete(userRoles)
    .where(
      and(
        eq(userRoles.userId, userId),
        eq(userRoles.roleId, roleId),
        eq(userRoles.projectId, projectId ?? 0),
      ),
    )
    .returning();
  return result.length > 0;
}

export async function getUserPermissionKeys(userId: number): Promise<string[]> {
  const db = getDb();
  const result = await db
    .selectDistinct({ key: permissions.key })
    .from(userRoles)
    .innerJoin(rolePermissions, eq(userRoles.roleId, rolePermissions.roleId))
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(eq(userRoles.userId, userId));
  return result.map((r) => r.key);
}
