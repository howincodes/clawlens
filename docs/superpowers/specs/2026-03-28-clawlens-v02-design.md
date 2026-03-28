# ClawLens v0.2 — Full Redesign

## Goal

Rewrite ClawLens from a Go binary-dependent system to a TypeScript monorepo with shell-script-based client distribution, HTTP hooks, and two deployment modes with increasing enforcement.

## Architecture

```
Developer Machine                          ClawLens Server (VPS)
┌────────────────────────┐                ┌──────────────────────────┐
│ Claude Code            │                │ Express + TypeScript     │
│ ├── settings.json      │   HTTP POST    │ ├── Hook API (11 routes) │
│ │   └── hooks ─────────┼───────────────►│ ├── Admin API            │
│ │                      │                │ ├── WebSocket            │
│ │                      │                │ ├── Dead Man's Switch    │
│ │                      │                │ ├── Claude AI Service    │
│ └── [Enforced]         │                │ └── SQLite (better-sqlite3)
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
- Client: Shell script (install.sh registers hooks in ~/.claude/settings.json)
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
│   └── dashboard/
│       ├── src/                         ← existing React, updated
│       └── package.json
│
├── scripts/
│   ├── install.sh                       ← client installer (registers hooks in settings.json)
│   ├── uninstall.sh                     ← client uninstaller
│   ├── install-server.sh                ← server installer (systemd)
│   ├── update-server.sh                 ← server updater
│   ├── enforce.sh                       ← enforced mode installer
│   ├── enforce.ps1
│   ├── restore.sh                       ← clean uninstall of enforced mode
│   ├── restore.ps1
│   └── migrate-v01.sh                   ← v0.1 to v0.2 migration
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

## Deployment Modes

### Standard (install.sh)

**Install:** `bash <(curl -fsSL .../install.sh)`
**Admin access:** None required
**Enforcement:** Detection only (dead man's switch, integrity hash)
**Kill switch:** Block prompts/tools via HTTP hook response
**Best for:** Startups, trust-based teams

install.sh registers 11 hooks in `~/.claude/settings.json`. User enters server URL and auth token during install.

Users CAN disable by removing hooks or `disableAllHooks: true`. Dead man's switch detects this.

### Enforced (enforce.sh)

**Install:** Admin runs `enforce.sh` once per machine (sudo)
**Admin access:** One-time per machine
**Enforcement:** `allowManagedHooksOnly: true` + watchdog daemon + optional auth revocation on kill
**Kill switch:** Block all + hooks cannot be disabled by user; can also revoke Claude Code auth credentials
**Best for:** Compliance teams, enterprises

Managed settings block all non-managed hooks. Watchdog auto-repairs tampering every 5 minutes.

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

Installed at `~/.claude/hooks/clawlens-hook.sh` by install.sh. Used for SessionStart and FileChanged (command-only events). Environment variables `CLAWLENS_SERVER_URL` and `CLAWLENS_AUTH_TOKEN` are set during install.

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
  -H "Authorization: Bearer $CLAWLENS_AUTH_TOKEN" \
  -d "$INPUT" \
  "$CLAWLENS_SERVER_URL/api/v1/hook/$PATH_SUFFIX" 2>/dev/null)

if [ -n "$RESP" ]; then
  echo "$RESP"
else
  exit 0
fi
```

---

## Client Configuration

Plugin approach was replaced by install.sh. The install script directly writes hooks into `~/.claude/settings.json`, which is simpler and avoids plugin marketplace dependency.

Hooks are registered as HTTP hooks pointing to the server URL with the auth token in headers. SessionStart and FileChanged use command hooks (calling `~/.claude/hooks/clawlens-hook.sh`) since those events only support `type: "command"` in Claude Code.

---

## Installation Flows

### Standard: Developer Install

**Admin creates user:**
1. Dashboard → Users → Add User → enters name, email, subscription
2. Server generates auth token (format: `clwt_<username>_<random>`)
3. Dashboard shows install instructions with token (shown once)

**Developer installs:**
```bash
bash <(curl -fsSL https://raw.githubusercontent.com/howincodes/clawlens/main/scripts/install.sh)
# Prompts for server URL and auth token interactively
```

### Enforced: Admin Enforces

```bash
curl -fsSL https://raw.githubusercontent.com/howincodes/clawlens/main/scripts/enforce.sh | sudo bash
```

### Uninstall / Restore

```bash
# Standard
bash <(curl -fsSL https://raw.githubusercontent.com/howincodes/clawlens/main/scripts/uninstall.sh)

# Enforced
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

| Mode | Mechanism | Bypassable? |
|---|---|---|
| Standard | HTTP response: `continue: false` + `decision: block` + `permissionDecision: deny` | Yes (remove hooks from settings.json) |
| Enforced | Same as Standard, but managed hooks can't be removed; optional auth revocation | No (without admin access) |

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
- `scripts/install.sh` — client installer
- `scripts/uninstall.sh` — client uninstaller
- `scripts/install-server.sh` — updated for Node.js server
- `scripts/update-server.sh` — updated
- `scripts/enforce.sh` — enforced mode installer
- `scripts/enforce.ps1` — Windows equivalent
- `scripts/restore.sh` — clean removal
- `scripts/restore.ps1` — Windows clean removal
- `scripts/migrate-v01.sh` — v0.1 to v0.2 migration

---

## Risks and Mitigations

### SessionStart/FileChanged are command-only

**Confirmed 2026-03-28.** install.sh installs `clawlens-hook.sh` using curl for these events.

### HTTP hooks fail-open offline

Claude Code allows all actions when hooks timeout.

**Mitigation:** Dead man's switch detects offline abuse. Enforced mode gate script can fail-closed.

### `claude -p --json-schema` availability

Requires Claude Code v2.1.x+. Older versions don't support `--json-schema`.

**Mitigation:** AI service falls back to parsing JSON from text output if flag unavailable. Validate with zod either way.
