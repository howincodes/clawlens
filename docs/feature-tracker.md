# Feature Tracker

Status: `[ ]` = Not Started | `[~]` = In Progress | `[x]` = Done

---

## Foundation

- [x] PostgreSQL migration (replace SQLite)
- [x] Connection pooling
- [x] Drop multi-tenant / teams architecture
- [x] Remove team_id from all tables and queries
- [x] RBAC: custom roles with names
- [x] RBAC: granular permission definitions
- [x] RBAC: role-permission assignment
- [x] RBAC: per-project role assignment
- [x] RBAC: user-to-role assignment (global)
- [x] Admin dashboard: role management UI
- [x] Admin dashboard: permission matrix UI

## Task Management

- [ ] Projects: CRUD (name, description, settings)
- [ ] Projects: link GitHub repository
- [ ] Projects: assign members with roles
- [ ] Tasks: CRUD (title, description, status, priority, effort)
- [ ] Tasks: assign to user
- [ ] Tasks: milestones / grouping
- [ ] Tasks: subtasks
- [ ] Tasks: comments / threaded discussion
- [ ] Tasks: activity audit trail (status changes, reassignments)
- [ ] Tasks: custom statuses per project
- [ ] AI: generate tasks from pasted text (meeting notes / requirements)
- [ ] AI: generate tasks from uploaded documents (PDF, docs)
- [ ] AI: suggest priority and effort
- [ ] AI: suggest assignee from project members (using developer profiles)
- [ ] Human review gate: approve / edit / reject AI suggestions
- [ ] GitHub sync: import existing Issues on first link
- [ ] GitHub sync: push new tasks as GitHub Issues
- [ ] GitHub sync: update Issue status from task status
- [ ] Collect GitHub ID per user
- [ ] Task-to-activity correlation: manual active task selection (client)
- [ ] Task-to-activity correlation: AI inference from cwd + prompt content
- [ ] Dashboard: project list page
- [ ] Dashboard: project detail page
- [ ] Dashboard: task board / list view
- [ ] Dashboard: task detail page

## Attendance & Salary

- [ ] Punch in/out: via desktop client
- [ ] Punch in/out: via web dashboard
- [ ] Punch in/out: via mobile-responsive web page
- [ ] Punch in/out: geolocation capture
- [ ] Implicit attendance: derive from git commits
- [ ] Implicit attendance: derive from AI sessions
- [ ] Implicit attendance: derive from file change events
- [ ] Implicit attendance: derive from task activity
- [ ] Work hours: activity window bucketing (configurable gap threshold)
- [ ] Work schedule: per-user office hours configuration
- [ ] Company calendar: holidays management
- [ ] Leave types: casual / sick / vacation (configurable)
- [ ] Leave balances: per user per year
- [ ] Leave request / approval workflow
- [ ] Salary: pay config per user (monthly rate, currency, effective date)
- [ ] Salary: monthly computation (base - deductions + overtime)
- [ ] Salary: overtime auto-detection (work outside office hours)
- [ ] Salary: payroll period management (draft / finalized)
- [ ] Salary: export reports (CSV / PDF)
- [ ] Data model extensible for hourly / daily rates (future)
- [ ] Dashboard: attendance calendar view
- [ ] Dashboard: leave management page
- [ ] Dashboard: salary / payroll page

## Git Analysis

- [ ] Repository linking: store GitHub repo URL per project
- [ ] GitHub webhook: receive push events
- [ ] GitHub webhook: receive PR events
- [ ] GitHub webhook: receive review events
- [ ] Commit ingestion: store per-commit data (sha, message, author, date, files, insertions, deletions)
- [ ] PR ingestion: store PR data (title, status, created, merged, review count)
- [ ] PR review tracking: reviewer, status, timestamp
- [ ] File change tracking: per-commit file paths, change type, language
- [ ] AI: summarize commit diffs (plain language)
- [ ] AI: auto-link commits to tasks (branch name, commit message, AI inference)
- [ ] Metrics: commit frequency per user
- [ ] Metrics: languages used breakdown
- [ ] Metrics: PR review activity (given / received)
- [ ] Metrics: time-to-merge
- [ ] Correlate commit timestamps with prompt/session timestamps
- [ ] Dashboard: per-user git activity view
- [ ] Dashboard: per-project commit timeline
- [ ] Dashboard: team code velocity overview
- [ ] GitHub polling fallback (if webhooks unavailable)

## Activity Tracking

