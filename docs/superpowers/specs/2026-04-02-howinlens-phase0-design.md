# HowinLens Phase 0: Foundation — Design Spec

**Date:** 2026-04-02
**Status:** Draft
**Scope:** PostgreSQL migration, rename, drop multi-tenant, RBAC, projects

---

## 1. Project Rename: ClawLens → HowinLens

### What Changes
- Package names: `@clawlens/server` → `@howinlens/server`, `dashboard` stays generic
- Docker: container name, image name, volume names
- All user-facing strings: API responses, dashboard title, install scripts, docs
- File references: env vars (`CLAWLENS_DEBUG` → `HOWINLENS_DEBUG`), DB path
- Hook scripts: `clawlens-hook.sh` → `howinlens-hook.sh`
- Client files: `clawlens.mjs`, `clawlens-watcher.mjs` → `howinlens.mjs`, `howinlens-watcher.mjs`
- GitHub repo name: separate decision (not blocked by code rename)

### What Does NOT Change
- Directory structure (`packages/server`, `packages/dashboard`)
- Git repo location on disk (rename later if desired)
- Architecture, API paths (`/api/v1/hook/*`, `/api/v1/admin/*`)

---

## 2. PostgreSQL Migration

### Tech Stack
- **ORM:** Drizzle ORM (`drizzle-orm` + `drizzle-orm/postgres-js`)
- **Driver:** `postgres` (postgres.js) — fastest Node.js PG driver, built-in pooling
- **Migrations:** Drizzle Kit (`drizzle-kit`) — schema-first, generates SQL migration files
- **Validation:** Zod (already used, Drizzle can derive Zod schemas via `drizzle-zod`)

### Docker Compose
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
      - ${HOME}/.claude:/root/.claude
      - ${HOME}/.claude.json:/root/.claude.json
      - ${HOME}/.local/bin/claude:/usr/local/bin/claude:ro
    environment:
      - ADMIN_PASSWORD=${ADMIN_PASSWORD:-admin}
      - PORT=3000
      - DATABASE_URL=postgresql://howinlens:${DB_PASSWORD:-howinlens}@postgres:5432/howinlens
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

volumes:
  howinlens-data:
  howinlens-pgdata:
```

### Flexibility
- `DATABASE_URL` env var — can point to any PostgreSQL (Docker, managed, remote)
- Docker Compose is the default, but server works with any PG instance
- Connection pooling via postgres.js (configurable pool size)

### Migration Strategy
- Clean rewrite of data layer — no incremental SQLite→PG migration
- New `packages/server/src/db/` directory replaces `services/db.ts`
- Structure:
  ```
  packages/server/src/db/
  ├── index.ts          — connection setup, export db instance
  ├── schema/
  │   ├── users.ts      — users table
  │   ├── sessions.ts   — sessions table
  │   ├── prompts.ts    — prompts table
  │   ├── projects.ts   — projects table (NEW)
  │   ├── roles.ts      — roles + permissions (NEW)
  │   └── ...           — one file per table/domain
  ├── queries/
  │   ├── users.ts      — user CRUD + queries
  │   ├── sessions.ts   — session queries
  │   └── ...           — one file per domain
  └── migrate.ts        — run migrations on startup
  ```

---

## 3. Drop Multi-Tenant

### Current State
- `teams` table exists with team_id FK on most tables
- `CLAWLENS_MODE=saas|selfhost` env var
- `plan` table for SaaS billing
- Every query scoped by `team_id`

### What Gets Removed
- `teams` table — dropped entirely
- `plan` table — dropped entirely
- `team_id` column — removed from all tables
- `CLAWLENS_MODE` env var — removed
- All team_id WHERE clauses — removed from queries
- Dashboard team switching UI — removed
- Team signup/onboarding flow — removed

### Migration Path
- New schema simply doesn't have these columns
- No data migration needed (fresh PG database)
- Old SQLite DB kept as backup if historical data needed

---

## 4. RBAC System

### Schema

#### `roles` table
| Column | Type | Description |
|---|---|---|
| id | serial PK | |
| name | varchar(100) unique | e.g. "Admin", "Project Manager", "Developer" |
| description | text | Human-readable description |
| is_system | boolean default false | System roles can't be deleted |
| created_at | timestamptz | |

#### `permissions` table
| Column | Type | Description |
|---|---|---|
| id | serial PK | |
| key | varchar(100) unique | e.g. "users.manage", "tasks.create", "salary.view" |
| name | varchar(200) | Human-readable: "Manage Users" |
| category | varchar(50) | Grouping: "users", "tasks", "projects", "salary", "config" |

#### `role_permissions` table
| Column | Type | Description |
|---|---|---|
| role_id | int FK → roles | |
| permission_id | int FK → permissions | |
| PK | (role_id, permission_id) | |

#### `user_roles` table
| Column | Type | Description |
|---|---|---|
| user_id | int FK → users | |
| role_id | int FK → roles | |
| project_id | int FK → projects, nullable | null = global role, set = project-scoped |
| assigned_at | timestamptz | |
| assigned_by | int FK → users, nullable | |
| PK | (user_id, role_id, project_id) | |

### Default Roles (seeded on first run)
| Role | Key Permissions |
|---|---|
| Admin | Everything |
| Project Manager | tasks.*, projects.view, projects.members, users.view, reports.*, leave.approve |
| Developer | tasks.view, tasks.update_own, projects.view_own |
| Viewer | *.view (read-only across everything) |

### Default Permissions (seeded)
```
users.manage, users.view, users.create, users.delete
projects.manage, projects.view, projects.create, projects.members
tasks.manage, tasks.create, tasks.assign, tasks.view, tasks.update_own
salary.manage, salary.view
attendance.manage, attendance.view, attendance.view_own
leave.approve, leave.request
config.manage, config.view
reports.view, reports.generate
subscriptions.manage, subscriptions.view
```

### Auth Changes
- Current: single admin password → JWT
- New: user login (email + password) → JWT with user_id + role info
- Middleware checks permissions per endpoint
- Admin password kept as bootstrap (first-run creates Admin user)

---

## 5. Projects

### Schema

#### `projects` table
| Column | Type | Description |
|---|---|---|
| id | serial PK | |
| name | varchar(200) | |
| description | text | |
| github_repo_url | varchar(500) nullable | Linked GitHub repository |
| github_webhook_id | varchar(100) nullable | For managing webhook |
| status | varchar(20) default 'active' | active / archived |
| created_by | int FK → users | |
| created_at | timestamptz | |
| updated_at | timestamptz | |

#### `project_members` table
| Column | Type | Description |
|---|---|---|
| project_id | int FK → projects | |
| user_id | int FK → users | |
| role_id | int FK → roles | Project-scoped role |
| added_at | timestamptz | |
| added_by | int FK → users, nullable | |
| PK | (project_id, user_id) | |

### Users Table Changes
| New Column | Type | Description |
|---|---|---|
| email | varchar(255) unique | Login email |
| password_hash | varchar(255) | bcrypt hash |
| github_id | varchar(100) nullable | GitHub username |
| avatar_url | varchar(500) nullable | Profile picture |

Existing columns retained: name, auth_token (for hooks), status, default_model, last_event_at, etc.

---

## 6. Updated Database Schema (Full)

All tables in the new PostgreSQL database:

### Retained from v0.2 (modified — no team_id)
- `users` — + email, password_hash, github_id, avatar_url
- `sessions` — unchanged (minus team_id)
- `prompts` — unchanged (minus team_id)
- `limits` — unchanged (minus team_id)
- `subscriptions` — unchanged (minus team_id)
- `alerts` — unchanged (minus team_id)
- `tamper_alerts` — unchanged
- `hook_events` — unchanged (minus team_id)
- `tool_events` — unchanged
- `subagent_events` — unchanged
- `summaries` — unchanged

### New in Phase 0
- `roles` — RBAC role definitions
- `permissions` — granular permission keys
- `role_permissions` — role ↔ permission mapping
- `user_roles` — user ↔ role assignment (global or per-project)
- `projects` — project definitions + GitHub link
- `project_members` — user ↔ project + project-scoped role

### Removed
- `teams` — dropped
- `plan` — dropped (SaaS billing)

---

## 7. API Changes

### New Endpoints
```
POST   /api/v1/auth/login          — email + password → JWT
POST   /api/v1/auth/register       — first-run admin creation
GET    /api/v1/auth/me              — current user + permissions

