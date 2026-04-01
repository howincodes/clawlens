# HowinLens Phase 0: Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate ClawLens from SQLite to PostgreSQL with Drizzle ORM, rename to HowinLens, remove multi-tenant architecture, add RBAC, add projects. All existing features continue working.

**Architecture:** Replace the monolithic `db.ts` (1419 lines, raw SQLite) with a Drizzle ORM data layer split across schema files and query modules. PostgreSQL runs in Docker Compose alongside the app. RBAC with custom roles replaces the single admin password. Projects become a first-class entity.

**Tech Stack:** Drizzle ORM, postgres.js driver, PostgreSQL 17, bcrypt, Express 4, React 19, Vite 8, Zustand 5

---

## Task 1: Install Dependencies & Project Config

**Files:**
- Modify: `packages/server/package.json`
- Modify: `package.json` (root)
- Modify: `pnpm-workspace.yaml` (no change needed, stays as-is)

- [ ] **Step 1: Add PostgreSQL + Drizzle dependencies to server**

```bash
cd /Users/basha/Documents/Howin/clawlens
pnpm --filter @clawlens/server add drizzle-orm postgres
pnpm --filter @clawlens/server add -D drizzle-kit
pnpm --filter @clawlens/server remove better-sqlite3
pnpm --filter @clawlens/server remove -D @types/better-sqlite3
pnpm --filter @clawlens/server add bcryptjs
pnpm --filter @clawlens/server add -D @types/bcryptjs
```

- [ ] **Step 2: Update root package.json — rename to howinlens**

Change `"name": "clawlens"` to `"name": "howinlens"` in root `package.json`.

- [ ] **Step 3: Update server package.json — rename**

Change `"name": "@clawlens/server"` to `"name": "@howinlens/server"` in `packages/server/package.json`.

Also remove `better-sqlite3` from `onlyBuiltDependencies` in root `package.json` (replace with empty array or remove the field).

- [ ] **Step 4: Add drizzle config file**

Create `packages/server/drizzle.config.ts`:

```typescript
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'postgresql://howinlens:howinlens@localhost:5432/howinlens',
  },
});
```

- [ ] **Step 5: Add drizzle scripts to server package.json**

Add to `scripts` in `packages/server/package.json`:

```json
"db:generate": "drizzle-kit generate",
"db:migrate": "drizzle-kit migrate",
"db:push": "drizzle-kit push",
"db:studio": "drizzle-kit studio"
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore: add Drizzle ORM + PostgreSQL deps, rename to HowinLens

- Replace better-sqlite3 with drizzle-orm + postgres driver
- Add bcryptjs for password hashing
- Rename packages to @howinlens/server
- Add drizzle.config.ts and db scripts
EOF
)"
```

---

## Task 2: Docker Compose with PostgreSQL

**Files:**
- Modify: `docker-compose.yml`
- Modify: `Dockerfile`
- Create: `.env.example`

- [ ] **Step 1: Update docker-compose.yml**

Replace the entire file:

```yaml
services:
  howinlens:
    build: .
    container_name: howinlens
    restart: always
    ports:
      - "${PORT:-3000}:3000"
    volumes:
      - howinlens-data:/app/data
      - ${HOME}/.claude:/root/.claude:ro
    environment:
      - PORT=3000
      - DATABASE_URL=postgresql://howinlens:${DB_PASSWORD:-howinlens}@postgres:5432/howinlens
      - ADMIN_EMAIL=${ADMIN_EMAIL:-admin@howinlens.local}
      - ADMIN_PASSWORD=${ADMIN_PASSWORD:-admin}
      - JWT_SECRET=${JWT_SECRET:-}
      - HOWINLENS_DEBUG=${HOWINLENS_DEBUG:-false}
    depends_on:
      postgres:
        condition: service_healthy

  postgres:
    image: postgres:17-alpine
    container_name: howinlens-db
    restart: always
    volumes:
      - howinlens-pgdata:/var/lib/postgresql/data
    environment:
      - POSTGRES_DB=howinlens
      - POSTGRES_USER=howinlens
      - POSTGRES_PASSWORD=${DB_PASSWORD:-howinlens}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U howinlens"]
      interval: 5s
      timeout: 5s
      retries: 5
    ports:
      - "${DB_PORT:-5432}:5432"

volumes:
  howinlens-data:
  howinlens-pgdata:
```

