# Roadmap Tracker

Status: `[ ]` = Not Started | `[~]` = In Progress | `[x]` = Done

---

## Phase 0: Foundation

### 0.1 — PostgreSQL Migration
- [x] PostgreSQL migration (replace SQLite)
- [x] Connection pooling
- [x] Migrate all 12 existing tables
- [x] Update all existing queries

### 0.2 — Drop Multi-Tenant
- [x] Drop multi-tenant / teams architecture
- [x] Remove team_id from all tables and queries
- [x] Update all API endpoints to remove team context
- [x] Update dashboard to remove team switching

### 0.3 — RBAC System
- [x] RBAC: custom roles with names
- [x] RBAC: granular permission definitions
- [x] RBAC: role-permission assignment
- [x] RBAC: user-to-role assignment (global)
- [x] RBAC: per-project role assignment
- [x] Admin dashboard: role management UI
- [x] Admin dashboard: permission matrix UI

### 0.4 — Projects & Users
- [x] Projects: CRUD (name, description, settings)
- [x] Projects: link GitHub repository
- [x] Projects: assign members with roles
- [x] Collect GitHub ID per user

---

## Phase 1: Client + Credential Control

### 1.1 — Electron App Core
- [x] Electron app: project scaffolding
- [x] System tray icon: macOS
- [x] System tray icon: Windows
- [x] System tray icon: Linux
- [x] Tray icon: different states (On Watch / Off Watch / alert)
- [x] Webview panel: loads server-hosted React pages
- [x] On Watch / Off Watch toggle (= punch in/out + tracking control)
- [x] Notifications: macOS (native notification center)
- [x] Notifications: Windows (PowerShell toast)
- [x] Notifications: Linux (notify-send)
- [x] Auto-update mechanism
- [x] Heartbeat: client pings server every 30-60s, detect missing client in 2 min

### 1.2 — Credential Management
- [x] Server-side credential vault: store all subscription OAuth tokens (access + refresh)
- [x] Credential delivery: push credentials to client on punch-in
- [x] Credential revocation: delete credentials from client on punch-out
- [x] Short-lived tokens: write only accessToken (1-2h expiry), not refreshToken
- [x] Token refresh flow: server refreshes accessToken using refreshToken
- [x] Credential rotation: periodically rotate tokens, invalidate old ones
- [x] Instant kill: push "delete credentials" command via WebSocket
- [x] Embedded WebView auth: Electron app embeds claude.ai login for credential capture
- [x] Cross-platform credential management: macOS Keychain / Linux libsecret / Windows Credential Manager
- [x] API key expiry alerts: notify 24h before OAuth token expires

### 1.3 — Subscription Monitoring
- [x] Subscription usage polling: server polls usage API per subscription
- [x] Usage dashboard: all subscriptions with live usage %
- [x] Usage dashboard: which dev is on which subscription right now
- [x] Per-model breakdown: track Opus vs Sonnet usage per dev per subscription
- [x] Pace projection (6-tier): project end-of-period usage per subscription
- [x] Threshold alerts: admin notified at 75/90/95% per subscription
- [x] Smart rotation: auto-rotate devs to least-used subscription at ~80%
- [x] Usage snapshots: periodic recording every 10 min for trend charts
- [x] Auto-start session reset: server triggers dummy message when 5h window hits 0%
- [x] Claude system status: poll status.claude.com, show in dashboard
- [x] Statusline integration: push usage %, model, reset time to dev's terminal
- [x] Subscription efficiency report: "Dev A uses 92%, Dev E uses 12%"

### 1.4 — JSONL Conversation Tracking
- [x] JSONL conversation watcher: track all prompts/responses from ~/.claude/projects/ files
- [x] JSONL watcher: works for both CLI and VS Code plugin (unlike hooks)
- [x] JSONL sync on reconnect: catch up missed conversations when client was offline

### 1.5 — CLI Companion
- [x] CLI: `status` — watch state, active task, today's stats
- [x] CLI: `watch-on` / `watch-off`
- [x] CLI: `task set <id>` / `task list`
- [x] CLI: `config` — view/edit local settings
- [x] CLI: works independently of Electron (direct server communication)

---

## Phase 2: Activity Tracking + Task Management

