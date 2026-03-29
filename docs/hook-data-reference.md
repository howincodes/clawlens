# ClawLens Hook Data Reference

Complete reference of all data flowing between Claude Code, the ClawLens client, and the ClawLens server.

---

## Data Flow

```
Claude Code                  ClawLens Client              ClawLens Server
(fires hook)                 (clawlens.mjs)               (hook-api.ts)

  stdin JSON ───────────────►  enrich (SessionStart)  ───► POST /api/v1/hook/<event>
                               pass-through (others)       │
                                                           ├─ auth: Bearer token → user lookup
                                                           ├─ zod parse
                                                           ├─ business logic (limits, kill switch)
  stdout JSON ◄──────────────  forward response  ◄────────┘  response JSON
```

---

## Common Base Fields

Every hook event from Claude Code includes these fields:

| Field | Type | Example | Notes |
|---|---|---|---|
| `session_id` | string | `"9feb4e57-cbae-4692-a21f-e132b7de8e23"` | UUID, same for entire session |
| `transcript_path` | string? | `"C:\\Users\\Basha\\.claude\\projects\\...\\9feb4e57.jsonl"` | Path to session transcript |
| `cwd` | string? | `"C:\\Users\\Basha"` | Working directory |
| `permission_mode` | string? | `"default"` | Claude Code permission mode |
| `hook_event_name` | string | `"SessionStart"` | Event type identifier |

---

## Event: SessionStart

**When:** Claude Code session begins.
**Sync:** Yes. **Can block:** Yes (`continue: false`).

### Claude Code sends (stdin):

```json
{
  "session_id": "9feb4e57-cbae-4692-a21f-e132b7de8e23",
  "transcript_path": "C:\\Users\\Basha\\.claude\\projects\\...\\9feb4e57.jsonl",
  "cwd": "C:\\Users\\Basha",
  "hook_event_name": "SessionStart",
  "source": "startup",
  "model": "claude-opus-4-6[1m]"
}
```

| Field | Type | Notes |
|---|---|---|
| `source` | string? | `"startup"` |
| `model` | string? | Raw model ID, e.g. `"claude-opus-4-6[1m]"` |

### Client enriches and sends to server:

```json
{
  "session_id": "9feb4e57-...",
  "transcript_path": "...",
  "cwd": "C:\\Users\\Basha",
  "hook_event_name": "SessionStart",
  "source": "startup",
  "model": "opus",
  "detected_model": "opus",
  "subscription_email": "eatiko.hc@gmail.com",
  "subscription_type": "max",
  "org_name": "eatiko.hc@gmail.com's Organization",
  "hostname": "WIN-02K9JROATFS",
  "platform": "win32",
  "os_version": "10.0.26100",
  "node_version": "v22.22.2"
}
```

| Field | Type | Source | Notes |
|---|---|---|---|
| `model` | string | Overwritten by client | Normalized: `"opus"`, `"sonnet"`, `"haiku"` |
| `detected_model` | string | Client detection chain | Same as `model` |
| `subscription_email` | string | `claude auth status` or `~/.claude.json` | Cached 5 min |
| `subscription_type` | string | `claude auth status` | `"max"`, `"pro"`, `"team"`, etc. |
| `org_name` | string | `claude auth status` | Organization name |
| `hostname` | string | `os.hostname()` | Machine hostname |
| `platform` | string | `os.platform()` | `"win32"`, `"darwin"`, `"linux"` |
| `os_version` | string | `os.release()` | OS kernel version |
| `node_version` | string | `process.version` | `"v22.22.2"` |

### Server stores:

- Creates **session** row: `id`, `user_id`, `model`, `cwd`
- Updates **user** row: `email` (if empty), `default_model` (if changed)
- Creates/updates **subscription** row: `email`, `subscription_type`, `plan_name`
- Records **hook_event** row: full payload as JSON
- Updates `last_event_at` on user

### Server responds:

```json
{}
```

Or if user is killed/paused:

```json
{
  "continue": false,
  "stopReason": "Account suspended by admin. Contact your team lead."
}
```

---

## Event: UserPromptSubmit

**When:** User submits a prompt.
**Sync:** Yes. **Can block:** Yes (`decision: "block"`).

### Claude Code sends (stdin):

```json
{
  "session_id": "9feb4e57-...",
  "transcript_path": "...",
  "cwd": "C:\\Users\\Basha",
  "permission_mode": "default",
  "hook_event_name": "UserPromptSubmit",
  "prompt": "Hey"
}
```

| Field | Type | Notes |
|---|---|---|
| `prompt` | string? | The user's prompt text |

### Client sends to server (pass-through, no enrichment):

Same as stdin.

### Server stores:

- Records **prompt** row: `session_id`, `user_id`, `prompt`, `model`, `credit_cost`, `blocked`, `block_reason`
- Increments session `prompt_count` and `total_credits`
- Records **hook_event** row

### Server responds:

```json
{}
```

Or if blocked (rate limit / kill switch):

