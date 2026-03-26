# ClawLens — Design Spec

**Date:** 2026-03-26
**Status:** Draft
**Author:** Basha + Claude

---

## What Is ClawLens

AI usage analytics and team management for Claude Code. See how your team uses AI — usage, cost, prompt quality, productivity — all from one dashboard.

**For:** Engineering team leads at startups (5-20 devs)
**How:** Hook on each dev's machine sends data to self-hosted server
**Price:** Free, open source, self-hosted
**Not:** Not affiliated with Anthropic. Not a Claude Code replacement.

---

## Core Pillars

| Pillar | What the team lead sees |
|--------|------------------------|
| **Usage** | Who's using Claude, how much, which models, which projects |
| **Cost** | Real $ per user, per project, per subscription — not estimates |
| **Quality** | AI-generated summaries of what each dev does, prompt patterns |
| **Limits** | Optional rate limiting per user (credit budgets, per-model caps) |

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                   ClawLens Server (Docker)                     │
│  ┌──────────┐  ┌──────────┐  ┌────────────┐  ┌───────────┐  │
│  │ REST API │  │  SQLite  │  │  React     │  │ AI Summary│  │
│  │          │  │          │  │  Dashboard │  │  Engine   │  │
│  └────┬─────┘  └────┬─────┘  └──────┬─────┘  └─────┬─────┘  │
│       └──────────────┴───────────────┴──────────────┘        │
└──────────┬──────────────┬──────────────┬─────────────────────┘
           │              │              │
      ┌────┘       ┌──────┘       ┌──────┘
      ▼            ▼              ▼
 ┌─────────┐  ┌─────────┐  ┌───────────┐
 │ Dev A   │  │ Dev B   │  │ Admin's   │
 │ MacBook │  │ Ubuntu  │  │ Browser   │
 │         │  │         │  │           │
 │ hook.js │  │ hook.js │  └───────────┘
 │    +    │  │    +    │
 │ file    │  │ file    │
 │ sync    │  │ sync    │
 └─────────┘  └─────────┘
