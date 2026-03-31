# ClawLens — OpenAI Codex Integration Design

> Date: 2026-03-31
> Status: Approved
> Priority: High (before Copilot)

## Overview

Extend ClawLens to support OpenAI Codex with full parity to Claude Code: rate limiting, kill switch, subscription management, credit tracking, and complete data collection. All provider data is separated by a `source` column.

GitHub Copilot integration (data collection only) is deferred to a later phase.

## Architecture

```
Developer's Machine                     ClawLens Server
┌──────────────────────┐               ┌────────────────────────────┐
│ Claude Code          │               │                            │
│  └─ clawlens.mjs ────┼──────────────►│ /api/v1/hook/*             │
│                      │               │  (existing, unchanged)     │
│ OpenAI Codex         │               │                            │
│  └─ clawlens-codex   │               │ /api/v1/codex/*            │
│     .mjs ────────────┼──────────────►│  (full parity: kill switch,│
│     ~/.codex/        │               │   rate limits, credits,    │
│     hooks.json       │               │   subscriptions)           │
└──────────────────────┘               │                            │
                                       │ Shared service layer:      │
                                       │  db.ts, ai-jobs.ts,        │
                                       │  websocket.ts              │
                                       └────────────────────────────┘
```

Existing Claude Code routes are untouched. Codex gets its own route file and client script. The service layer (DB, AI jobs, WebSocket) is shared. Dashboard filters by `source`.

## Codex Hook System

Codex v0.117.0+ supports lifecycle hooks via `~/.codex/hooks.json`. Requires `[features] codex_hooks = true` in `~/.codex/config.toml`.

### Hook Events

| Event | Sync | Blocks? | Data Available |
|-------|------|---------|----------------|
| SessionStart | Yes | Yes (kill) | session_id, model, cwd, permission_mode, source |
| UserPromptSubmit | Yes | Yes (kill/pause/rate limit) | prompt, turn_id |
| PreToolUse | Yes | Yes (kill, 3rd layer) | tool_name, tool_input, tool_use_id |
| PostToolUse | No | No | tool_name, tool_input, tool_response, tool_use_id |
| Stop | No | No | last_assistant_message, token counts via transcript |

### Hook Response Format

Block a prompt or tool:
```json
{"decision": "block"}
```

Allow (default):
```json
{}
```

Note: Codex TUI v0.117.0 does not render block reason messages. Blocks are silent (no AI response shown).

### Kill Switch (3 layers, same as CC)

1. **SessionStart** → `{decision:"block"}` — session won't proceed
2. **UserPromptSubmit** → `{decision:"block"}` — prompt silently dropped
3. **PreToolUse** → `{decision:"block"}` — tool execution denied

**Hard kill:** Hook runs `codex logout` to remove `~/.codex/auth.json`, same pattern as CC's `claude auth logout`.

## Client: `clawlens-codex.mjs`

Zero dependencies. Fail-open design (exit 0 on all errors). Mirrors `clawlens.mjs` architecture.

### Data Collection Per Event

**SessionStart:**

From stdin payload:
- `session_id`, `model`, `cwd`, `permission_mode`, `source`

From `~/.codex/auth.json` JWT decode:
- `email`
- `plan_type` (go, pro, plus)
- `auth_provider` (google, etc.)
- `account_id`, `user_id`
- `subscription_active_start`, `subscription_active_until`
- `org_id`, `org_title`

From `transcript_path` (session_meta entry):
- `cli_version` (e.g., 0.117.0)
- `model_provider` (openai)
- `personality` (pragmatic, friendly, etc.)
- `collaboration_mode` (default, plan)
- `sandbox_mode` (read-only, workspace-write)
- `approval_policy` (on-request, never)
- `model_context_window` (e.g., 258400)
- `reasoning_effort` (high, medium, low)

