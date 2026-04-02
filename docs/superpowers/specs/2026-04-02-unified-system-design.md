# HowinLens Unified System Design

**Date:** 2026-04-02
**Status:** Draft — needs user review before implementation

## 1. Provider Architecture

### Provider Registry

```sql
CREATE TABLE providers (
  id SERIAL PRIMARY KEY,
  slug VARCHAR(50) UNIQUE NOT NULL,       -- 'claude-code', 'codex', 'antigravity'
  name VARCHAR(100) NOT NULL,             -- 'Claude Code', 'Codex', 'Antigravity'
  type VARCHAR(20) NOT NULL,              -- 'hook', 'extension', 'collector'
  enabled BOOLEAN DEFAULT true,           -- toggle on/off from dashboard
  has_hooks BOOLEAN DEFAULT false,        -- can receive hook events?
  has_blocking BOOLEAN DEFAULT false,     -- can block prompts?
  has_credentials BOOLEAN DEFAULT false,  -- do we manage credentials?
  has_usage_polling BOOLEAN DEFAULT false, -- can poll usage from server?
  has_local_files BOOLEAN DEFAULT false,  -- writes local files we can watch?
  has_enforced_mode BOOLEAN DEFAULT false, -- can enforce hooks?
  config JSONB DEFAULT '{}',              -- provider-specific settings
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed
INSERT INTO providers (slug, name, type, has_hooks, has_blocking, has_credentials, has_usage_polling, has_local_files, has_enforced_mode) VALUES
  ('claude-code', 'Claude Code', 'hook', true, true, true, true, true, true),
  ('codex', 'Codex', 'hook', true, true, false, false, false, true),
  ('antigravity', 'Antigravity', 'extension', false, false, false, false, false, false);
```

### Provider Adapter Interface

```typescript
// packages/server/src/providers/types.ts
export interface ProviderCapabilities {
  hooks: boolean;
  blocking: boolean;
  credentials: boolean;
  usagePolling: boolean;
  localFiles: boolean;
  enforcedMode: boolean;
}

export interface ProviderAdapter {
  slug: string;
  name: string;
  capabilities: ProviderCapabilities;

  // Event normalization — convert provider-specific payload to unified format
  normalizeSessionStart(raw: unknown): UnifiedSession;
  normalizePrompt(raw: unknown): UnifiedPrompt;
  normalizeResponse(raw: unknown): UnifiedResponse;
  normalizeModel(rawModel: string): ModelInfo;

  // Blocking responses — format differs per provider
  formatAllowResponse(): object;
  formatBlockResponse(reason: string): object;
  formatKillResponse(): object;

  // Credit calculation
  getCreditCost(model: string): Promise<number>;
}
```

### Unified Event Types

```typescript
// packages/server/src/providers/unified-types.ts

// What every conversation message looks like regardless of source
export interface UnifiedMessage {
  provider: string;          // 'claude-code' | 'codex' | 'antigravity'
  sessionId: string;
  userId: number;
  type: 'user' | 'assistant';
  content: string;
  model?: string;
  rawModel?: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  cwd?: string;
  gitBranch?: string;
  projectId?: number;        // auto-resolved from cwd
  timestamp: Date;
}

// What every session looks like
export interface UnifiedSession {
  provider: string;
  sessionId: string;
  userId: number;
  model?: string;
  cwd?: string;
  startedAt: Date;
  endedAt?: Date;
}
```

### Provider File Structure

```
packages/server/src/providers/
├── types.ts                    -- interfaces
├── unified-types.ts            -- unified event types
├── registry.ts                 -- provider registry (load from DB, get adapter)
├── pipeline.ts                 -- unified event processing pipeline
├── adapters/
│   ├── claude-code.ts          -- Claude Code adapter
│   ├── codex.ts                -- Codex adapter
│   └── antigravity.ts          -- Antigravity adapter
└── index.ts                    -- exports
```

### Unified Hook Route

Instead of separate route files per provider, ONE route file dispatches through adapters:

```
POST /api/v1/providers/:provider/session-start
POST /api/v1/providers/:provider/prompt
POST /api/v1/providers/:provider/session-end
POST /api/v1/providers/:provider/cwd-changed
POST /api/v1/providers/:provider/stop
```

The route handler:
1. Looks up the provider adapter from registry
2. Validates the provider is enabled
3. Passes the raw event through the adapter's normalizer
4. Runs the unified pipeline (user status check → credit check → record → decide)
5. Formats the response using the adapter's response formatter

---

## 2. Database Schema (Complete Redesign)

### Core Tables

```
users                  -- people in the system
projects               -- projects they work on
project_repositories   -- multiple repos per project
project_members        -- who belongs to which project
roles                  -- RBAC role definitions
permissions            -- granular permission keys
role_permissions       -- role ↔ permission mapping
user_roles             -- user ↔ role (global or per-project)
```

### Provider & Credential Tables

```
providers              -- registered AI tool providers (claude-code, codex, antigravity)
subscription_credentials -- OAuth tokens for managed subscriptions
credential_assignments   -- which user has which credential right now
usage_polls              -- usage snapshots with user tracking
```

