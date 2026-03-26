# ClawLens Dashboard — Feature Requirements

> **For the UI agent.** This document describes WHAT the dashboard needs to do. All design decisions (layout, components, design system, animations, colors) are yours. Make it look like a premium SaaS product.

**Stack:** React + TypeScript + Tailwind (+ whatever UI library you choose)
**Served at:** `/dashboard/` path on the Express server
**API base:** same origin — `/api/admin/*` for all endpoints
**Auth:** JWT token stored in localStorage, sent as `Authorization: Bearer <token>`
**Real-time:** WebSocket at `/ws` for live updates

---

## Pages

### 1. Login

- Password input + submit
- Error state on wrong password
- Redirect to overview on success
- Store JWT in localStorage

### 2. Overview (home)

**Stats row:**
- Total users (count)
- Active now (users with a session in last 5 min)
- Prompts today (count)
- Cost today ($)

**Subscription groups:**
- Cards grouped by subscription email
- Each card shows: email, plan type (Pro/Max), number of users on this subscription, total cost
- Click to expand and see users in that subscription

**User cards:**
- Each user: name, avatar (initials), status badge (active/paused/killed), current model
- Usage bars: per-model with limits shown
- Credit gauge if credit budget set
- Quick actions: pause, resume, kill
- Click card → user detail page

**Live feed:**
- Real-time scrolling event list from WebSocket
- Events: prompt submitted, prompt blocked, turn completed, session started/ended, errors
- Each event: timestamp, user name, action, model, project

### 3. User Detail

**Header:**
- User name, status badge, subscription email, devices count
- Action buttons: kill, pause, reinstate, delete

**Stats cards:**
- Total prompts (all time + today)
- Total cost (all time + today)
- Lines of code added/removed
- Average turns per session
- Sessions today
- Devices

**Latest AI summary:**
- Show the most recent daily summary
- Categories breakdown (debugging %, feature dev %, etc.)
- Productivity score, prompt quality score
- "Generate summary now" button

**Charts:**
- Daily usage trend (prompts per day, 30 days)
- Model distribution (donut/pie)
- Tool usage breakdown (which tools they use most)
- Peak hours (bar chart, 0-23h)

**Devices table:**
- Hostname, platform, arch, OS version, Claude version, last seen, IP

**Top projects table:**
- Project name, prompt count, cost, last used

**Limits section (if rate limiting enabled):**
- Current rules displayed
- Edit limits button → opens modal/form
- Same limit types as claude-code-limiter: per_model, credits, time_of_day

**Recent prompts:**
- Expandable list of last N prompts
- Show: timestamp, model, prompt text (if collected), response preview (if collected), tools used, project
- Pagination or infinite scroll
- Search/filter by text, model, project

**Recent sessions:**
- Session list with: start time, duration, prompt count, model, project, cost

### 4. Subscriptions

**Subscription cards:**
- One card per unique Claude subscription email
- Shows: email, display name, org name, plan type (Pro/Max), billing type
- Total users on this subscription
- Total cost, total prompts
- List of users under this subscription with their individual stats

**Use case:** Admin sees "We have 3 subscriptions: alice@co (Max, 2 users, $45/week), bob@co (Pro, 1 user, $8/week), shared@co (Max, 3 users, $62/week)"

### 5. Analytics

**Day range selector:** 7 / 14 / 30 / 90 days

**Leaderboard:**
- Users ranked by: prompts, cost, productivity score (sortable)
- Show: rank, name, prompts, cost, sessions, avg turns, model preference

**Cost report:**
- Total cost for period
- Cost per user (bar chart)
- Cost per project (bar chart)
- Cost per subscription (bar chart)
- Cost trend (line chart over time)

**Model usage:**
- Distribution: opus vs sonnet vs haiku (donut)
- Per-user model preference (stacked bar)
- Model efficiency: who uses expensive models unnecessarily

**Tool usage:**
- Most used tools across team (bar chart)
- Per-user tool preference
- Tool error rates

**Project heat map:**
- Projects ranked by AI usage
- Which users work on which projects

**Error rates:**
- Tool failures per user
- Anthropic rate limit hits per user
- Trends over time

**User comparison:**
- Select two users → side-by-side stats

### 6. AI Summaries

**Latest summaries:**
- Per-user daily summaries (most recent first)
- Each summary card: user name, period, summary text, categories pie, scores

**Weekly team summary:**
- Full team summary at the top
- What the team focused on, notable insights

**Timeline:**
- Scroll through historical summaries
- Filter by user, date range

**Generate now:**
- Button to trigger on-demand summary generation
- Shows progress/loading state

### 7. Prompts Browser

**Full-text search** across all collected prompts

**Filters:**
- User
- Model
- Project
- Date range
- Has response (yes/no)
- Was blocked (yes/no)

