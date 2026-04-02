# HowinLens Session Handoff

## Use this to start a new Claude Code session with full context.

Copy everything below this line as your first prompt:

---

## Project: HowinLens (formerly ClawLens)

**Repo:** `/Users/basha/Documents/Howin/clawlens`
**Branch:** `phase0/foundation` (40+ commits ahead of main)
**What it is:** AI-powered team operations platform — tracks developer AI tool usage, manages tasks, credentials, attendance, across Claude Code, Codex, and Antigravity.

## Current State

### What's Built & Working (tested, 14 core endpoints passing)
- **PostgreSQL + Drizzle ORM** — replaced SQLite, 42+ tables, connection pooling
- **RBAC** — 7 system roles (Admin, Team Lead, PM, Project Coordinator, HR, Developer, Viewer), 26 permissions, custom roles support
- **User Management** — email/password login, role assignment, GitHub ID
- **Projects** — CRUD, multiple repos per project (`project_repositories` table), members with roles
- **Task Management** — tasks, subtasks, milestones, comments, activity audit, custom statuses, AI task generation from requirements
- **Subscription Credential Vault** — store Claude OAuth tokens, assign to users, rotate, revoke
- **Usage Monitoring** — server polls each credential's 5h/7d/model usage every 60s, tracks which users were assigned at poll time
- **Hook API** — session-start, prompt (block/allow), cwd-changed, session-end, stop, pre/post-tool
- **Client API** — heartbeat, watch on/off, credential delivery, conversation sync, JSONL sync, file events, app tracking
- **Electron Client** — system tray, webview, JSONL watcher, file watcher, credential writer, heartbeat, CLI companion, auto-restart (launchd/systemd/schtasks)
- **Dashboard** — 16 pages: Overview, Users, Projects, Tasks, TaskDetail, Subscriptions, Roles, Activity, Analytics, AI Intelligence, Prompts, Settings, AuditLog, ProjectDetail, Login
- **9 shared components** — RoleBadge, WatchStatusIndicator, UsageBar, PermissionMatrix, UserSelector, ProjectSelector, CreateProjectModal, AssignRoleModal, AddRepoModal

### What's NOT Built (spec exists but not implemented)
- **Unified Provider System** — spec at `docs/superpowers/specs/2026-04-02-unified-system-design.md`. Currently providers (Claude Code, Codex, Antigravity) are handled with separate route files and duplicated logic. The spec defines: provider registry in DB, adapter pattern, unified `messages` table, single `provider-api.ts` route file. NOT IMPLEMENTED.
- **RBAC Enforcement** — roles/permissions exist in DB but endpoints don't check them (no permission middleware)
- **Attendance/Salary** — no schema, no API, no UI (Phase 3)
- **Git Analysis** — no schema, no webhooks, no API (Phase 3)
- **Remote Config** — no schema, no API (Phase 4)
- **AI Summary Pipeline** — no batch/daily/weekly/monthly summaries (Phase 4)
- **Reports/Project Health** — no auto-standups, no health scores (Phase 4)
- **Antigravity/Codex data collection** — discussed but not built yet

### Architecture Issues (need fixing)
1. `hook-api.ts` (942 lines) and `codex-api.ts` (604 lines) have ~60% duplicated logic — should be unified via provider adapters
2. `admin-api.ts` (1600+ lines) — monolithic, should be split into domain-specific route files
3. `prompts` table still exists alongside `conversation_messages` — should be unified into `messages` table
4. Old `clawlens.mjs` hook script (538 lines) — should be renamed `howinlens-hook.mjs` and slimmed to ~200 lines
5. No permission middleware — RBAC schema exists but nothing checks permissions on endpoints

## Key Files