```

### Two Data Collection Methods

**1. Hooks (real-time, per-event)**
Installed via `managed-settings.json`. Fires on every prompt, tool use, session start/end. Sends data to server in real-time.

**2. File sync (periodic, historical)**
A background sync reads `~/.claude.json`, `~/.claude/stats-cache.json`, and `~/.claude/history.jsonl` periodically. Captures cost data, token counts, lines of code, full prompt history — data that hooks don't provide.

Both methods run on each dev's machine. The hook is the primary data source; file sync fills in gaps and provides historical data.

---

## Data Model

### Tables

```sql
-- Teams (one per ClawLens deployment, multi-tenant for future SaaS)
CREATE TABLE team (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  admin_password   TEXT NOT NULL,
  settings         TEXT NOT NULL DEFAULT '{}',  -- JSON: collection_level, summary_interval, credit_weights, slack_webhook, etc.
  created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Subscriptions (Claude accounts — users sharing same email = same subscription)
CREATE TABLE subscription (
  id               TEXT PRIMARY KEY,
  team_id          TEXT NOT NULL REFERENCES team(id),
  email            TEXT NOT NULL,
  display_name     TEXT,
  org_name         TEXT,
  subscription_type TEXT,          -- pro | max
  billing_type     TEXT,           -- stripe_subscription, etc.
  account_created  DATETIME,
  subscription_created DATETIME,
  UNIQUE(team_id, email)
);

-- Users (individual developers)
CREATE TABLE user (
  id               TEXT PRIMARY KEY,
  team_id          TEXT NOT NULL REFERENCES team(id),
  subscription_id  TEXT REFERENCES subscription(id),
  slug             TEXT NOT NULL,
  name             TEXT NOT NULL,
  auth_token       TEXT NOT NULL UNIQUE,
  status           TEXT NOT NULL DEFAULT 'active',  -- active | paused | killed
  default_model    TEXT,            -- detected during setup (pro=sonnet, max=opus)
  killed_at        DATETIME,
  created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(team_id, slug)
);

-- Devices (machines each user has)
CREATE TABLE device (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  hostname         TEXT,
  platform         TEXT,           -- darwin, linux, win32
  arch             TEXT,           -- arm64, x64
  os_version       TEXT,
  node_version     TEXT,
  claude_version   TEXT,
  subscription_type TEXT,
  first_seen       DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_seen        DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_ip          TEXT,
  UNIQUE(user_id, hostname)
);

-- Limit rules (rate limiting — optional feature)
CREATE TABLE limit_rule (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  type             TEXT NOT NULL,   -- credits | per_model | time_of_day
  model            TEXT,
  window           TEXT,            -- daily | weekly | monthly | sliding_24h
  value            INTEGER,
  schedule_start   TEXT,
  schedule_end     TEXT,
  schedule_tz      TEXT,
  created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Usage events (one per completed turn — for rate limiting + basic counting)
CREATE TABLE usage_event (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  model            TEXT NOT NULL,
  credit_cost      INTEGER NOT NULL,
  timestamp        DATETIME NOT NULL,
  source           TEXT NOT NULL DEFAULT 'hook'
);

-- Sessions (tracked from SessionStart to SessionEnd)
CREATE TABLE session (
  id               TEXT PRIMARY KEY,  -- Claude Code session_id
  user_id          TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  device_id        TEXT REFERENCES device(id),
  model            TEXT,
  project_dir      TEXT,              -- basename only
  cwd              TEXT,              -- full path (for project matching)
  started_at       DATETIME NOT NULL,
  ended_at         DATETIME,
  end_reason       TEXT,              -- clear | logout | exit | resume
  prompt_count     INTEGER DEFAULT 0,
  tool_count       INTEGER DEFAULT 0,
  total_input_tokens  INTEGER DEFAULT 0,
  total_output_tokens INTEGER DEFAULT 0,
  total_cost_usd   REAL DEFAULT 0
);

-- Prompts (the core analytics data — configurable collection)
CREATE TABLE prompt (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  session_id       TEXT REFERENCES session(id),
  model            TEXT,
  prompt_text      TEXT,              -- full prompt (null if collection off)
  prompt_length    INTEGER NOT NULL,  -- always tracked (char count)
  response_text    TEXT,              -- full response (null if collection off)
  response_length  INTEGER,
  project_dir      TEXT,
  cwd              TEXT,
  tool_calls       INTEGER DEFAULT 0, -- tools used in this turn
  tools_used       TEXT,              -- JSON array: ["Bash","Read","Edit"]
  had_error        BOOLEAN DEFAULT FALSE,
  was_blocked      BOOLEAN DEFAULT FALSE,
  block_reason     TEXT,
  turn_duration_ms INTEGER,           -- time from prompt to stop
  timestamp        DATETIME NOT NULL
);

-- Tool events (every tool call — for tool usage analytics)
CREATE TABLE tool_event (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  session_id       TEXT REFERENCES session(id),
  prompt_id        INTEGER REFERENCES prompt(id),
  tool_name        TEXT NOT NULL,     -- Bash, Read, Write, Edit, Glob, Grep, Agent, etc.
  tool_input_summary TEXT,            -- first 200 chars of input (not full input for privacy)
  success          BOOLEAN DEFAULT TRUE,
  error_message    TEXT,
  timestamp        DATETIME NOT NULL
);

-- AI Summaries (generated periodically by AI)
CREATE TABLE ai_summary (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          TEXT REFERENCES user(id) ON DELETE CASCADE,
  team_id          TEXT REFERENCES team(id),
  type             TEXT NOT NULL,     -- daily_user | weekly_user | weekly_team
  period_start     DATETIME NOT NULL,
  period_end       DATETIME NOT NULL,
  summary_text     TEXT NOT NULL,     -- AI-generated summary
  categories       TEXT,              -- JSON: {"debugging": 40, "feature_dev": 30, ...}
  topics           TEXT,              -- JSON: ["auth flow", "API endpoints", ...]
  productivity_score REAL,            -- 0-100 computed score
  prompt_quality_score REAL,          -- 0-100
  model_efficiency_score REAL,        -- 0-100 (right model for the task?)
  generated_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  generated_by     TEXT               -- "claude-code" | "anthropic-api" | "openai" | "local"
);

-- File sync data (from ~/.claude.json — real cost/token data)
CREATE TABLE project_stats (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  project_path     TEXT NOT NULL,
  project_name     TEXT NOT NULL,     -- basename
  model            TEXT NOT NULL,
  input_tokens     INTEGER DEFAULT 0,
  output_tokens    INTEGER DEFAULT 0,
  cache_read_tokens INTEGER DEFAULT 0,
  cache_create_tokens INTEGER DEFAULT 0,
  cost_usd         REAL DEFAULT 0,
  lines_added      INTEGER DEFAULT 0,
  lines_removed    INTEGER DEFAULT 0,
  web_search_count INTEGER DEFAULT 0,
  synced_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, project_path, model)
);

-- Daily activity (from stats-cache.json)
CREATE TABLE daily_activity (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  date             TEXT NOT NULL,     -- YYYY-MM-DD
  message_count    INTEGER DEFAULT 0,
  session_count    INTEGER DEFAULT 0,
  tool_call_count  INTEGER DEFAULT 0,
  synced_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, date)
);