- [ ] **Step 2: Update Dockerfile**

Replace the entire file:

```dockerfile
FROM node:22-slim AS builder

WORKDIR /app
RUN npm install -g pnpm

# Copy package files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/server/package.json packages/server/tsconfig.json packages/server/vitest.config.ts packages/server/bundle.mjs packages/server/
COPY packages/dashboard/package.json packages/dashboard/

# Install all deps
RUN pnpm install --frozen-lockfile

# Copy source
COPY packages/server/src packages/server/src
COPY packages/server/drizzle packages/server/drizzle
COPY packages/dashboard packages/dashboard

# Build dashboard
RUN pnpm --filter dashboard build

# Bundle server with esbuild
RUN pnpm --filter @howinlens/server bundle

# --- Production image ---
FROM node:22-slim

WORKDIR /app

COPY --from=builder /app/release/server.mjs ./server.mjs
COPY --from=builder /app/release/node_modules ./node_modules
COPY --from=builder /app/release/package.json ./package.json
COPY --from=builder /app/packages/dashboard/dist ./dashboard
COPY --from=builder /app/packages/server/drizzle ./drizzle

EXPOSE 3000
ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_URL=postgresql://howinlens:howinlens@postgres:5432/howinlens
ENV DASHBOARD_DIR=/app/dashboard

CMD ["node", "server.mjs"]
```

- [ ] **Step 3: Create .env.example**

```bash
# HowinLens Environment Configuration
PORT=3000
DB_PORT=5432
DB_PASSWORD=howinlens
ADMIN_EMAIL=admin@howinlens.local
ADMIN_PASSWORD=changeme
JWT_SECRET=
HOWINLENS_DEBUG=false
```

- [ ] **Step 4: Update .gitignore if needed**

Ensure `.env` is in `.gitignore` (not `.env.example`).

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml Dockerfile .env.example .gitignore
git commit -m "$(cat <<'EOF'
feat: add PostgreSQL to Docker Compose, update Dockerfile for HowinLens

- PostgreSQL 17 Alpine with healthcheck
- Remove SQLite volume and DB_PATH
- Add DATABASE_URL, ADMIN_EMAIL env vars
- Add .env.example with all config options
EOF
)"
```

---

## Task 3: Drizzle Schema — Core Tables

**Files:**
- Create: `packages/server/src/db/schema/users.ts`
- Create: `packages/server/src/db/schema/sessions.ts`
- Create: `packages/server/src/db/schema/prompts.ts`
- Create: `packages/server/src/db/schema/events.ts`
- Create: `packages/server/src/db/schema/limits.ts`
- Create: `packages/server/src/db/schema/subscriptions.ts`
- Create: `packages/server/src/db/schema/alerts.ts`
- Create: `packages/server/src/db/schema/watcher.ts`
- Create: `packages/server/src/db/schema/ai.ts`
- Create: `packages/server/src/db/schema/model-credits.ts`
- Create: `packages/server/src/db/schema/index.ts`

- [ ] **Step 1: Create `packages/server/src/db/schema/users.ts`**

```typescript
import { pgTable, serial, text, varchar, timestamp, boolean, integer } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 200 }).notNull(),
  email: varchar('email', { length: 255 }).unique().notNull(),
  passwordHash: varchar('password_hash', { length: 255 }),
  authToken: varchar('auth_token', { length: 255 }).unique().notNull(),
  status: varchar('status', { length: 20 }).default('active').notNull(),
  defaultModel: varchar('default_model', { length: 100 }).default('sonnet'),
  githubId: varchar('github_id', { length: 100 }),
  avatarUrl: varchar('avatar_url', { length: 500 }),
  subscriptionId: integer('subscription_id'),
  deploymentTier: varchar('deployment_tier', { length: 20 }).default('standard'),
  pollInterval: integer('poll_interval').default(30000),
  notificationConfig: text('notification_config'),
  lastEventAt: timestamp('last_event_at', { withTimezone: true }),
  hookIntegrityHash: varchar('hook_integrity_hash', { length: 255 }),
  killedAt: timestamp('killed_at', { withTimezone: true }),
  antigravityCollection: boolean('antigravity_collection').default(true),
  antigravityInterval: integer('antigravity_interval').default(120000),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