### Session & Conversation Tables (Unified)

```
sessions               -- AI sessions across all providers (source column)
messages               -- ALL conversation messages (replaces prompts table)
                          - user prompts + assistant responses in one table
                          - provider, sessionId, type (user/assistant), content, model, tokens
session_raw_data       -- raw JSONL/data per session for replay
```

### Hook & Control Tables (Minimal)

```
hook_events            -- raw hook event log (only for control events)
```

### Activity Tables

```
file_events            -- file system changes
app_tracking           -- window/app usage context
activity_windows       -- bucketed work windows
project_directories    -- linked project dirs per user
```

### Task Tables

```
tasks                  -- task management
task_comments          -- threaded discussion
task_activity          -- audit trail
milestones             -- task grouping
task_status_configs    -- custom statuses per project
requirement_inputs     -- raw requirements text/docs
ai_task_suggestions    -- AI-generated suggestions
```

### Attendance & Payroll Tables

```
watch_events           -- punch in/out (On Watch / Off Watch)
work_schedule          -- per-user office hours
holidays               -- company calendar
leave_types            -- casual/sick/vacation
leave_balances         -- per user per year
leave_requests         -- request/approval workflow
pay_config             -- salary configuration per user
payroll_periods        -- monthly periods
payroll_entries        -- computed salary per user per period
attendance_days        -- derived daily attendance record
```

### Git Tables

```
commits                -- git commit data
pull_requests          -- PR data
pr_reviews             -- PR review data
file_changes           -- per-commit file changes
```

### Config & Remote Control Tables

```
config_templates       -- reusable config presets
config_deployments     -- pushed config per target
config_state           -- current config per user
config_history         -- change audit trail
```

### AI Summary Tables

```
batch_summaries        -- micro-summaries (every 5-10 min)
daily_digests          -- per-user daily
weekly_digests         -- per-user weekly
monthly_digests        -- per-user monthly
project_health_snapshots -- per-project health scores
model_aliases          -- raw model → display name mapping
```

### Client & System Tables

```
heartbeats             -- client heartbeat tracking
watcher_commands       -- server → client command queue
watcher_logs           -- client log uploads
alerts                 -- admin notifications
tamper_alerts          -- tamper detection alerts
```

### Key Change: `prompts` table → `messages` table

The old `prompts` table stored only user prompts, with responses added later. The new `messages` table stores both user and assistant messages as separate rows, matching the JSONL format:

```sql
CREATE TABLE messages (
  id SERIAL PRIMARY KEY,
  provider VARCHAR(50) NOT NULL,         -- 'claude-code', 'codex', 'antigravity'
  session_id VARCHAR(255),
  user_id INTEGER NOT NULL REFERENCES users(id),
  type VARCHAR(20) NOT NULL,             -- 'user', 'assistant'
  content TEXT,
  model VARCHAR(100),
  raw_model VARCHAR(255),
  input_tokens INTEGER,
  output_tokens INTEGER,
  cached_tokens INTEGER,
  reasoning_tokens INTEGER,
  credit_cost REAL DEFAULT 0,
  cwd TEXT,
  git_branch VARCHAR(255),
  project_id INTEGER REFERENCES projects(id),
  blocked BOOLEAN DEFAULT false,
  block_reason TEXT,
  source_type VARCHAR(20) NOT NULL,      -- 'hook', 'jsonl', 'extension', 'collector'
  timestamp TIMESTAMPTZ NOT NULL,
  synced_at TIMESTAMPTZ DEFAULT NOW()
);
```

The `source_type` distinguishes HOW the data arrived:
- `hook` — came via hook event (real-time)
- `jsonl` — came from JSONL file watcher (comprehensive)
- `extension` — came from Antigravity extension
- `collector` — came from batch collector

---

## 3. Server Structure (Restructured)