-- Install codes (one-time use)
CREATE TABLE install_code (
  code             TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES user(id),
  used             BOOLEAN DEFAULT FALSE,
  created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Audit log
CREATE TABLE audit_log (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id          TEXT NOT NULL,
  actor            TEXT NOT NULL,     -- "admin" or user slug
  action           TEXT NOT NULL,     -- user_created, user_killed, limits_changed, settings_updated, etc.
  target           TEXT,              -- user_id or setting name
  details          TEXT,              -- JSON with before/after
  timestamp        DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX idx_prompt_user_ts ON prompt(user_id, timestamp);
CREATE INDEX idx_prompt_session ON prompt(session_id);
CREATE INDEX idx_tool_event_user_ts ON tool_event(user_id, timestamp);
CREATE INDEX idx_tool_event_session ON tool_event(session_id);
CREATE INDEX idx_session_user ON session(user_id, started_at);
CREATE INDEX idx_usage_user_ts ON usage_event(user_id, timestamp);
CREATE INDEX idx_project_stats_user ON project_stats(user_id);
CREATE INDEX idx_daily_activity_user ON daily_activity(user_id, date);
CREATE INDEX idx_ai_summary_user ON ai_summary(user_id, period_start);
CREATE INDEX idx_audit_team ON audit_log(team_id, timestamp);
CREATE INDEX idx_subscription_team ON subscription(team_id);
```

### Team Settings (JSON in team.settings)

```json
{
  "collection_level": "full",          // "off" | "summaries" | "full"
  "collect_responses": true,           // store Claude's responses too
  "summary_interval_hours": 8,         // AI summary every N hours (0 = disabled)
  "summary_provider": "claude-code",   // "claude-code" | "anthropic-api" | "openai" | "custom"
  "summary_api_key": null,             // API key for external provider
  "summary_api_url": null,             // custom endpoint URL
  "credit_weights": { "opus": 10, "sonnet": 3, "haiku": 1 },
  "prompt_retention_days": 90,         // auto-delete prompts older than N days (0 = keep forever)
  "slack_webhook": null,               // Slack incoming webhook URL
  "discord_webhook": null,             // Discord webhook URL
  "alert_on_block": true,              // send alert when user gets blocked
  "alert_on_kill": true,               // send alert on kill switch
  "daily_digest": true,                // send daily summary to webhook
  "weekly_digest": true,               // send weekly summary to webhook
  "file_sync_interval_minutes": 30,    // how often to sync ~/.claude.json data
  "export_enabled": true               // allow CSV/JSON export
}
```

---

## Hook System

### Hooks Installed (via managed-settings.json)

```json
{
  "allowManagedHooksOnly": true,
  "hooks": {
    "SessionStart": [{ "matcher": "", "hooks": [{ "type": "command", "command": "node <hook> session-start", "timeout": 10 }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "node <hook> prompt", "timeout": 5 }] }],
    "PreToolUse": [{ "hooks": [{ "type": "command", "command": "node <hook> pre-tool", "timeout": 2 }] }],
    "PostToolUse": [{ "hooks": [{ "type": "command", "command": "node <hook> post-tool", "timeout": 2 }] }],
    "PostToolUseFailure": [{ "hooks": [{ "type": "command", "command": "node <hook> tool-error", "timeout": 2 }] }],
    "Stop": [{ "hooks": [{ "type": "command", "command": "node <hook> stop", "timeout": 5 }] }],
    "StopFailure": [{ "matcher": "", "hooks": [{ "type": "command", "command": "node <hook> stop-error", "timeout": 2 }] }],
    "SessionEnd": [{ "matcher": "", "hooks": [{ "type": "command", "command": "node <hook> session-end", "timeout": 3 }] }],
    "SubagentStart": [{ "matcher": "", "hooks": [{ "type": "command", "command": "node <hook> subagent-start", "timeout": 2 }] }],
    "SubagentStop": [{ "matcher": "", "hooks": [{ "type": "command", "command": "node <hook> subagent-stop", "timeout": 2 }] }],
    "TaskCompleted": [{ "hooks": [{ "type": "command", "command": "node <hook> task-done", "timeout": 2 }] }]
  }
}
```

### What Each Hook Sends to Server

| Hook Action | Endpoint | Data Sent |
|-------------|----------|-----------|
| `session-start` | POST /api/v1/session-start | model, session_id, device info (hostname, platform, arch, OS, node, claude version), cwd, subscription info |
| `prompt` | POST /api/v1/prompt | session_id, model, prompt_text (if collection on), prompt_length, cwd, project_dir, permission_mode |
| `pre-tool` | POST /api/v1/tool | session_id, tool_name, tool_input_summary (first 200 chars), action: "start" |
| `post-tool` | POST /api/v1/tool | session_id, tool_name, success: true, response_length |
| `tool-error` | POST /api/v1/tool | session_id, tool_name, success: false, error (first 200 chars) |
| `stop` | POST /api/v1/stop | session_id, model, response_text (if collection on), response_length, stop_hook_active |
| `stop-error` | POST /api/v1/stop-error | session_id, error_type (rate_limit, billing_error, etc.), error_details |
| `session-end` | POST /api/v1/session-end | session_id, reason |
| `subagent-start` | POST /api/v1/subagent | session_id, agent_type, action: "start" |
| `subagent-stop` | POST /api/v1/subagent | session_id, agent_type, action: "stop" |
| `task-done` | POST /api/v1/task | session_id, task_subject |

### Rate Limiting (checked on `prompt` action)

Same as claude-code-limiter: the `prompt` hook calls `/api/v1/prompt`, server evaluates limits, returns `{ allowed: true/false }`. If blocked, hook returns `{ decision: "block", reason: "..." }`.

The `pre-tool` hook does local-only kill/pause enforcement (same as limiter's `enforce`).

### File Sync (periodic background job)

The hook also runs a file sync on `session-start` and periodically (configurable). It reads:

| File | What It Syncs |
|------|--------------|
| `~/.claude.json` → `projects.*` | Per-project: costUSD, tokens, linesAdded, linesRemoved → `project_stats` table |
| `~/.claude.json` → `oauthAccount` | Subscription info → `subscription` table |
| `~/.claude.json` → `toolUsage` | Tool usage counts |
| `~/.claude.json` → `skillUsage` | Skill/plugin adoption |
| `~/.claude/stats-cache.json` | Daily activity: messages, sessions, tool calls → `daily_activity` table |
| `~/.claude/history.jsonl` | Historical prompts (backfill on first sync) → `prompt` table |

The file sync sends a single POST `/api/v1/file-sync` with all the data. Server upserts into the appropriate tables.

---

## Server API

### Hook API (auth: per-user token)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/v1/session-start` | Register session, update device, sync subscription |
| POST | `/api/v1/prompt` | Record prompt + rate limit check |
| POST | `/api/v1/tool` | Record tool usage |
| POST | `/api/v1/stop` | Record turn completion + response |
| POST | `/api/v1/stop-error` | Record errors (rate limits from Anthropic, etc.) |
| POST | `/api/v1/session-end` | Close session |
| POST | `/api/v1/subagent` | Record subagent usage |
| POST | `/api/v1/task` | Record task completion |
| POST | `/api/v1/file-sync` | Periodic file sync data |
| POST | `/api/v1/register` | Exchange install code for auth token |
| GET | `/api/v1/health` | Health check |

### Admin API (auth: JWT)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/admin/login` | Authenticate |
| GET | `/api/admin/team` | Team info + settings |
| PUT | `/api/admin/team` | Update team settings |
| GET | `/api/admin/subscriptions` | List all subscriptions with grouped users |
| GET | `/api/admin/users` | List all users with stats |
| POST | `/api/admin/users` | Create user |
| GET | `/api/admin/users/:id` | User detail with full stats |
| PUT | `/api/admin/users/:id` | Update user (limits, status, name) |
| DELETE | `/api/admin/users/:id` | Remove user |
| GET | `/api/admin/users/:id/prompts` | User's prompts (paginated) |
| GET | `/api/admin/users/:id/sessions` | User's sessions |
| GET | `/api/admin/analytics` | Team-wide analytics |
| GET | `/api/admin/analytics/users` | User leaderboard/comparison |
| GET | `/api/admin/analytics/projects` | Project-level analytics |
| GET | `/api/admin/analytics/costs` | Cost breakdown |
| GET | `/api/admin/summaries` | AI-generated summaries |
| POST | `/api/admin/summaries/generate` | Trigger summary generation now |
| GET | `/api/admin/audit-log` | Audit trail |
| GET | `/api/admin/export/:type` | Export data (CSV/JSON) |

### WebSocket `/ws`

Events broadcast to dashboard:
- `prompt_submitted` — user sent a prompt (real-time feed)
- `prompt_blocked` — user was rate limited
- `turn_completed` — Claude finished responding
- `session_started` / `session_ended`
- `tool_used` — tool call completed
- `tool_failed` — tool call errored
- `user_killed` / `user_paused` / `user_reinstated`
- `rate_limit_hit` — Anthropic rate limit (from StopFailure)
- `summary_generated` — new AI summary available

---

## AI Summary Engine

### How It Works

```
Every N hours (configurable, default 8):
  1. For each user with new prompts since last summary:
     a. Collect all prompts from the period
     b. Build a summary prompt:
        "Here are [user]'s Claude Code prompts from the last 8 hours.
         Summarize: what they worked on, categories (debugging/feature/refactor/learning),
         prompt quality (specific vs vague), productivity signals, topics/technologies."
     c. Send to AI provider (claude -p, API, or custom)
     d. Parse response → store in ai_summary table
  2. If weekly boundary crossed:
     a. Aggregate daily summaries into weekly user summary
     b. Aggregate all users into weekly team summary

Weekly team summary example:
  "This week the team focused on the auth refactor (Alice, Bob) and
   new API endpoints (Charlie). 312 prompts across 45 sessions.
   Opus usage: 40% (mostly Alice for complex architecture).
   Notable: Dave's prompt quality improved significantly — fewer
   re-prompts this week vs last."
```

### Summary Providers

| Provider | How | Cost |
|----------|-----|------|
| `claude-code` | `claude -p "summarize these prompts..."` on the server machine | Free (uses admin's subscription) |
| `anthropic-api` | Direct API call with admin's API key | ~$0.01-0.05 per summary |
| `openai` | OpenAI API (gpt-4o) | ~$0.01-0.03 per summary |
| `custom` | POST to any URL with prompt in body | Varies |

Default: `claude-code` — zero extra cost if admin has Claude Code installed on the server.

---

## Dashboard Pages

### Overview
- Stats row: total users, active now, prompts today, cost today
- Subscription cards: group users by subscription email
- User cards with live usage bars
- Real-time event feed (WebSocket)
- Quick actions: pause, kill, view

### User Detail
- Profile: name, status, subscription, devices
- Stats: prompts, sessions, cost, lines of code, avg turn duration
- Charts: daily usage trend, model distribution, tool usage breakdown, peak hours
- Latest AI summary
- Recent prompts (expandable, shows full text if collection is on)
- Recent sessions with duration and prompt count
- Top projects
- Limits (if set) with edit option

### Subscriptions
- Group users by Claude email/subscription
- Per-subscription: total cost, total users, model usage
- Identify which subscriptions are shared vs individual

### Analytics
- **Leaderboard**: users ranked by prompts, cost, productivity score
- **Cost report**: per user, per project, per subscription, trends
- **Model usage**: who uses what, efficiency analysis
- **Tool usage**: most used tools, Bash vs Read vs Write patterns
- **Project heat map**: which projects get the most AI usage
- **Peak hours**: team-wide and per-user
- **Error rates**: tool failures, Anthropic rate limits per user
- **Prompt quality**: average scores, trends, comparison

### AI Summaries
- Latest daily summaries per user
- Weekly team summary
- Historical summaries (scrollable timeline)
- "Generate now" button for on-demand summary

### Prompts Browser
- Searchable, filterable list of all prompts
- Filter by user, project, model, date range
- Show prompt + response side by side (if collected)
- Flag/bookmark interesting prompts

### Settings
- Collection level: off / summaries / full
- Response collection: on / off
- Summary interval and provider
- Credit weights
- Webhook URLs (Slack/Discord)
- Alert configuration
- Data retention policy
- Export options

### Audit Log
- Chronological list of admin actions
- Filter by actor, action type, target

---

## Webhook Alerts

### Slack/Discord Notifications

**Real-time alerts (configurable):**
- User blocked by rate limit
- User killed/paused/reinstated
- Anthropic rate limit hit (StopFailure)
- Anomaly: usage spike >200% vs average

**Scheduled digests:**
- Daily: team usage summary, top users, cost, blocks
- Weekly: AI-generated team summary, trends, insights

### Payload Format

```json
{
  "event": "user_blocked",
  "user": "Alice",
  "model": "opus",
  "reason": "Daily opus limit reached (5/5)",
  "timestamp": "2026-03-26T14:30:00Z",
  "dashboard_url": "https://clawlens.example.com/dashboard/users/abc123"
}
```

---

## CLI (client-side)

### Installation

```bash
sudo npx @howincodes/clawlens setup \
  --code CLM-alice-a8f3e2 \
  --server https://clawlens.yourteam.com
```

### Commands

```bash
# Install hook + file sync
sudo npx @howincodes/clawlens setup --code <CODE> --server <URL>

# Check current status
npx @howincodes/clawlens status

# Force sync files now
sudo npx @howincodes/clawlens sync

# Remove everything
sudo npx @howincodes/clawlens uninstall
```

### Pre-flight Checks (during setup)
- Claude Code installed?
- Claude Code authenticated?
- Detect subscription type (pro/max) → set default model
- Detect subscription email → link to subscription group
- Collect device info

---

## Security

| # | Layer | What |
|---|-------|------|
| 1 | `managed-settings.json` | Can't be overridden by user config |
| 2 | `allowManagedHooksOnly` | Users can't add bypass hooks |
| 3 | File permissions | Root-owned, user-readable |
| 4 | Watchdog daemon | SHA-256 integrity check every 5 min |
| 5 | Server-side tracking | Deleting local files doesn't erase server data |
| 6 | Per-user auth tokens | Prevents impersonation |
| 7 | Fail-closed | Missing config = blocked |
| 8 | Prompt retention policy | Auto-delete old data |
| 9 | Configurable collection | Admin controls what's collected |
| 10 | Audit log | Every admin action tracked |

---

## Privacy Controls

| Setting | Options | Default |
|---------|---------|---------|
| Prompt collection | off / summaries / full | summaries |
| Response collection | off / on | off |
| Tool input collection | off / summary (200 chars) / full | summary |
| File sync | off / on | on |
| Project paths | basename only / full path | basename |
| Prompt retention | N days / forever | 90 days |

**"summaries" mode:** Prompts are sent to AI for summarization, then the raw text is discarded. Only the AI summary is stored.

---

## Project Structure

```
clawlens/
├── packages/
│   ├── cli/                          ← npm: @howincodes/clawlens
│   │   ├── package.json              ← zero npm deps
│   │   ├── bin/cli.js
│   │   └── src/
│   │       ├── hook.js               ← all hook actions
│   │       ├── file-sync.js          ← reads ~/.claude files
│   │       └── installer.js
│   ├── server/                       ← npm: @howincodes/clawlens-server
│   │   ├── package.json
│   │   ├── Dockerfile
│   │   ├── bin/server.js
│   │   └── src/
│   │       ├── server/
│   │       │   ├── index.js
│   │       │   ├── db.js
│   │       │   ├── routes/
│   │       │   │   ├── hook-api.js
│   │       │   │   └── admin-api.js
│   │       │   ├── services/
│   │       │   │   ├── limiter.js
│   │       │   │   ├── usage.js
│   │       │   │   ├── analytics.js
│   │       │   │   ├── summary-engine.js
│   │       │   │   ├── webhook.js
│   │       │   │   ├── file-sync-handler.js
│   │       │   │   ├── export.js
│   │       │   │   └── auth.js
│   │       │   ├── jobs/
│   │       │   │   ├── summary-scheduler.js
│   │       │   │   ├── digest-scheduler.js
│   │       │   │   └── retention-cleanup.js
│   │       │   └── ws.js
│   │       └── dashboard/            ← React + Tailwind (built)
│   └── dashboard/                    ← React source
│       ├── src/
│       │   ├── pages/
│       │   │   ├── Overview.tsx
│       │   │   ├── UserDetail.tsx
│       │   │   ├── Subscriptions.tsx
│       │   │   ├── Analytics.tsx
│       │   │   ├── Summaries.tsx
│       │   │   ├── PromptsBrowser.tsx
│       │   │   ├── Settings.tsx
│       │   │   └── AuditLog.tsx
│       │   ├── components/
│       │   └── lib/
│       └── package.json
├── README.md
├── LICENSE
└── examples/
```

---

## Deployment

### Docker (primary)

```bash
docker run -d \
  --name clawlens \
  -p 3000:3000 \
  -v clawlens-data:/data \
  -e ADMIN_PASSWORD=your-password \
  ghcr.io/howincodes/clawlens:latest
```

### Requirements
- Docker or Node.js 18+
- Network access from dev machines to server
- (Optional) Claude Code on server for AI summaries

---

## Relationship to claude-code-limiter

| | claude-code-limiter | ClawLens |
|---|---|---|
| **Focus** | Rate limiting only | Full analytics + management |
| **Scope** | Shared subscriptions | Any team (shared or separate accounts) |
| **Status** | Released, stable | New product |
| **Code** | Separate repo | Separate repo |
| **Shared concepts** | Hook system, managed-settings.json, server-sync | Same approach, expanded |

ClawLens is NOT a fork or v2 of the limiter. It's a new product that happens to use the same Claude Code hook infrastructure. The limiter stays as-is for users who only need rate limiting.
