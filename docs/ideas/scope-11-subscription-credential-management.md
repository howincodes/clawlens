# Scope 11: Subscription & Credential Management — Raw Ideas

## Core Problem
- 3 Claude subscription emails shared across 6-8 developers
- No tracking of which email is near its limit
- Manual login/logout process: physically share auth links between machines
- No way to prevent usage outside office hours
- No analytics on subscription efficiency
- VS Code plugin sessions sometimes don't fire hooks consistently

## Architecture: Server is the Authority

### Server Holds All Credentials
- All 3 (or more) subscription OAuth credentials stored on server
- Server manages: accessToken, refreshToken, expiresAt per subscription
- Client is just a delivery mechanism — writes/deletes credentials on local machine
- Client never stores credentials permanently

### Credential Lifecycle
1. Dev punches in (On Watch) → client requests credentials from server
2. Server picks best subscription (least used) → sends credentials to client
3. Client writes to macOS Keychain / Linux libsecret / Windows Credential Manager + ~/.claude/.credentials.json
4. Dev works normally — Claude Code uses the credentials
5. Dev punches out (Off Watch) → client deletes credentials → runs `claude auth logout`
6. Outside office hours → no credentials on machine → Claude doesn't work

### Short-Lived Token Strategy
- Don't write long-lived refreshToken to developer machine
- Write only accessToken (expires in 1-2 hours)
- Client must talk to our server to get a fresh token
- Kill the client app? Token dies naturally in 1-2 hours
- No server connection = no refresh = Claude stops working

## 5-Layer Security Model

### Layer 1: Short-Lived Tokens
- accessToken expires in 1-2 hours without server refresh
- Dev can't stockpile credentials

### Layer 2: Heartbeat
- Client pings server every 30-60 seconds
- Server detects missing client in 2 minutes
- Missing heartbeat → mark user suspicious → hooks block on next prompt

### Layer 3: Hooks as Enforcement
- Every prompt goes through our hook → hook calls server → server allows/blocks
- Even if credentials exist, server can block any prompt
- Kill switch works regardless of credential state

### Layer 4: JSONL Audit (Retroactive)
- All conversations stored as JSONL at ~/.claude/projects/<path>/<session>.jsonl
- Contains: full prompts, full responses, model, token usage, cwd, gitBranch, timestamps
- Written by Claude Code regardless of CLI or VS Code plugin
- Client watches JSONL files → syncs to server on reconnect
- Nothing is lost — admin sees everything retroactively

### Layer 5: Credential Rotation
- Server rotates OAuth tokens periodically (every few hours)
- Old tokens invalidated
- Client must be running and connected to get new token

## Server Capabilities (at any moment)

- **Revoke access** — stop refreshing token → Claude stops in 1-2h max
- **Instant kill** — push "delete credentials" command via WebSocket → immediate
- **Rotate subscription** — push different subscription's credentials transparently
- **Rate limit** — hook blocks prompt when limit reached
- **Alert** — detect anomaly (usage spike, off-hours, no heartbeat)
- **Audit** — read JSONL backlog on reconnect → full history recovered

## Subscription Usage Tracking

### Data Collection
- Server polls claude.ai/api/organizations/{orgId}/usage for each subscription
- Every 30-60 seconds per subscription
- Gets: 5-hour session %, 7-day weekly %, per-model (Opus/Sonnet), reset times

### Dashboard Features
- All subscriptions displayed with live usage %
- Which dev is on which subscription right now
- Usage history per subscription over time
- Pace projection: "Sub 2 will hit limit by 3 PM at current rate"
- Threshold alerts: notify admin at 75/90/95% per subscription

### Smart Rotation
- When subscription hits ~80%, server auto-rotates devs to least-used subscription
- Transparent to developer — client receives new credentials, writes them, Claude continues
- Priority: devs with active sessions get priority on fresh subscriptions
- Round-robin or least-used algorithm (admin configurable)

## Features from Claude Usage Tracker

### Must Have
- **Auto-start session reset** — when 5h window hits 0%, server triggers dummy message via client to reset timer
- **Claude system status** — poll status.claude.com, show in dashboard, correlate with productivity
- **Statusline integration** — push usage %, model, reset time to dev's Claude Code terminal
- **Token refresh flow** — use refreshToken to get new accessToken automatically
- **API key expiry alerts** — notify 24h before OAuth token expires
- **Usage snapshots** — periodic recording (every 10 min) for trend charts
- **Pace projection (6-tier)** — project end-of-period usage, color-coded severity
- **Embedded WebView auth** — Electron app embeds claude.ai login flow for credential capture

### Nice to Have
- **Network request logging** — debug view of all Claude API calls per dev
- **Console API cost data** — per-model, per-day dollar spend (if using API credits)

## JSONL-Based Conversation Tracking

### Why JSONL Over Hooks
- Hooks are inconsistent with VS Code plugin (some prompts don't fire hooks)
- JSONL files are written by Claude Code regardless of CLI or VS Code plugin
- Contains richer data: full responses, token usage, model, cache stats

### JSONL File Structure
Location: `~/.claude/projects/<project-path>/<session-id>.jsonl`

Message types:
- `type: "user"` — full prompt text, cwd, sessionId, gitBranch, timestamp
- `type: "assistant"` — full response, model, token usage (input/output/cache), content blocks
- `type: "queue-operation"` — session start/end
- `type: "last-prompt"` — last prompt reference

### Implementation
- Client file-watches ~/.claude/projects/ for new/modified .jsonl files
- On change: read new lines, parse, send to server
- Supplements hooks (hooks for real-time blocking, JSONL for comprehensive tracking)
- On reconnect: sync any missed conversation data

### Additional Local Data Sources
- `~/.claude/history.jsonl` — every prompt ever typed with timestamps
- `~/.claude/usage-data/session-meta/` — per-session metadata with token counts, tools used, lines added/removed
- `~/.claude/sessions/` — active session PIDs and working directories

## Cross-Platform Credential Management

| Capability | macOS | Ubuntu | Windows |
|---|---|---|---|
| Credential storage | Keychain (`security` CLI) | `libsecret` / encrypted file | Windows Credential Manager (`cmdkey`) |
| Credential file | `~/.claude/.credentials.json` | `~/.claude/.credentials.json` | `%USERPROFILE%\.claude\.credentials.json` |
| Auth logout | `claude auth logout` | `claude auth logout` | `claude auth logout` |

## Open Questions
- Can we use the refreshToken to get a fresh accessToken via API? (need to test the OAuth flow)
- What's the exact token expiry time for Claude OAuth tokens?
- Can we invalidate a specific accessToken from server-side? Or only let it expire?
- Should auto-start session reset be opt-in per subscription or automatic?
- How to handle the case where dev has 2 Claude Code sessions open and we rotate credentials mid-session?
