# ClawLens — Dashboard Codex UI Integration Design

> Date: 2026-03-31
> Status: Approved
> Depends on: `2026-03-31-codex-integration-design.md` (server + client, already implemented)

## Overview

Add Codex data visibility and management to the React dashboard. Shared pages with per-page source filters. Codex-specific sections in User Detail and Subscriptions. Separate credit/rate limit management per provider.

## Approach

Option C: Shared pages for Overview/Users/Analytics with source filters. Codex-specific sections within User Detail for quotas/tokens/subscription. Enhanced Subscriptions page with richer Codex cards.

---

## Per-Page Source Filter

Every data page gets a dropdown at the top: `All | Claude Code | Codex | Antigravity`

- Stored in component state (not global — each page filters independently)
- API calls append `?source=codex` query param when filtered
- `All` omits the param (server returns everything)
- Consistent placement: top-right of page header, before any action buttons

```tsx
<select value={source} onChange={e => setSource(e.target.value)}>
  <option value="">All</option>
  <option value="claude_code">Claude Code</option>
  <option value="codex">Codex</option>
  <option value="antigravity">Antigravity</option>
</select>
```

---

## Page-by-Page Changes

### Overview Page

**User cards** — add Codex stats to the existing 2x2 grid, making it 3x2:

```
CC Prompts: 980       Credits: 32
AG Prompts: 145       Sessions: 12
Codex Prompts: 254    Codex Credits: 78
```

**Live feed** — add a source badge pill on each event:
- `CC` — muted gray
- `Codex` — cyan
- `AG` — purple

Badge appears to the left of the event type, small and unobtrusive.

**Top stats cards** — filtered by source dropdown. When `All`, show combined totals.

### Users Page

- Source filter dropdown at top
- User cards: show per-provider stat rows (CC/AG/Codex) as they already do for CC/AG
- If table/list view exists: add `Codex Prompts` and `Codex Credits` columns

### User Detail Page

This page gets the most changes.

**Two side-by-side credit/limit cards:**

```
┌─ Claude Code ────────────────┐  ┌─ Codex ──────────────────────┐
│  Credits: 32/100 daily       │  │  Credits: 78/200 daily       │
│  Model: Opus (10 cr)         │  │  Model: gpt-5.4 (10 cr)     │
│  Prompts today: 12           │  │  Prompts today: 8            │
│  Rate limit: 100/day         │  │  Rate limit: 200/day         │
└──────────────────────────────┘  └──────────────────────────────┘
```

Each card shows:
- Current credit usage vs limit (from `limits` table filtered by `source`)
- Active model + credit cost per prompt
- Prompt count today (filtered by source)
- Active rate limit rules for that source

**Codex Provider Quotas card** (only shown if user has Codex data):

```
┌─ OpenAI Quotas ─────────────────────────────┐
│  Weekly     ████░░░░░░░░░░░ 2%              │
│             Resets Apr 6                     │
│                                              │
│  5hr        ████████░░░░░░░ 15%             │
│             Resets in 2h 14m                 │
│                                              │
│  Plan: Go                                    │
└──────────────────────────────────────────────┘
```

- Progress bars: green (0-50%), yellow (50-80%), red (80-100%)
- Reset time: relative for <24h ("in 2h 14m"), absolute for >24h ("Apr 6")
- Data from `provider_quotas` table via `GET /api/admin/provider-quotas/:userId`

**Codex Subscription card** (only shown if user has Codex subscription data):

```
┌─ Codex Subscription ────────────────────────┐
│  bashahowin@gmail.com                       │
│  Plan: Go          Auth: Google             │
│  Org: Personal (owner)                      │
│  Active: Nov 4 2025 → Mar 4 2026    🟢     │
└──────────────────────────────────────────────┘
```

- Status indicator: green = active, red = expired, yellow = expiring within 7 days
- Data from `subscriptions` table where `source = 'codex'`

**Prompts table** — source filter dropdown. Codex prompts show additional columns:
- `turn_id`
- `input_tokens` / `output_tokens` / `cached_tokens` / `reasoning_tokens`
- Source badge

**Sessions table** — source filter dropdown. Codex sessions show: `cli_version`, `model_provider`, `reasoning_effort`

**Edit Limits Modal** — add source selector:
- Dropdown at the top: `Claude Code | Codex`
- Model dropdown filters to show only models from selected source (from `model_credits` table)
- Limit saved with `source` column set

### Analytics Page

- Source filter dropdown at top
- All chart queries append `?source=` param
- Same chart types (bar, pie, line, area) — just filtered data
- No structural changes

### Subscriptions Page

**Source tabs**: `All | Claude Code | Codex`

**Claude Code cards** — unchanged from current:
- Email, PRO/MAX badge, users/prompts/credits stats, linked users

**Codex cards** — enhanced layout:

```
┌─────────────────────────────────────────────┐
│  bashahowin@gmail.com              GO 🟢    │
│  Google · Personal org                      │
│  Active: Nov 4 2025 → Mar 4 2026           │
├─────────────────────────────────────────────┤
│  Weekly Quota          5hr Quota            │
│  ████░░░░░░ 2%         ███████░░░ 15%      │
│  Resets Apr 6           Resets in 2h 14m    │
├─────────────────────────────────────────────┤
│  👤 Users    💬 Prompts    🪙 Credits       │
│     2           254           78            │
├─────────────────────────────────────────────┤
│  Linked Users                               │
│  basha        120 prompts    45 credits     │
│  dev2          134 prompts    33 credits    │
└─────────────────────────────────────────────┘
```

- **Plan badge**: GO (green), PRO (blue), PLUS (purple) — color-coded
- **Auth provider + org**: single line
- **Subscription dates**: with status indicator (green/red/yellow based on expiry)
- **Quota progress bars**: two horizontal bars, color shifts green→yellow→red as usage increases. Reset shown as relative (<24h) or absolute (>24h)
- **Stats row**: users, prompts, credits
- **Linked users**: same pattern as CC