```json
{
  "decision": "block",
  "reason": "Credit limit reached. daily usage: 150/100"
}
```

### Credit costs:

| Model | Cost |
|---|---|
| opus | 10 |
| sonnet | 3 |
| haiku | 1 |

---

## Event: Stop

**When:** Claude Code finishes generating a response.
**Sync:** Yes. **Can block:** No.

### Claude Code sends (stdin):

```json
{
  "session_id": "9feb4e57-...",
  "transcript_path": "...",
  "cwd": "C:\\Users\\Basha",
  "permission_mode": "default",
  "hook_event_name": "Stop",
  "stop_hook_active": false,
  "last_assistant_message": "Hey! How can I help you today?"
}
```

| Field | Type | Notes |
|---|---|---|
| `stop_hook_active` | boolean? | Whether stop hook is active |
| `last_assistant_message` | string? | The AI's response text |

### Server stores:

- Updates most recent **prompt** row with `response` and `model` (does NOT re-charge credits)
- Records **hook_event** row

### Server responds:

```json
{}
```

---

## Event: SessionEnd

**When:** Claude Code session ends.
**Sync:** No (async). **Can block:** No.

### Claude Code sends (stdin):

```json
{
  "session_id": "9feb4e57-...",
  "transcript_path": "...",
  "cwd": "C:\\Users\\Basha",
  "hook_event_name": "SessionEnd",
  "reason": "prompt_input_exit"
}
```

| Field | Type | Notes |
|---|---|---|
| `reason` | string? | `"prompt_input_exit"`, `"unknown"`, etc. |

### Server stores:

- Ends **session** row (sets `ended_at`, `end_reason`)
- Records **hook_event** row

### Server responds:

```json
{}
```

---

## Event: PreToolUse

**When:** Before Claude Code executes a tool (Read, Edit, Bash, etc.).
**Sync:** Yes (but configured async in default install). **Can block:** Yes (`permissionDecision: "deny"`).

### Claude Code sends (stdin):

```json
{
  "session_id": "...",
  "hook_event_name": "PreToolUse",
  "tool_name": "Edit",
  "tool_input": { "file_path": "/path/to/file", "old_string": "...", "new_string": "..." }
}
```

| Field | Type | Notes |
|---|---|---|
| `tool_name` | string | `"Edit"`, `"Read"`, `"Bash"`, `"Write"`, `"Glob"`, `"Grep"`, etc. |
| `tool_input` | object? | Tool-specific input (truncated to 500 chars in DB) |

### Server stores:

- Records **tool_event** row: `tool_name`, `tool_input`
- Records **hook_event** row

### Server responds:

```json
{}
```