### 2.1 — Activity Tracking
- [x] File watcher: monitor linked project directories
- [x] File watcher: record file path, timestamp, change type, size delta
- [x] File watcher: debounce rapid saves
- [x] File watcher: ignore node_modules, .git, build output
- [x] File watcher: batch sync to server
- [x] Project directory discovery: auto from hooks (cwd + git remote matching)
- [x] Project directory discovery: background scan of dev directories
- [x] Project directory discovery: manual link fallback
- [x] App tracking: active window + app name
- [x] App tracking: window title capture (context, not work measurement)
- [x] App tracking: macOS support
- [x] App tracking: Windows support
- [x] App tracking: Linux support
- [x] Work = output only
- [x] Activity window bucketing: configurable gap threshold

### 2.2 — Task Management
- [x] Tasks: CRUD (title, description, status, priority, effort)
- [x] Tasks: assign to user
- [x] Tasks: milestones / grouping
- [x] Tasks: subtasks
- [x] Tasks: comments / threaded discussion
- [x] Tasks: activity audit trail (status changes, reassignments)
- [x] Tasks: custom statuses per project
- [x] Dashboard: project list page
- [x] Dashboard: project detail page
- [x] Dashboard: task board / list view
- [x] Dashboard: task detail page

### 2.3 — AI Task Generation
- [x] AI: generate tasks from pasted text (meeting notes / requirements)
- [x] AI: generate tasks from uploaded documents (PDF, docs)
- [x] AI: suggest priority and effort
- [x] AI: suggest assignee from project members
- [x] Human review gate: approve / edit / reject AI suggestions

### 2.4 — Task ↔ Activity Correlation
- [x] Manual active task selection (client)
- [x] AI inference from cwd + prompt content