**UserPromptSubmit:**
- `prompt` (full text)
- `turn_id` (unique per turn — Codex-specific, CC doesn't have this)

**PreToolUse:**
- `tool_name` (Bash — Codex is shell-only, no Read/Edit/Write)
- `tool_input` (`{command: "..."}`)
- `tool_use_id` (links pre ↔ post)

**PostToolUse:**
- `tool_name`, `tool_input`, `tool_response` (command output)
- `tool_use_id`

**Stop:**
- `last_assistant_message` (the AI response text)

From `transcript_path` last `token_count` entry:
- `input_tokens`, `cached_input_tokens`, `output_tokens`, `reasoning_output_tokens`, `total_tokens`
- `rate_limits.primary`: `used_percent`, `window_minutes`, `resets_at`
- `rate_limits.secondary`: same fields (5hr window, may be null)
- `rate_limits.plan_type`

## Database Changes

### New Columns on Existing Tables

**`sessions`:**
```sql
source              TEXT DEFAULT 'claude-code'   -- 'claude-code' | 'codex'
cli_version         TEXT
model_provider      TEXT                         -- 'openai' | 'anthropic'
personality         TEXT
collaboration_mode  TEXT
sandbox_mode        TEXT
approval_policy     TEXT
reasoning_effort    TEXT
```

**`prompts`:**
```sql
source              TEXT DEFAULT 'claude-code'
turn_id             TEXT
input_tokens        INTEGER
cached_tokens       INTEGER
output_tokens       INTEGER
reasoning_tokens    INTEGER
```

**`tool_events`:**
```sql
source              TEXT DEFAULT 'claude-code'
tool_use_id         TEXT
```

**`hook_events`:**
```sql
source              TEXT DEFAULT 'claude-code'
```

**`limits`:**
```sql
source              TEXT DEFAULT 'claude-code'
```

**`subscriptions`:**
```sql
source              TEXT DEFAULT 'claude-code'
account_id          TEXT
org_id              TEXT
auth_provider       TEXT
quota_used_percent  REAL
quota_resets_at     TEXT
quota_window_min    INTEGER
```

All existing CC data is untouched — `source` defaults to `'claude-code'` so no migration of existing rows.

### New Tables

**`provider_quotas`** — Tracks OpenAI's own rate limit windows:
```sql
CREATE TABLE provider_quotas (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         TEXT NOT NULL REFERENCES users(id),
  source          TEXT NOT NULL,         -- 'codex'
  window_name     TEXT NOT NULL,         -- 'primary' | 'secondary'
  plan_type       TEXT,                  -- 'go' | 'pro' | 'plus'
  used_percent    REAL,                  -- 2.0
  window_minutes  INTEGER,              -- 10080 (weekly) | 300 (5hr)
  resets_at       INTEGER,              -- unix timestamp
  updated_at      TEXT NOT NULL,
  UNIQUE(user_id, source, window_name)
);
```

Updated on every Stop event. Dashboard shows:
- "Weekly: 2% used — resets Apr 6"
- "5hr window: 15% used — resets in 2h 14m"

**`model_credits`** — Configurable credit weights per model per source:
```sql
CREATE TABLE model_credits (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  source  TEXT NOT NULL,        -- 'codex' | 'claude-code'
  model   TEXT NOT NULL,
  credits INTEGER DEFAULT 7,   -- admin-configurable
  tier    TEXT,                 -- 'flagship' | 'mid' | 'mini' | 'unknown'
  UNIQUE(source, model)
);
```

### Default Credit Weights

**Codex models:**

| Model | Tier | Credits |
|-------|------|---------|
| gpt-5.4 | flagship | 10 |
| gpt-5.3-codex | flagship | 10 |
| gpt-5.3-codex-spark | flagship | 10 |
| gpt-5.2-codex | flagship | 10 |
| gpt-5.2 | mid | 7 |
| gpt-5.1-codex-max | mid | 7 |
| gpt-5.1 | mid | 5 |
| gpt-5.1-codex | mid | 5 |
| gpt-5-codex | mid | 5 |
| gpt-5 | mid | 5 |
| gpt-5.4-mini | mini | 2 |
| gpt-5.1-codex-mini | mini | 2 |
| gpt-5-codex-mini | mini | 2 |
| (unknown) | unknown | 7 |

**Claude Code models** (migrated from hardcoded `getCreditCost`):

| Model | Tier | Credits |
|-------|------|---------|
| opus | flagship | 10 |
| sonnet | mid | 3 |
| haiku | mini | 1 |
| (unknown) | unknown | 3 |

**Unknown model handling:** When a new model appears in a hook event, server auto-inserts it into `model_credits` with default credit = 7 and tier = 'unknown'. Admin sees "New models detected" in the Settings page and can adjust.

This replaces the hardcoded `getCreditCost()` function in `hook-api.ts` — all models move to the `model_credits` table.

## Server Routes: `codex-api.ts`

New route file alongside `hook-api.ts`.

```
POST /api/v1/codex/session-start     Register session, check kill, return subscription info
POST /api/v1/codex/prompt            Record prompt, check kill/pause/rate limits
POST /api/v1/codex/pre-tool-use      Record tool, check kill (3rd layer)
POST /api/v1/codex/post-tool-use     Record tool result (data collection)
POST /api/v1/codex/stop              Record response + token counts + update provider quotas
```

### Differences from `hook-api.ts`

- Accepts `turn_id` field on prompt/tool events
- Stop endpoint receives token counts and provider quota data from transcript
- Credit cost lookup via `model_credits` table (not hardcoded)
- Kill response format: `{decision:"block"}` (Codex format)
- Hard kill response: `{killed:true, hard:true}` → client runs `codex logout`

### Shared with CC (no duplication)

- `db.ts` helpers — all queries accept `source` parameter
- `ai-jobs.ts` — profiles and team pulse work across all sources
- `websocket.ts` — live feed broadcasts Codex events
- `admin-api.ts` — dashboard endpoints filter by source
- Auth middleware — same token-based auth for hook endpoints

## Install Flow

Single `install.sh` with interactive prompts:

```
ClawLens Installer
==================

Server URL: https://clawlens.example.com
Auth Token: clwt_basha_a1b2c3d4

Install for Claude Code? (Y/n) Y
  ✓ Hooks installed in ~/.claude/settings.json

Install for OpenAI Codex? (Y/n) Y
  Checking codex version... 0.117.0 ✓
  ✓ codex_hooks enabled in ~/.codex/config.toml
  ✓ Hooks installed in ~/.codex/hooks.json
  ✓ clawlens-codex.mjs deployed

Starting watcher... ✓
```

Requirements for Codex install:
- `codex` CLI ≥ 0.117.0
- Node.js ≥ 18 (for native fetch)

Same interactive prompt on `uninstall.sh`, `enforce.sh`, `deep-clean.sh`.

## Dashboard Changes

### Filtering

All data pages get a source filter: `All | Claude Code | Codex`

### Codex-Specific UI

**User Detail page:**
- Provider quota cards: "Weekly: 2% used", "5hr: 15% used"
- Token usage breakdown per session (input/output/cached/reasoning)
- Subscription info: plan_type, email, org

**Settings page:**
- Model credits management: table of all models + credits
- "New models detected" alert for unknown models
- Separate credit tables per source

**Overview page:**
- Source breakdown in stats cards (CC prompts vs Codex prompts)
- Live feed shows Codex events with distinct badge

## Probe Results Reference

Based on testing with Codex v0.117.0 on 2026-03-31.

### Hook Payload Schemas (from real captures)

**SessionStart stdin:**
```json
{
  "session_id": "019d4253-2dfc-7e83-95c1-ffda6633e50e",
  "transcript_path": "~/.codex/sessions/2026/03/31/rollout-....jsonl",
  "cwd": "/Users/basha",
  "hook_event_name": "SessionStart",
  "model": "gpt-5.1-codex-mini",
  "permission_mode": "default",
  "source": "startup"
}
```

**UserPromptSubmit stdin:**
```json
{
  "session_id": "019d4253-...",
  "turn_id": "019d4253-37c1-7a81-8750-21180028a482",
  "transcript_path": "...",
  "cwd": "/Users/basha",
  "hook_event_name": "UserPromptSubmit",
  "model": "gpt-5.1-codex-mini",
  "permission_mode": "default",
  "prompt": "hey broh"
}
```

**PreToolUse stdin:**
```json
{
  "session_id": "019d4253-...",
  "turn_id": "019d4254-3b55-...",
  "transcript_path": "...",
  "hook_event_name": "PreToolUse",
  "model": "gpt-5.1-codex-mini",
  "permission_mode": "default",
  "tool_name": "Bash",
  "tool_input": {"command": "touch dummy.txt"},
  "tool_use_id": "call_n6wLplAqpsrNBUrCkNNUIcIC"
}
```

**PostToolUse stdin:**
```json
{
  "session_id": "019d4253-...",
  "turn_id": "019d4254-3b55-...",
  "hook_event_name": "PostToolUse",
  "tool_name": "Bash",
  "tool_input": {"command": "touch dummy.txt"},
  "tool_response": "",
  "tool_use_id": "call_n6wLplAqpsrNBUrCkNNUIcIC"
}
```

**Stop stdin:**
```json
{
  "session_id": "019d4253-...",
  "turn_id": "019d4254-3b55-...",
  "hook_event_name": "Stop",
  "model": "gpt-5.1-codex-mini",
  "permission_mode": "default",
  "stop_hook_active": false,
  "last_assistant_message": "Created `dummy.txt`."
}
```

**Transcript token_count entry (from transcript_path JSONL):**
```json
{
  "type": "token_count",
  "info": {
    "total_token_usage": {
      "input_tokens": 47784,
      "cached_input_tokens": 40192,
      "output_tokens": 100,
      "reasoning_output_tokens": 0,
      "total_tokens": 47884
    },
    "last_token_usage": {
      "input_tokens": 12067,
      "output_tokens": 9,
      "total_tokens": 12076
    },
    "model_context_window": 258400
  },
  "rate_limits": {
    "limit_id": "codex",
    "primary": {
      "used_percent": 2,
      "window_minutes": 10080,
      "resets_at": 1775537916
    },
    "secondary": null,
    "credits": null,
    "plan_type": "go"
  }
}
```

**Auth JWT fields (from `~/.codex/auth.json` id_token):**
```json
{
  "email": "user@example.com",
  "email_verified": true,
  "auth_provider": "google",
  "chatgpt_plan_type": "go",
  "chatgpt_account_id": "23f1ae27-...",
  "chatgpt_user_id": "user-hthitGT2Jgo...",
  "chatgpt_subscription_active_start": "2025-11-04T19:02:58+00:00",
  "chatgpt_subscription_active_until": "2026-03-04T19:02:58+00:00",
  "organizations": [
    {"id": "org-LWat0kP6...", "is_default": true, "role": "owner", "title": "Personal"}
  ]
}
```

## Hooks JSON Format

File: `~/.codex/hooks.json`

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node ~/.codex/hooks/clawlens-codex.mjs",
            "timeout": 10
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node ~/.codex/hooks/clawlens-codex.mjs",
            "timeout": 10
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node ~/.codex/hooks/clawlens-codex.mjs",
            "timeout": 10
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node ~/.codex/hooks/clawlens-codex.mjs",
            "timeout": 10
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node ~/.codex/hooks/clawlens-codex.mjs",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

Requires `[features] codex_hooks = true` in `~/.codex/config.toml`.

## Watcher Integration (deferred)

Whether `clawlens-watcher.mjs` should also monitor Codex hook integrity (repair `~/.codex/hooks.json` if tampered) is deferred to a follow-up design.

## Testing Notes

- Codex hooks require v0.117.0+ (v0.104.0 does not fire hooks)
- `codex exec` (non-interactive) does NOT fire hooks — only interactive mode
- `codex_hooks` feature flag was `under development` as of v0.117.0
- Hooks JSON format requires nested `{hooks: {EventName: [{hooks: [...]}]}}` — flat format is silently ignored
- No env vars set on hook processes (all data comes via stdin JSON)
- Kill switch blocks silently — Codex TUI does not render block reason messages
