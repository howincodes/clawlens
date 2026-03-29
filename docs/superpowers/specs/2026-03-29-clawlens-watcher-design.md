# ClawLens Watcher — Design Spec

## Goal

A persistent background Node.js process on developer machines that enforces hook integrity, syncs config from the server, sends logs on demand, and delivers desktop notifications. Stealthy — no UI, no tray icon.

---

## Architecture

```
Developer Machine (always running)
┌─────────────────────────────────────────────┐
│ clawlens-watcher.mjs (background process)   │
│                                             │
│  ┌─ File Watcher ──────────────────────┐    │
│  │  fs.watch(~/.claude/settings.json)  │    │
│  │  → verify 11 ClawLens hooks present │    │
│  │  → auto-repair if missing           │    │
│  │  → detect model/subscription change │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  ┌─ WebSocket Client ─────────────────┐    │
│  │  wss://server/ws/watcher            │    │
│  │  ← commands (kill, notify, upload)  │    │
│  │  → heartbeat, status               │    │
│  │  Reconnect with backoff on drop     │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  ┌─ Poll Fallback (when WS down) ────┐    │
│  │  POST /api/v1/watcher/sync          │    │
│  │  Every poll_interval_ms (default 5m)│    │
│  └─────────────────────────────────────┘    │
│                                             │
│  ┌─ Log Manager ──────────────────────┐    │
│  │  Local audit log (~1MB rotated)     │    │
│  │  Upload on server command           │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  ┌─ Notifier ─────────────────────────┐    │
│  │  Desktop notifications + sound      │    │
│  │  macOS: osascript                   │    │
│  │  Linux: notify-send                 │    │
│  │  Windows: PowerShell toast          │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  ┌─ Status Command ───────────────────┐    │
│  │  node clawlens-watcher.mjs status   │    │
│  │  → credits, limits, model, uptime   │    │
│  └─────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
         │
         │  WebSocket (primary) + HTTPS poll (fallback)
         ▼
┌─────────────────────────────────────────────┐
│ ClawLens Server                             │
│                                             │
│  /ws/watcher      WebSocket channel         │
│    Auth: Bearer token (same as hook auth)   │
│    Server → Watcher: commands               │
│    Watcher → Server: heartbeat, status      │
│                                             │
│  POST /api/v1/watcher/sync   Poll fallback  │
│  POST /api/v1/watcher/logs   Log upload     │
│                                             │
│  watcher_commands table   Command queue      │
│  watcher_status table     Last heartbeat     │
└─────────────────────────────────────────────┘
```

---

## Components

### 1. File Watcher — Hook Auto-Repair

Monitors `~/.claude/settings.json` using `fs.watch()`.

**What "hooks present" means:**
Each of the 11 event keys (SessionStart, UserPromptSubmit, PreToolUse, Stop, StopFailure, SessionEnd, PostToolUse, SubagentStart, PostToolUseFailure, ConfigChange, FileChanged) must have at least one hook group containing a hook whose `command` includes `clawlens`.

**Repair rules (pixel-perfect):**
- Parse with `JSON.parse()`, write with `JSON.stringify(data, null, 2)`
- Only add missing ClawLens hook entries — never remove anything
- Never modify existing ClawLens hooks (user may have changed timeout values)
- Never touch non-ClawLens hooks
- Atomic write: write to `settings.json.tmp`, then `fs.renameSync()` to `settings.json`
- Debounce: ignore file changes for 500ms after a repair to avoid reacting to own write
- Report repair event to server via WebSocket/poll

**Also watches for:**
- Model changes in settings.json → update cached model, report to server
- Env var changes (SERVER_URL, AUTH_TOKEN removed) → report to server

### 2. WebSocket Client (Primary Connection)

Persistent WebSocket connection to `wss://<server>/ws/watcher`.

**Authentication:** Query param `?token=<auth_token>` (same Bearer token as hook auth).

**Watcher → Server messages:**

```json
{"type": "heartbeat", "model": "opus", "subscription_email": "...", "subscription_type": "max", "hostname": "...", "platform": "win32", "hooks_intact": true, "uptime_seconds": 3600, "watcher_version": "1.0.0"}
```

```json
{"type": "hooks_repaired", "missing_events": ["SessionStart", "PreToolUse"], "timestamp": "..."}
```

```json
{"type": "model_changed", "old_model": "sonnet", "new_model": "opus"}
```

**Server → Watcher messages:**

```json
{"type": "config", "status": "active", "poll_interval_ms": 300000, "limits": [...], "credit_usage": {"used": 150, "limit": 200, "percent": 75}}
```

```json
{"type": "command", "command": "upload_logs"}
```

```json
{"type": "command", "command": "kill"}
```

```json
{"type": "command", "command": "notify", "message": "Model switched to sonnet by admin", "sound": true}
```

**Reconnection:**
- On disconnect: retry after 1s, 2s, 4s, 8s, 16s, 30s (exponential backoff, cap at 30s)
- On reconnect: send heartbeat immediately
- While disconnected: fall back to HTTP poll

