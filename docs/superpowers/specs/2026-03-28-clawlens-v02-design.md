# ClawLens v0.2 — Full Redesign

## Goal

Rewrite ClawLens from a Go binary-dependent system to a TypeScript monorepo with plugin-based distribution, HTTP hooks, and three deployment tiers with increasing enforcement.

## Architecture

```
Developer Machine                          ClawLens Server (VPS)
┌────────────────────────┐                ┌──────────────────────────┐
│ Claude Code            │                │ Express + TypeScript     │
│ ├── Plugin: clawlens   │   HTTP POST    │ ├── Hook API (11 routes) │
│ │   ├── HTTP hooks ────┼───────────────►│ ├── Admin API            │
│ │   ├── Command hooks  │                │ ├── WebSocket            │
│ │   └── /clawlens-status               │ ├── Dead Man's Switch    │
│ │                      │                │ ├── Claude AI Service    │
│ └── [Tier 2/3]         │                │ └── SQLite (better-sqlite3)
│     managed-settings.d │                │                          │
└────────────────────────┘                │ React Dashboard (Vite)   │
                                          └──────────────────────────┘
```

**Tech Stack:**
- Server: Express + TypeScript (rewrite from Go)
- Database: SQLite via better-sqlite3 (synchronous, fast)
- Dashboard: React + Vite (existing, updated)
- Validation: zod (schema validation)
- WebSocket: ws
- Background jobs: node-cron
- AI: `claude -p` wrapper with `--bare --json-schema` for structured output
- Client: Claude Code plugin (HTTP hooks + command hooks)
- Auth: JWT (admin) + Bearer tokens (hooks)

---

## Monorepo Structure

```
clawlens/
├── packages/
│   ├── server/
│   │   ├── src/
│   │   │   ├── routes/
│   │   │   │   ├── hook-api.ts
│   │   │   │   └── admin-api.ts
│   │   │   ├── services/
│   │   │   │   ├── db.ts               ← better-sqlite3
│   │   │   │   ├── auth.ts             ← JWT + token auth
│   │   │   │   ├── limiter.ts          ← credit-based rate limiting
│   │   │   │   ├── claude-ai.ts        ← claude -p wrapper
│   │   │   │   ├── deadman.ts          ← dead man's switch
│   │   │   │   ├── tamper.ts           ← tamper detection
│   │   │   │   └── analytics.ts
│   │   │   ├── middleware/
│   │   │   │   ├── hook-auth.ts
│   │   │   │   └── admin-auth.ts
│   │   │   ├── schemas/
│   │   │   │   ├── hook-events.ts      ← zod schemas for Claude Code JSON
│   │   │   │   ├── admin.ts
│   │   │   │   └── ai-outputs.ts       ← zod schemas for AI responses
│   │   │   └── server.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── dashboard/
│   │   ├── src/                         ← existing React, updated
│   │   └── package.json
│   │
│   └── plugin/
│       ├── .claude-plugin/
│       │   └── plugin.json
│       ├── hooks/
│       │   └── hooks.json
│       ├── scripts/
│       │   └── clawlens-hook.sh         ← command hook handler
│       └── skills/
│           └── clawlens-status/
│               └── SKILL.md
│
├── scripts/
│   ├── enforce.sh                       ← Tier 2/3 installer
│   ├── enforce.ps1
│   ├── restore.sh                       ← clean uninstall
│   └── restore.ps1
│
├── pnpm-workspace.yaml
├── package.json
└── tsconfig.base.json
```

---

## Claude AI Service (`claude-ai.ts`)

Wraps `claude -p` CLI for structured AI operations. Uses the team's existing Claude subscription — no separate API key or billing.

**CLI flags used:**
- `--bare` — skip hooks/plugins/MCP (fast startup, ~1s vs ~5s)
- `--output-format json` — JSON output
- `--json-schema '{...}'` — enforced structured output with validation
- `--max-turns 1` — single turn, no agentic loop
- `-p` — non-interactive print mode

