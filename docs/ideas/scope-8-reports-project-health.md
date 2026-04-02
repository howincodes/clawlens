# Scope 8: Auto-Generated Reports & Project Health Dashboard — Raw Ideas

## Core Concept
Leverage all collected data (prompts, commits, tasks, file changes, attendance) to auto-generate standups, weekly/monthly reports, and project health views. Zero manual effort from developers or managers.

## Reports (rolled out incrementally: daily → weekly → monthly)

### Daily Standup (per developer)
- Auto-generated each morning from previous day's data
- "What I did yesterday": tasks worked on, commits made, files changed, sessions, key prompts
- "What I'm doing today": open assigned tasks, carry-over work
- Viewable in dashboard
- Optionally pushed to Slack/channel/webhook

### Weekly Team Summary (for team leads/PMs)
- Per-developer breakdown: hours worked, tasks completed, commits, AI usage
- Per-project progress: tasks completed vs created, velocity trend
- Highlights: notable completions, blockers, anomalies
- Attendance summary for the week

### Monthly Executive Report (for management)
- Project health overview: on-track / at-risk / stalled
- Budget/cost: AI credit usage, projected spend, budget vs actual
- Team velocity trends: improving / stable / declining
- Attendance + salary summary
- Headcount activity: who's productive, who needs support

## Project Health Dashboard

### Per-Project View
- **Velocity**: tasks completed per week, trend line
- **Active developers**: who's contributing, hours per person
- **Commit frequency**: daily/weekly commit rate, trend
- **AI usage**: prompts per project, credits consumed
- **Task status**: open / in-progress / done / overdue breakdown
- **Blockers**: stale tasks (no activity for X days), unassigned tasks
- **Health score**: AI-generated composite score (0-100) based on all signals

### Team-Wide View
- All projects at a glance with health indicators (green/yellow/red)
- Comparative metrics: which project is most active, which is stalling
- Resource allocation: developer hours distributed across projects

## AI Summarization Efficiency — Cross-Cutting Concern

### The Problem
- Generating summaries requires reading prompts, commits, tasks, file events
- Re-reading everything from scratch each time is expensive and wasteful
- AI context windows have limits — can't dump all data in one call
- Need incremental processing, not full re-computation

### Incremental Processing Architecture
- **Watermark/cursor pattern**: each summarization job tracks "last processed" markers
  - `last_prompt_id`, `last_commit_id`, `last_task_event_id`, `last_file_event_id`
  - On next run: only read events after the watermark
- **Micro-summaries**: as events come in, generate tiny summaries at the event level
  - Session ends → AI summarizes that session (already exists)
  - Task completed → AI generates one-liner
  - Commit pushed → AI summarizes diff (already planned in git analysis)
- **Roll-up pattern**: higher-level summaries built from lower-level summaries, NOT raw data
  - Daily standup = roll up of session summaries + commit summaries + task changes from that day
  - Weekly report = roll up of daily standups (NOT re-reading all raw events)
  - Monthly report = roll up of weekly reports
  - Project health = roll up of per-project daily activity summaries
- **Never re-summarize**: once a session/commit/task is summarized, store it. Higher layers read stored summaries only.
- **Delta updates**: if a daily standup already exists and new late events arrive, append/patch — don't regenerate from scratch.

### Summary Storage
- Each level of summary stored with its watermarks
- `daily_summaries` — user_id, date, summary_json, watermarks_json, generated_at
- `weekly_summaries` — user_id, week_start, summary_json, generated_at
- `monthly_summaries` — user_id, month, summary_json, generated_at
- `project_health_snapshots` — project_id, date, health_json, score, generated_at

### Scheduling
- Session summaries: on session end (already exists)
- Commit summaries: on webhook receive
- Task summaries: on task status change
- Daily standups: cron job each morning (roll up yesterday's micro-summaries)
- Weekly reports: cron job Monday morning (roll up daily summaries)
- Monthly reports: cron job 1st of month (roll up weekly summaries)
- Project health: cron job nightly (roll up project activity)

## Open Questions
- Slack integration specifics — bot? webhook? which channels?
- Should developers be able to edit their auto-standup before it posts?
- PDF/email export for monthly reports?
- Custom report templates (admin defines what sections to include)?
- How to handle developers who work across multiple projects in one day?