### 3. Poll Fallback

When WebSocket is disconnected, watcher falls back to HTTP polling.

**POST /api/v1/watcher/sync**

Request body (same data as WebSocket heartbeat):
```json
{
  "heartbeat": true,
  "model": "opus",
  "subscription_email": "eatiko.hc@gmail.com",
  "subscription_type": "max",
  "hostname": "WIN-02K9JROATFS",
  "platform": "win32",
  "hooks_intact": true,
  "uptime_seconds": 3600,
  "watcher_version": "1.0.0"
}
```

Response (same as WebSocket config message + pending commands):
```json
{
  "status": "active",
  "poll_interval_ms": 300000,
  "limits": [...],
  "credit_usage": {"used": 150, "limit": 200, "percent": 75},
  "commands": [
    {"id": 1, "type": "upload_logs"},
    {"id": 2, "type": "notify", "message": "New limits applied"}
  ]
}
```

**Poll interval:** Controlled by server via `poll_interval_ms`. Default 300000 (5 min). Bounds: min 30s, max 60min. Watcher clamps to bounds if server sends value outside range.

### 4. Log Manager

**Local audit log:** `~/.claude/hooks/.clawlens-watcher.log`
- Logs: watcher start/stop, file watch events, repairs, sync cycles, notifications sent, commands executed, errors
- Rotation: truncates oldest entries when file exceeds 1MB
- Format: `[ISO-timestamp] message`

**Combined with hook debug log:** `~/.claude/hooks/.clawlens-debug.log` (already exists from hook handler)

**Log upload (on command):**
1. Server sends `{type: "command", command: "upload_logs"}`
2. Watcher reads both log files (last 500KB each, most recent entries)
3. POSTs to `POST /api/v1/watcher/logs`:
```json
{
  "hook_log": "...(last 500KB of debug log)...",
  "watcher_log": "...(last 500KB of watcher log)...",
  "uploaded_at": "..."
}
```
4. Server stores in DB, shows on user detail page in dashboard

### 5. Notifier — Desktop Notifications

All platforms, with sound. No npm dependencies.

**macOS:**
```bash
osascript -e 'display notification "message" with title "ClawLens" sound name "Ping"'
```

**Linux:**
```bash
notify-send "ClawLens" "message" --urgency=normal
# Sound: paplay /usr/share/sounds/freedesktop/stereo/message.oga
```

**Windows (PowerShell):**
```powershell
[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms')
$n = New-Object System.Windows.Forms.NotifyIcon
$n.BalloonTipTitle = 'ClawLens'
$n.BalloonTipText = 'message'
$n.ShowBalloonTip(5000)
[System.Media.SystemSounds]::Asterisk.Play()
```

**Notification triggers:**

| Trigger | Message | Sound |
|---|---|---|
| Permission prompt waiting | "Claude Code needs your approval" | Yes |
| Task/session completed | "Session completed" | Yes |
| Credit usage >= 80% | "80% of daily credit budget used" | Yes |
| Credit limit hit | "Daily credit limit reached" | Yes |
| Account killed | "Access revoked by admin" | Yes |
| Account paused | "Access paused by admin" | Yes |
| Model changed by admin | "Model switched to {model}" | Yes |
| Custom admin message | "{message}" | Yes |

### 6. Status Command

```bash
node ~/.claude/hooks/clawlens-watcher.mjs status
```

Output:
```
ClawLens Status
═══════════════
  User:       tstwinc
  Model:      opus
  Status:     active
  Server:     https://clawlens.howincloud.com (connected)

  Credits Today:  150 / 200 (75%)
  ██████████████░░░░░░  75%

  Limits:
    total_credits: 200/day
    per_model opus: 100/day

  Watcher:    running (uptime 2h 15m)
  Hooks:      intact (11/11)
  Last sync:  30 seconds ago
```

Reads cached config from `~/.claude/hooks/.clawlens-config.json` (saved by watcher on each sync). Works even when server is unreachable.

### 7. Auto-Start on Login

**macOS — launchd user agent:**
Install: `~/Library/LaunchAgents/com.clawlens.watcher.plist`
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "...">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.clawlens.watcher</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>~/.claude/hooks/clawlens-watcher.mjs</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardErrorPath</key><string>~/.claude/hooks/.clawlens-watcher-stderr.log</string>
</dict>
</plist>
```

**Linux — XDG autostart:**
Install: `~/.config/autostart/clawlens-watcher.desktop`
```ini
[Desktop Entry]
Type=Application
Name=ClawLens Watcher
Exec=node ~/.claude/hooks/clawlens-watcher.mjs
Hidden=true
X-GNOME-Autostart-enabled=true
```

**Windows — Startup folder shortcut:**
Install: `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\clawlens-watcher.vbs`
```vbs
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "node ""%USERPROFILE%\.claude\hooks\clawlens-watcher.mjs""", 0, False
```
(VBS wrapper hides the console window — stealthy.)

### 8. SessionStart Backup Spawn

In `clawlens.mjs` hook handler, on SessionStart:
```javascript
// Check if watcher is running (PID file)
const pidFile = join(HOOKS_DIR, '.clawlens-watcher.pid');
const pid = readText(pidFile);
if (!pid || !isProcessAlive(pid)) {
  // Spawn watcher detached
  const child = spawn('node', [join(HOOKS_DIR, 'clawlens-watcher.mjs')], {
    detached: true, stdio: 'ignore'
  });
  child.unref();
}
```

Watcher writes its PID to `.clawlens-watcher.pid` on startup. Hook checks this file.

---

## Server Changes

### New Database Tables

```sql
CREATE TABLE IF NOT EXISTS watcher_commands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id),
  command TEXT NOT NULL,
  payload TEXT,
  status TEXT DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);