```typescript
import { execFile } from 'child_process';
import { z, ZodSchema } from 'zod';

interface ClaudeRequest<T> {
  prompt: string;
  systemPrompt?: string;
  schema: ZodSchema<T>;
  timeout?: number;           // ms, default 30000
}

interface ClaudeResponse<T> {
  data: T;
  durationMs: number;
}

class ClaudeAI {
  private queue: Array<() => Promise<void>> = [];
  private running = 0;
  private maxConcurrent = 2;

  async run<T>(req: ClaudeRequest<T>): Promise<ClaudeResponse<T>> {
    // Build args
    const args = ['-p', '--bare', '--output-format', 'json', '--max-turns', '1'];
    if (req.systemPrompt) {
      args.push('--system-prompt', req.systemPrompt);
    }
    // Convert zod schema to JSON Schema for --json-schema flag
    const jsonSchema = zodToJsonSchema(req.schema);
    args.push('--json-schema', JSON.stringify(jsonSchema));
    args.push(req.prompt);

    // Execute with queue management
    const start = Date.now();
    const raw = await this.execute(args, req.timeout ?? 30000);
    const parsed = JSON.parse(raw);
    const data = req.schema.parse(parsed);

    return { data, durationMs: Date.now() - start };
  }

  private execute(args: string[], timeout: number): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile('claude', args, { timeout }, (err, stdout) => {
        if (err) return reject(err);
        resolve(stdout);
      });
    });
  }
}

export const claude = new ClaudeAI();
```

**AI use cases (current + planned):**

| Use case | Schema | Status |
|---|---|---|
| Session summaries | `{summary, categories, topics, risk_level}` | Port from v0.1 |
| Prompt categorization | `{category, tags, sensitivity}` | New |
| Usage anomaly detection | `{is_anomaly, reason, severity}` | New |
| Cost optimization | `{suggestion, savings, models}` | Future |
| Security audit | `{findings, risk_score, recommendations}` | Future |
| Team productivity reports | `{metrics, trends, recommendations}` | Future |

---

## Deployment Tiers

### Tier 1: Standard (Plugin Only)

