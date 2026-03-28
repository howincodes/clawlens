# ClawLens Architecture

AI usage analytics and team management for Claude Code teams.

## How It Works

```
Developer's Machine                        ClawLens Server (VPS)
┌──────────────────────┐                  ┌─────────────────────────┐
│ Claude Code          │                  │                         │
│ │                    │    curl POST     │  Express + TypeScript   │
│ ├─ settings.json     │                  │  ├─ Hook API            │
│ │  └─ hooks ─────────┼─────────────────►│  │  (11 endpoints)      │
│ │     (11 events)    │                  │  ├─ Admin API           │
│ │                    │                  │  │  (22 endpoints)      │
│ └─ hooks/            │                  │  ├─ WebSocket /ws       │
│    └─ clawlens-      │                  │  ├─ SQLite (better-     │
│       hook.sh        │                  │  │   sqlite3)           │
│                      │                  │  └─ React Dashboard     │
│ [Enforced mode]      │                  │     (Vite static)      │
│ managed-settings.d/  │                  │                         │
│   10-clawlens.json   │                  └─────────────────────────┘
└──────────────────────┘
```

## Data Flow

1. Developer types prompt in Claude Code
2. Claude Code fires `UserPromptSubmit` hook
3. Hook runs `~/.claude/hooks/clawlens-hook.sh`
4. Script reads JSON from stdin, extracts event name
5. Script POSTs to `$SERVER_URL/api/v1/hook/<event>`
6. Server checks: user status (kill/pause), credit limits
7. Server returns `{}` (allow) or `{"decision":"block"}` (deny)
8. Claude Code blocks or processes the prompt
9. On completion, `Stop` hook fires with the AI response
10. Server records prompt + response + credit cost

## Project Structure

```
clawlens/
├── packages/
│   ├── server/                 Express + TypeScript API
│   │   ├── src/
│   │   │   ├── server.ts       Entry point, Express setup, static serving
│   │   │   ├── routes/
│   │   │   │   ├── hook-api.ts     11 hook endpoints (the core)
│   │   │   │   └── admin-api.ts    22 dashboard endpoints
│   │   │   ├── services/
│   │   │   │   ├── db.ts           SQLite schema + CRUD (~30 helpers)
│   │   │   │   ├── claude-ai.ts    claude -p wrapper for AI features
│   │   │   │   ├── deadman.ts      Dead man's switch (opt-in)
│   │   │   │   ├── tamper.ts       Tamper detection logic
│   │   │   │   └── websocket.ts    WebSocket live feed
│   │   │   ├── middleware/
│   │   │   │   ├── hook-auth.ts    Bearer token → user lookup
│   │   │   │   └── admin-auth.ts   JWT for dashboard
│   │   │   └── schemas/
│   │   │       └── hook-events.ts  Zod schemas for Claude Code JSON
│   │   └── tests/              6 test files, 149 tests
│   │
│   └── dashboard/              React + Vite + Tailwind admin UI
│       └── src/
│           ├── pages/          Overview, Users, Analytics, etc.
│           ├── components/     AddUserModal, EditLimitsModal, etc.
│           ├── lib/api.ts      API client (fetchClient wrapper)
│           └── store/          Zustand auth store
│
└── scripts/
    ├── install.sh              Client installer (one command)
    ├── uninstall.sh            Client removal
    ├── enforce.sh              Enforced mode (managed settings + gate)
    ├── restore.sh              Enforced mode removal
    ├── enforce.ps1             Windows enforce
    ├── restore.ps1             Windows restore
    ├── install-server.sh       Server deployment (Node.js + systemd)
    ├── update-server.sh        Server update (git pull + rebuild)
    ├── migrate-v01.sh          v0.1 → v0.2 migration
    └── test-integration.sh     39-test integration suite
```

## Database (SQLite)

12 tables:
- `teams` — multi-tenant team info
- `users` — developers (auth_token, status, credit tracking)
- `sessions` — Claude Code sessions
- `prompts` — every prompt + response + credit cost + blocked status
- `limits` — per-user rate limit rules (total_credits, per_model, time_of_day)
- `subscriptions` — Claude subscription info
- `alerts` — admin notifications
- `tamper_alerts` — tampering detection alerts
- `hook_events` — raw hook event log
- `tool_events` — tool usage (Edit, Bash, Read, etc.)
- `subagent_events` — subagent spawns
- `summaries` — AI-generated usage summaries

## Hook Events (11 total)

| Event | Sync/Async | Blocks? | Purpose |
|-------|-----------|---------|---------|
| SessionStart | Sync | Yes (kill/pause) | Register session |
| UserPromptSubmit | Sync | Yes (kill/pause/rate limit) | Record prompt, check limits |
| PreToolUse | Async | No | Track tool usage |
| Stop | Sync | No | Record AI response + credits |
| StopFailure | Async | No | Log API errors |
| SessionEnd | Async | No | Finalize session |
| PostToolUse | Async | No | Track tool completion |
| SubagentStart | Async | No | Track subagent spawns |
| PostToolUseFailure | Async | No | Track tool failures |
| ConfigChange | Sync | No | Tamper detection |
| FileChanged | Sync | No | Tamper detection |

## Kill Switch (3 layers)

When admin sets user status to `killed`:
1. `SessionStart` → `{"continue": false}` — session won't start
2. `UserPromptSubmit` → `{"decision": "block"}` — prompt rejected
3. `PreToolUse` → `{"permissionDecision": "deny"}` — tools blocked

## Two Deployment Modes

**Standard** (`install.sh`): Writes hooks to `~/.claude/settings.json`. No admin needed. Users can remove hooks (dead man's switch detects this).

**Enforced** (`enforce.sh`): Writes to `managed-settings.d/10-clawlens.json` with `allowManagedHooksOnly: true`. Requires sudo. Users cannot override. Gate script runs `claude auth logout` on kill.

## Key Design Decisions

- **All hooks use `type: "command"`** — Claude Code blocks HTTP hooks to private addresses and `${user_config.*}` substitution doesn't work in plugin HTTP URLs. Shell script + curl is the only reliable approach.
- **better-sqlite3 (synchronous)** — adequate for team-scale analytics. Simpler than async drivers. WAL mode handles concurrent reads.
- **Credits charged at prompt time, not stop time** — prevents double-counting. Stop handler only records the response text.
- **Fail-open on hook errors** — if server is down, Claude Code continues working. Dead man's switch detects prolonged silence.
- **No plugin** — Claude Code plugin system has limitations (userConfig broken, HTTP hooks blocked). Direct settings.json manipulation via install script is simpler and more reliable.