- [ ] File watcher: monitor linked project directories
- [ ] File watcher: record file path, timestamp, change type, size delta
- [ ] File watcher: debounce rapid saves
- [ ] File watcher: ignore node_modules, .git, build output
- [ ] File watcher: batch sync to server
- [ ] Project directory discovery: auto from hooks (cwd + git remote matching)
- [ ] Project directory discovery: background scan of dev directories
- [ ] Project directory discovery: manual link fallback
- [ ] App tracking: active window + app name
- [ ] App tracking: window title capture (context, not work measurement)
- [ ] App tracking: macOS support
- [ ] App tracking: Windows support
- [ ] App tracking: Linux support
- [ ] Work = output only (file saves, commits, prompts, task updates count; app open time does not)
- [ ] Activity window bucketing: configurable gap threshold

## Desktop Client (Electron)

- [ ] Electron app: project scaffolding
- [ ] System tray icon: macOS
- [ ] System tray icon: Windows
- [ ] System tray icon: Linux
- [ ] Tray icon: different states (On Watch / Off Watch / alert)
- [ ] Webview panel: loads server-hosted React pages
- [ ] Webview: today's activity summary
- [ ] Webview: active task selector
- [ ] Webview: personal stats
- [ ] Webview: settings / preferences
- [ ] Webview: full dashboard access
- [ ] On Watch / Off Watch toggle (= punch in/out + tracking control)
- [ ] Smart reminders: nudge during office hours if Off Watch
- [ ] Smart reminders: respect holiday calendar
- [ ] Smart reminders: configurable (auto watch-on vs reminder, frequency)
- [ ] Auto punch-out: after office hours + configurable threshold
- [ ] Overtime: auto-detect work outside scheduled hours
- [ ] Notifications: macOS (native notification center)
- [ ] Notifications: Windows (PowerShell toast)
- [ ] Notifications: Linux (notify-send)
- [ ] CLI: `status` — watch state, active task, today's stats
- [ ] CLI: `watch-on` / `watch-off`
- [ ] CLI: `task set <id>` / `task list`
- [ ] CLI: `config` — view/edit local settings
- [ ] CLI: works independently of Electron (direct server communication)
- [ ] Mobile web: punch in/out page for non-dev roles
- [ ] Mobile web: geolocation support
- [ ] Auto-update mechanism

## Remote Configuration

- [ ] Config control: AI model per user / project / global
- [ ] Config control: tool permissions (enable/disable Bash, Edit, etc.)
- [ ] Config control: rate limits and credit caps
- [ ] Config control: hook management (add/remove/update)
- [ ] Config control: arbitrary settings override
- [ ] Delivery: push via WebSocket (primary)
- [ ] Delivery: HTTP poll fallback
- [ ] Targeting: per-user
- [ ] Targeting: per-project (all members)
- [ ] Targeting: global (everyone)
- [ ] Precedence: user-specific > project > global
- [ ] Developer notification: configurable (silent / notify-but-enforce)
- [ ] Admin can include message with config change
- [ ] Config versioning: every change recorded (who, what, when, for whom, previous value)
- [ ] Config rollback: revert to any previous version
- [ ] Config state: dashboard shows what's on each developer's machine
- [ ] Tamper detection: detect manual edits to managed settings
- [ ] Config templates / presets (e.g. "Cost Saver" = cheap model + strict limits)
- [ ] Dashboard: config editor UI
- [ ] Dashboard: config change history / audit log
- [ ] Dashboard: per-user current config view

## Real-Time Tracking & Antigravity

- [ ] Antigravity extension: mature probe into production extension
- [ ] Antigravity extension: subscribe to onStepCountChanged
- [ ] Antigravity extension: subscribe to onNewConversation
- [ ] Antigravity extension: subscribe to onActiveSessionChanged
- [ ] Antigravity extension: fetch new steps and POST to server
- [ ] Antigravity extension: read workspace URIs for project correlation
- [ ] Antigravity collector: keep as batch fallback
- [ ] Antigravity: tracking only (no blocking / rate limiting)
- [ ] Deduplication: tag source on every event (claude-code / codex / antigravity)
- [ ] Deduplication: prevent double-counting across tools (timestamp + cwd + user)
- [ ] Sync state: per-user last synced cascade_id + step_index
- [ ] Dashboard: live activity feed via WebSocket
- [ ] Dashboard: per-user "currently active" indicator with source
- [ ] Codex: maintain existing integration

## Reports & Project Health