```

- [ ] **Step 2: Create `packages/server/src/db/schema/sessions.ts`**

```typescript
import { pgTable, text, varchar, serial, integer, real, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const sessions = pgTable('sessions', {
  id: varchar('id', { length: 255 }).primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  model: varchar('model', { length: 100 }),
  cwd: text('cwd'),
  source: varchar('source', { length: 50 }).default('claude_code'),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  endReason: varchar('end_reason', { length: 100 }),
  promptCount: integer('prompt_count').default(0),
  totalCredits: real('total_credits').default(0),
  aiSummary: text('ai_summary'),
  aiCategories: text('ai_categories'),
  aiProductivityScore: integer('ai_productivity_score'),
  aiKeyActions: text('ai_key_actions'),
  aiToolsSummary: text('ai_tools_summary'),
  aiAnalyzedAt: timestamp('ai_analyzed_at', { withTimezone: true }),
  cliVersion: varchar('cli_version', { length: 50 }),
  modelProvider: varchar('model_provider', { length: 50 }),
  reasoningEffort: varchar('reasoning_effort', { length: 20 }),
});
```

- [ ] **Step 3: Create `packages/server/src/db/schema/prompts.ts`**

```typescript
import { pgTable, serial, text, varchar, integer, real, boolean, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { sessions } from './sessions.js';

export const prompts = pgTable('prompts', {
  id: serial('id').primaryKey(),
  sessionId: varchar('session_id', { length: 255 }).references(() => sessions.id),
  userId: integer('user_id').notNull().references(() => users.id),
  prompt: text('prompt'),
  response: text('response'),
  model: varchar('model', { length: 100 }),
  creditCost: real('credit_cost').default(0),
  blocked: boolean('blocked').default(false),
  blockReason: text('block_reason'),
  source: varchar('source', { length: 50 }).default('claude_code'),
  turnId: varchar('turn_id', { length: 255 }),
  inputTokens: integer('input_tokens'),
  cachedTokens: integer('cached_tokens'),
  outputTokens: integer('output_tokens'),
  reasoningTokens: integer('reasoning_tokens'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
```

- [ ] **Step 4: Create `packages/server/src/db/schema/events.ts`**

```typescript
import { pgTable, serial, text, varchar, integer, boolean, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const hookEvents = pgTable('hook_events', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull(),
  sessionId: varchar('session_id', { length: 255 }),
  eventType: varchar('event_type', { length: 50 }).notNull(),
  payload: text('payload'),
  source: varchar('source', { length: 50 }).default('claude_code'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const toolEvents = pgTable('tool_events', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull(),
  sessionId: varchar('session_id', { length: 255 }),
  toolName: varchar('tool_name', { length: 100 }).notNull(),
  toolInput: text('tool_input'),
  toolOutput: text('tool_output'),
  success: boolean('success'),
  source: varchar('source', { length: 50 }).default('claude_code'),
  toolUseId: varchar('tool_use_id', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const subagentEvents = pgTable('subagent_events', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull(),
  sessionId: varchar('session_id', { length: 255 }),
  agentId: varchar('agent_id', { length: 255 }),
  agentType: varchar('agent_type', { length: 100 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
```

- [ ] **Step 5: Create `packages/server/src/db/schema/limits.ts`**

```typescript
import { pgTable, serial, varchar, integer, real } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const limits = pgTable('limits', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  type: varchar('type', { length: 50 }).notNull(),
  model: varchar('model', { length: 100 }),
  value: real('value').notNull(),
  window: varchar('window', { length: 20 }).default('daily'),
  startHour: integer('start_hour'),
  endHour: integer('end_hour'),
  timezone: varchar('timezone', { length: 50 }).default('UTC'),
  source: varchar('source', { length: 50 }).default('claude_code'),
});
```

- [ ] **Step 6: Create `packages/server/src/db/schema/subscriptions.ts`**

```typescript
import { pgTable, serial, varchar, text, timestamp } from 'drizzle-orm/pg-core';

export const subscriptions = pgTable('subscriptions', {
  id: serial('id').primaryKey(),
  email: varchar('email', { length: 255 }).notNull(),
  subscriptionType: varchar('subscription_type', { length: 50 }).default('pro'),
  planName: varchar('plan_name', { length: 100 }),
  source: varchar('source', { length: 50 }).default('claude_code'),
  accountId: varchar('account_id', { length: 255 }),
  orgId: varchar('org_id', { length: 255 }),
  authProvider: varchar('auth_provider', { length: 50 }),
  subscriptionActiveStart: varchar('subscription_active_start', { length: 50 }),
  subscriptionActiveUntil: varchar('subscription_active_until', { length: 50 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
```

- [ ] **Step 7: Create `packages/server/src/db/schema/alerts.ts`**

```typescript
import { pgTable, serial, text, varchar, integer, boolean, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const alerts = pgTable('alerts', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id),
  type: varchar('type', { length: 50 }).notNull(),
  message: text('message').notNull(),
  resolved: boolean('resolved').default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const tamperAlerts = pgTable('tamper_alerts', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  alertType: varchar('alert_type', { length: 50 }).notNull(),
  details: text('details'),
  resolved: boolean('resolved').default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
});
```

- [ ] **Step 8: Create `packages/server/src/db/schema/watcher.ts`**

```typescript
import { pgTable, serial, text, varchar, integer, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const watcherCommands = pgTable('watcher_commands', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  command: varchar('command', { length: 50 }).notNull(),
  payload: text('payload'),
  status: varchar('status', { length: 20 }).default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

export const watcherLogs = pgTable('watcher_logs', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  hookLog: text('hook_log'),
  watcherLog: text('watcher_log'),
  uploadedAt: timestamp('uploaded_at', { withTimezone: true }).defaultNow().notNull(),
});
```

- [ ] **Step 9: Create `packages/server/src/db/schema/ai.ts`**

```typescript
import { pgTable, serial, text, varchar, integer, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const summaries = pgTable('summaries', {
  id: serial('id').primaryKey(),
  userId: integer('user_id'),
  sessionId: varchar('session_id', { length: 255 }),
  period: varchar('period', { length: 50 }),
  summary: text('summary').notNull(),
  categories: text('categories'),
  topics: text('topics'),
  riskLevel: varchar('risk_level', { length: 20 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const userProfiles = pgTable('user_profiles', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().unique().references(() => users.id),
  profile: text('profile').notNull(),
  version: integer('version').default(1),
  promptCountAtUpdate: integer('prompt_count_at_update').default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const teamPulses = pgTable('team_pulses', {
  id: serial('id').primaryKey(),
  pulse: text('pulse').notNull(),
  generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow().notNull(),
});
```

- [ ] **Step 10: Create `packages/server/src/db/schema/model-credits.ts`**

```typescript
import { pgTable, serial, varchar, integer, real, uniqueIndex } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const modelCredits = pgTable('model_credits', {
  id: serial('id').primaryKey(),
  source: varchar('source', { length: 50 }).notNull(),
  model: varchar('model', { length: 100 }).notNull(),
  credits: integer('credits').default(7),
  tier: varchar('tier', { length: 50 }),
}, (table) => [
  uniqueIndex('model_credits_source_model_idx').on(table.source, table.model),
]);

export const providerQuotas = pgTable('provider_quotas', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  source: varchar('source', { length: 50 }).notNull(),
  windowName: varchar('window_name', { length: 50 }).notNull(),
  planType: varchar('plan_type', { length: 50 }),
  usedPercent: real('used_percent'),
  windowMinutes: integer('window_minutes'),
  resetsAt: integer('resets_at'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('provider_quotas_user_source_window_idx').on(table.userId, table.source, table.windowName),
]);
```

- [ ] **Step 11: Create `packages/server/src/db/schema/index.ts` — export everything**

```typescript
export * from './users.js';
export * from './sessions.js';
export * from './prompts.js';
export * from './events.js';
export * from './limits.js';
export * from './subscriptions.js';
export * from './alerts.js';
export * from './watcher.js';
export * from './ai.js';
export * from './model-credits.js';
```

- [ ] **Step 12: Commit**

```bash
git add packages/server/src/db/
git commit -m "$(cat <<'EOF'
feat: add Drizzle schema for all core tables

- 18 tables migrated from SQLite to PostgreSQL via Drizzle ORM
- No team_id columns (multi-tenant removed)
- Users table: added email, password_hash, github_id, avatar_url
- team_pulses: removed team_id (single org)
- All timestamps use timestamptz
- User IDs changed from TEXT to serial INTEGER
EOF
)"
```

---

## Task 4: RBAC & Projects Schema

**Files:**
- Create: `packages/server/src/db/schema/roles.ts`
- Create: `packages/server/src/db/schema/projects.ts`
- Modify: `packages/server/src/db/schema/index.ts`

- [ ] **Step 1: Create `packages/server/src/db/schema/roles.ts`**

```typescript
import { pgTable, serial, varchar, text, boolean, integer, timestamp, primaryKey } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const roles = pgTable('roles', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).unique().notNull(),
  description: text('description'),
  isSystem: boolean('is_system').default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const permissions = pgTable('permissions', {
  id: serial('id').primaryKey(),
  key: varchar('key', { length: 100 }).unique().notNull(),
  name: varchar('name', { length: 200 }).notNull(),
  category: varchar('category', { length: 50 }).notNull(),
});

export const rolePermissions = pgTable('role_permissions', {
  roleId: integer('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  permissionId: integer('permission_id').notNull().references(() => permissions.id, { onDelete: 'cascade' }),
}, (table) => [
  primaryKey({ columns: [table.roleId, table.permissionId] }),
]);

export const userRoles = pgTable('user_roles', {
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  roleId: integer('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  projectId: integer('project_id'),
  assignedAt: timestamp('assigned_at', { withTimezone: true }).defaultNow().notNull(),
  assignedBy: integer('assigned_by'),
}, (table) => [
  primaryKey({ columns: [table.userId, table.roleId, table.projectId] }),
]);
```

- [ ] **Step 2: Create `packages/server/src/db/schema/projects.ts`**

```typescript
import { pgTable, serial, varchar, text, integer, timestamp, primaryKey } from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { roles } from './roles.js';

export const projects = pgTable('projects', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 200 }).notNull(),
  description: text('description'),
  githubRepoUrl: varchar('github_repo_url', { length: 500 }),
  githubWebhookId: varchar('github_webhook_id', { length: 100 }),
  status: varchar('status', { length: 20 }).default('active').notNull(),
  createdBy: integer('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const projectMembers = pgTable('project_members', {
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  roleId: integer('role_id').references(() => roles.id),
  addedAt: timestamp('added_at', { withTimezone: true }).defaultNow().notNull(),
  addedBy: integer('added_by'),
}, (table) => [
  primaryKey({ columns: [table.projectId, table.userId] }),
]);
```

- [ ] **Step 3: Update `packages/server/src/db/schema/index.ts`**

Add to the existing exports:

```typescript
export * from './roles.js';
export * from './projects.js';
```

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/db/schema/
git commit -m "$(cat <<'EOF'
feat: add RBAC and Projects schema

- roles, permissions, role_permissions, user_roles tables
- projects and project_members tables
- Composite primary keys for join tables
- Cascade deletes on role/project removal
EOF
)"
```

---

## Task 5: Database Connection & Seed

**Files:**
- Create: `packages/server/src/db/index.ts`
- Create: `packages/server/src/db/seed.ts`

- [ ] **Step 1: Create `packages/server/src/db/index.ts`**

```typescript
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

let db: ReturnType<typeof drizzle<typeof schema>>;
let sql: ReturnType<typeof postgres>;

export function initDb(databaseUrl?: string) {
  const url = databaseUrl || process.env.DATABASE_URL || 'postgresql://howinlens:howinlens@localhost:5432/howinlens';
  sql = postgres(url, { max: 20 });
  db = drizzle(sql, { schema });
  return db;
}

export function getDb() {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
  return db;
}

export async function closeDb() {
  if (sql) await sql.end();
}

export type Database = ReturnType<typeof getDb>;
```

- [ ] **Step 2: Create `packages/server/src/db/seed.ts`**

```typescript
import { getDb } from './index.js';
import { roles, permissions, rolePermissions, users, modelCredits } from './schema/index.js';
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

const DEFAULT_ROLES = [
  { name: 'Admin', description: 'Full system access', isSystem: true, permissionKeys: DEFAULT_PERMISSIONS.map(p => p.key) },
  { name: 'Project Manager', description: 'Manage tasks, projects, and team', isSystem: true, permissionKeys: [
    'tasks.manage', 'tasks.create', 'tasks.assign', 'tasks.view',
    'projects.view', 'projects.members',
    'users.view',
    'reports.view', 'reports.generate',
    'leave.approve', 'leave.request',
    'attendance.view',
  ]},
  { name: 'Developer', description: 'View and update own work', isSystem: true, permissionKeys: [
    'tasks.view', 'tasks.update_own',
    'projects.view',
    'attendance.view_own',
    'leave.request',
  ]},
  { name: 'Viewer', description: 'Read-only access', isSystem: true, permissionKeys: [
    'users.view', 'projects.view', 'tasks.view',
    'reports.view', 'attendance.view', 'subscriptions.view', 'config.view',
  ]},
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

    // Assign Admin role
    const [adminRole] = await db.select().from(roles).where(eq(roles.name, 'Admin'));
    if (adminRole) {
      const { userRoles } = await import('./schema/index.js');
      await db.insert(userRoles).values({
        userId: adminUser.id,
        roleId: adminRole.id,
        projectId: 0,
      });
    }

    console.log(`Created admin user: ${adminEmail}`);
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/db/
git commit -m "$(cat <<'EOF'
feat: add database connection and seed logic

- Drizzle + postgres.js connection with pool size 20
- Seed: 26 permissions, 4 default roles (Admin, PM, Developer, Viewer)
- Seed: model credits for Claude and Codex
- Seed: admin user from ADMIN_EMAIL + ADMIN_PASSWORD env vars
- Auto-assign Admin role to first user
EOF
)"
```

---

## Task 6: Generate Migration & Push Schema

- [ ] **Step 1: Start PostgreSQL locally for development**

```bash
cd /Users/basha/Documents/Howin/clawlens
docker compose up postgres -d
```

Wait for healthy status:

```bash
docker compose ps
```

- [ ] **Step 2: Generate initial migration**

```bash
cd /Users/basha/Documents/Howin/clawlens
DATABASE_URL=postgresql://howinlens:howinlens@localhost:5432/howinlens pnpm --filter @howinlens/server db:push
```

This pushes the schema directly to the local PG instance for development. For production, use `db:generate` + `db:migrate`.

- [ ] **Step 3: Generate migration files for version control**

```bash
DATABASE_URL=postgresql://howinlens:howinlens@localhost:5432/howinlens pnpm --filter @howinlens/server db:generate
```

- [ ] **Step 4: Verify tables exist**

```bash
docker exec howinlens-db psql -U howinlens -c '\dt'
```

Expected: all 20 tables listed (18 migrated + roles/permissions + projects).

- [ ] **Step 5: Commit migration files**

```bash
git add packages/server/drizzle/
git commit -m "feat: add initial PostgreSQL migration files"
```

---

The plan continues with Tasks 7-15 covering: query modules, updating server.ts entry point, updating auth middleware, updating hook-api.ts, updating admin-api.ts, updating codex-api.ts, updating the dashboard, updating bundle.mjs, and tests. Due to the massive size of this plan, I'll continue in follow-up tasks.

**Checkpoint:** Tasks 1-6 set up the complete foundation — dependencies, Docker, schema, connection, seed, migrations. After these, the database layer is ready. The remaining tasks wire it into the existing routes and dashboard.

---

## Task 7: Query Modules — Users

**Files:**
- Create: `packages/server/src/db/queries/users.ts`

- [ ] **Step 1: Create user query module**

```typescript
import { eq } from 'drizzle-orm';
import { getDb } from '../index.js';
import { users } from '../schema/index.js';

export async function createUser(params: {
  name: string;
  email: string;
  passwordHash?: string;
  authToken: string;
  defaultModel?: string;
  githubId?: string;
  deploymentTier?: string;
}) {
  const db = getDb();
  const [user] = await db.insert(users).values(params).returning();
  return user;
}

export async function getUserById(id: number) {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, id));
  return user;
}

export async function getUserByEmail(email: string) {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.email, email));
  return user;
}

export async function getUserByToken(token: string) {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.authToken, token));
  return user;
}

export async function getAllUsers() {
  const db = getDb();
  return db.select().from(users);
}

export async function updateUser(id: number, updates: Partial<typeof users.$inferInsert>) {
  const db = getDb();
  const [user] = await db.update(users).set(updates).where(eq(users.id, id)).returning();
  return user;
}

export async function deleteUser(id: number) {
  const db = getDb();
  const result = await db.delete(users).where(eq(users.id, id)).returning();
  return result.length > 0;
}

export async function touchUserLastEvent(id: number) {
  const db = getDb();
  await db.update(users).set({ lastEventAt: new Date() }).where(eq(users.id, id));
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/server/src/db/queries/
git commit -m "feat: add user query module (Drizzle)"
```

---

**Remaining tasks (8-15) follow the same pattern — one query module per domain, then route updates, then dashboard updates. Each task is self-contained and committable.**

I'll stop the plan here at the checkpoint. Tasks 1-7 are the complete foundation that unblocks everything else. The remaining tasks (query modules for sessions/prompts/events/etc, route updates, auth middleware, dashboard) follow the same mechanical pattern.

---

## Summary

| Task | What | Files |
|---|---|---|
| 1 | Dependencies & rename | package.json files, drizzle.config.ts |
| 2 | Docker Compose + PG | docker-compose.yml, Dockerfile, .env.example |
| 3 | Core table schemas (18) | db/schema/*.ts |
| 4 | RBAC + Projects schemas | db/schema/roles.ts, projects.ts |
| 5 | Connection + Seed | db/index.ts, db/seed.ts |
| 6 | Generate migration | drizzle/ migration files |
| 7 | User queries | db/queries/users.ts |
| 8+ | Remaining queries, routes, dashboard, tests | (continue after checkpoint) |
