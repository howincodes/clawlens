# Implementation Roadmap — Phased Delivery

Every feature from all 11 scopes, grouped by dependency and priority.
Nothing is missing. Each phase builds on the previous one.

---

## Dependency Map

```
Scope 10 (Drop Multi-Tenant) ──┐
Scope 9  (PostgreSQL)     ─────┤
                                ├──► FOUNDATION (must be first)
RBAC (from Scope 1)        ─────┤
                                │
Scope 5  (Electron Client) ─────┤──► CLIENT CORE (needed by almost everything)
Scope 11 (Credentials)    ─────┘
                                │
                                ▼
Scope 4  (Activity Tracking) ◄── needs Electron client for file watcher
Scope 1  (Task Management)  ◄── needs RBAC + projects + users
Scope 3  (Git Analysis)     ◄── needs projects + GitHub integration
                                │
                                ▼
Scope 2  (Attendance/Salary) ◄── needs activity tracking + punch in/out (client)
Scope 6  (Remote Config)    ◄── needs client + WebSocket infra
                                │
                                ▼
Scope 7  (Antigravity RT)   ◄── needs tracking infra + dedup
Scope 8  (Reports/Health)   ◄── needs ALL data flowing (tasks, git, attendance, activity)
Scope 9  (AI Efficiency)    ◄── needs summary pipeline designed before reports
```

---

## Phase 0: Foundation
**Goal:** Rip out old architecture, lay new foundation. Nothing user-facing yet.

### 0.1 — PostgreSQL Migration
- [ ] PostgreSQL migration (replace SQLite)
- [ ] Connection pooling
- [ ] Migrate all 12 existing tables
- [ ] Update all existing queries

### 0.2 — Drop Multi-Tenant
- [ ] Drop multi-tenant / teams architecture
- [ ] Remove team_id from all tables and queries
- [ ] Update all API endpoints to remove team context
- [ ] Update dashboard to remove team switching

### 0.3 — RBAC System
- [ ] RBAC: custom roles with names
- [ ] RBAC: granular permission definitions
- [ ] RBAC: role-permission assignment
- [ ] RBAC: user-to-role assignment (global)
- [ ] RBAC: per-project role assignment
- [ ] Admin dashboard: role management UI
- [ ] Admin dashboard: permission matrix UI

### 0.4 — Projects & Users (new model)
- [ ] Projects: CRUD (name, description, settings)
- [ ] Projects: link GitHub repository
- [ ] Projects: assign members with roles
- [ ] Collect GitHub ID per user

**Phase 0 delivers:** New database, no multi-tenant baggage, proper roles, project structure. Existing v0.2 features continue working on new DB.

---

## Phase 1: Client + Credential Control
**Goal:** Electron client running on dev machines. Subscription management. Solve the biggest pain: credential sharing.

### 1.1 — Electron App Core
- [ ] Electron app: project scaffolding
- [ ] System tray icon: macOS
- [ ] System tray icon: Windows
- [ ] System tray icon: Linux
- [ ] Tray icon: different states (On Watch / Off Watch / alert)
- [ ] Webview panel: loads server-hosted React pages
- [ ] On Watch / Off Watch toggle (= punch in/out + tracking control)
- [ ] Notifications: macOS (native notification center)
- [ ] Notifications: Windows (PowerShell toast)
- [ ] Notifications: Linux (notify-send)
- [ ] Auto-update mechanism
- [ ] Heartbeat: client pings server every 30-60s, detect missing client in 2 min

### 1.2 — Credential Management (Biggest Pain Solved)
- [ ] Server-side credential vault: store all subscription OAuth tokens (access + refresh)
- [ ] Credential delivery: push credentials to client on punch-in
- [ ] Credential revocation: delete credentials from client on punch-out
- [ ] Short-lived tokens: write only accessToken (1-2h expiry), not refreshToken
- [ ] Token refresh flow: server refreshes accessToken using refreshToken
- [ ] Credential rotation: periodically rotate tokens, invalidate old ones
- [ ] Instant kill: push "delete credentials" command via WebSocket
- [ ] Embedded WebView auth: Electron app embeds claude.ai login for credential capture
- [ ] Cross-platform credential management: macOS Keychain / Linux libsecret / Windows Credential Manager
- [ ] API key expiry alerts: notify 24h before OAuth token expires

### 1.3 — Subscription Monitoring
- [ ] Subscription usage polling: server polls claude.ai/api/organizations/{orgId}/usage per subscription
- [ ] Usage dashboard: all subscriptions with live usage %
- [ ] Usage dashboard: which dev is on which subscription right now
- [ ] Per-model breakdown: track Opus vs Sonnet usage per dev per subscription
- [ ] Pace projection (6-tier): project end-of-period usage per subscription
- [ ] Threshold alerts: admin notified at 75/90/95% per subscription
- [ ] Smart rotation: auto-rotate devs to least-used subscription at ~80%
- [ ] Usage snapshots: periodic recording every 10 min for trend charts
- [ ] Auto-start session reset: server triggers dummy message when 5h window hits 0%
- [ ] Claude system status: poll status.claude.com, show in dashboard
- [ ] Statusline integration: push usage %, model, reset time to dev's terminal
- [ ] Subscription efficiency report: "Dev A uses 92%, Dev E uses 12%"

### 1.4 — JSONL Conversation Tracking
- [ ] JSONL conversation watcher: track all prompts/responses from ~/.claude/projects/ files
- [ ] JSONL watcher: works for both CLI and VS Code plugin (unlike hooks)
- [ ] JSONL sync on reconnect: catch up missed conversations when client was offline

