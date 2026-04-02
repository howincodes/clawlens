# Scope 2: Attendance Management + Salary Calculation — Raw Ideas

## Core Concept
Track attendance through both explicit (punch in/out) and implicit (activity-derived) signals. Calculate salary based on attendance data. Export reports for actual payroll software — ClawLens tracks, external tools handle money.

## Attendance — Two Layers

### Explicit: Punch In/Out
- Manual punch in/out with optional location (geolocation)
- Available via: dashboard web app, mobile-friendly web page, potentially desktop client app (decide in visible client scope)
- Records timestamp + location per punch event

### Implicit: Activity-Derived
- Git commit history (primary source for developers)
- Prompt/session activity from Claude Code, Codex, Antigravity
- Task management activity (status updates, comments)
- **Gap: Non-AI work tracking** — manual coding, real device testing, code reviews, meetings. Needs dedicated discussion. Options may include: tracking code repo changes (local or remote), IDE activity, manual time logging, etc. → full discussion deferred to tracking system design.

## Salary Calculation
- **Primary model: Monthly fixed salary** — set monthly rate per user, deductions for absences
- **Data model designed for future flexibility** — don't hardcode monthly assumption, allow for hourly/daily rates later without schema changes
- Leave management: casual / sick / vacation leave types
- Overtime tracking
- Basic deductions
- Exportable salary reports (CSV/PDF) for external payroll software

## Features
- Attendance calendar view (per user, team-wide)
- "Did this person work today?" — derived from all signals (punches + activity)
- Monthly attendance summary
- Salary calculation: base rate - absence deductions + overtime (if applicable)
- Leave request / approval workflow (employee requests, manager approves)
- Export: attendance reports, salary reports

## Data Model (rough)
- `pay_config` — user_id, pay_type (monthly/hourly/daily — monthly for now), rate, currency, effective_from
- `punch_events` — user_id, type (in/out), timestamp, latitude, longitude, source (web/mobile/desktop)
- `attendance_days` — user_id, date, status (present/absent/half-day/leave), derived_from (punch/activity/manual), work_hours
- `leave_types` — name (casual/sick/vacation), days_per_year
- `leave_balances` — user_id, leave_type_id, year, total, used, remaining
- `leave_requests` — user_id, leave_type_id, start_date, end_date, status (pending/approved/rejected), approved_by
- `payroll_periods` — month, year, status (draft/finalized)
- `payroll_entries` — user_id, period_id, base_salary, deductions, overtime, net_amount, exported_at

## Open Questions
- How to handle partial days? (worked 3 hours — present or half-day?)
- Non-AI work tracking system — needs full dedicated discussion
- Grace period for late punch-in?
- Should AI flag anomalies? (e.g. "punched in but zero activity for 6 hours")
- Public holidays / company calendar?
