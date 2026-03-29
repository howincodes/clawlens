# ClawLens AI Intelligence — Design Spec

## Goal

Replace the current basic AI summary with a three-layer intelligence system: Session Intelligence (per-session auto-analysis), Developer Profiles (rolling behavioral profiles that evolve over time), and Team Pulse (executive briefing). Every feature has a complete dashboard UI.

---

## Data Available

| Source | Fields | Volume |
|---|---|---|
| Prompts | text, model, credits, blocked, timestamp, session_id | Every prompt |
| Sessions | model, cwd/project, started_at, ended_at, prompt_count, total_credits | Every session |
| Tool events | tool_name, tool_input, tool_output, success | Every tool use |
| Subagent events | agent_type | Every subagent spawn |
| Hook events | all 11 types with full payload | Every hook fire |
| Devices | hostname, platform, os_version | Per SessionStart |

---

## Feature 1: Session Intelligence

### What it does

Automatically analyzes every completed session. When a session ends, the server queues a background AI analysis that produces a structured summary of what happened in that session.

### Trigger

`SessionEnd` hook handler → after recording the event, queue a background job:
```typescript
queueSessionIntelligence(session_id, user_id);
```

The job runs asynchronously (doesn't block the hook response). Uses a simple in-memory queue with concurrency limit of 1 (process one at a time).

### AI Input

For the given session, fetch:
- All prompts (text + model + credits + timestamp)
- All tool events (tool_name, success)
- Session metadata (cwd/project, duration, prompt_count, total_credits)

Build a prompt:
```
Analyze this Claude Code session and return JSON.

Session: {project}, {duration}min, {prompt_count} prompts, {total_credits} credits, model: {model}

Prompts:
1. [10:05] {prompt_text_truncated_200}
2. [10:07] {prompt_text_truncated_200}
...

Tools used: Edit(5), Bash(3), Read(12), Grep(2) — 2 failures

Return JSON with these exact keys:
- "summary": string (1-2 sentences, what was accomplished)
- "categories": string[] (e.g. ["debugging", "feature-dev", "refactoring"])
- "productivity_score": number 0-100 (0=idle chat, 100=highly productive coding)
- "key_actions": string[] (e.g. ["Fixed auth bug", "Added unit tests"])
- "tools_summary": string (1 sentence about tool usage patterns)
```

### AI Output → Stored on session row

New columns on `sessions` table:
```sql
ALTER TABLE sessions ADD COLUMN ai_summary TEXT;
ALTER TABLE sessions ADD COLUMN ai_categories TEXT;       -- JSON array
ALTER TABLE sessions ADD COLUMN ai_productivity_score INTEGER;
ALTER TABLE sessions ADD COLUMN ai_key_actions TEXT;       -- JSON array
ALTER TABLE sessions ADD COLUMN ai_tools_summary TEXT;
ALTER TABLE sessions ADD COLUMN ai_analyzed_at TEXT;
```

### Skip conditions

- Session has < 2 prompts (not worth analyzing)
- Session already has `ai_analyzed_at` set (don't re-analyze)
- Claude CLI not available

### Dashboard UI: Session Intelligence

#### On User Detail page → "Recent Sessions" section

Currently shows: project name, model badge, prompt count, timestamp.

**Enhanced:** Each session row now shows the AI summary inline:

```
┌─────────────────────────────────────────────────────────────────┐
│ 📁 clawlens  SONNET  12 prompts  45 credits  about 2 hours ago │
│                                                                  │
│ "Debugged Stripe webhook verification. Fixed by switching to     │
│  raw body parser. Added integration tests."                      │
│                                                                  │
│ 🏷 debugging  payment  testing     ⚡ Productivity: 85/100      │
│                                                                  │
│ Key: Fixed auth bug • Added 3 unit tests • Refactored handler   │
│ Tools: Heavy Edit + Bash usage, 2 failed Bash attempts          │
└─────────────────────────────────────────────────────────────────┘
```

**Components:**
- AI summary text (1-2 sentences, italic, below the session header)
- Category badges (same style as prompt model badges)
- Productivity score (progress bar or number with color: red <40, yellow 40-70, green >70)
- Key actions (bullet list, collapsible if >3)
- Tools summary (small text)
- "Analyzing..." spinner if session just ended and AI hasn't processed yet
- "Re-analyze" button (small, secondary) to re-run AI on this session

#### On Analytics page

Add a "Session Intelligence" section:
- Average productivity score across team (gauge chart or big number)
- Productivity trend over time (line chart, daily average)
- Most common categories (tag cloud or bar chart)
- Sessions needing attention (productivity < 40)

#### On Prompt Browser

Each prompt card already shows model + credits. Add the session's AI summary as a subtle subtitle when the session has been analyzed:
```
winwin  Sonnet  about 2 hours ago
Session: "Debugged Stripe webhook verification"  ⚡85
```

---

## Feature 2: Developer Profile (Rolling)

### What it does

A cron job runs every 2 hours. For each user with new prompts since their last profile update, it fetches the previous profile + new activity and asks AI to produce an updated profile. The profile accumulates knowledge over days/weeks, becoming a rich behavioral document.

### Database

New table:
```sql
CREATE TABLE IF NOT EXISTS user_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
  profile TEXT NOT NULL,                    -- JSON: the full developer profile
  version INTEGER DEFAULT 1,               -- increments on each update
  prompt_count_at_update INTEGER DEFAULT 0, -- to detect new prompts
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Cron Job

Runs every 2 hours via `node-cron` (same as dead man's switch pattern).

```
For each user in team:
  1. Get current prompt_count for user
  2. Compare with user_profiles.prompt_count_at_update
  3. If no new prompts → skip
  4. Fetch previous profile (or null if first time)
  5. Fetch new prompts + session summaries since last update
  6. Call AI with merge prompt
  7. Store updated profile
```

### AI Input (merge prompt)

```
You are maintaining a developer behavior profile that evolves over time.

PREVIOUS PROFILE:
{previous_profile_json or "No previous profile — this is the first analysis."}

NEW ACTIVITY SINCE LAST UPDATE:
- {N} new prompts across {M} sessions
- Projects: {project_list}
- Models used: {model_breakdown}
- Credits: {total_credits}
- Sessions:
  1. {session_summary_1}
  2. {session_summary_2}
  ...

Sample recent prompts:
1. {prompt_1}
2. {prompt_2}
...

Update the developer profile. Preserve historical observations from the previous profile.
Add new insights from the recent activity. Update trends (improving/declining/stable).

Return JSON with these exact keys:
- "role_estimate": string (e.g. "Senior backend developer")
- "primary_languages": string[] (e.g. ["TypeScript", "Python"])
- "current_focus": string (what they're working on RIGHT NOW)
- "work_patterns": {
    "peak_hours": string,
    "avg_session_length": string,
    "preferred_model": string,
    "session_frequency": string
  }
- "strengths": string[] (observed from their work)
- "growth_areas": string[] (areas where they struggle or seek help)
- "productivity": {
    "score": number 0-100,
    "trend": "improving" | "stable" | "declining",
    "prompts_per_day_avg": number,
    "tool_use_ratio": number 0-1
  }
- "behavioral_notes": string (free-form observations about work style)
- "this_week": string (summary of this week's work)
- "last_week": string (summary of last week's work, carried forward)
- "flags": string[] (concerning patterns: high error rate, declining productivity, etc.)
- "updated_at": string (ISO timestamp)
```

### Dashboard UI: Developer Profile

#### User Detail page → New "AI Profile" card

This is a prominent card, placed right after the stats cards (before watcher section). It's the centerpiece of the user detail page.

```
┌─────────────────────────────────────────────────────────────────────┐
│ 🧠 Developer Profile                    Updated: 30 min ago  [↻]  │
│                                                                      │
│ Senior Backend Developer                                             │
│ TypeScript, Python, Go                                               │
│                                                                      │
│ ┌─────────────────────────────────┐  ┌────────────────────────────┐ │
│ │ Current Focus                    │  │ Productivity        78/100 │ │
│ │ Payment integration with Stripe  │  │ ████████████████░░░░  ↑   │ │
│ │                                  │  │ Trend: Improving          │ │
│ │ This Week                        │  │ 25 prompts/day avg        │ │
│ │ Shipped webhook handlers.        │  │ 70% tool use ratio        │ │
│ │ Started auth middleware refactor. │  │                           │ │
│ └─────────────────────────────────┘  └────────────────────────────┘ │
│                                                                      │
│ Strengths                          Growth Areas                      │
│ ✅ API design                      📚 Frontend React                │
│ ✅ Debugging                       📚 CSS/Styling                   │
│ ✅ Test writing                    📚 Docker                        │
│                                                                      │
│ Work Patterns                                                        │
│ 🕐 Peak: 10am-1pm  📊 Avg session: 35min  🤖 Prefers opus for     │
│    architecture, sonnet for implementation                           │
│                                                                      │
│ Behavioral Notes                                                     │
│ "Starts with broad architecture discussions using opus, then         │
│  switches to sonnet for implementation. Tends to abandon sessions    │
│  after ~45 minutes. Most productive on Mondays. Shows strong         │
│  debugging instincts — typically identifies root cause within        │
│  2-3 prompts."                                                       │
│                                                                      │
│ ⚠ Flags                                                             │
│ • Error rate increasing on Friday sessions                           │
│ • 3 abandoned sessions this week (> normal)                          │
│                                                                      │
│ Last Week: "Completed OAuth integration. Wrote comprehensive         │
│ API documentation for the auth endpoints."                           │
│                                                                      │
│ Profile version: 12 • First seen: March 15, 2026                    │
│ [🔄 Force Update Profile]                                           │
└─────────────────────────────────────────────────────────────────────┘
```

**Detailed component breakdown:**

1. **Header row:** "Developer Profile" title + last updated timestamp + refresh button
2. **Role + Languages:** Large text showing AI's estimate of their role and primary languages
3. **Two-column layout:**
   - Left: Current Focus (what they're working on) + This Week summary
   - Right: Productivity score (number + progress bar + trend arrow ↑↓→ + daily avg + tool ratio)
4. **Strengths + Growth Areas:** Two columns with green checkmarks and book emojis
5. **Work Patterns:** Single row with icons for peak hours, avg session, model preference
6. **Behavioral Notes:** Italic paragraph, the AI's free-form observations
7. **Flags section:** Warning-colored badges for concerning patterns. Only shown if flags exist.
8. **Last Week:** Small text showing carried-forward last week summary
9. **Footer:** Profile version number + first seen date + "Force Update Profile" button

**Interactions:**
- Refresh button (↻) → calls `POST /api/admin/users/:id/profile/update` → regenerates profile now
- "Force Update Profile" button → same, but also shown when profile is stale (>24h old)
- If no profile exists yet → show "No profile yet. Generating..." with a spinner, auto-trigger generation

#### Overview page → User cards

Each user card currently shows: name, email, prompts, credits, sessions, top model.

**Add to each card:**
- AI role estimate (small text under the email): "Senior Backend Developer"
- Productivity score: small badge "⚡78"
- Current focus: one-line text (truncated): "Working on: Payment integration"
- Flag indicator: yellow dot if user has any flags

```
┌────────────────────────────────────┐
│ WI  win        🟢  active   ⚡78  │
│ eatiko.hc@gmail.com                │
│ Senior Backend Developer           │
│ Working on: Payment integration    │
│                                    │
│   4          24 credits            │
│   Prompts    Credits               │
│   1          Opus                  │
│   Sessions   Top Model             │
│                                    │
│ Model: Opus  Credits: 24           │
│                          ▶ ⏸ 🗑   │
└────────────────────────────────────┘
```

---

## Feature 3: Team Pulse (Executive Briefing)

### What it does

Generates a concise team-wide briefing that an admin can read in 30 seconds. Combines all user profiles + today's activity into one digestible report.

### Trigger

Two triggers:
1. **Manual:** Admin clicks "Generate Team Pulse" button on the new AI Intelligence page
2. **Scheduled:** Daily at a configurable time (default: 9 AM, stored in team settings)

### AI Input

```
Generate a team executive briefing. Be concise — the reader has 30 seconds.

TEAM: {team_name}, {user_count} developers

USER PROFILES:
{for each user}
- {name}: {role_estimate}, productivity {score}/100 ({trend}), current focus: {current_focus}, flags: {flags}
{end for}

TODAY'S ACTIVITY:
- Total prompts: {n}, Total credits: {n}, Active users: {n}/{total}
- Models: opus {n}%, sonnet {n}%, haiku {n}%
- Per user today: {name}: {prompts} prompts, {credits} credits
{end per user}

COST BREAKDOWN:
- Total credits today: {n}
- Per user: {name}: {n} credits
- Per model: opus: {n}, sonnet: {n}, haiku: {n}

Return JSON with these exact keys:
- "headline": string (one sentence team status)
- "active_summary": string (who's active, who's not)
- "shipping": [{"user": "name", "work": "description"}] (who's shipping and what)
- "needs_attention": [{"user": "name", "issue": "description"}] (who needs help)
- "cost_insight": string (1-2 sentences on credit usage)
- "trend": string (1 sentence on team direction)
- "recommendations": string[] (actionable suggestions for admin)
```

### Database

New table:
```sql
CREATE TABLE IF NOT EXISTS team_pulses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id TEXT NOT NULL,
  pulse TEXT NOT NULL,          -- JSON: the full pulse data
  generated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Dashboard UI: Team Pulse

#### New "AI Intelligence" page (replaces current "AI Summaries" page)

This becomes the AI hub. Three tabs: **Team Pulse** | **Developer Profiles** | **Session Log**

**Tab 1: Team Pulse**

```
┌──────────────────────────────────────────────────────────────────────┐
│ 🧠 AI Intelligence                                                   │
│                                                                       │
│ [Team Pulse]  [Developer Profiles]  [Session Log]                    │
│ ═══════════                                                           │
│                                                                       │
│ ┌────────────────────────────────────────────────────────────────┐   │
│ │ TEAM PULSE — March 30, 2026                  [🔄 Generate Now] │   │
│ │ Generated: 9:00 AM today                                       │   │
│ │                                                                 │   │
│ │ "Team is productive — 4/5 devs active, shipping features       │   │
│ │  on schedule. One developer needs attention."                   │   │
│ │                                                                 │   │
│ │ ── WHO'S SHIPPING ──────────────────────────────────────────── │   │
│ │ 🟢 John — Payment integration (12 sessions, on track)          │   │
│ │ 🟢 Sarah — API documentation (5 sessions, wrapping up)         │   │
│ │ 🟢 Mike — Auth refactor (3 sessions, good progress)            │   │
│ │                                                                 │   │
│ │ ── NEEDS ATTENTION ─────────────────────────────────────────── │   │
│ │ 🔴 Alex — Stuck on CI pipeline (5 failed attempts, error      │   │
│ │          rate 3x normal). Consider pairing with Mike.           │   │
│ │ ⚪ Tom — Inactive for 3 days                                   │   │
│ │                                                                 │   │
│ │ ── COST INSIGHT ────────────────────────────────────────────── │   │
│ │ 450 credits used today (budget: 1000)                           │   │
│ │ John: 200 (44%) — high but productive                           │   │
│ │ Sarah: 150 — mostly sonnet, very efficient                      │   │
│ │                                                                 │   │
│ │ ── TREND ───────────────────────────────────────────────────── │   │
│ │ Team productivity up 15% from last week. Opus usage down 10%   │   │
│ │ (good — team is learning when sonnet suffices).                 │   │
│ │                                                                 │   │
│ │ ── RECOMMENDATIONS ─────────────────────────────────────────── │   │
│ │ • Pair Alex with Mike on CI issues                              │   │
│ │ • Check in with Tom — 3 days inactive                           │   │
│ │ • Consider setting opus limit for Sarah (using only sonnet)    │   │
│ └────────────────────────────────────────────────────────────────┘   │
│                                                                       │
│ Previous Pulses:                                                      │
│ ┌──────────────────────────────────────────────────────────────┐     │
│ │ March 29 — "Strong day. 3 features shipped. One stuck dev."  │     │
│ │ March 28 — "Quiet day. Only 2 active. Post-sprint recovery." │     │
│ │ March 27 — "Sprint end. 5/5 active. 800 credits used."      │     │
│ └──────────────────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────────────┘
```

**Components:**
- Generate Now button (top right)
- Latest pulse card with sections: headline, shipping, needs attention, cost, trend, recommendations
- Each section has its own visual treatment (green for shipping, red for attention, blue for cost)
- Previous pulses list (click to expand, shows full pulse)
- Auto-generation schedule indicator: "Next auto-pulse: Tomorrow 9:00 AM"

**Tab 2: Developer Profiles**

List of all users with their AI profiles in card format.

```
┌──────────────────────────────────────────────────────────────────────┐
│ [Team Pulse]  [Developer Profiles]  [Session Log]                    │
│                ═══════════════════                                    │
│                                                                       │
│ ┌──────────────────────────────────────┐ ┌──────────────────────────┐│
│ │ John Smith              ⚡ 85  ↑     │ │ Sarah Lee     ⚡ 72  →  ││
│ │ Senior Backend Developer             │ │ Full-Stack Developer     ││
│ │                                      │ │                          ││
│ │ Focus: Payment integration           │ │ Focus: API docs          ││
│ │ This week: Shipped webhook handlers  │ │ This week: OpenAPI specs ││
│ │                                      │ │                          ││
│ │ Strengths: API, debugging            │ │ Strengths: Frontend, UX  ││
│ │ Growth: React, CSS                   │ │ Growth: DevOps           ││
│ │                                      │ │                          ││
│ │ ⚠ Friday error rate increasing      │ │ No flags                 ││
│ │                                      │ │                          ││
│ │ [View Full Profile]                  │ │ [View Full Profile]      ││
│ └──────────────────────────────────────┘ └──────────────────────────┘│
│                                                                       │
│ ┌──────────────────────────────────────┐ ┌──────────────────────────┐│
│ │ Mike Chen               ⚡ 68  ↓     │ │ Alex Kim     ⚡ 45  ↓  ││
│ │ Junior Developer                     │ │ DevOps Engineer          ││
│ │ ...                                  │ │ ...                      ││
│ └──────────────────────────────────────┘ └──────────────────────────┘│
└──────────────────────────────────────────────────────────────────────┘
```

**"View Full Profile" click:** Opens the User Detail page scrolled to the AI Profile card.

**Components per card:**
- Name + productivity score with trend arrow
- Role estimate
- Current focus
- This week summary
- Strengths (top 2) + Growth areas (top 2)
- Flags (if any, shown as warning badge)
- "View Full Profile" link

**Tab 3: Session Log**

Replaces the old summaries list. Shows all sessions with AI analysis.

```
┌──────────────────────────────────────────────────────────────────────┐
│ [Team Pulse]  [Developer Profiles]  [Session Log]                    │
│                                      ═══════════                     │
│                                                                       │
│ Filters: [User: All ▼]  [Date: Today ▼]  [Min Score: 0 ▼]         │
│                                                                       │
│ ┌────────────────────────────────────────────────────────────────┐   │
│ │ John  📁 clawlens  OPUS  12 prompts  45 credits   2h ago  ⚡85│   │
│ │ "Debugged Stripe webhook verification. Fixed by switching to   │   │
│ │  raw body parser. Added integration tests."                    │   │
│ │ 🏷 debugging  payment  testing                                 │   │
│ │ Key: Fixed auth bug • Added 3 tests • Refactored handler      │   │
│ └────────────────────────────────────────────────────────────────┘   │
│                                                                       │
│ ┌────────────────────────────────────────────────────────────────┐   │
│ │ Sarah  📁 api-docs  SONNET  8 prompts  24 credits  3h ago ⚡72│   │
│ │ "Wrote OpenAPI specifications for auth and payment endpoints." │   │
│ │ 🏷 documentation  api                                          │   │
│ └────────────────────────────────────────────────────────────────┘   │
│                                                                       │
│ ┌────────────────────────────────────────────────────────────────┐   │
│ │ Alex  📁 ci-pipeline  SONNET  15 prompts  45 credits  4h ⚡32 │   │
│ │ "Attempted to fix CI pipeline. Multiple failed approaches.     │   │
│ │  No resolution reached."                                       │   │
│ │ 🏷 devops  debugging  ⚠ low productivity                      │   │
│ └────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

**Filters:**
- User dropdown (all or specific user)
- Date range (today, this week, this month, custom)
- Minimum productivity score (slider or dropdown: 0, 25, 50, 75)

**Each session card:**
- User name + project + model badge + prompts + credits + relative time + productivity score
- AI summary text
- Category badges
- Key actions (if available)
- Low productivity warning if score < 40

---

## Server Architecture

### Background Job Queue

Simple in-memory queue. No Redis, no external deps.

```typescript
// services/ai-jobs.ts
const jobQueue: Array<() => Promise<void>> = [];
let processing = false;

function enqueueJob(job: () => Promise<void>): void {
  jobQueue.push(job);
  processNext();
}

async function processNext(): Promise<void> {
  if (processing || jobQueue.length === 0) return;
  processing = true;
  const job = jobQueue.shift()!;
  try { await job(); } catch (e) { console.error('[ai-jobs] job failed:', e); }
  processing = false;
  processNext();
}
```

### Session Intelligence Job

```typescript
// Queued from hook-api.ts on SessionEnd
enqueueJob(() => analyzeSession(sessionId, userId));
```

### Profile Update Cron

```typescript
// Started in server.ts alongside dead man's switch
import cron from 'node-cron';

cron.schedule('0 */2 * * *', () => {  // every 2 hours
  updateAllProfiles();
});
```

### API Endpoints

**Session Intelligence:**
- `POST /api/admin/sessions/:id/analyze` — manually trigger analysis for a session
- Sessions already returned by `GET /users/:id/sessions` — just include new AI columns

**Developer Profiles:**
- `GET /api/admin/users/:id/profile` — get user's current AI profile
- `POST /api/admin/users/:id/profile/update` — force regenerate profile now
- `GET /api/admin/profiles` — list all user profiles (for the Developer Profiles tab)

**Team Pulse:**
- `POST /api/admin/pulse/generate` — generate team pulse now
- `GET /api/admin/pulse` — get latest pulse
- `GET /api/admin/pulse/history` — get previous pulses

### AI Configuration (admin settings)

Stored in team settings or a new `ai_config` table:

```json
{
  "session_intelligence": true,       // auto-analyze sessions
  "profile_update_hours": 2,          // how often to update profiles
  "pulse_auto_time": "09:00",         // daily auto-pulse time (null = disabled)
  "ai_model": "sonnet",               // model for AI calls (sonnet recommended)
  "profile_depth": "full"             // "full" | "work_only" (configurable depth)
}
```

**Dashboard: Settings page** gets a new "AI Intelligence" section:

```
┌─────────────────────────────────────────────────────────────────┐
│ 🧠 AI Intelligence Settings                                     │
│                                                                   │
│ Session Intelligence          [====ON====]                       │
│ Auto-analyze completed sessions                                  │
│                                                                   │
│ Developer Profile Updates     Every [ 2 ] hours                  │
│ Rolling behavioral profiles                                      │
│                                                                   │
│ Daily Team Pulse              [ 09:00 ] (local time)             │
│ Auto-generate executive briefing                                 │
│                                                                   │
│ AI Model                      [ Sonnet ▼ ]                       │
│ Used for all AI analysis                                         │
│                                                                   │
│ Profile Depth                 [ Full behavioral ▼ ]              │
│ Full = work + habits + behavioral notes                          │
│ Work only = projects + productivity only                         │
│                                                                   │
│ [Save Settings]                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Navigation Update

The sidebar currently has:
```
DASHBOARD
  Overview
  Users
  Subscriptions
  Analytics
  AI Summaries      ← rename
  Prompts Browser

SYSTEM
  Settings
  Audit Log
```

Change to:
```
DASHBOARD
  Overview
  Users
  Subscriptions
  Analytics
  AI Intelligence   ← renamed, new page with 3 tabs
  Prompts Browser

SYSTEM
  Settings          ← add AI settings section
  Audit Log
```

---

## Cost Estimate

For a team of 10 users, 8 hours/day:

| Feature | Frequency | Calls/day | Cost/day (~) |
|---|---|---|---|
| Session Intelligence | Per session (~5/user/day) | 50 | $2.50 |
| Developer Profiles | Every 2h for active users | ~30 | $1.50 |
| Team Pulse | 1x daily | 1 | $0.10 |
| **Total** | | ~81 | **~$4.10/day** |

Using sonnet model. Opus would be 3x more expensive.

---

## Files to Create/Modify

| File | Action | Purpose |
|---|---|---|
| `packages/server/src/services/ai-jobs.ts` | Create | Background job queue + session analysis + profile update + team pulse |
| `packages/server/src/services/claude-ai.ts` | Modify | Add new AI prompts for session, profile, pulse |
| `packages/server/src/services/db.ts` | Modify | New tables + columns + helpers |
| `packages/server/src/routes/admin-api.ts` | Modify | New endpoints for profiles, pulse, session analysis |
| `packages/server/src/routes/hook-api.ts` | Modify | Queue session intelligence on SessionEnd |
| `packages/server/src/server.ts` | Modify | Start profile update cron |
| `packages/dashboard/src/pages/AIIntelligence.tsx` | Create | New page with 3 tabs (replaces Summaries.tsx) |
| `packages/dashboard/src/pages/UserDetail.tsx` | Modify | Add AI Profile card + enhanced sessions |
| `packages/dashboard/src/pages/Overview.tsx` | Modify | Add profile data to user cards |
| `packages/dashboard/src/pages/Settings.tsx` | Modify | Add AI Intelligence settings section |
| `packages/dashboard/src/pages/Analytics.tsx` | Modify | Add session intelligence section |
| `packages/dashboard/src/pages/PromptsBrowser.tsx` | Modify | Add session context to prompt cards |
| `packages/dashboard/src/lib/api.ts` | Modify | New API functions |
| `packages/dashboard/src/App.tsx` (or router) | Modify | Rename route, update sidebar |
| `packages/server/tests/ai-jobs.test.ts` | Create | Tests for job queue + AI functions |

---

## What Gets Removed

- Current `Summaries.tsx` page → replaced by `AIIntelligence.tsx`
- Current `summaries` table → kept for backward compatibility but new features use `user_profiles` and `team_pulses`
- Current `POST /summaries/generate` endpoint → replaced by new endpoints (keep old one working for backward compat)