Or if user is killed/paused:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Account suspended."
  }
}
```

---

## Event: PostToolUse

**When:** After a tool completes successfully.
**Sync:** No (async). **Can block:** No.

### Claude Code sends (stdin):

```json
{
  "session_id": "...",
  "hook_event_name": "PostToolUse",
  "tool_name": "Read",
  "tool_input": { "file_path": "/path/to/file" },
  "tool_response": "file contents..."
}
```

| Field | Type | Notes |
|---|---|---|
| `tool_name` | string | Same tool names as PreToolUse |
| `tool_input` | object? | Same as PreToolUse |
| `tool_response` | any? | Tool output (truncated to 500 chars in DB) |

### Server stores:

- Records **tool_event** row: `tool_name`, `tool_input`, `tool_output`, `success=true`

---

## Event: PostToolUseFailure

**When:** After a tool fails.
**Sync:** No (async). **Can block:** No.

### Claude Code sends (stdin):

```json
{
  "session_id": "...",
  "hook_event_name": "PostToolUseFailure",
  "tool_name": "Bash",
  "error": "command not found: xyz"
}
```

| Field | Type | Notes |
|---|---|---|
| `tool_name` | string | Tool that failed |
| `error` | string? | Error message (truncated to 500 chars in DB) |
| `error_details` | any? | Additional error context |

### Server stores:

- Records **tool_event** row: `tool_name`, `tool_output=error`, `success=false`

---

## Event: StopFailure

**When:** Claude Code API call fails.
**Sync:** No (async). **Can block:** No.

### Claude Code sends (stdin):

```json
{
  "session_id": "...",
  "hook_event_name": "StopFailure",
  "error": "API error message",
  "error_details": { ... }
}
```

| Field | Type | Notes |
|---|---|---|
| `error` | string? | Error message |
| `error_details` | any? | Additional error context |

### Server stores:

- Records **hook_event** row with error details in payload

---

## Event: SubagentStart

**When:** A subagent is spawned (Agent tool).
**Sync:** No (async). **Can block:** No.

### Claude Code sends (stdin):

```json
{
  "session_id": "...",
  "hook_event_name": "SubagentStart",
  "agent_id": "...",
  "agent_type": "general-purpose"
}
```

| Field | Type | Notes |
|---|---|---|
| `agent_id` | string? | Subagent identifier |
| `agent_type` | string? | `"general-purpose"`, `"Explore"`, `"Plan"`, etc. |

### Server stores:

- Records **subagent_event** row: `agent_id`, `agent_type`

---

## Event: ConfigChange

**When:** Claude Code settings change during a session.
**Sync:** Yes. **Can block:** No.

### Claude Code sends (stdin):

```json
{
  "session_id": "...",
  "hook_event_name": "ConfigChange",
  "source": "user_settings",
  "file_path": "C:\\Users\\Basha\\.claude\\settings.json"
}
```

| Field | Type | Notes |
|---|---|---|
| `source` | string? | `"user_settings"`, etc. |
| `file_path` | string? | Path to changed config file |

### Server stores:

- Records **hook_event** row
- Creates **tamper_alert** if source contains `"settings"`

---

## Event: FileChanged

**When:** A watched file is modified (settings.json).
**Sync:** Yes. **Can block:** No.

### Claude Code sends (stdin):

```json
{
  "session_id": "...",
  "hook_event_name": "FileChanged",
  "file_path": "settings.json",
  "event": "modified"
}
```

| Field | Type | Notes |
|---|---|---|
| `file_path` | string? | Relative path of changed file |
| `event` | string? | `"modified"`, `"created"`, `"deleted"` |

### Server stores:

- Records **hook_event** row
- Creates **tamper_alert**: `file_changed`

---

## Client Model Detection Chain

The client detects the active model using this priority (first match wins):

| Priority | Source | Example |
|---|---|---|
| 1 | Hook stdin JSON `model` field | `"claude-opus-4-6[1m]"` (SessionStart only) |
| 2 | `~/.claude/settings.json` → `model` key | Set by `/model` command |
| 2b | Settings exists but no `model` key | User chose plan default → use subscription type |
| 3 | `.claude/settings.local.json` → `model` | Project-local override |
| 4 | `.claude/settings.json` (project) → `model` | Project settings |
| 5 | `~/.claude/hooks/.clawlens-model.txt` | Cached from last SessionStart |
| 6 | `ANTHROPIC_MODEL` env var | Environment override |
| 7 | `CLAUDE_MODEL` env var | Environment override |
| 8 | Plan default | Max → `opus`, Pro/Team → `sonnet` |
| 9 | Ultimate fallback | `"sonnet"` |

**Normalization:** Any string containing `"opus"` → `"opus"`, `"sonnet"` → `"sonnet"`, `"haiku"` → `"haiku"`.

---

## Client Subscription Info

Fetched on SessionStart, cached for 5 minutes at `~/.claude/hooks/.clawlens-cache.json`.

| Method | Source | Speed |
|---|---|---|
| 1 | `claude auth status` (exec) | ~300-1300ms |
| 2 | `~/.claude.json` → `oauthAccount` (file read) | instant |

### `claude auth status` output:

```json
{
  "loggedIn": true,
  "authMethod": "claude.ai",
  "apiProvider": "firstParty",
  "email": "eatiko.hc@gmail.com",
  "orgId": "7cfa947c-6dec-4e1a-87b6-66cde8f16a07",
  "orgName": "eatiko.hc@gmail.com's Organization",
  "subscriptionType": "max"
}
```

---

## Server Auth

Every request to `/api/v1/hook/*` requires:

```
Authorization: Bearer <auth_token>
```

Token format: `clwt_<username>_<random>` (e.g. `clwt_tstwinc_abc123...`)

Server does: `getUserByToken(token)` → user row → `getTeamById(user.team_id)` → team row.

Killed/paused users are still authenticated (so kill switch responses can be returned).

---

## Database Tables Written By Hooks

| Table | Written by | Key fields |
|---|---|---|
| `sessions` | SessionStart, ensureSession | `id`, `user_id`, `model`, `cwd`, `ended_at`, `end_reason` |
| `prompts` | UserPromptSubmit, Stop | `session_id`, `user_id`, `prompt`, `response`, `model`, `credit_cost`, `blocked` |
| `hook_events` | All events | `user_id`, `session_id`, `event_type`, `payload` (full JSON) |
| `tool_events` | PreToolUse, PostToolUse, PostToolUseFailure | `user_id`, `session_id`, `tool_name`, `tool_input`, `tool_output`, `success` |
| `subagent_events` | SubagentStart | `user_id`, `session_id`, `agent_id`, `agent_type` |
| `subscriptions` | SessionStart | `email`, `subscription_type`, `plan_name` |
| `tamper_alerts` | ConfigChange, FileChanged | `user_id`, `alert_type`, `details` |
| `users` | SessionStart (update only) | `email`, `default_model`, `subscription_id`, `last_event_at` |

---

## Debug Logging

Enable with `CLAWLENS_DEBUG=1` environment variable.

**Client:** Logs to stderr + `~/.claude/hooks/.clawlens-debug.log`
**Server:** Logs to console with `[hook-auth]` and `[hook-api]` prefixes