```
packages/server/src/
├── server.ts                    -- Express app, startup
├── db/
│   ├── index.ts                 -- Drizzle connection
│   ├── seed.ts                  -- seed data
│   ├── schema/                  -- all table schemas
│   │   ├── users.ts
│   │   ├── projects.ts
│   │   ├── sessions.ts
│   │   ├── messages.ts          -- NEW: replaces prompts
│   │   ├── providers.ts         -- NEW: provider registry
│   │   ├── credentials.ts
│   │   ├── tasks.ts
│   │   ├── tracking.ts
│   │   ├── attendance.ts        -- NEW: watch, schedule, leave, payroll
│   │   ├── git.ts               -- NEW: commits, PRs, reviews
│   │   ├── config.ts            -- NEW: remote config
│   │   ├── summaries.ts         -- NEW: batch/daily/weekly/monthly
│   │   ├── roles.ts
│   │   ├── alerts.ts
│   │   ├── watcher.ts
│   │   └── index.ts
│   └── queries/                 -- organized by domain
│       ├── users.ts
│       ├── projects.ts
│       ├── sessions.ts
│       ├── messages.ts          -- NEW
│       ├── providers.ts         -- NEW
│       ├── credentials.ts
│       ├── tasks.ts
│       ├── tracking.ts
│       ├── attendance.ts        -- NEW
│       ├── git.ts               -- NEW
│       ├── config.ts            -- NEW
│       ├── summaries.ts         -- NEW
│       ├── roles.ts
│       ├── alerts.ts
│       ├── watcher.ts
│       └── index.ts
├── providers/                   -- NEW: unified provider system
│   ├── types.ts
│   ├── unified-types.ts
│   ├── registry.ts
│   ├── pipeline.ts
│   ├── adapters/
│   │   ├── claude-code.ts
│   │   ├── codex.ts
│   │   └── antigravity.ts
│   └── index.ts
├── routes/
│   ├── provider-api.ts          -- NEW: unified hook/event routes
│   ├── admin-api.ts             -- dashboard admin endpoints
│   ├── client-api.ts            -- desktop client endpoints
│   ├── subscription-api.ts      -- credential management
│   ├── task-api.ts              -- NEW: task-specific routes (split from admin)
│   ├── git-api.ts               -- NEW: GitHub webhook + git data
│   ├── attendance-api.ts        -- NEW: punch, leave, salary
│   └── config-api.ts            -- NEW: remote config management
├── middleware/
│   ├── hook-auth.ts             -- bearer token auth for hooks/client
│   ├── admin-auth.ts            -- JWT auth for dashboard
│   └── permission.ts            -- NEW: RBAC permission checking
├── services/
│   ├── usage-monitor.ts         -- subscription usage polling
│   ├── task-generation.ts       -- AI task generation
│   ├── statusline.ts            -- terminal status line
│   ├── websocket.ts             -- WebSocket manager
│   ├── watcher-ws.ts            -- watcher WebSocket
│   ├── ai-jobs.ts               -- AI cron jobs
│   ├── claude-ai.ts             -- Claude CLI wrapper
│   ├── deadman.ts               -- dead man's switch
│   └── tamper.ts                -- tamper detection
└── schemas/
    └── events.ts                -- Zod schemas for all providers (unified)
```

### Key Changes from Current:
- `hook-api.ts` and `codex-api.ts` → merged into `provider-api.ts`
- `prompts` table → `messages` table
- `admin-api.ts` → split into domain-specific route files
- New `providers/` directory with adapter pattern
- New `middleware/permission.ts` for RBAC enforcement

---

## 4. Client Structure (Restructured)

```
packages/client/
├── src/
│   ├── main/
│   │   ├── index.ts              -- Electron main process
│   │   ├── tray.ts               -- system tray
│   │   ├── window.ts             -- webview window
│   │   ├── ipc.ts                -- IPC handlers
│   │   └── services/
│   │       ├── api-client.ts     -- server API client
│   │       ├── heartbeat.ts      -- 30s heartbeat
│   │       ├── credentials.ts    -- credential write/delete
│   │       ├── auto-start.ts     -- OS-level auto-restart
│   │       ├── notifications.ts  -- desktop notifications
│   │       └── watchers/         -- NEW: organized watchers
│   │           ├── jsonl.ts      -- Claude Code JSONL watcher
│   │           ├── codex.ts      -- Codex data watcher (future)
│   │           ├── antigravity.ts-- Antigravity data watcher (future)
│   │           ├── files.ts      -- project file watcher
│   │           └── index.ts      -- starts all enabled watchers
│   ├── preload/
│   │   └── index.ts
│   └── cli/
│       └── index.ts              -- CLI companion
├── resources/                    -- OS service configs
│   ├── com.howinlens.client.plist
│   ├── howinlens-client.service
│   └── install-service.ps1
└── assets/
```

### Key Changes:
- Watchers organized by provider in `watchers/` directory
- Each watcher is a self-contained module
- `watchers/index.ts` starts only enabled provider watchers

---

## 5. Hook Script (Restructured)

Current: single 538-line `clawlens.mjs` doing everything.

New: clean, minimal hook handler:

```
client/
├── hooks/
│   ├── howinlens-hook.sh        -- thin shell wrapper (calls Node script)
│   └── howinlens-hook.mjs       -- main handler (~200 lines, down from 538)
```

The hook script is THIN:
1. Read stdin JSON
2. Extract event name
3. POST to `/api/v1/providers/claude-code/{event}`
4. Return server response
5. No enrichment, no watcher spawning, no notifications — that's the Electron client's job

---

## 6. Implementation Priority

### Wave 1: Foundation (do first, everything depends on it)
1. Provider registry (DB table + adapter interface)
2. `messages` table (replaces prompts)
3. Unified provider route (`provider-api.ts`)
4. Claude Code adapter
5. Permission middleware
6. Restructured hook script

### Wave 2: Data Collection
7. JSONL watcher improvements (raw append + parsed messages)
8. Client watcher architecture (`watchers/` directory)
9. Codex adapter (data collection only)
10. Antigravity adapter (data collection only)

### Wave 3: Remaining Domains
11. Attendance/salary schema + API + UI
12. Git analysis schema + webhook + API + UI
13. Remote config schema + API + UI
14. AI summary pipeline (batch → daily → weekly → monthly)
15. Reports + project health