- [ ] AI summary layer: batch micro-summaries every 5-10 min
- [ ] AI summary layer: session-end triggers flush
- [ ] AI summary layer: skip if no new events
- [ ] Roll-up: daily digests from batch summaries
- [ ] Roll-up: weekly from daily
- [ ] Roll-up: monthly from weekly
- [ ] Roll-up: never re-read raw events
- [ ] Daily standup: auto-generated per developer
- [ ] Daily standup: viewable in dashboard
- [ ] Daily standup: optionally push to Slack / webhook
- [ ] Weekly team summary: per-developer breakdown + project progress
- [ ] Monthly executive report: health, budget, velocity, attendance
- [ ] Project health score: AI-generated (0-100)
- [ ] Project health: velocity (tasks completed / week)
- [ ] Project health: active developers and hours
- [ ] Project health: commit frequency
- [ ] Project health: blocker detection (stale tasks, no activity)
- [ ] Project health: visual indicator (green / yellow / red)
- [ ] Dashboard: project health overview (all projects at a glance)
- [ ] Dashboard: individual project health detail
- [ ] Dashboard: report viewer (daily / weekly / monthly)
- [ ] Developer profiles: update from daily digests (not raw data)
- [ ] Team pulse: update from weekly digests

## Subscription & Credential Management

- [ ] Server-side credential vault: store all subscription OAuth tokens (access + refresh)
- [ ] Credential delivery: push credentials to client on punch-in
- [ ] Credential revocation: delete credentials from client on punch-out
- [ ] Short-lived tokens: write only accessToken (1-2h expiry), not refreshToken
- [ ] Token refresh flow: server refreshes accessToken using refreshToken
- [ ] Credential rotation: periodically rotate tokens, invalidate old ones
- [ ] Heartbeat: client pings server every 30-60s, detect missing client in 2 min
- [ ] Instant kill: push "delete credentials" command via WebSocket
- [ ] Subscription usage polling: server polls claude.ai/api/organizations/{orgId}/usage per subscription
- [ ] Usage dashboard: all subscriptions with live usage %
- [ ] Usage dashboard: which dev is on which subscription right now
- [ ] Pace projection (6-tier): project end-of-period usage per subscription
- [ ] Threshold alerts: admin notified at 75/90/95% per subscription
- [ ] Smart rotation: auto-rotate devs to least-used subscription at ~80%
- [ ] Auto-start session reset: server triggers dummy message when 5h window hits 0%
- [ ] Claude system status: poll status.claude.com, show in dashboard
- [ ] Statusline integration: push usage %, model, reset time to dev's terminal
- [ ] Embedded WebView auth: Electron app embeds claude.ai login for credential capture
- [ ] API key expiry alerts: notify 24h before OAuth token expires
- [ ] Usage snapshots: periodic recording every 10 min for trend charts
- [ ] Per-model breakdown: track Opus vs Sonnet usage per dev per subscription
- [ ] Subscription efficiency report: "Dev A uses 92%, Dev E uses 12%"
- [ ] JSONL conversation watcher: track all prompts/responses from ~/.claude/projects/ files
- [ ] JSONL watcher: works for both CLI and VS Code plugin (unlike hooks)
- [ ] JSONL sync on reconnect: catch up missed conversations when client was offline
- [ ] Cross-platform credential management: macOS Keychain / Linux libsecret / Windows Credential Manager

## Client — Task Management (Webview)

- [ ] My Tasks tab: view assigned tasks
- [ ] Set active task (what I'm working on now)
- [ ] Quick status update: in-progress / done / blocked
- [ ] View task details
- [ ] Create sub-tasks or comments
- [ ] All served from server via webview (same React codebase as dashboard)

## Existing Features (v0.2) to Retain

- [x] Hook API: 11 endpoints (SessionStart through FileChanged)
- [x] Kill switch: 3-layer blocking (session, prompt, tool)
- [x] Credit-based rate limiting (per user / model / window)
- [x] Tamper detection (config change monitoring)
- [x] Dead man's switch
- [x] Watcher daemon (WebSocket + HTTP poll)
- [x] AI Intelligence: session summaries
- [x] AI Intelligence: developer profiles
- [x] AI Intelligence: team pulse
- [x] Codex integration
- [x] Antigravity collector (batch)
- [x] Dashboard: 11 pages (Overview, Users, Analytics, etc.)
- [x] Enforced mode (managed-settings.d)
- [x] Install / uninstall scripts
- [x] Source filtering (Claude Code / Codex / Antigravity)