**All tab** — both CC and Codex cards mixed. Small source badge in corner of each card (`CC` or `Codex`).

### Prompts Browser

- Source filter dropdown
- Codex prompts show extra columns: `turn_id`, `input_tokens`, `output_tokens`, `cached_tokens`, `reasoning_tokens`
- Source badge column
- CC prompts show those columns as `—`

### Settings Page

**Two separate model credit cards:**

```
┌─ Claude Code Model Credits ──────────────────┐
│  Model        Tier        Credits   [Edit]   │
│  opus         flagship    10                  │
│  sonnet       mid         3                   │
│  haiku        mini        1                   │
└──────────────────────────────────────────────┘

┌─ Codex Model Credits ────────────────────────┐
│  Model              Tier        Credits [Edit]│
│  gpt-5.4            flagship    10            │
│  gpt-5.3-codex      flagship    10            │
│  gpt-5.2            mid         7             │
│  gpt-5.4-mini       mini        2             │
│  gpt-99-turbo       unknown     7    ⚠       │
│  ...                                          │
└──────────────────────────────────────────────┘
```

- Each row is editable (inline edit or modal)
- Unknown tier models show a warning icon — "New model detected, assign credit weight"
- Data from `GET /api/admin/model-credits`
- Updates via `PUT /api/admin/model-credits/:id`

### Audit Log

- Source filter dropdown
- No structural changes

### AI Intelligence

- No changes needed — profiles and team pulse already aggregate across all sources

---

## Admin API Additions

New endpoints:

```
GET  /api/admin/model-credits                — list all model credits (optional ?source=)
PUT  /api/admin/model-credits/:id            — update credit weight + tier
GET  /api/admin/provider-quotas/:userId      — get user's provider quotas
```

Existing endpoints — add `?source=` query param support:

```
GET  /api/admin/subscriptions    — filter by source
GET  /api/admin/users            — include codex stats in response
GET  /api/admin/users/:id        — include codex stats + provider quotas
GET  /api/admin/prompts          — filter by source, include token columns
GET  /api/admin/analytics/*      — filter by source in all analytics queries
```

The `?source=` param filters on the `source` column. When omitted, returns all sources (backward compatible).

---

## Shared Components

### SourceFilter component
Reusable dropdown used on every page:

```tsx
// components/SourceFilter.tsx
function SourceFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className="flex h-9 w-40 rounded-md border ...">
      <option value="">All Sources</option>
      <option value="claude_code">Claude Code</option>
      <option value="codex">Codex</option>
      <option value="antigravity">Antigravity</option>
    </select>
  )
}
```

### SourceBadge component
Small pill showing the source:

```tsx
// components/SourceBadge.tsx
function SourceBadge({ source }: { source: string }) {
  const config = {
    claude_code: { label: 'CC', className: 'bg-gray-100 text-gray-600' },
    codex: { label: 'Codex', className: 'bg-cyan-100 text-cyan-700' },
    antigravity: { label: 'AG', className: 'bg-purple-100 text-purple-700' },
  }
  const c = config[source] || { label: source, className: 'bg-gray-100 text-gray-600' }
  return <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${c.className}`}>{c.label}</span>
}
```

### QuotaBar component
Progress bar for provider quotas:

```tsx
// components/QuotaBar.tsx
function QuotaBar({ percent, label, resetText }: { percent: number; label: string; resetText: string }) {
  const color = percent < 50 ? 'bg-green-500' : percent < 80 ? 'bg-yellow-500' : 'bg-red-500'
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span>{label}</span>
        <span>{percent}%</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${percent}%` }} />
      </div>
      <div className="text-[10px] text-muted-foreground mt-0.5">{resetText}</div>
    </div>
  )
}
```

---

## Data Flow

```
Dashboard page
  → SourceFilter onChange → setSource('codex')
  → API call: GET /api/admin/users?source=codex
  → Server: WHERE source = 'codex' (or omit for all)
  → Response: filtered data
  → UI renders with source-appropriate columns/cards
```

For User Detail with quotas:
```
UserDetail mount
  → GET /api/admin/users/:id (includes codex stats)
  → GET /api/admin/provider-quotas/:userId
  → Render CC card + Codex card + QuotaBars
```

---

## Files Changed

### New files:
- `packages/dashboard/src/components/SourceFilter.tsx`
- `packages/dashboard/src/components/SourceBadge.tsx`
- `packages/dashboard/src/components/QuotaBar.tsx`

### Modified files:
- `packages/dashboard/src/pages/Overview.tsx` — add Codex stats to user cards, source badges in live feed
- `packages/dashboard/src/pages/Users.tsx` — add source filter, Codex stat columns
- `packages/dashboard/src/pages/UserDetail.tsx` — add CC/Codex credit cards, quota bars, subscription card, source filter on tables, edit limits source selector
- `packages/dashboard/src/pages/Analytics.tsx` — add source filter to chart queries
- `packages/dashboard/src/pages/Subscriptions.tsx` — source tabs, enhanced Codex cards with quotas
- `packages/dashboard/src/pages/PromptsBrowser.tsx` — source filter, token columns, source badge
- `packages/dashboard/src/pages/Settings.tsx` — two model credit cards with editable tables
- `packages/dashboard/src/pages/AuditLog.tsx` — source filter
- `packages/dashboard/src/components/EditLimitsModal.tsx` — source selector, filtered model dropdown
- `packages/dashboard/src/lib/api.ts` — new API functions for model-credits, provider-quotas
- `packages/server/src/routes/admin-api.ts` — new endpoints + source filter on existing endpoints