**Prompt cards:**
- Timestamp, user, model, project
- Prompt text (expandable)
- Response text (expandable, if collected)
- Tools used in this turn
- Turn duration

**Pagination** — server-side, 50 per page

### 8. Settings

**Team settings:**
- Team name

**Collection settings:**
- Collection level: off / summaries / full (dropdown)
- Collect responses: on / off (toggle)
- Prompt retention: N days (input, 0 = forever)

**AI Summary settings:**
- Summary interval: N hours (input, 0 = disabled)
- Provider: claude-code / anthropic-api / openai / custom (dropdown)
- API key (input, shown as dots)
- Custom URL (input, shown if provider = custom)

**Rate limiting:**
- Credit weights: opus / sonnet / haiku cost (number inputs)

**Webhooks:**
- Slack webhook URL (input)
- Discord webhook URL (input)
- Alert on block (toggle)
- Alert on kill (toggle)
- Daily digest (toggle)
- Weekly digest (toggle)

**Danger zone:**
- Change admin password (current + new + confirm)
- Export all data (CSV / JSON buttons)

### 9. Audit Log

**Chronological list** of admin actions:
- Timestamp, actor, action, target, details
- Filter by action type
- Pagination

---

## Real-time (WebSocket)

Connect to `/ws` on mount. Auto-reconnect with exponential backoff.

**Events to handle:**
- `prompt_submitted` → add to live feed, update user card stats
- `prompt_blocked` → add to live feed with warning style, show toast
- `turn_completed` → add to live feed, update usage counters
- `session_started` / `session_ended` → update active session count
- `tool_used` / `tool_failed` → add to live feed
- `user_killed` / `user_paused` / `user_reinstated` → update user status badge, show toast
- `rate_limit_hit` → add to live feed with error style, show toast
- `summary_generated` → show toast, refresh summaries page if open

**Connection indicator** in sidebar: green dot = connected, yellow = reconnecting, red = disconnected

---

## API Endpoints Reference

All admin endpoints require `Authorization: Bearer <jwt>` header.

| Method | Endpoint | Returns |
|--------|----------|---------|
| POST | `/api/admin/login` | `{ token, team }` |
| GET | `/api/admin/team` | `{ id, name, settings }` |
| PUT | `/api/admin/team` | `{ id, name, settings }` |
| GET | `/api/admin/subscriptions` | `{ subscriptions: [{ email, type, users: [...] }] }` |
| GET | `/api/admin/users` | `{ users: [{ id, name, status, usage, devices, ... }] }` |
| POST | `/api/admin/users` | `{ user, install_code }` |
| GET | `/api/admin/users/:id` | `{ user, analytics, devices, limits, latestSummary }` |
| PUT | `/api/admin/users/:id` | `{ user }` |
| DELETE | `/api/admin/users/:id` | `{ deleted: true }` |
| GET | `/api/admin/users/:id/prompts?page=1&limit=50` | `{ prompts: [...], total, page }` |
| GET | `/api/admin/users/:id/sessions` | `{ sessions: [...] }` |
| GET | `/api/admin/analytics?days=7` | `{ overview, trends, models, tools, peakHours }` |
| GET | `/api/admin/analytics/users?days=7&sortBy=prompts` | `{ leaderboard: [...] }` |
| GET | `/api/admin/analytics/projects?days=7` | `{ projects: [...] }` |
| GET | `/api/admin/analytics/costs?days=7` | `{ byUser, byProject, bySubscription, trend }` |
| GET | `/api/admin/summaries?userId=x&days=30` | `{ summaries: [...] }` |
| POST | `/api/admin/summaries/generate` | `{ status: "started" }` |
| GET | `/api/admin/audit-log?page=1` | `{ entries: [...], total }` |
| GET | `/api/admin/export/prompts?days=30&format=csv` | CSV or JSON file |
| GET | `/api/admin/export/usage?days=30&format=csv` | CSV or JSON file |

---

## Add User Flow

1. Admin clicks "Add User"
2. Form: name, slug (auto from name)
3. Optional: set limits (presets or custom)
4. Submit → server creates user + returns install code
5. Show install command with copy button:
   ```
   sudo npx @howincodes/clawlens setup --code CLM-alice-abc123 --server https://your-server
   ```
6. Admin sends this to the developer

## Kill/Pause/Reinstate Flow

1. Admin clicks Kill/Pause on user card or detail page
2. Confirmation dialog with warning text
3. On confirm → PUT /api/admin/users/:id with { status: "killed" | "paused" | "active" }
4. Toast notification
5. User card updates in real-time via WebSocket

## Edit Limits Flow

1. Admin clicks "Edit Limits" on user detail
2. Modal/form with current limits pre-filled
3. Sections: credit budget (value + window), per-model caps (opus/sonnet/haiku + window), time-of-day rules
4. Save → PUT /api/admin/users/:id with { limits: [...] }