```
packages/server/src/
  server.ts                     — Express entry point
  db/
    index.ts                    — Drizzle + postgres.js connection
    seed.ts                     — 7 roles, 26 permissions, model credits, admin user
    schema/                     — 15 schema files, 42+ tables
    queries/                    — 12 query modules, 120+ functions
  routes/
    hook-api.ts                 — Claude Code hooks (needs unification)
    codex-api.ts                — Codex hooks (needs unification)
    admin-api.ts                — dashboard admin endpoints (needs splitting)
    client-api.ts               — Electron client endpoints
    subscription-api.ts         — credential management
  services/
    usage-monitor.ts            — polls subscription usage every 60s
    task-generation.ts          — AI task generation from requirements
    ai-jobs.ts                  — AI cron jobs (session analysis, profiles, pulse)
    websocket.ts                — WebSocket manager
    watcher-ws.ts               — watcher WebSocket
  middleware/
    hook-auth.ts                — bearer token auth for hooks/client
    admin-auth.ts               — JWT auth for dashboard

packages/dashboard/src/
  pages/                        — 16 React pages
  components/                   — 9 shared + layout components
  lib/api.ts                    — API client (80+ functions)
  store/authStore.ts            — Zustand auth store

packages/client/src/
  main/
    index.ts                    — Electron main process
    tray.ts, window.ts, ipc.ts  — UI shell
    services/                   — heartbeat, credentials, jsonl-watcher, file-watcher, notifications, auto-start, api-client
  cli/index.ts                  — CLI companion (howinlens command)
  preload/index.ts              — context bridge

client/
  clawlens.mjs                  — hook handler script (needs rename to howinlens)
```

## Key Docs
- `docs/ideas/scope-*.md` — 11 scope files from brainstorming
- `docs/ideas/roadmap.md` — phased delivery plan
- `docs/roadmap-tracker.md` — feature checkbox tracker
- `docs/ui-tracker.md` — 103/103 dashboard UI items complete
- `docs/superpowers/specs/2026-04-02-unified-system-design.md` — THE unified architecture spec (NOT implemented)
- `docs/superpowers/specs/2026-04-02-dashboard-ui-plan.md` — UI micro flows
- `docs/references/claude-usage-tracker/` — reference project (Swift app for tracking Claude usage)

## Docker
- PostgreSQL 17 running: `docker compose up postgres -d`
- Dev server: `DATABASE_URL=postgresql://howinlens:howinlens@localhost:5432/howinlens ADMIN_EMAIL=admin@howinlens.local ADMIN_PASSWORD=admin PORT=3000 pnpm dev`
- Login: `admin@howinlens.local` / `admin`

## Tech Stack
- Server: Express 4, TypeScript, Drizzle ORM, postgres.js, Zod, node-cron
- Dashboard: React 19, Vite 8, Tailwind CSS, Zustand, Radix UI, Recharts, Lucide icons
- Client: Electron 34, chokidar, electron-builder
- DB: PostgreSQL 17

## Rate Limit Self-Monitoring
- Run `bash scripts/check-usage.sh` before heavy work
- If 5h > 90%: sleep until reset
- Decision to use Codex vs Claude is per-task based on task nature

## User Preferences
- Quality over speed — test everything, no hacks, no shortcuts
- Industry-standard, production-quality code
- One project can have MULTIPLE repositories (frontend, backend, app)
- 7 system roles: Admin, Team Lead, PM, Project Coordinator, HR, Developer, Viewer
- Claude Code is the primary AI tool (8 Team seats under company emails)
- Codex and Antigravity are secondary (data collection only for now)
- Hooks should be THIN (control only) — real data collection via JSONL file watching
- Client should be non-killable (auto-restart via launchd/systemd)
- Server is the source of truth, not the client

## What To Do Next
The immediate priority is implementing the unified provider system from `docs/superpowers/specs/2026-04-02-unified-system-design.md`. This means:
1. Create `providers/` directory with adapter pattern
2. Create `provider-api.ts` replacing `hook-api.ts` + `codex-api.ts`
3. Create unified `messages` table replacing `prompts` + `conversation_messages`
4. Create provider registry table
5. Add RBAC permission middleware
6. Split `admin-api.ts` into domain-specific route files
7. Rename and slim hook script to `howinlens-hook.mjs`

After that: Antigravity + Codex data collection, then Phase 3 (attendance/salary, git analysis).
