# HowinLens Session Handoff

## Copy everything below the line as your first prompt in a new Claude Code session.

---

## Project: HowinLens (formerly ClawLens)

**Repo:** This working directory
**Branch:** `phase0/foundation` (50+ commits ahead of main)
**Domain:** `howinlens.howincloud.com` (VPS, Hestia Panel, Let's Encrypt SSL)
**What it is:** AI-powered team operations platform — tracks developer AI tool usage, manages tasks, credentials, attendance, across Claude Code, Codex, and Antigravity.

## Architecture (as of 2026-04-02)

```
Internet → howinlens.howincloud.com
         → Hestia nginx (SSL termination)
         → proxy_pass http://127.0.0.1:3000
         → Node.js Express + Drizzle ORM
         → PostgreSQL 17 (Docker)

Provider flow:
  Developer machine → hook script (howinlens-hook.mjs)
    → POST /api/v1/providers/claude-code/{event}
    → Provider middleware resolves adapter
    → Pipeline: normalize → status check → credit check → record → respond
    → Adapter formats provider-specific response
```

## What's Built & Working

### Unified Provider System (just implemented)
- **Provider adapter pattern** — `packages/server/src/providers/`
  - `types.ts` — ProviderAdapter interface, normalized event types
  - `adapters/claude-code.ts` — CC response formats (`{continue: false}` for kill, `{decision: 'block'}` for prompt block)
  - `adapters/codex.ts` — Codex response formats (`{decision: 'block', killed: true, hard: true}`)
  - `registry.ts` — in-memory adapter map
  - `pipeline.ts` — shared business logic (processSessionStart, processPrompt, processStop)
- **Unified route** — `packages/server/src/routes/provider-api.ts`
  - `POST /api/v1/providers/:provider/session-start` — full pipeline
  - `POST /api/v1/providers/:provider/prompt` — full pipeline
  - `POST /api/v1/providers/:provider/stop` — full pipeline
  - `POST /api/v1/providers/:provider/session-end` — CC-only
  - `POST /api/v1/providers/:provider/config-change` — CC-only, tamper detection
  - Tool events (pre-tool, post-tool, etc.) → passthrough, just return `{}`
  - `POST /api/v1/providers/claude-code/antigravity-sync` — batch sync
- **Backward compat** — `/api/v1/hook/*` → claude-code, `/api/v1/codex/*` → codex (via `_providerSlug` middleware)
- **181 tests passing** across 8 test files

### Messages Table (replaces prompts)
- `packages/server/src/db/schema/messages.ts` — provider, type (user/assistant), content, model, tokens, sourceType, turnId
- `packages/server/src/db/queries/messages.ts` — recordMessage, getMessagesBySession, updateLastMessageModel, etc.
- Old `prompts` table completely removed (schema, queries, all references)
- Admin-api.ts fully migrated to use `messages` table

### Providers Table
- `packages/server/src/db/schema/providers.ts` — slug, name, type, capability flags, enabled, config
- 3 providers seeded: claude-code, codex, antigravity
- Source values standardized everywhere: `claude_code` → `claude-code`

### RBAC (schema exists, middleware created)
- 7 system roles: Admin, Team Lead, PM, Project Coordinator, HR, Developer, Viewer
- 28 permissions (including `providers.manage`, `providers.view`)
- `packages/server/src/middleware/permission.ts` — `requirePermission()`, `requireAnyPermission()`
- Permission middleware created but NOT yet applied to admin endpoints

### PostgreSQL + Drizzle ORM
- 42+ tables, connection pooling via postgres.js
- Drizzle schema in `packages/server/src/db/schema/` (15 files)
- Query modules in `packages/server/src/db/queries/` (15 files)

### User Management
- Email/password login, JWT auth for dashboard
- Bearer token auth for hooks/client
- Role assignment, GitHub ID, subscription linking

### Projects
- CRUD, multiple repos per project (`project_repositories`), members with roles

### Task Management
- Tasks, subtasks, milestones, comments, activity audit
- Custom statuses per project, AI task generation from requirements

### Subscription Credential Vault
- Store Claude OAuth tokens, assign to users, rotate, revoke
- Server polls usage every 60s per credential

### Usage Monitoring
- `packages/server/src/services/usage-monitor.ts` — polls 5h/7d/model usage
- Credit system: model credits in DB (opus=10, sonnet=3, haiku=1, gpt-5.4=10, etc.)
- Per-user credit limits (total, per-model, time-of-day)

### Hook Script
- `client/hooks/howinlens-hook.mjs` — 136 lines (down from 539)
- Thin: read stdin → POST to `/api/v1/providers/claude-code/{event}` → return response
- Env vars: `HOWINLENS_SERVER`, `HOWINLENS_TOKEN` (with `CLAWLENS_*` fallbacks)

### Electron Client
- System tray, webview, JSONL watcher, file watcher, credential writer
- Heartbeat, CLI companion, auto-restart (launchd/systemd/schtasks)
- Uses `/api/v1/client/*` endpoints (NOT provider routes)

### Dashboard — 16 pages
- Overview, Users, Projects, Tasks, TaskDetail, Subscriptions, Roles, Activity
- Analytics, AI Intelligence, Messages (was Prompts), Settings, AuditLog, ProjectDetail, Login
- 9 shared components: RoleBadge, WatchStatusIndicator, UsageBar, PermissionMatrix, etc.

### Test Infrastructure
- Vitest + supertest against real Drizzle+Postgres (howinlens_test DB)
- `packages/server/src/services/db.ts` — test helper wrapping Drizzle queries
- 181 tests across 8 files, all passing
- Tests run sequentially (pool: forks, singleFork: true)

## What's NOT Built Yet

- **RBAC enforcement on endpoints** — middleware exists but not applied to admin routes
- **Attendance/Salary** — no schema, no API, no UI (Phase 3)
- **Git Analysis** — no schema, no webhooks, no API (Phase 3)
- **Remote Config** — no schema, no API (Phase 4)
- **AI Summary Pipeline** — no batch/daily/weekly/monthly summaries (Phase 4)
- **Reports/Project Health** — no auto-standups, no health scores (Phase 4)
- **Antigravity/Codex data collection** — adapters exist but no active collection yet

## Key Files

```
packages/server/src/
  server.ts                     — Express entry, route mounting, backward compat
  providers/
    types.ts                    — ProviderAdapter interface
    adapters/claude-code.ts     — CC adapter
    adapters/codex.ts           — Codex adapter
    registry.ts                 — adapter lookup
    pipeline.ts                 — shared business logic
  routes/
    provider-api.ts             — unified hook endpoints
    admin-api.ts                — dashboard admin endpoints (2000+ lines)
    client-api.ts               — Electron client endpoints
    subscription-api.ts         — credential management
  db/
    schema/                     — 15 Drizzle schema files
      messages.ts               — replaces prompts
      providers.ts              — provider registry
    queries/                    — 15 query modules
      messages.ts               — recordMessage, getMessagesBySession, etc.
      providers.ts              — getProviderBySlug, etc.
  middleware/
    hook-auth.ts                — Bearer token auth (hooks/client)
    admin-auth.ts               — JWT auth (dashboard)
    permission.ts               — RBAC (requirePermission)
  services/
    db.ts                       — test helper (wraps Drizzle for vitest)
    usage-monitor.ts            — subscription usage polling
    ai-jobs.ts                  — AI cron jobs
    websocket.ts                — WebSocket manager

packages/dashboard/src/
  pages/                        — 16 React pages
  components/                   — 9 shared + layout components
  lib/api.ts                    — API client (80+ functions)

packages/client/src/            — Electron desktop client

client/hooks/
  howinlens-hook.mjs            — slim hook script (136 lines)

client/
  clawlens.mjs                  — OLD hook script (539 lines, deprecated)
```

## Key Docs
- `docs/superpowers/specs/2026-04-02-unified-system-design.md` — unified architecture spec
- `docs/ideas/roadmap.md` — phased delivery plan
- `DEPLOY-VPS.md` — VPS deployment guide

## Running

```bash
# Dev server
PORT=3000 pnpm dev

# Build
pnpm --filter @howinlens/server build
pnpm --filter dashboard build

# Tests (needs howinlens_test Postgres DB)
pnpm --filter @howinlens/server test

# Docker Postgres
docker compose up postgres -d
```

## Tech Stack
- Server: Express 4, TypeScript, Drizzle ORM, postgres.js, Zod, node-cron
- Dashboard: React 19, Vite 8, Tailwind CSS, Zustand, Radix UI, Recharts
- Client: Electron 34, chokidar, electron-builder
- DB: PostgreSQL 17 (Docker)
- Tests: Vitest, supertest, Drizzle+Postgres

## User Preferences
- Quality over speed — production-quality, open-source standards
- No hacks, no workarounds, no shortcuts — fix root causes
- One project can have MULTIPLE repositories
- Hooks should be THIN — real data collection via JSONL file watching
- Server is the source of truth, not the client
- Source values use slug format: `claude-code`, `codex`, `antigravity`
- High-value events (session, prompt, stop) get full processing
- Tool events are passthrough — JSONL watcher captures everything