**Install:** `claude plugin install clawlens@howincodes`
**Admin access:** None required
**Enforcement:** Detection only (dead man's switch, integrity hash)
**Kill switch:** Block prompts/tools via HTTP hook response
**Best for:** Startups, trust-based teams

Plugin registers 11 hooks (8 HTTP + 3 command). User enters server URL and auth token during plugin enable. Token stored in system keychain.

Users CAN disable by uninstalling plugin or `disableAllHooks: true`. Dead man's switch detects this.

### Tier 2: Enforced (Managed Hooks + Watchdog)

**Install:** Plugin + admin runs `enforce.sh` once per machine (sudo)
**Admin access:** One-time per machine
**Enforcement:** `allowManagedHooksOnly: true` + watchdog daemon
**Kill switch:** Block all + hooks cannot be disabled by user
**Best for:** Compliance teams

Managed settings block all non-managed hooks. Watchdog auto-repairs tampering every 5 minutes.

### Tier 3: Locked (Managed + Auth Revocation + Watchdog)

**Install:** Admin runs `enforce.sh --tier3` once per machine (sudo)
**Admin access:** One-time per machine
**Enforcement:** All of Tier 2 + `claude auth logout` on kill
**Kill switch:** Revokes Claude Code auth credentials — completely unusable
**Best for:** High-security, enterprises

Ported from claude-code-limiter's `triggerLogout()`.

**Verified 2026-03-28:** `managed-settings.json`, `managed-settings.d/`, and `allowManagedHooksOnly: true` all work on Claude Max subscription (not Enterprise-gated).

---

## Hook Events

| Hook Event | Type | Sync/Async | Server Response | Purpose |
|---|---|---|---|---|
| `SessionStart` | **command** | Sync | `continue: false` if killed | Kill switch, session registration |
| `UserPromptSubmit` | http | Sync | `decision: block` if over limit | Rate limiting, prompt logging |
| `PreToolUse` | http | Sync | `permissionDecision: deny` if killed | Kill switch backup, tool tracking |
| `Stop` | http | Sync | `200 OK` | Record response + credit cost |
| `StopFailure` | http | Async | `200 OK` | Log API errors |
| `SessionEnd` | http | Async | `200 OK` | Finalize session |
| `PostToolUse` | http | Async | `200 OK` | Tool usage analytics |
| `SubagentStart` | http | Async | `200 OK` | Subagent tracking |
| `PostToolUseFailure` | http | Async | `200 OK` | Error analytics |
| `ConfigChange` | http | Sync | `200 OK` | Tamper detection |
| `FileChanged` | **command** | Sync | `200 OK` | Tamper detection (watches settings.json) |

**command** = Claude Code limitation, these events only support `type: "command"`. Plugin bundles `clawlens-hook.sh` that calls server via curl.
**http** = native HTTP POST (verified working 2026-03-28).

### Command Hook Script (`clawlens-hook.sh`)

Bundled at `${CLAUDE_PLUGIN_ROOT}/scripts/clawlens-hook.sh`. Used for SessionStart and FileChanged (command-only events). Environment variables `CLAUDE_PLUGIN_OPTION_SERVER_URL` and `CLAUDE_PLUGIN_OPTION_AUTH_TOKEN` are auto-exported by Claude Code from plugin `userConfig`.

```bash
#!/bin/bash
INPUT=$(cat)
EVENT=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('hook_event_name',''))" 2>/dev/null)

# Map event names to API paths
case "$EVENT" in
  SessionStart)  PATH_SUFFIX="session-start" ;;
  FileChanged)   PATH_SUFFIX="file-changed" ;;
  *)             PATH_SUFFIX="unknown" ;;
esac

RESP=$(curl -sf -m 5 -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CLAUDE_PLUGIN_OPTION_AUTH_TOKEN" \
  -d "$INPUT" \
  "$CLAUDE_PLUGIN_OPTION_SERVER_URL/api/v1/hook/$PATH_SUFFIX" 2>/dev/null)

if [ -n "$RESP" ]; then
  echo "$RESP"
else
  exit 0
fi
```

---

## Plugin Configuration

### plugin.json

```json
{
  "name": "clawlens",
  "version": "0.2.0",
  "description": "AI usage analytics and team management for Claude Code teams",
  "author": {
    "name": "Howin Codes",
    "url": "https://github.com/howincodes"
  },
  "repository": "https://github.com/howincodes/clawlens",
  "keywords": ["analytics", "monitoring", "team-management"],
  "userConfig": {
    "server_url": {
      "description": "ClawLens server URL (e.g. https://clawlens.howincloud.com)",
      "sensitive": false
    },
    "auth_token": {
      "description": "Your auth token (from admin dashboard)",
      "sensitive": true
    }
  }
}
```

### hooks/hooks.json

```json
{
  "hooks": {
    "SessionStart": [{
      "hooks": [{
        "type": "command",
        "command": "${CLAUDE_PLUGIN_ROOT}/scripts/clawlens-hook.sh",
        "timeout": 5
      }]
    }],
    "UserPromptSubmit": [{
      "hooks": [{
        "type": "http",
        "url": "${user_config.server_url}/api/v1/hook/prompt",
        "headers": {"Authorization": "Bearer ${user_config.auth_token}"},
        "allowedEnvVars": ["CLAUDE_PLUGIN_OPTION_AUTH_TOKEN"],
        "timeout": 5
      }]
    }],
    "PreToolUse": [{
      "hooks": [{
        "type": "http",
        "url": "${user_config.server_url}/api/v1/hook/pre-tool",
        "headers": {"Authorization": "Bearer ${user_config.auth_token}"},
        "allowedEnvVars": ["CLAUDE_PLUGIN_OPTION_AUTH_TOKEN"],
        "timeout": 2
      }]
    }],
    "Stop": [{
      "hooks": [{
        "type": "http",
        "url": "${user_config.server_url}/api/v1/hook/stop",
        "headers": {"Authorization": "Bearer ${user_config.auth_token}"},
        "allowedEnvVars": ["CLAUDE_PLUGIN_OPTION_AUTH_TOKEN"],
        "timeout": 5
      }]
    }],
    "StopFailure": [{
      "hooks": [{
        "type": "http",
        "url": "${user_config.server_url}/api/v1/hook/stop-error",
        "headers": {"Authorization": "Bearer ${user_config.auth_token}"},
        "allowedEnvVars": ["CLAUDE_PLUGIN_OPTION_AUTH_TOKEN"],
        "timeout": 2,
        "async": true
      }]
    }],
    "SessionEnd": [{
      "hooks": [{
        "type": "http",
        "url": "${user_config.server_url}/api/v1/hook/session-end",
        "headers": {"Authorization": "Bearer ${user_config.auth_token}"},
        "allowedEnvVars": ["CLAUDE_PLUGIN_OPTION_AUTH_TOKEN"],
        "timeout": 3,
        "async": true
      }]
    }],
    "PostToolUse": [{
      "hooks": [{
        "type": "http",
        "url": "${user_config.server_url}/api/v1/hook/post-tool",
        "headers": {"Authorization": "Bearer ${user_config.auth_token}"},
        "allowedEnvVars": ["CLAUDE_PLUGIN_OPTION_AUTH_TOKEN"],
        "timeout": 3,
        "async": true
      }]
    }],
    "SubagentStart": [{
      "hooks": [{
        "type": "http",
        "url": "${user_config.server_url}/api/v1/hook/subagent-start",
        "headers": {"Authorization": "Bearer ${user_config.auth_token}"},
        "allowedEnvVars": ["CLAUDE_PLUGIN_OPTION_AUTH_TOKEN"],
        "timeout": 2,
        "async": true
      }]
    }],
    "PostToolUseFailure": [{
      "hooks": [{
        "type": "http",
        "url": "${user_config.server_url}/api/v1/hook/post-tool-failure",
        "headers": {"Authorization": "Bearer ${user_config.auth_token}"},
        "allowedEnvVars": ["CLAUDE_PLUGIN_OPTION_AUTH_TOKEN"],
        "timeout": 2,
        "async": true
      }]
    }],
    "ConfigChange": [{
      "hooks": [{
        "type": "http",
        "url": "${user_config.server_url}/api/v1/hook/config-change",
        "headers": {"Authorization": "Bearer ${user_config.auth_token}"},
        "allowedEnvVars": ["CLAUDE_PLUGIN_OPTION_AUTH_TOKEN"],
        "timeout": 3
      }]
    }],
    "FileChanged": [{
      "matcher": "settings.json",
      "hooks": [{
        "type": "command",
        "command": "${CLAUDE_PLUGIN_ROOT}/scripts/clawlens-hook.sh",
        "timeout": 3
      }]
    }]
  }
}
```

**Note:** `${user_config.*}` substitution in HTTP hook URLs/headers needs verification via marketplace install. Fallback: use `$CLAUDE_PLUGIN_OPTION_SERVER_URL` env var (auto-exported by Claude Code from userConfig).

---

## Installation Flows

### Tier 1: Developer Install

**Admin creates user:**
1. Dashboard → Users → Add User → enters name, email, subscription
2. Server generates auth token (format: `clwt_<username>_<random>`)
3. Dashboard shows install instructions with token (shown once)

**Developer installs:**
```
Step 1: Add marketplace (one-time)
  claude /plugin marketplace add --source github --repo howincodes/claude-plugins

Step 2: Install plugin
  claude plugin install clawlens

Step 3: Enter credentials when prompted
  Server URL: https://clawlens.howincloud.com
  Auth Token: clwt_krishna_a8f3k2m9x7
```

### Tier 2/3: Admin Enforces

```bash
# Tier 2 (managed hooks + watchdog)
curl -fsSL https://raw.githubusercontent.com/howincodes/clawlens/main/scripts/enforce.sh | sudo bash

# Tier 3 (+ auth revocation on kill)
curl -fsSL https://raw.githubusercontent.com/howincodes/clawlens/main/scripts/enforce.sh | sudo bash -s -- --tier3
```

### Uninstall / Restore

```bash
# Tier 1
claude plugin uninstall clawlens

# Tier 2/3
curl -fsSL https://raw.githubusercontent.com/howincodes/clawlens/main/scripts/restore.sh | sudo bash
```

Windows: `enforce.ps1`, `restore.ps1`

---

## Server Hook Endpoints

All receive Claude Code's native hook JSON. Auth via `Authorization: Bearer <token>`.

| Endpoint | Sync | Can Block | Key Logic |
|---|---|---|---|
| `POST /api/v1/hook/session-start` | Yes | `continue: false` | Kill/pause check, session creation, dead man's switch update |
| `POST /api/v1/hook/prompt` | Yes | `decision: block` | Rate limiting, credit check, prompt recording |
| `POST /api/v1/hook/pre-tool` | Yes | `permissionDecision: deny` | Kill/pause check, tool event recording |
| `POST /api/v1/hook/stop` | Yes | No | Response recording, credit cost calculation |
| `POST /api/v1/hook/stop-error` | No | No | Error logging |
| `POST /api/v1/hook/session-end` | No | No | Session finalization |
| `POST /api/v1/hook/post-tool` | No | No | Tool usage analytics |
| `POST /api/v1/hook/subagent-start` | No | No | Subagent tracking |
| `POST /api/v1/hook/post-tool-failure` | No | No | Error analytics |
| `POST /api/v1/hook/config-change` | Yes | No | Tamper detection |
| `POST /api/v1/hook/file-changed` | Yes | No | Tamper detection |

Existing admin API and dashboard endpoints preserved with same contract.

---

## Tamper Detection

| Layer | How | Catches |
|---|---|---|
| Dead Man's Switch | Server checks `last_event_at` every 5 min | Complete hook removal, offline abuse |
| Hook Integrity Hash | SessionStart sends metadata, server compares | Selective hook removal/modification |
| ConfigChange Monitor | Fires when settings.json changes | Real-time tampering during sessions |
| FileChanged Monitor | Fires when settings.json modified on disk | External script/manual modifications |

Dashboard shows user status: Active / Inactive / Tampered / Killed / Paused with alert history.

---

## Kill Switch

| Tier | Mechanism | Bypassable? |
|---|---|---|
| 1 | HTTP response: `continue: false` + `decision: block` + `permissionDecision: deny` | Yes (remove plugin) |
| 2 | Same as 1, but managed hooks can't be removed | No (without admin access) |
| 3 | Same as 2, plus `claude auth logout` revokes credentials | No (Claude Code completely dead) |

---

## Database Schema

```sql
-- New tables
CREATE TABLE tamper_alerts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL REFERENCES users(id),
  alert_type  TEXT NOT NULL,
  details     TEXT,
  resolved    BOOLEAN DEFAULT FALSE,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME
);

CREATE TABLE hook_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL,
  session_id  TEXT,
  event_type  TEXT NOT NULL,
  payload     TEXT,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_hook_events_user ON hook_events(user_id, created_at);

CREATE TABLE tool_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL,
  session_id  TEXT,
  tool_name   TEXT NOT NULL,
  tool_input  TEXT,
  tool_output TEXT,
  success     BOOLEAN,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_tool_events_user ON tool_events(user_id, created_at);

CREATE TABLE subagent_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL,
  session_id  TEXT,
  agent_id    TEXT,
  agent_type  TEXT,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Modified: add columns to users
-- last_event_at, hook_integrity_hash, deployment_tier
```

Existing tables (users, sessions, prompts, subscriptions, limits, alerts, teams) preserved with same schema.

---

## v0.1 Cleanup

**Entire directories to remove:**
- `internal/` — all Go code (client + server + shared)
- `cmd/` — Go CLI entry points
- `bin/` — compiled binaries (12 files)
- `.playwright-cli/` — old test tooling
- `node_modules/` — old deps

**Files to remove:**
- `go.mod`, `go.sum` — Go deps
- `Makefile` — Go build targets
- `Dockerfile`, `docker-compose.yml`, `Caddyfile` — old docker setup
- `clawlens.db*` — local dev database
- `analytics.yml` — old config
- `package.json`, `package-lock.json`, `playwright.config.ts` — old test deps
- All `scripts/` except enforce/restore (install-client.sh, install-client.ps1, update-*, Dockerfile.*, simulate.sh, test-client.sh, setup-container.sh, entrypoint.sh, reset-windows.ps1, install.sh)

**Scripts to keep:**
- `scripts/install-server.sh` — updated for Node.js server
- `scripts/update-server.sh` — updated
- `scripts/enforce.sh` — new (Tier 2/3)
- `scripts/enforce.ps1` — new
- `scripts/restore.sh` — new
- `scripts/restore.ps1` — new

---

## Risks and Mitigations

### `${user_config.*}` substitution in HTTP hook URLs

Documented for "hook commands" and "MCP/LSP configs" but not explicitly for HTTP URLs. `--plugin-dir` skips userConfig so couldn't test locally.

**Mitigation:** Test via marketplace install early. Fallback: env var `$CLAUDE_PLUGIN_OPTION_SERVER_URL`.

### SessionStart/FileChanged are command-only

**Confirmed 2026-03-28.** Plugin bundles `clawlens-hook.sh` using curl.

### HTTP hooks fail-open offline

Claude Code allows all actions when hooks timeout.

**Mitigation:** Dead man's switch detects offline abuse. Tier 3 gate script can fail-closed.

### `claude -p --json-schema` availability

Requires Claude Code v2.1.x+. Older versions don't support `--json-schema`.

**Mitigation:** AI service falls back to parsing JSON from text output if flag unavailable. Validate with zod either way.