### 1.5 — CLI Companion
- [ ] CLI: `status` — watch state, active task, today's stats
- [ ] CLI: `watch-on` / `watch-off`
- [ ] CLI: `task set <id>` / `task list`
- [ ] CLI: `config` — view/edit local settings
- [ ] CLI: works independently of Electron (direct server communication)

**Phase 1 delivers:** Electron client on every dev machine. No more manual credential sharing. Auto login/logout on punch in/out. Subscription usage visible in dashboard. Consistent prompt tracking via JSONL. Admin can revoke access instantly.

---

## Phase 2: Activity Tracking + Task Management
**Goal:** Know what everyone is working on. Assign and track tasks.

### 2.1 — Activity Tracking (Client-side)
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

### 2.2 — Task Management (Server + Dashboard)
- [ ] Tasks: CRUD (title, description, status, priority, effort)
- [ ] Tasks: assign to user
- [ ] Tasks: milestones / grouping
- [ ] Tasks: subtasks
- [ ] Tasks: comments / threaded discussion
- [ ] Tasks: activity audit trail (status changes, reassignments)
- [ ] Tasks: custom statuses per project
- [ ] Dashboard: project list page
- [ ] Dashboard: project detail page
- [ ] Dashboard: task board / list view
- [ ] Dashboard: task detail page

### 2.3 — AI Task Generation
- [ ] AI: generate tasks from pasted text (meeting notes / requirements)
- [ ] AI: generate tasks from uploaded documents (PDF, docs)
- [ ] AI: suggest priority and effort
- [ ] AI: suggest assignee from project members (using developer profiles)
- [ ] Human review gate: approve / edit / reject AI suggestions

### 2.4 — Task ↔ Activity Correlation
- [ ] Task-to-activity correlation: manual active task selection (client)
- [ ] Task-to-activity correlation: AI inference from cwd + prompt content

### 2.5 — Client Task Management (Webview)
- [ ] My Tasks tab: view assigned tasks
- [ ] Set active task (what I'm working on now)
- [ ] Quick status update: in-progress / done / blocked
- [ ] View task details
- [ ] Create sub-tasks or comments
- [ ] All served from server via webview (same React codebase as dashboard)

### 2.6 — Webview Enhancements
- [ ] Webview: today's activity summary
- [ ] Webview: active task selector
- [ ] Webview: personal stats
- [ ] Webview: settings / preferences
- [ ] Webview: full dashboard access

**Phase 2 delivers:** PMs create tasks from meeting notes. Devs see tasks in their tray app. Activity tracked from file changes. System knows who is working on what project/task. Dashboard shows it all.

---

## Phase 3: Git Analysis + Attendance + Salary
**Goal:** Git data flowing. Attendance automated. Salary computable.

### 3.1 — Git Analysis
- [ ] Repository linking: store GitHub repo URL per project
- [ ] GitHub webhook: receive push events
- [ ] GitHub webhook: receive PR events
- [ ] GitHub webhook: receive review events
- [ ] Commit ingestion: store per-commit data (sha, message, author, date, files, insertions, deletions)
- [ ] PR ingestion: store PR data (title, status, created, merged, review count)
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
- [ ] AI: auto-link commits to tasks (branch name, commit message, AI inference)

### 3.3 — GitHub Issues Sync
- [ ] GitHub sync: import existing Issues on first link
- [ ] GitHub sync: push new tasks as GitHub Issues
- [ ] GitHub sync: update Issue status from task status

### 3.4 — Attendance System
- [ ] Punch in/out: via desktop client (already built in Phase 1 as On Watch)
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
- [ ] Dashboard: attendance calendar view

### 3.5 — Leave Management
- [ ] Leave types: casual / sick / vacation (configurable)
- [ ] Leave balances: per user per year
- [ ] Leave request / approval workflow
- [ ] Dashboard: leave management page

### 3.6 — Salary
- [ ] Salary: pay config per user (monthly rate, currency, effective date)
- [ ] Salary: monthly computation (base - deductions + overtime)
- [ ] Salary: overtime auto-detection (work outside office hours)
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

**Phase 3 delivers:** Git history analyzed and correlated with tasks. Attendance tracked automatically. Leave workflow working. Salary computed monthly. GitHub Issues synced. Devs reminded to punch in, auto-punched out.

---

## Phase 4: Remote Config + Antigravity + Intelligence
**Goal:** Full remote control. All AI tools tracked. Reports auto-generated.

### 4.1 — Remote Configuration
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

### 4.2 — Antigravity Real-Time
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

**Phase 4 delivers:** Full remote config control. Antigravity tracked in real-time. AI generates daily standups, weekly reports, monthly reports. Project health scores. Everything ties together.

---

## Summary

| Phase | What | Depends On | Key Outcome |
|---|---|---|---|
| **0** | Foundation | Nothing | PostgreSQL, RBAC, Projects |
| **1** | Client + Credentials | Phase 0 | No more manual login sharing. Subscription tracking. |
| **2** | Tracking + Tasks | Phase 0 + 1 | Know what everyone works on. AI task generation. |
| **3** | Git + Attendance + Salary | Phase 0 + 1 + 2 | Git analysis. Auto attendance. Salary computation. |
| **4** | Config + Intelligence | All above | Full control. Auto reports. Project health. |

### Feature Count Per Phase

| Phase | Features |
|---|---|
| Phase 0 | 15 |
| Phase 1 | 38 |
| Phase 2 | 41 |
| Phase 3 | 41 |
| Phase 4 | 45 |
| v0.2 retained | 15 |
| **Total** | **195** |
