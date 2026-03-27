# ClawLens v0.2 — Settings & Hooks Redesign

## Goal

Redesign ClawLens from a binary-dependent system requiring sudo/admin to a plugin-based architecture using Claude Code's native HTTP hooks, with three deployment tiers offering increasing levels of enforcement.

## Architecture

ClawLens v0.2 eliminates the client binary for hook handling. Claude Code's native HTTP hooks POST events directly to the ClawLens server. Distribution shifts from platform-specific install scripts to a Claude Code plugin (Tier 1) with optional managed settings enforcement (Tier 2/3).

**Tech Stack:**
- Server: Go 1.23+ (existing, modified)
- Database: SQLite via modernc.org/sqlite (existing)
- Dashboard: React (existing, modified)
- Client: Claude Code plugin (new) + enforcement scripts (new)
- Hooks: HTTP type (`type: "http"`) for most events + command type for SessionStart, CwdChanged, FileChanged (Claude Code limitation)
- Plugin scripts: Small shell script bundled with plugin for command-only hooks

---

## Deployment Tiers

### Tier 1: Standard (Plugin Only)

**Install:** `claude plugin install clawlens@howincodes`
**Admin access:** None required
**Enforcement:** Detection only (dead man's switch, integrity hash)
**Kill switch:** Block prompts via HTTP hook response
**Best for:** Startups, trust-based teams

Plugin registers 11 hooks (8 HTTP + 3 command). Most events POST directly to the ClawLens server via HTTP hooks. Three events (SessionStart, FileChanged, CwdChanged) use command hooks with a bundled shell script because Claude Code only supports `type: "command"` for these events. User enters server URL and auth token during plugin enable. Token stored in system keychain.

Users CAN disable by uninstalling the plugin or setting `disableAllHooks: true`. Dead man's switch detects this.

### Tier 2: Enforced (Managed Hooks + Watchdog)

**Install:** Tier 1 plugin + admin runs `enforce.sh` once per machine (sudo)
**Admin access:** One-time per machine
**Enforcement:** `allowManagedHooksOnly: true` + watchdog daemon
**Kill switch:** Block prompts + hooks cannot be disabled by user
**Best for:** Teams needing compliance

Admin deploys `managed-settings.d/10-clawlens.json` with all 11 hooks and `allowManagedHooksOnly: true`. This blocks all user/project/plugin hooks — only managed hooks run. Plugin remains installed for the `/clawlens-status` skill but its hooks are inactive (no duplicates).

Watchdog daemon (launchd/systemd/Task Scheduler) runs every 5 minutes:
- Verifies managed settings file exists
- Checks SHA256 hash against expected value
- Restores from backup if tampered
- Verifies file permissions (root-owned, 644)

Users CANNOT disable hooks without admin/root access. Tampering is auto-repaired by watchdog.

### Tier 3: Locked (Managed + Auth Gate + Watchdog)

**Install:** Admin runs `enforce.sh --tier3` once per machine (sudo)
**Admin access:** One-time per machine
**Enforcement:** All of Tier 2 + auth credential revocation on kill
**Kill switch:** `claude auth logout` — Claude Code becomes completely unusable
**Best for:** High-security teams, enterprises

Same as Tier 2 plus a command hook gate script for SessionStart. When server returns `status: "killed"`, the gate script runs `claude auth logout` (detached process), removing Claude Code auth credentials entirely. User must re-authenticate, which admin controls.

Ported from claude-code-limiter project at `~/Documents/Howin/claudelimiter`.

**Verified:** `managed-settings.json`, `managed-settings.d/`, and `allowManagedHooksOnly: true` all work on Claude Max subscription (not Enterprise-gated). Tested 2026-03-28.

---

## Plugin Structure

```
howincodes/claude-plugins/          ← GitHub marketplace repo
├── marketplace.json
└── clawlens/
    ├── .claude-plugin/
    │   └── plugin.json
    ├── hooks/
    │   └── hooks.json
    ├── scripts/
    │   └── clawlens-hook.sh        ← command hook handler (SessionStart, FileChanged)
    └── skills/
        └── clawlens-status/
            └── SKILL.md
```

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
        "timeout": 5
      }]
    }],
    "PreToolUse": [{
      "hooks": [{
        "type": "http",
        "url": "${user_config.server_url}/api/v1/hook/pre-tool",
        "headers": {"Authorization": "Bearer ${user_config.auth_token}"},
        "timeout": 2
      }]
    }],
    "Stop": [{
      "hooks": [{
        "type": "http",
        "url": "${user_config.server_url}/api/v1/hook/stop",
        "headers": {"Authorization": "Bearer ${user_config.auth_token}"},
        "timeout": 5
      }]
    }],
    "StopFailure": [{
      "hooks": [{
        "type": "http",
        "url": "${user_config.server_url}/api/v1/hook/stop-error",
        "headers": {"Authorization": "Bearer ${user_config.auth_token}"},
        "timeout": 2,
        "async": true
      }]
    }],
    "SessionEnd": [{
      "hooks": [{
        "type": "http",
        "url": "${user_config.server_url}/api/v1/hook/session-end",
        "headers": {"Authorization": "Bearer ${user_config.auth_token}"},
        "timeout": 3,
        "async": true
      }]
    }],
    "PostToolUse": [{
      "hooks": [{
        "type": "http",
        "url": "${user_config.server_url}/api/v1/hook/post-tool",
        "headers": {"Authorization": "Bearer ${user_config.auth_token}"},
        "timeout": 3,
        "async": true
      }]
    }],
    "SubagentStart": [{
      "hooks": [{
        "type": "http",
        "url": "${user_config.server_url}/api/v1/hook/subagent-start",
        "headers": {"Authorization": "Bearer ${user_config.auth_token}"},
        "timeout": 2,
        "async": true
      }]
    }],
    "PostToolUseFailure": [{
      "hooks": [{
        "type": "http",
        "url": "${user_config.server_url}/api/v1/hook/post-tool-failure",
        "headers": {"Authorization": "Bearer ${user_config.auth_token}"},
        "timeout": 2,
        "async": true
      }]
    }],
    "ConfigChange": [{
      "hooks": [{
        "type": "http",
        "url": "${user_config.server_url}/api/v1/hook/config-change",
        "headers": {"Authorization": "Bearer ${user_config.auth_token}"},
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

Command hooks (command-only events): SessionStart, FileChanged — use bundled `clawlens-hook.sh` script
HTTP sync hooks (can block): UserPromptSubmit, PreToolUse, Stop, ConfigChange
HTTP async hooks (fire-and-forget): StopFailure, SessionEnd, PostToolUse, SubagentStart, PostToolUseFailure

**Verified 2026-03-28:** HTTP hooks confirmed working for UserPromptSubmit and Stop. SessionStart confirmed command-only (debug log: "HTTP hooks are not supported for SessionStart"). `${user_config.*}` substitution in HTTP hook URLs/headers needs verification via marketplace install (--plugin-dir skips userConfig prompt). Fallback: env vars `$CLAUDE_PLUGIN_OPTION_SERVER_URL` and `$CLAUDE_PLUGIN_OPTION_AUTH_TOKEN`.

### /clawlens-status Skill

Invoked by user typing `/clawlens-status` in Claude Code. Displays connection status, credit usage, hook registration count, and last sync time. Implementation uses WebFetch to query the server's health and user status endpoints.

---

## Installation Flows

### Tier 1: Developer Install

**Admin creates user:**
1. Dashboard → Users → Add User
2. Enters name, email, subscription type
3. Server generates auth token (format: `clwt_<username>_<random>`)
4. Dashboard displays install instructions with token (shown once)

**Developer installs:**
```
Step 1: Add marketplace (one-time per machine)
  claude /plugin marketplace add --source github --repo howincodes/claude-plugins

Step 2: Install plugin
  claude plugin install clawlens

Step 3: Enter credentials when prompted
  Server URL: https://clawlens.howincloud.com
  Auth Token: clwt_krishna_a8f3k2m9x7
```

No sudo. No binary download. No PATH configuration. 30 seconds.

### Tier 2: Admin Enforces

After Tier 1 install, admin runs once per machine:

```bash
curl -fsSL https://raw.githubusercontent.com/howincodes/clawlens/main/scripts/enforce.sh | sudo bash
```

The script:
1. Prompts for server URL and auth token
2. Creates `managed-settings.d/10-clawlens.json` with all 11 hooks + `allowManagedHooksOnly: true`
3. Installs watchdog daemon (platform-specific)
4. Saves SHA256 hash for tamper detection
5. Verifies hooks are active

### Tier 3: Admin Enforces with Auth Gate

```bash
curl -fsSL https://raw.githubusercontent.com/howincodes/clawlens/main/scripts/enforce.sh | sudo bash -s -- --tier3
```

Same as Tier 2 plus:
1. Installs gate script at a platform-specific path
2. SessionStart hook uses command type (not HTTP) to run the gate script
3. Gate script calls server API, checks status, runs `claude auth logout` if killed

### Uninstall / Restore

```bash
# Tier 1: Developer removes plugin
claude plugin uninstall clawlens

# Tier 2/3: Admin removes enforcement
curl -fsSL https://raw.githubusercontent.com/howincodes/clawlens/main/scripts/restore.sh | sudo bash
```

`restore.sh`:
1. Removes `managed-settings.d/10-clawlens.json`
2. Removes watchdog daemon (launchd/systemd/Task Scheduler)
3. Removes gate script (Tier 3)
4. Optionally removes plugin
5. Prints confirmation

Windows equivalents: `enforce.ps1`, `restore.ps1`

---

## Server API — New Hook Endpoints

All endpoints receive Claude Code's native hook JSON as POST body. Auth via `Authorization: Bearer <token>` header.

### POST /api/v1/hook/session-start

**Input:** Claude Code SessionStart JSON (`session_id`, `source`, `model`, `cwd`, `transcript_path`)

**Server logic:**
1. Validate auth token → look up user
2. Check user status (active/paused/killed)
3. If killed → return `{"continue": false, "stopReason": "Account suspended by admin."}`
4. If paused → return `{"continue": false, "stopReason": "Account paused by admin."}`
5. Create/update session record in DB
6. Update `users.last_event_at` (dead man's switch)
7. Compute hook integrity hash from request metadata
8. Return `200 OK` with optional `additionalContext`

### POST /api/v1/hook/prompt

**Input:** Claude Code UserPromptSubmit JSON (`session_id`, `prompt`, `cwd`, `permission_mode`)

**Server logic:**
1. Validate auth token → look up user
2. Check user status → block if killed/paused
3. Detect model (from session cache or default)
4. Compute credit cost (opus=10, sonnet=3, haiku=1)
5. Check rate limits:
   - Total credits (daily budget)
   - Per-model caps
   - Time-of-day restrictions
6. If over limit → return `{"decision": "block", "reason": "Credit limit reached (150/150)."}`
7. Record prompt in DB (apply secret scrubbing based on user settings)
8. Update `users.last_event_at`
9. Return `200 OK` (empty body = allowed)

### POST /api/v1/hook/pre-tool

**Input:** Claude Code PreToolUse JSON (`session_id`, `tool_name`, `tool_input`)

**Server logic:**
1. Validate auth token → check user status
2. If killed/paused → return `{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "Account suspended."}}`
3. Record tool event (async, don't block)
4. Return `200 OK`

### POST /api/v1/hook/stop

**Input:** Claude Code Stop JSON (`session_id`, `stop_hook_active`, `last_assistant_message`)

**Server logic:**
1. Validate auth token
2. Extract response text from `last_assistant_message`
3. Detect model, compute credit cost
4. Update prompt record with response + credit cost
5. Update session stats
6. Update `users.last_event_at`
7. Return `200 OK`

### POST /api/v1/hook/stop-error

**Input:** Claude Code StopFailure JSON (`session_id`, `error`, `error_details`)

**Server logic:**
1. Validate auth token
2. Record error event (type, details)
3. Create alert if recurring
4. Return `200 OK`

### POST /api/v1/hook/session-end

**Input:** Claude Code SessionEnd JSON (`session_id`, `reason`)

**Server logic:**
1. Validate auth token
2. Update session end time and reason
3. Return `200 OK`

### POST /api/v1/hook/post-tool

**Input:** Claude Code PostToolUse JSON (`session_id`, `tool_name`, `tool_input`, `tool_response`)

**Server logic:**
1. Validate auth token
2. Record tool usage (tool name, input summary, response summary)
3. Update `users.last_event_at`
4. Return `200 OK`

### POST /api/v1/hook/subagent-start

**Input:** Claude Code SubagentStart JSON (`session_id`, `agent_id`, `agent_type`)

**Server logic:**
1. Validate auth token
2. Record subagent spawn event
3. Return `200 OK`

### POST /api/v1/hook/post-tool-failure

**Input:** Claude Code PostToolUseFailure JSON (`session_id`, `tool_name`, `error`)

**Server logic:**
1. Validate auth token
2. Record tool failure event
3. Return `200 OK`

### POST /api/v1/hook/config-change

**Input:** Claude Code ConfigChange JSON (`session_id`, `source`, `file_path`)

**Server logic:**
1. Validate auth token
2. Record config change event
3. If source involves settings files → create tamper alert
4. Return `200 OK`

### POST /api/v1/hook/file-changed

**Input:** Claude Code FileChanged JSON (`session_id`, `file_path`, `event`)

**Server logic:**
1. Validate auth token
2. Record file change event
3. If settings.json modified → correlate with ConfigChange for tamper detection
4. Return `200 OK`

---

## Tamper Detection System

### Dead Man's Switch

Server background job runs every 5 minutes:
1. For each active user, check `last_event_at`
2. Compare against team's configured threshold (default: 8 hours during work hours)
3. If exceeded → create tamper alert with type `"inactive"`
4. Dashboard shows user as inactive

Threshold is configurable per team in admin settings. Supports work-hour awareness (don't alert at night/weekends if configured).

### Hook Integrity Hash

On each SessionStart:
1. Server computes expected hook configuration hash for the user's tier
2. Compare with metadata from the request (Claude Code version, hook count)
3. If mismatch → create tamper alert with type `"hooks_modified"`
4. Dashboard shows user as tampered

### ConfigChange Monitor

When ConfigChange hook fires:
1. Server records which settings file changed and when
2. If the change involves hook configuration → create tamper alert
3. Real-time detection during active sessions

### FileChanged Monitor

When FileChanged hook fires (watching `settings.json`):
1. Server records file modification event
2. Correlates with ConfigChange events for redundancy
3. Detects external modifications (scripts, manual edits outside Claude Code)

### Tamper Alert Dashboard

New section in dashboard showing:
- User status: Active / Inactive / Tampered / Killed / Paused
- Last event timestamp
- Hook integrity status (OK / Modified / Unknown)
- Alert history with timestamps and types
- Per-team threshold configuration

---

## Kill Switch

### Tier 1 Kill (HTTP response)

Admin clicks "Suspend" → server sets `user.status = "killed"`:
- SessionStart → `{"continue": false, "stopReason": "Account suspended by admin."}`
- UserPromptSubmit → `{"decision": "block", "reason": "Account suspended."}`
- PreToolUse → `{"hookSpecificOutput": {"permissionDecision": "deny"}}`

Three blocking layers. User sees the message but can still bypass by removing plugin.

### Tier 2 Kill (Managed hooks, can't remove)

Same as Tier 1 but hooks are in managed settings with `allowManagedHooksOnly: true`. User cannot remove or disable hooks without admin access. Watchdog restores if tampered.

### Tier 3 Kill (Auth credential revocation)

Same as Tier 2 plus the gate script runs `claude auth logout`:
```bash
claude auth logout  # spawned as detached process
```
This removes Claude Code's auth credentials. Claude Code becomes completely unusable until re-authenticated. Admin controls re-authentication.

Ported from claude-code-limiter's `triggerLogout()` function.

---

## Tier 3 Gate Script

Installed at platform-specific path by `enforce.sh --tier3`.

**macOS/Linux:** `/Library/Application Support/ClaudeCode/clawlens-gate.sh` or `/etc/claude-code/clawlens-gate.sh`

```bash
#!/bin/bash
# ClawLens session gate — checks status, enforces kill switch
INPUT=$(cat)

RESP=$(curl -sf -m 5 -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CLAWLENS_TOKEN" \
  -d "$INPUT" \
  "$CLAWLENS_SERVER/api/v1/hook/session-start" 2>/dev/null)

STATUS=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('user_status','active'))" 2>/dev/null)

if [ "$STATUS" = "killed" ]; then
  claude auth logout >/dev/null 2>&1 &
  echo '{"continue": false, "stopReason": "Access revoked by admin. Contact your team lead."}'
  exit 0
fi

if [ "$STATUS" = "paused" ]; then
  echo '{"continue": false, "stopReason": "Access paused by admin. Contact your team lead."}'
  exit 0
fi

echo "$RESP"
```

For Tier 3, the SessionStart hook in managed settings uses `type: "command"` pointing to this script instead of `type: "http"`. All other hooks remain HTTP type.

---

## Watchdog Daemon

Installed by `enforce.sh` for Tier 2/3. Auto-repairs tampered managed settings files.

### macOS (LaunchDaemon)

Plist at `/Library/LaunchDaemons/com.clawlens.watchdog.plist`:
- Runs every 300 seconds (5 minutes)
- Executes watchdog script that checks file existence, hash, permissions
- Restores from backup if tampered
- Logs to `/var/log/clawlens-watchdog.log`

### Linux (systemd timer)

Timer at `/etc/systemd/system/clawlens-watchdog.timer`:
- Runs every 5 minutes
- Triggers `clawlens-watchdog.service`
- Same verification and restoration logic

### Windows (Task Scheduler)

Scheduled task `ClawLens Watchdog`:
- Runs every 5 minutes
- Executes PowerShell watchdog script
- Same verification and restoration logic

---

## Enforcement Scripts

### enforce.sh (macOS/Linux)

```
Usage: sudo bash enforce.sh [--tier2|--tier3]
  --tier2   Managed hooks + watchdog (default)
  --tier3   Managed hooks + watchdog + auth gate script

Prompts for:
  - Server URL
  - Auth token

Creates:
  - managed-settings.d/10-clawlens.json (hooks + allowManagedHooksOnly)
  - Watchdog daemon (launchd or systemd)
  - [Tier 3] Gate script
  - Backup hash file for tamper detection
```

### enforce.ps1 (Windows)

PowerShell equivalent requiring elevated (Administrator) prompt.

### restore.sh (macOS/Linux)

```
Usage: sudo bash restore.sh

Removes:
  - managed-settings.d/10-clawlens.json
  - Watchdog daemon
  - Gate script (if Tier 3)
  - Backup hash file
  - Optionally: claude plugin uninstall clawlens
```

### restore.ps1 (Windows)

PowerShell equivalent requiring elevated prompt.

---

## Database Changes

### New Tables

```sql
CREATE TABLE IF NOT EXISTS tamper_alerts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL REFERENCES users(id),
  alert_type  TEXT NOT NULL,  -- "inactive", "hooks_modified", "config_changed", "file_changed"
  details     TEXT,
  resolved    BOOLEAN DEFAULT FALSE,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME
);

CREATE TABLE IF NOT EXISTS hook_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL,
  session_id  TEXT,
  event_type  TEXT NOT NULL,  -- "session_start", "prompt", "pre_tool", "stop", etc.
  payload     TEXT,           -- raw JSON from Claude Code
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_hook_events_user ON hook_events(user_id, created_at);

CREATE TABLE IF NOT EXISTS tool_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL,
  session_id  TEXT,
  tool_name   TEXT NOT NULL,
  tool_input  TEXT,
  tool_output TEXT,
  success     BOOLEAN,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_tool_events_user ON tool_events(user_id, created_at);

CREATE TABLE IF NOT EXISTS subagent_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL,
  session_id  TEXT,
  agent_id    TEXT,
  agent_type  TEXT,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

### Modified Tables

```sql
-- Add to users table
ALTER TABLE users ADD COLUMN last_event_at DATETIME;
ALTER TABLE users ADD COLUMN hook_integrity_hash TEXT;
ALTER TABLE users ADD COLUMN deployment_tier TEXT DEFAULT 'standard'; -- standard, enforced, locked
```

---

## Migration Path (v0.1 → v0.2)

### Server Migration

1. Update server binary (new hook endpoints + new tables)
2. Run DB migration (new tables, altered columns)
3. Rebuild and deploy dashboard
4. Existing admin API endpoints unchanged

### Per-Developer Migration

1. Remove old v0.1 installation:
   ```bash
   rm -rf ~/.clawlens
   sudo rm -f "/Library/Application Support/ClaudeCode/managed-settings.json"
   sudo rm -f /etc/claude-code/managed-settings.json
   sudo rm -f /usr/local/bin/clawlens
   ```
2. Install plugin:
   ```bash
   claude /plugin marketplace add --source github --repo howincodes/claude-plugins
   claude plugin install clawlens
   ```
3. Enter server URL + new auth token (admin generates in dashboard)
4. [Tier 2/3] Admin runs `enforce.sh` on the machine

### Token Migration

v0.1 used install codes exchanged for tokens via `/api/v1/register`. v0.2 generates tokens directly in the dashboard. Existing tokens can be preserved — server recognizes both formats. The `/api/v1/register` endpoint remains for backwards compatibility but is no longer the primary flow.

---

## What Changes From v0.1

### Removed

| Component | Why |
|---|---|
| Client Go binary (hook handlers) | HTTP hooks bypass local binary |
| `internal/client/hook.go` | Not needed — server handles all logic |
| `internal/client/model.go` | Claude Code sends model natively |
| `internal/client/queue.go` + `sync.go` | No local queue — direct HTTP |
| `scripts/install-client.sh` | Replaced by plugin install |
| `scripts/install-client.ps1` | Replaced by plugin install |
| Platform-specific binary builds (6 targets) | No binary to build |

### Modified

| Component | Change |
|---|---|
| Server hook routes | New HTTP hook endpoints (parse Claude Code native JSON) |
| Server store | New tables (tamper_alerts, hook_events, tool_events, subagent_events) |
| Server analytics | More data sources (PostToolUse, SubagentStart, etc.) |
| Dashboard | Tamper alerts panel, user status indicators, Tier display |
| Dashboard Add User modal | Shows plugin install instructions + auth token |

### Added

| Component | Purpose |
|---|---|
| Plugin package | Claude Code plugin (hooks.json, plugin.json, skill) |
| Plugin marketplace repo | GitHub repo hosting the plugin |
| `scripts/enforce.sh` | Tier 2/3 managed settings installer |
| `scripts/enforce.ps1` | Windows equivalent |
| `scripts/restore.sh` | Clean uninstall for all tiers |
| `scripts/restore.ps1` | Windows equivalent |
| Watchdog daemon configs | launchd plist, systemd timer, Task Scheduler XML |
| Gate script (Tier 3) | SessionStart auth gate with `claude auth logout` |
| Dead man's switch job | Server background job checking user activity |

---

## Risks and Mitigations

### Risk: `${user_config.server_url}` substitution may not work in HTTP hook URLs

Plugin variable substitution is documented for "hook commands" and "MCP/LSP configs" but not explicitly for HTTP hook URL fields. `--plugin-dir` skips userConfig prompts so this couldn't be tested locally.

**Mitigation:** Test via marketplace install early in implementation. Fallbacks:
- Option A: Environment variable `$CLAUDE_PLUGIN_OPTION_SERVER_URL` in URL field (these are auto-exported by Claude Code from userConfig)
- Option B: Use command hooks with curl for all events (works but loses native HTTP hook error handling)
- Option C: Hardcode server URL in plugin (one plugin build per deployment)

### Risk: SessionStart, CwdChanged, FileChanged only support command hooks

**Confirmed 2026-03-28.** Debug log showed: "HTTP hooks are not supported for SessionStart". These events require `type: "command"`.

**Mitigation:** Plugin bundles `scripts/clawlens-hook.sh` that reads stdin JSON, calls server via curl, and outputs the response. Environment variables from userConfig (`CLAUDE_PLUGIN_OPTION_*`) are available in command hook subprocesses.

### Risk: HTTP hooks fail-open when server is unreachable

Claude Code allows all actions when HTTP hooks timeout or fail.

**Mitigation:** Acceptable for Tier 1/2 (detection catches offline abuse). Tier 3's gate script can fail-closed (block if server unreachable) since it's a command hook with custom logic.

### Risk: Claude Code plugin system changes

Plugin API is relatively new and may change between Claude Code versions.

**Mitigation:** Pin to known working Claude Code versions. Plugin marketplace allows version-specific distributions. Managed settings (Tier 2/3) don't depend on plugin system.

### Risk: `claude auth logout` behavior changes

Tier 3 depends on this command existing and working.

**Mitigation:** Already used in production by claude-code-limiter. If it changes, the command hook can adapt. Tier 2 remains functional without it.
