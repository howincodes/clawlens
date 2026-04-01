import { getDb } from './index.js';
import { roles, permissions, rolePermissions, userRoles, users, modelCredits } from './schema/index.js';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';

const DEFAULT_PERMISSIONS = [
  { key: 'users.manage', name: 'Manage Users', category: 'users' },
  { key: 'users.view', name: 'View Users', category: 'users' },
  { key: 'users.create', name: 'Create Users', category: 'users' },
  { key: 'users.delete', name: 'Delete Users', category: 'users' },
  { key: 'projects.manage', name: 'Manage Projects', category: 'projects' },
  { key: 'projects.view', name: 'View Projects', category: 'projects' },
  { key: 'projects.create', name: 'Create Projects', category: 'projects' },
  { key: 'projects.members', name: 'Manage Project Members', category: 'projects' },
  { key: 'tasks.manage', name: 'Manage Tasks', category: 'tasks' },
  { key: 'tasks.create', name: 'Create Tasks', category: 'tasks' },
  { key: 'tasks.assign', name: 'Assign Tasks', category: 'tasks' },
  { key: 'tasks.view', name: 'View Tasks', category: 'tasks' },
  { key: 'tasks.update_own', name: 'Update Own Tasks', category: 'tasks' },
  { key: 'salary.manage', name: 'Manage Salary', category: 'salary' },
  { key: 'salary.view', name: 'View Salary', category: 'salary' },
  { key: 'attendance.manage', name: 'Manage Attendance', category: 'attendance' },
  { key: 'attendance.view', name: 'View Attendance', category: 'attendance' },
  { key: 'attendance.view_own', name: 'View Own Attendance', category: 'attendance' },
  { key: 'leave.approve', name: 'Approve Leave', category: 'attendance' },
  { key: 'leave.request', name: 'Request Leave', category: 'attendance' },
  { key: 'config.manage', name: 'Manage Configuration', category: 'config' },
  { key: 'config.view', name: 'View Configuration', category: 'config' },
  { key: 'reports.view', name: 'View Reports', category: 'reports' },
  { key: 'reports.generate', name: 'Generate Reports', category: 'reports' },
  { key: 'subscriptions.manage', name: 'Manage Subscriptions', category: 'subscriptions' },
  { key: 'subscriptions.view', name: 'View Subscriptions', category: 'subscriptions' },
];

const DEFAULT_ROLES: Array<{ name: string; description: string; isSystem: boolean; permissionKeys: string[] }> = [
  {
    name: 'Admin',
    description: 'Full system access',
    isSystem: true,
    permissionKeys: DEFAULT_PERMISSIONS.map(p => p.key),
  },
  {
    name: 'Project Manager',
    description: 'Manage tasks, projects, and team',
    isSystem: true,
    permissionKeys: [
      'tasks.manage', 'tasks.create', 'tasks.assign', 'tasks.view',
      'projects.view', 'projects.members',
      'users.view',
      'reports.view', 'reports.generate',
      'leave.approve', 'leave.request',
      'attendance.view',
    ],
  },
  {
    name: 'Developer',
    description: 'View and update own work',
    isSystem: true,
    permissionKeys: [
      'tasks.view', 'tasks.update_own',
      'projects.view',
      'attendance.view_own',
      'leave.request',
    ],
  },
  {
    name: 'Viewer',
    description: 'Read-only access',
    isSystem: true,
    permissionKeys: [
      'users.view', 'projects.view', 'tasks.view',
      'reports.view', 'attendance.view', 'subscriptions.view', 'config.view',
    ],
  },
];

const DEFAULT_MODEL_CREDITS = [
  { source: 'claude_code', model: 'opus', credits: 10, tier: 'flagship' },
  { source: 'claude_code', model: 'sonnet', credits: 3, tier: 'mid' },
  { source: 'claude_code', model: 'haiku', credits: 1, tier: 'mini' },
  { source: 'codex', model: 'gpt-5.4', credits: 10, tier: 'flagship' },
  { source: 'codex', model: 'gpt-5.2', credits: 7, tier: 'mid' },
  { source: 'codex', model: 'gpt-5.1', credits: 5, tier: 'mid' },
  { source: 'codex', model: 'gpt-5.4-mini', credits: 2, tier: 'mini' },
];

export async function seedDatabase() {
  const db = getDb();

  // Seed permissions (skip if already exist)
  const existingPerms = await db.select().from(permissions);
  if (existingPerms.length === 0) {
    await db.insert(permissions).values(DEFAULT_PERMISSIONS);
    console.log(`Seeded ${DEFAULT_PERMISSIONS.length} permissions`);
  }

  // Seed roles (skip if already exist)
  const existingRoles = await db.select().from(roles);
  if (existingRoles.length === 0) {
    const allPerms = await db.select().from(permissions);
    const permKeyToId = Object.fromEntries(allPerms.map(p => [p.key, p.id]));

    for (const roleDef of DEFAULT_ROLES) {
      const [role] = await db.insert(roles).values({
        name: roleDef.name,
        description: roleDef.description,
        isSystem: roleDef.isSystem,
      }).returning();

      const rpValues = roleDef.permissionKeys
        .filter(key => permKeyToId[key])
        .map(key => ({ roleId: role.id, permissionId: permKeyToId[key] }));

      if (rpValues.length > 0) {
        await db.insert(rolePermissions).values(rpValues);
      }

      console.log(`Seeded role "${roleDef.name}" with ${rpValues.length} permissions`);
    }
  }

  // Seed model credits (skip if already exist)
  const existingCredits = await db.select().from(modelCredits);
  if (existingCredits.length === 0) {
    await db.insert(modelCredits).values(DEFAULT_MODEL_CREDITS);
    console.log(`Seeded ${DEFAULT_MODEL_CREDITS.length} model credits`);
  }

  // Create admin user if none exists
  const existingUsers = await db.select().from(users);
  if (existingUsers.length === 0) {
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@howinlens.local';
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin';
    const passwordHash = await bcrypt.hash(adminPassword, 12);

    const [adminUser] = await db.insert(users).values({
      name: 'Admin',
      email: adminEmail,
      passwordHash,
      authToken: crypto.randomUUID(),
      status: 'active',
      deploymentTier: 'standard',
    }).returning();

    // Assign Admin role (projectId=0 means global)
    const [adminRole] = await db.select().from(roles).where(eq(roles.name, 'Admin'));
    if (adminRole) {
      await db.insert(userRoles).values({
        userId: adminUser.id,
        roleId: adminRole.id,
        projectId: 0,
      });
    }

    console.log(`Created admin user: ${adminEmail}`);
  }
}