GET    /api/v1/roles                — list roles
POST   /api/v1/roles                — create role
PUT    /api/v1/roles/:id            — update role
DELETE /api/v1/roles/:id            — delete role (non-system)
GET    /api/v1/roles/:id/permissions — get role permissions
PUT    /api/v1/roles/:id/permissions — set role permissions

GET    /api/v1/permissions          — list all permissions (grouped by category)

GET    /api/v1/projects             — list projects
POST   /api/v1/projects             — create project
GET    /api/v1/projects/:id         — project detail
PUT    /api/v1/projects/:id         — update project
DELETE /api/v1/projects/:id         — archive project
GET    /api/v1/projects/:id/members — list members
POST   /api/v1/projects/:id/members — add member with role
DELETE /api/v1/projects/:id/members/:userId — remove member
```

### Modified Endpoints
- All existing admin endpoints: remove team_id params/queries
- Auth middleware: check user permissions instead of just "is admin"
- Hook endpoints: unchanged (auth_token based, no team_id)

---

## 8. Dashboard Changes

### New Pages
- **Login page** — email + password (replaces single admin password)
- **Roles & Permissions** — manage roles, assign permissions (admin only)
- **Projects** — list, create, manage members
- **Project Detail** — members, linked repo, settings

### Modified Pages
- **All pages** — remove team context, add permission-based visibility
- **Users** — add role assignment, GitHub ID field
- **Overview** — show projects instead of team overview

---

## 9. Dockerfile Changes

```dockerfile
FROM node:22-slim AS builder
WORKDIR /app
RUN npm install -g pnpm

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/server/package.json packages/server/tsconfig.json packages/server/vitest.config.ts packages/server/bundle.mjs packages/server/
COPY packages/dashboard/package.json packages/dashboard/

RUN pnpm install --frozen-lockfile

COPY packages/server/src packages/server/src
COPY packages/server/drizzle packages/server/drizzle
COPY packages/dashboard packages/dashboard

RUN pnpm --filter dashboard build
RUN pnpm --filter @howinlens/server bundle

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

---

## 10. Implementation Order

1. **Rename** — ClawLens → HowinLens across codebase
2. **PostgreSQL + Drizzle** — new db/ directory, schema files, connection
3. **Drop multi-tenant** — remove teams, team_id, plan
4. **Migrate existing tables** — users, sessions, prompts, etc. to Drizzle schema
5. **RBAC** — roles, permissions, user_roles tables + API + middleware
6. **User auth** — email/password login replacing admin password
7. **Projects** — projects, project_members tables + API
8. **Dashboard** — login page, roles page, projects page, update existing pages
9. **Docker Compose** — add PostgreSQL service, update env vars
10. **Tests** — update existing 149 tests for new data layer