CREATE INDEX idx_watcher_commands_user ON watcher_commands(user_id, status);

CREATE TABLE IF NOT EXISTS watcher_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id),
  hook_log TEXT,
  watcher_log TEXT,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### New Endpoints

**POST /api/v1/watcher/sync** — Poll fallback (hookAuth middleware)
- Receives heartbeat data, returns config + pending commands
- Marks returned commands as `status='delivered'`
- Updates user's `last_event_at`

**POST /api/v1/watcher/logs** — Log upload (hookAuth middleware)
- Stores hook_log and watcher_log in `watcher_logs` table

**WebSocket /ws/watcher** — Persistent connection
- Auth via `?token=` query param → same `getUserByToken()` lookup
- Server can push commands from `watcher_commands` table
- Receives heartbeat messages, updates user status

### New Admin API Endpoints

**POST /api/admin/users/:id/watcher/command** — Queue a command
- Body: `{command: "upload_logs" | "kill" | "notify", message?: string}`
- Inserts into `watcher_commands` table
- If watcher WebSocket connected → push immediately

**GET /api/admin/users/:id/watcher/logs** — View uploaded logs
- Returns most recent watcher_logs entry for user

**GET /api/admin/users/:id/watcher/status** — Watcher connection status
- Returns: connected (WS alive), last_heartbeat, uptime, hooks_intact, watcher_version

---

## Files

| File | Location | Purpose |
|---|---|---|
| `clawlens-watcher.mjs` | `client/clawlens-watcher.mjs` (repo) → `~/.claude/hooks/` (installed) | Watcher process |
| `clawlens.mjs` | `client/clawlens.mjs` → `~/.claude/hooks/` | Hook handler (add backup spawn) |
| `install.sh` | `scripts/install.sh` | Add watcher install + login agent setup |
| `install.ps1` | `scripts/install.ps1` | Same for Windows |
| `uninstall.sh` | `scripts/uninstall.sh` | Full removal: watcher, hooks, cache, login agent, env vars |
| `uninstall.ps1` | `scripts/uninstall.ps1` (new) | Windows full removal |
| `watcher-ws.ts` | `packages/server/src/services/watcher-ws.ts` (new) | Watcher WebSocket channel |
| `watcher-api.ts` | `packages/server/src/routes/watcher-api.ts` (new) | Watcher sync/logs endpoints |

---

## Constraints

- Zero npm dependencies (Node.js built-ins only)
- Node 18+ (native fetch, WebSocket in Node 22; for Node 18-21 use `http`/`https` upgrade for WS)
- Works on macOS, Linux, Windows
- Fails open — if watcher crashes, Claude Code still works
- Single file: `clawlens-watcher.mjs` (like the hook handler)
- Stealthy: no console window, no tray icon, no user-visible process name

---

## Uninstall Script — Full Removal

`scripts/uninstall.sh` (bash) and `scripts/uninstall.ps1` (PowerShell):

1. Stop watcher process (read PID file, kill)
2. Remove login agent:
   - macOS: `rm ~/Library/LaunchAgents/com.clawlens.watcher.plist && launchctl bootout ...`
   - Linux: `rm ~/.config/autostart/clawlens-watcher.desktop`
   - Windows: `del "%APPDATA%\...\Startup\clawlens-watcher.vbs"`
3. Remove hook files: `~/.claude/hooks/clawlens.mjs`, `clawlens-watcher.mjs`, `clawlens-hook.sh`
4. Remove cache files: `.clawlens-cache.json`, `.clawlens-model.txt`, `.clawlens-config.json`, `.clawlens-watcher.pid`, `.clawlens-debug.log`, `.clawlens-watcher.log`
5. Remove ClawLens hooks from `~/.claude/settings.json` (parse JSON, remove entries containing `clawlens`, preserve everything else)
6. Remove ClawLens env vars from `~/.claude/settings.json` (`CLAUDE_PLUGIN_OPTION_SERVER_URL`, `CLAUDE_PLUGIN_OPTION_AUTH_TOKEN`, `CLAWLENS_DEBUG`)
7. Verify: confirm no ClawLens traces remain

---

## What This Spec Does NOT Cover

- Dashboard UI changes for watcher status/logs (separate spec)
- Enforce mode changes (enforce.sh already handles managed hooks differently)
- Server deployment changes (no new infrastructure needed)