### 2.5 — Client Task Management
- [x] My Tasks tab: view assigned tasks
- [x] Set active task (what I'm working on now)
- [x] Quick status update: in-progress / done / blocked
- [x] View task details
- [x] Create sub-tasks or comments
- [x] All served from server via webview

### 2.6 — Client Webview Enhancements
- [x] Webview: today's activity summary
- [x] Webview: active task selector
- [x] Webview: personal stats
- [x] Webview: settings / preferences
- [x] Webview: full dashboard access

---

## Phase 3: Git + Attendance + Salary

### 3.1 — Git Analysis
- [ ] Repository linking: store GitHub repo URL per project
- [ ] GitHub webhook: receive push events
- [ ] GitHub webhook: receive PR events
- [ ] GitHub webhook: receive review events
- [ ] Commit ingestion: store per-commit data
- [ ] PR ingestion: store PR data
- [ ] PR review tracking: reviewer, status, timestamp
- [ ] File change tracking: per-commit file paths, change type, language
- [ ] Metrics: commit frequency per user
- [ ] Metrics: languages used breakdown
- [ ] Metrics: PR review activity (given / received)
- [ ] Metrics: time-to-merge
- [ ] Correlate commit timestamps with prompt/session timestamps
- [ ] GitHub polling fallback (if webhooks unavailable)
- [ ] Dashboard: per-user git activity view
- [ ] Dashboard: per-project commit timeline
- [ ] Dashboard: team code velocity overview

### 3.2 — AI Git Features
- [ ] AI: summarize commit diffs (plain language)
- [ ] AI: auto-link commits to tasks

### 3.3 — GitHub Issues Sync
- [ ] GitHub sync: import existing Issues on first link
- [ ] GitHub sync: push new tasks as GitHub Issues
- [ ] GitHub sync: update Issue status from task status

### 3.4 — Attendance
- [ ] Punch in/out: via web dashboard
- [ ] Punch in/out: via mobile-responsive web page
- [ ] Punch in/out: geolocation capture
- [ ] Implicit attendance: derive from git commits
- [ ] Implicit attendance: derive from AI sessions
- [ ] Implicit attendance: derive from file change events
- [ ] Implicit attendance: derive from task activity
- [ ] Work hours: activity window bucketing
- [ ] Work schedule: per-user office hours configuration
- [ ] Company calendar: holidays management
- [ ] Dashboard: attendance calendar view

### 3.5 — Leave Management
- [ ] Leave types: casual / sick / vacation (configurable)
- [ ] Leave balances: per user per year
- [ ] Leave request / approval workflow
- [ ] Dashboard: leave management page

### 3.6 — Salary
- [ ] Salary: pay config per user (monthly rate, currency, effective date)
- [ ] Salary: monthly computation (base - deductions + overtime)
- [ ] Salary: overtime auto-detection
- [ ] Salary: payroll period management (draft / finalized)
- [ ] Salary: export reports (CSV / PDF)
- [ ] Data model extensible for hourly / daily rates (future)
- [ ] Dashboard: salary / payroll page

### 3.7 — Smart Client Behaviors
- [ ] Smart reminders: nudge during office hours if Off Watch
- [ ] Smart reminders: respect holiday calendar
- [ ] Smart reminders: configurable (auto watch-on vs reminder, frequency)
- [ ] Auto punch-out: after office hours + configurable threshold
- [ ] Overtime: auto-detect work outside scheduled hours
- [ ] Mobile web: punch in/out page for non-dev roles
- [ ] Mobile web: geolocation support

---

## Phase 4: Remote Config + Intelligence

### 4.1 — Remote Configuration
- [ ] Config control: AI model per user / project / global
- [ ] Config control: tool permissions
- [ ] Config control: rate limits and credit caps
- [ ] Config control: hook management
- [ ] Config control: arbitrary settings override
- [ ] Delivery: push via WebSocket (primary)
- [ ] Delivery: HTTP poll fallback
- [ ] Targeting: per-user
- [ ] Targeting: per-project (all members)
- [ ] Targeting: global (everyone)
- [ ] Precedence: user-specific > project > global
- [ ] Developer notification: configurable (silent / notify-but-enforce)
- [ ] Admin can include message with config change
- [ ] Config versioning: every change recorded
- [ ] Config rollback: revert to any previous version
- [ ] Config state: dashboard shows what's on each dev's machine
- [ ] Tamper detection: detect manual edits to managed settings
- [ ] Config templates / presets
- [ ] Dashboard: config editor UI
- [ ] Dashboard: config change history / audit log
- [ ] Dashboard: per-user current config view

### 4.2 — Antigravity Real-Time
- [ ] Antigravity extension: mature probe into production extension
- [ ] Antigravity extension: subscribe to onStepCountChanged
- [ ] Antigravity extension: subscribe to onNewConversation
- [ ] Antigravity extension: subscribe to onActiveSessionChanged
- [ ] Antigravity extension: fetch new steps and POST to server
- [ ] Antigravity extension: read workspace URIs for project correlation
- [ ] Antigravity collector: keep as batch fallback
- [ ] Antigravity: tracking only (no blocking / rate limiting)
- [ ] Deduplication: tag source on every event
- [ ] Deduplication: prevent double-counting across tools
- [ ] Sync state: per-user last synced cascade_id + step_index
- [ ] Codex: maintain existing integration

### 4.3 — AI Efficiency Pipeline
- [ ] AI summary layer: batch micro-summaries every 5-10 min
- [ ] AI summary layer: session-end triggers flush
- [ ] AI summary layer: skip if no new events
- [ ] Roll-up: daily digests from batch summaries
- [ ] Roll-up: weekly from daily
- [ ] Roll-up: monthly from weekly
- [ ] Roll-up: never re-read raw events
- [ ] Developer profiles: update from daily digests (not raw data)
- [ ] Team pulse: update from weekly digests

### 4.4 — Reports
- [ ] Daily standup: auto-generated per developer
- [ ] Daily standup: viewable in dashboard
- [ ] Daily standup: optionally push to Slack / webhook
- [ ] Weekly team summary: per-developer breakdown + project progress
- [ ] Monthly executive report: health, budget, velocity, attendance

### 4.5 — Project Health
- [ ] Project health score: AI-generated (0-100)
- [ ] Project health: velocity (tasks completed / week)
- [ ] Project health: active developers and hours
- [ ] Project health: commit frequency
- [ ] Project health: blocker detection (stale tasks, no activity)
- [ ] Project health: visual indicator (green / yellow / red)
- [ ] Dashboard: project health overview (all projects at a glance)
- [ ] Dashboard: individual project health detail
- [ ] Dashboard: report viewer (daily / weekly / monthly)

### 4.6 — Live Dashboard
- [ ] Dashboard: live activity feed via WebSocket
- [ ] Dashboard: per-user "currently active" indicator with source

---

## Progress Summary

| Phase | Total | Done | Remaining |
|---|---|---|---|
| Phase 0 | 15 | 15 | 0 |
| Phase 1 | 38 | 38 | 0 |
| Phase 2 | 41 | 41 | 0 |
| Phase 3 | 41 | 0 | 41 |
| Phase 4 | 45 | 0 | 45 |
| **Total** | **180** | **94** | **86** |
