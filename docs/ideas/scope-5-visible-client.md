# Scope 5: Visible Client Application — Raw Ideas

## Core Concept
Take the client out of stealth. Electron-based system tray app + CLI tool. Tray app is a thin native shell with webview content served from ClawLens server. Unified "On Watch / Off Watch" toggle replaces separate punch in/out — one concept for tracking and attendance.

## Architecture
- **Electron app** (TypeScript, same language as rest of stack)
- **System tray icon** — always present, non-intrusive
- **Webview panel** — loads client-specific pages from server (React, same codebase as dashboard)
- **Native layer** — tray menus, file watcher, app tracking, OS notifications, CLI
- **UI updates don't need new Electron build** — webview content is server-hosted

### What Lives in Native Layer (Electron)
- System tray icon + context menus
- File watcher (fs.watch on project directories)
- JSONL conversation watcher (~/.claude/projects/ — tracks all prompts/responses regardless of CLI or VS Code plugin)
- Window/app tracking (OS-level APIs)
- On Watch / Off Watch toggle state
- Credential management (write/delete Claude OAuth tokens on punch in/out)
- Heartbeat to server (every 30-60 seconds)
- Geolocation for punch events
- Background sync to server
- Desktop notifications (cross-platform: macOS, Windows, Ubuntu)
- CLI interface (`clawlens status`, `clawlens watch-on`, `clawlens set-task 42`)

### What Lives in Webview (Server-hosted React)
- **My Tasks** — assigned tasks, set active task, quick status updates, comments
- **Activity** — today's activity summary, activity timeline
- **Stats** — personal stats (credits used, prompts today, hours tracked, subscription usage %)
- **Settings** — preferences, notification config
- Full dashboard access (open wider webview if needed)
- Task management: view tasks, update status, create sub-tasks — same React codebase as dashboard

## On Watch / Off Watch = Unified Tracking + Attendance

### The Model
- **On Watch** = punched in = tracking active (file watcher, app tracking, activity counts)
- **Off Watch** = punched out = tracking paused (personal time, nothing recorded)
- One toggle, one concept — no separate punch in/out needed
- Server records punch events from toggle state changes

### Smart Behaviors (all admin-configurable, can be turned on/off)

**Auto Watch-On during office hours:**
- If it's work hours and user is Off Watch, system can either:
  - Auto-enable On Watch, OR
  - Frequently remind them via desktop notification to turn on
- Configurable: auto vs reminder, frequency of reminders
- Respects company calendar — no reminders on holidays

**Admin alerts:**
- If someone is Off Watch during work hours beyond a threshold → admin alert
- Configurable threshold (e.g. 30 min, 1 hour)

**Overtime tracking:**
- If user goes On Watch outside work hours (evenings/weekends) → tracked as overtime automatically
- No separate overtime action needed

**Auto punch-out:**
- End of office hours + configurable threshold (e.g. 30 min after 6 PM) → auto switch to Off Watch
- Prevents inflated hours from forgetting to toggle off
- Alternative trigger: no activity (no file changes) for X minutes past work hours → auto Off Watch

**Company calendar integration:**
- Holidays marked in calendar → no auto watch-on, no reminders
- Admin manages holiday calendar in dashboard

### Notifications (cross-platform)
- macOS: native notification center (osascript / node-notifier)
- Windows: PowerShell toast notifications (existing pattern from watcher)
- Ubuntu: notify-send / libnotify
- Notification types:
  - "It's 9:15 AM — start your day?" (watch-on reminder)
  - "Auto punch-out in 15 minutes" (end of day warning)
  - "You've been Off Watch for 2 hours during work hours" (if configured)
  - Task assignments, limit warnings, admin messages (existing watcher notifications)

## CLI Tool
- `clawlens status` — current watch state, active task, today's stats
- `clawlens watch-on` / `clawlens watch-off` — toggle from terminal
- `clawlens task set <id>` — set active task
- `clawlens task list` — show assigned tasks
- `clawlens config` — view/edit local settings
- Available even without Electron running (talks directly to server)

## Mobile Web (for non-dev roles)
- PMs and other non-dev roles don't have the desktop client
- Mobile-responsive web page for punch in/out with geolocation
- Accessible from phone browser
- Simple: one big toggle button + today's status

## Data Model Additions
- `watch_events` — user_id, type (on/off), timestamp, source (tray/cli/mobile/auto), latitude, longitude
- `work_schedule` — user_id, day_of_week, start_time, end_time (office hours per user)
- `holidays` — date, name, description (company calendar)
- `client_config` — user_id, auto_watch_on (bool), reminder_frequency_min, auto_punchout_threshold_min, notification_preferences

## Open Questions
- Auto-update mechanism for Electron app? (electron-updater, or just update webview content server-side)
- Should the client app replace the current watcher daemon, or run alongside it?
- Minimum Electron version / OS version support?
- Should CLI be a separate npm package or bundled with Electron?
- Tray icon states: different icons for On Watch / Off Watch / alerts?
