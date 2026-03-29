# ClawLens

AI usage analytics and team management for Claude Code.

Admin deploys a server. Developers install a client. The client hooks into Claude Code events, sends data to the server. A background watcher enforces hook integrity, syncs config, and delivers desktop notifications.

## Quick Start

### 1. Deploy Server

```bash
git clone https://github.com/howincodes/clawlens.git
cd clawlens
cp .env.example .env
nano .env                  # set ADMIN_PASSWORD
docker compose up -d
```

Dashboard: `http://your-server:3000`
Default login password: `admin` (change via `ADMIN_PASSWORD` in `.env`)

### 2. Create a User

1. Open dashboard → **Add User**
2. Enter name (e.g., `john`)
3. Copy the generated auth token (shown once)

### 3. Install on Developer Machine

**macOS / Linux:**
```bash
bash <(curl -fsSL https://raw.githubusercontent.com/howincodes/clawlens/main/scripts/install.sh)
```

**Windows (PowerShell):**
```powershell
irm https://raw.githubusercontent.com/howincodes/clawlens/main/scripts/install.ps1 | iex
```

Prompts for:
- **Server URL** — e.g., `https://clawlens.example.com`
- **Auth token** — from the dashboard

The installer:
1. Downloads `clawlens.mjs` (hook handler) and `clawlens-watcher.mjs` (background watcher)
2. Creates a bash wrapper at `~/.claude/hooks/clawlens-hook.sh`
3. Registers 11 hooks in `~/.claude/settings.json`
4. Sets up watcher auto-start on login (launchd / autostart / Startup folder)
5. Starts the watcher immediately

### 4. Verify

Close all terminals, open a fresh one, and run `claude`. The dashboard should show the session appear in real-time.

Check watcher status:
```bash
node ~/.claude/hooks/clawlens-watcher.mjs status
```

---

## Features

### Hook Events (11)

| Event | Blocks? | What it tracks |
|---|---|---|
| SessionStart | Kill/pause | Session registration, model, subscription, device info |
| UserPromptSubmit | Rate limit | Prompt text, credit check |
| PreToolUse | Kill/pause | Tool name + input |
| Stop | No | Response completion |
| StopFailure | No | API errors |
| SessionEnd | No | Session end reason |
| PostToolUse | No | Tool completion + output |
| SubagentStart | No | Subagent type |
| PostToolUseFailure | No | Tool errors |
| ConfigChange | No | Settings changes |
| FileChanged | No | File modifications |

### Rate Limiting

Credit-based system: **Opus = 10**, **Sonnet = 3**, **Haiku = 1** credits per prompt.

Three rule types:
- **total_credits** — daily/hourly/monthly credit budget
- **per_model** — per-model credit cap
- **time_of_day** — block usage during specific hours

### Kill Switch (3 layers)

When admin sets user status to `killed`:
1. SessionStart → session won't start
2. UserPromptSubmit → prompt rejected
3. PreToolUse → tools blocked

### Background Watcher

A persistent Node.js process running on developer machines:

- **Hook auto-repair** — if user removes ClawLens hooks from settings.json, watcher restores them instantly
- **Server sync** — polls server every 5 minutes (configurable by admin) for config updates and commands
- **Desktop notifications** — credit warnings (80%, 100%), kill/pause alerts, custom admin messages (with sound)
- **Remote commands** — admin can request logs, send notifications, or trigger emergency kill from dashboard
- **Auto-start on login** — survives reboots (launchd on macOS, XDG autostart on Linux, Startup folder on Windows)
- **Backup spawn** — if watcher dies, the SessionStart hook detects and restarts it

### Dashboard

- **Overview** — real-time stats, user cards with watcher connection dots, live WebSocket feed
- **Users** — manage status (active/paused/killed), set rate limits, view prompts
- **Analytics** — daily trends, model distribution, cost by user/project/model
- **Prompt Browser** — full-text search, filter by user/model/project/blocked
- **Subscriptions** — group users by Claude subscription, track usage per plan
- **Summaries** — AI-generated usage summaries via `claude -p`
- **Audit Log** — raw hook event history
- **User Detail** — watcher status, action buttons (Request Logs, Send Notification, Kill Now), log viewer

### AI Summaries

The server can generate AI-powered usage summaries using the `claude` CLI:
- Automatic categorization of prompts
- Topic extraction
- Risk level assessment (low/medium/high)

Requires `claude` CLI installed on the server.

---

## Deployment Modes

### Standard (install.sh)

- No admin access required
- Hooks in `~/.claude/settings.json`
- Watcher auto-repairs removed hooks
- Dead man's switch detects prolonged inactivity
- User can uninstall via `uninstall.sh`

### Enforced (enforce.sh) — optional, requires sudo

- Hooks in `managed-settings.d/` with `allowManagedHooksOnly: true`
- Users cannot add or remove managed hooks
- Emergency kill revokes Claude auth credentials
- Watcher runs alongside as additional enforcement layer

```bash
# Install enforced mode (admin runs once per machine)
curl -fsSL https://raw.githubusercontent.com/howincodes/clawlens/main/scripts/enforce.sh | sudo bash

# Remove enforced mode
curl -fsSL https://raw.githubusercontent.com/howincodes/clawlens/main/scripts/restore.sh | sudo bash
```

---

## Uninstall

Removes everything: watcher, hooks, cache files, login agent, env vars. Zero traces.

**macOS / Linux:**
```bash
bash <(curl -fsSL https://raw.githubusercontent.com/howincodes/clawlens/main/scripts/uninstall.sh)
```

**Windows (PowerShell):**
```powershell
irm https://raw.githubusercontent.com/howincodes/clawlens/main/scripts/uninstall.ps1 | iex
```

---

## Server Configuration

| Environment Variable | Default | Description |
|---|---|---|
| `ADMIN_PASSWORD` | `admin` | Dashboard login password |
| `PORT` | `3000` | Server port |
| `DB_PATH` | `./clawlens.db` | SQLite database file path |
| `JWT_SECRET` | auto-generated | JWT signing key (sessions reset on restart if not set) |
| `CORS_ORIGINS` | `localhost:5173,localhost:3000` | Allowed CORS origins |
| `CLAWLENS_DEBUG` | off | Set to `1` for verbose server logging |

### Update Server

```bash
cd clawlens
git pull
docker compose build
docker compose up -d
```

### Reset Database

```bash
docker exec clawlens rm /app/data/clawlens.db
docker restart clawlens
```

---

## Debug Logging

Enable verbose logging to trace issues:

**Client (developer machine):**
Add to `~/.claude/settings.json` env block:
```json
"CLAWLENS_DEBUG": "1"
```

View logs:
```bash
cat ~/.claude/hooks/.clawlens-debug.log      # hook handler log
cat ~/.claude/hooks/.clawlens-watcher.log    # watcher log
```

**Server:**
```bash
CLAWLENS_DEBUG=1 docker compose up
# or add to .env: CLAWLENS_DEBUG=1
```

---

## Development

```bash
pnpm install
PORT=3000 pnpm dev                # start server on :3000
pnpm --filter @clawlens/server test  # run 166 tests
pnpm --filter dashboard dev      # dashboard dev server on :5173
pnpm --filter dashboard build    # production build
```

## Architecture

See [`.claude/ARCHITECTURE.md`](.claude/ARCHITECTURE.md) for full architecture docs.

See [`docs/hook-data-reference.md`](docs/hook-data-reference.md) for complete hook data structures.

## License

MIT
