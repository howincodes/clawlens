# Dashboard Codex UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Codex data visibility, source filtering, provider quotas, and model credit management to the ClawLens React dashboard.

**Architecture:** Per-page source filter dropdowns control API query params. New shared components (SourceFilter, SourceBadge, QuotaBar). Admin API gets source filter support on existing endpoints + 3 new endpoints. Separate CC/Codex credit cards on User Detail. Enhanced Codex subscription cards.

**Tech Stack:** React 19, Vite 8, Tailwind CSS 4, Zustand, Recharts, Express + TypeScript server

**Spec:** `docs/superpowers/specs/2026-03-31-dashboard-codex-ui-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `packages/server/src/routes/admin-api.ts` | New endpoints + source filter on existing |
| Create | `packages/dashboard/src/components/SourceFilter.tsx` | Reusable source dropdown |
| Create | `packages/dashboard/src/components/SourceBadge.tsx` | Source pill badge |
| Create | `packages/dashboard/src/components/QuotaBar.tsx` | Progress bar for provider quotas |
| Modify | `packages/dashboard/src/lib/api.ts` | New API functions |
| Modify | `packages/dashboard/src/pages/Overview.tsx` | Codex stats in user cards, source badges in feed |
| Modify | `packages/dashboard/src/pages/Users.tsx` | Source filter |
| Modify | `packages/dashboard/src/pages/UserDetail.tsx` | CC/Codex credit cards, quotas, subscription |
| Modify | `packages/dashboard/src/pages/Subscriptions.tsx` | Source tabs, enhanced Codex cards |
| Modify | `packages/dashboard/src/pages/Settings.tsx` | Model credits management cards |
| Modify | `packages/dashboard/src/pages/Analytics.tsx` | Source filter on charts |
| Modify | `packages/dashboard/src/pages/PromptsBrowser.tsx` | Source filter, token columns |
| Modify | `packages/dashboard/src/pages/AuditLog.tsx` | Source filter |
| Modify | `packages/dashboard/src/components/EditLimitsModal.tsx` | Source selector, dynamic models |

---

### Task 1: Server — New Admin API Endpoints

**Files:**
- Modify: `packages/server/src/routes/admin-api.ts`

- [ ] **Step 1: Add model-credits GET endpoint**

Add after the existing team endpoints section in `admin-api.ts`:

```typescript
// GET /model-credits
adminRouter.get('/model-credits', authenticateAdmin, (req: Request, res: Response) => {
  try {
    const source = req.query.source as string | undefined;
    const credits = getModelCredits(source || undefined);
    res.json({ data: credits });
  } catch (err: any) {
    console.error('[admin-api] model-credits error:', err);
    res.status(500).json({ error: 'Failed to load model credits' });
  }
});
```

Add the import at the top: `getModelCredits, upsertModelCredit, getProviderQuotas` from `../services/db.js`.

- [ ] **Step 2: Add model-credits PUT endpoint**

```typescript
// PUT /model-credits/:id
adminRouter.put('/model-credits/:id', authenticateAdmin, (req: Request, res: Response) => {
  try {
    const { credits, tier } = req.body;
    const db = getDb();
    const existing = db.prepare('SELECT * FROM model_credits WHERE id = ?').get(req.params.id) as any;
    if (!existing) { res.status(404).json({ error: 'Not found' }); return; }
    db.prepare('UPDATE model_credits SET credits = ?, tier = ? WHERE id = ?')
      .run(credits ?? existing.credits, tier ?? existing.tier, req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    console.error('[admin-api] update model-credit error:', err);
    res.status(500).json({ error: 'Failed to update' });
  }
});
```

- [ ] **Step 3: Add provider-quotas GET endpoint**

```typescript
// GET /provider-quotas/:userId
adminRouter.get('/provider-quotas/:userId', authenticateAdmin, (req: Request, res: Response) => {
  try {
    const source = (req.query.source as string) || 'codex';
    const quotas = getProviderQuotas(req.params.userId, source);
    res.json({ data: quotas });
  } catch (err: any) {
    console.error('[admin-api] provider-quotas error:', err);
    res.status(500).json({ error: 'Failed to load quotas' });
  }
});
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @clawlens/server test`
Expected: All 198 tests pass (new endpoints have no test coverage yet — they're admin endpoints hit by the dashboard)

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/admin-api.ts
git commit -m "feat: add model-credits and provider-quotas admin endpoints"
```

---

### Task 2: Server — Source Filter on Existing Admin Endpoints

**Files:**
- Modify: `packages/server/src/routes/admin-api.ts`

The following existing endpoints need `?source=` query param support. The pattern is: if `req.query.source` is set, add `AND source = ?` to the WHERE clause. If not set, return all sources (backward compatible).

- [ ] **Step 1: Add source filter to GET /subscriptions**

Find the `GET /subscriptions` handler. Add source filter to the main query. The subscriptions table now has a `source` column. When `?source=codex`, filter to codex subscriptions only. Include the new columns (`account_id`, `org_id`, `auth_provider`) in the response.

Add source param handling:
```typescript
const source = req.query.source as string | undefined;
```

Add to the WHERE clause conditionally:
```typescript
const sourceClause = source ? `AND s.source = '${source}'` : '';
// Use in query: ... WHERE 1=1 ${sourceClause} ...
```

Note: Use parameterized queries (not string interpolation) for the actual implementation. The above is pseudocode showing the pattern.

- [ ] **Step 2: Add source filter to GET /prompts**

Find the `GET /prompts` handler. Add `?source=` filter. When source is set, add `AND p.source = ?` to the query. Include `turn_id`, `input_tokens`, `output_tokens`, `cached_tokens`, `reasoning_tokens` in the SELECT for codex prompts.

- [ ] **Step 3: Add source filter to GET /users/:id**

In the user detail endpoint, add codex-specific stats to the response. After fetching CC stats, also fetch:
```typescript
const codexStats = db.prepare(`
  SELECT COUNT(*) as prompts, COALESCE(SUM(credit_cost), 0) as credits
  FROM prompts WHERE user_id = ? AND source = 'codex' AND blocked = 0
`).get(userId) as any;
```

Include `codex_prompts`, `codex_credits` in the response object.

- [ ] **Step 4: Add source filter to GET /users**

In the users list endpoint, add codex stats per user (same pattern as existing CC/AG stats):
```typescript
const codexStats = db.prepare(`
  SELECT COUNT(*) as prompts, COALESCE(SUM(credit_cost), 0) as credits
  FROM prompts WHERE user_id = ? AND source = 'codex' AND blocked = 0
`).get(user.id) as any;
```

Add `codex_prompts` and `codex_credits` to each user object in the response.

- [ ] **Step 5: Add source filter to analytics endpoints**

For `GET /analytics`, `GET /analytics/users`, `GET /analytics/projects`, `GET /analytics/costs` — the `source` param is already passed from the dashboard (`api.ts` lines 82-89 already send `&source=`). Verify the server endpoints respect it. If not, add the filter to the SQL queries — add `AND p.source = ?` when source param is present.

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @clawlens/server test`
Expected: All 198 tests pass

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/routes/admin-api.ts
git commit -m "feat: add source filter to admin API endpoints"
```

---

### Task 3: Dashboard — Shared Components + API Functions

**Files:**
- Create: `packages/dashboard/src/components/SourceFilter.tsx`
- Create: `packages/dashboard/src/components/SourceBadge.tsx`
- Create: `packages/dashboard/src/components/QuotaBar.tsx`
- Modify: `packages/dashboard/src/lib/api.ts`

- [ ] **Step 1: Create SourceFilter.tsx**

```tsx
const SELECT_CLASS = 'flex h-9 w-40 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus:outline-none focus:ring-1 focus:ring-ring'

interface SourceFilterProps {
  value: string
  onChange: (value: string) => void
  className?: string
}

export function SourceFilter({ value, onChange, className }: SourceFilterProps) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className={`${SELECT_CLASS} ${className || ''}`}
    >
      <option value="">All Sources</option>
      <option value="claude_code">Claude Code</option>
      <option value="codex">Codex</option>
      <option value="antigravity">Antigravity</option>
    </select>
  )
}
```

- [ ] **Step 2: Create SourceBadge.tsx**

```tsx
const SOURCE_CONFIG: Record<string, { label: string; className: string }> = {
  claude_code: { label: 'CC', className: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' },
  codex: { label: 'Codex', className: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300' },
  antigravity: { label: 'AG', className: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300' },
}

export function SourceBadge({ source }: { source: string }) {
  const config = SOURCE_CONFIG[source] || { label: source, className: 'bg-gray-100 text-gray-600' }
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium inline-block ${config.className}`}>
      {config.label}
    </span>
  )
}
```

- [ ] **Step 3: Create QuotaBar.tsx**

```tsx
interface QuotaBarProps {
  percent: number
  label: string
  resetText: string
}

export function QuotaBar({ percent, label, resetText }: QuotaBarProps) {
  const color = percent < 50 ? 'bg-green-500' : percent < 80 ? 'bg-yellow-500' : 'bg-red-500'
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">{percent.toFixed(1)}%</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${Math.min(percent, 100)}%` }} />
      </div>
      <div className="text-[10px] text-muted-foreground">{resetText}</div>
    </div>
  )
}
```

- [ ] **Step 4: Add new API functions to api.ts**

Add to `packages/dashboard/src/lib/api.ts`:

```typescript
// ── Model Credits ────────────────────────────────────
export const getModelCredits = (source?: string) =>
  fetchClient(`/model-credits${source ? `?source=${source}` : ''}`)
export const updateModelCredit = (id: number, credits: number, tier?: string) =>
  fetchClient(`/model-credits/${id}`, { method: 'PUT', body: JSON.stringify({ credits, tier }) })

// ── Provider Quotas ──────────────────────────────────
export const getProviderQuotas = (userId: string, source?: string) =>
  fetchClient(`/provider-quotas/${userId}${source ? `?source=${source}` : ''}`)

// ── Update existing functions to support source param ─
```

Also update `getSubscriptions` to accept an optional source:
```typescript
export const getSubscriptions = (source?: string) =>
  fetchClient(`/subscriptions${source ? `?source=${source}` : ''}`)
```

Update `getUsers` to accept source:
```typescript
export const getUsers = (source?: string) =>
  fetchClient(`/users${source ? `?source=${source}` : ''}`)
```

Update `getAllPrompts` — already uses `params` dict, so source can be added by callers.

- [ ] **Step 5: Verify dashboard builds**

Run: `pnpm --filter dashboard build`
Expected: Build succeeds (new components are not imported yet, but syntax should be valid)

- [ ] **Step 6: Commit**

```bash
git add packages/dashboard/src/components/SourceFilter.tsx packages/dashboard/src/components/SourceBadge.tsx packages/dashboard/src/components/QuotaBar.tsx packages/dashboard/src/lib/api.ts
git commit -m "feat: add SourceFilter, SourceBadge, QuotaBar components + API functions"
```

---

### Task 4: Dashboard — Overview Page

**Files:**
- Modify: `packages/dashboard/src/pages/Overview.tsx`

- [ ] **Step 1: Add Codex stats to user cards**

The user cards (around line 555-571) currently show a 2x2 grid: CC Prompts, Credits, AG Prompts, Sessions. Change to 3x2 grid to add Codex data:

```tsx
<div className="grid grid-cols-3 gap-3">
  <div className="text-center p-2 bg-muted/30 rounded">
    <div className="text-lg font-bold">{Number(stats.prompts ?? 0)}</div>
    <div className="text-[10px] text-muted-foreground">CC Prompts</div>
  </div>
  <div className="text-center p-2 bg-muted/30 rounded">
    <div className="text-lg font-bold">{Number(stats.ag_prompts ?? 0)}</div>
    <div className="text-[10px] text-muted-foreground">AG Prompts</div>
  </div>
  <div className="text-center p-2 bg-muted/30 rounded">
    <div className="text-lg font-bold">{Number(stats.codex_prompts ?? 0)}</div>
    <div className="text-[10px] text-muted-foreground">Codex Prompts</div>
  </div>
  <div className="text-center p-2 bg-muted/30 rounded">
    <div className="text-lg font-bold">{Number(stats.credits ?? 0)}</div>
    <div className="text-[10px] text-muted-foreground">CC Credits</div>
  </div>
  <div className="text-center p-2 bg-muted/30 rounded">
    <div className="text-lg font-bold">{Number(stats.codex_credits ?? 0)}</div>
    <div className="text-[10px] text-muted-foreground">Codex Credits</div>
  </div>
  <div className="text-center p-2 bg-muted/30 rounded">
    <div className="text-lg font-bold">{Number(stats.sessions ?? 0)}</div>
    <div className="text-[10px] text-muted-foreground">Sessions</div>
  </div>
</div>
```

- [ ] **Step 2: Add source badge to live feed events**

Import `SourceBadge` from `@/components/SourceBadge`. In the live feed event rendering (around the event list), add a SourceBadge next to each event's type label:

```tsx
<SourceBadge source={event.source || 'claude_code'} />
```

The `source` field is broadcast from the server in the WebSocket event payload (we added `source: SOURCE` to all broadcasts in codex-api.ts).

- [ ] **Step 3: Verify dashboard builds**

Run: `pnpm --filter dashboard build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/src/pages/Overview.tsx
git commit -m "feat: add Codex stats to Overview user cards + source badges in feed"
```

---

### Task 5: Dashboard — Subscriptions Page

**Files:**
- Modify: `packages/dashboard/src/pages/Subscriptions.tsx`

- [ ] **Step 1: Add source tabs and rewrite with Codex card support**

Import: `SourceFilter` from `@/components/SourceFilter`, `QuotaBar` from `@/components/QuotaBar`, `SourceBadge` from `@/components/SourceBadge`, `getProviderQuotas` from `@/lib/api`.

Add `source` state. Pass `source` to `getSubscriptions(source)`. The API already returns subscriptions with the `source` field.

For the card rendering, check `sub.source`:
- If `source === 'codex'`: render enhanced card with plan badge (GO green, PRO blue, PLUS purple), auth provider + org line, subscription dates with active/expired indicator, quota progress bars, stats, linked users.
- If `source === 'claude_code'`: render existing card layout unchanged.
- In "All" mode: show a `SourceBadge` in the top-right corner of each card.

For Codex quota bars, fetch quotas for each subscription's first linked user (or aggregate). Each Codex card shows:
```tsx
<QuotaBar percent={quota.used_percent ?? 0} label="Weekly" resetText={formatReset(quota.resets_at)} />
<QuotaBar percent={secondaryQuota?.used_percent ?? 0} label="5hr" resetText={formatReset(secondaryQuota?.resets_at)} />
```

Add a `formatReset` helper:
```typescript
function formatReset(unixTs: number | null | undefined): string {
  if (!unixTs) return 'N/A'
  const date = new Date(unixTs * 1000)
  const now = new Date()
  const diffMs = date.getTime() - now.getTime()
  if (diffMs < 0) return 'Expired'
  if (diffMs < 86400000) {
    const hours = Math.floor(diffMs / 3600000)
    const mins = Math.floor((diffMs % 3600000) / 60000)
    return `Resets in ${hours}h ${mins}m`
  }
  return `Resets ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
}
```

Subscription date status indicator:
```typescript
function subStatus(activeUntil: string | null): { color: string; label: string } {
  if (!activeUntil) return { color: 'bg-gray-400', label: 'Unknown' }
  const until = new Date(activeUntil)
  const now = new Date()
  const daysLeft = (until.getTime() - now.getTime()) / 86400000
  if (daysLeft < 0) return { color: 'bg-red-500', label: 'Expired' }
  if (daysLeft < 7) return { color: 'bg-yellow-500', label: 'Expiring' }
  return { color: 'bg-green-500', label: 'Active' }
}
```

Plan badge colors:
```typescript
function planBadgeVariant(plan: string): string {
  switch (plan?.toLowerCase()) {
    case 'go': return 'bg-green-100 text-green-700'
    case 'pro': return 'bg-blue-100 text-blue-700'
    case 'plus': return 'bg-purple-100 text-purple-700'
    case 'max': return 'bg-amber-100 text-amber-700'
    default: return 'bg-gray-100 text-gray-700'
  }
}
```

- [ ] **Step 2: Verify dashboard builds**

Run: `pnpm --filter dashboard build`

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard/src/pages/Subscriptions.tsx
git commit -m "feat: enhanced Subscriptions page with Codex cards and quota bars"
```

---

### Task 6: Dashboard — User Detail (Credit Cards + Quotas)

**Files:**
- Modify: `packages/dashboard/src/pages/UserDetail.tsx`

This is the largest page (1859 lines). Make targeted additions, don't restructure.

- [ ] **Step 1: Fetch codex data on mount**

Add state for provider quotas:
```typescript
const [providerQuotas, setProviderQuotas] = useState<any[]>([])
```

In the data fetch effect, add:
```typescript
getProviderQuotas(id, 'codex').then(res => setProviderQuotas(res?.data || [])).catch(() => {})
```

Import `getProviderQuotas` from `@/lib/api`, `QuotaBar` from `@/components/QuotaBar`, `SourceBadge` from `@/components/SourceBadge`, `SourceFilter` from `@/components/SourceFilter`.

- [ ] **Step 2: Add CC/Codex credit cards side by side**

Find the stats/limits section in UserDetail. Add two side-by-side cards after the existing stats:

```tsx
{/* Provider Credit Cards */}
<div className="grid gap-4 md:grid-cols-2">
  {/* Claude Code Card */}
  <Card>
    <CardHeader className="pb-2">
      <CardTitle className="text-sm font-medium flex items-center gap-2">
        <SourceBadge source="claude_code" /> Claude Code Limits
      </CardTitle>
    </CardHeader>
    <CardContent className="space-y-2">
      <div className="flex justify-between text-sm">
        <span>Credits Used</span>
        <span className="font-medium">{userData?.cc_credits_today ?? 0} / {ccLimit?.value ?? '∞'} daily</span>
      </div>
      <div className="flex justify-between text-sm">
        <span>Model</span>
        <span className="font-medium">{normalizeModel(userData?.default_model || 'sonnet')}</span>
      </div>
      <div className="flex justify-between text-sm">
        <span>Prompts Today</span>
        <span className="font-medium">{userData?.cc_prompts_today ?? 0}</span>
      </div>
    </CardContent>
  </Card>

  {/* Codex Card */}
  <Card>
    <CardHeader className="pb-2">
      <CardTitle className="text-sm font-medium flex items-center gap-2">
        <SourceBadge source="codex" /> Codex Limits
      </CardTitle>
    </CardHeader>
    <CardContent className="space-y-2">
      <div className="flex justify-between text-sm">
        <span>Credits Used</span>
        <span className="font-medium">{userData?.codex_credits_today ?? 0} / {codexLimit?.value ?? '∞'} daily</span>
      </div>
      <div className="flex justify-between text-sm">
        <span>Prompts Today</span>
        <span className="font-medium">{userData?.codex_prompts_today ?? 0}</span>
      </div>
    </CardContent>
  </Card>
</div>
```

Derive `ccLimit` and `codexLimit` from the user's limits array:
```typescript
const ccLimit = (userData?.limits || []).find((l: any) => l.type === 'total_credits' && (l.source === 'claude_code' || !l.source))
const codexLimit = (userData?.limits || []).find((l: any) => l.type === 'total_credits' && l.source === 'codex')
```

- [ ] **Step 3: Add Provider Quotas card**

Below the credit cards, if `providerQuotas.length > 0`:

```tsx
{providerQuotas.length > 0 && (
  <Card>
    <CardHeader className="pb-2">
      <CardTitle className="text-sm font-medium">OpenAI Quotas</CardTitle>
    </CardHeader>
    <CardContent className="space-y-4">
      {providerQuotas.map((q: any) => (
        <QuotaBar
          key={q.window_name}
          percent={q.used_percent ?? 0}
          label={q.window_name === 'primary' ? 'Weekly' : '5hr'}
          resetText={formatReset(q.resets_at)}
        />
      ))}
      {providerQuotas[0]?.plan_type && (
        <div className="text-xs text-muted-foreground">Plan: {providerQuotas[0].plan_type.toUpperCase()}</div>
      )}
    </CardContent>
  </Card>
)}
```

Add the `formatReset` helper (same as Task 5):
```typescript
function formatReset(unixTs: number | null | undefined): string {
  if (!unixTs) return 'N/A'
  const date = new Date(unixTs * 1000)
  const now = new Date()
  const diffMs = date.getTime() - now.getTime()
  if (diffMs < 0) return 'Expired'
  if (diffMs < 86400000) {
    const hours = Math.floor(diffMs / 3600000)
    const mins = Math.floor((diffMs % 3600000) / 60000)
    return `Resets in ${hours}h ${mins}m`
  }
  return `Resets ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
}
```

- [ ] **Step 4: Add source filter to prompts and sessions tables**

Add a `promptSource` state. Place a `SourceFilter` above the prompts table. When it changes, re-fetch prompts with the source param:

```typescript
const [promptSource, setPromptSource] = useState('')
```

Update the prompts fetch to include source:
```typescript
getUserPrompts(id, { limit: '500', ...(promptSource ? { source: promptSource } : {}) })
```

For Codex prompts, show `turn_id` and token columns in the table when visible.

- [ ] **Step 5: Verify dashboard builds**

Run: `pnpm --filter dashboard build`

- [ ] **Step 6: Commit**

```bash
git add packages/dashboard/src/pages/UserDetail.tsx
git commit -m "feat: add CC/Codex credit cards, quota bars, source filter to UserDetail"
```

---

### Task 7: Dashboard — Settings Page (Model Credits)

**Files:**
- Modify: `packages/dashboard/src/pages/Settings.tsx`

- [ ] **Step 1: Add model credits cards**

Import `getModelCredits, updateModelCredit` from `@/lib/api`.

Add state:
```typescript
const [ccCredits, setCcCredits] = useState<any[]>([])
const [codexCredits, setCodexCredits] = useState<any[]>([])
const [creditsLoading, setCreditsLoading] = useState(true)
```

Fetch on mount:
```typescript
useEffect(() => {
  Promise.all([
    getModelCredits('claude_code'),
    getModelCredits('codex'),
  ]).then(([cc, codex]) => {
    setCcCredits(cc?.data || [])
    setCodexCredits(codex?.data || [])
  }).finally(() => setCreditsLoading(false))
}, [])
```

Add two cards after the existing settings cards. Each card is an editable table:

```tsx
<Card>
  <CardHeader>
    <CardTitle className="text-lg">Claude Code Model Credits</CardTitle>
    <CardDescription>Credit cost per prompt for each Claude model.</CardDescription>
  </CardHeader>
  <CardContent>
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b text-left">
          <th className="py-2 font-medium">Model</th>
          <th className="py-2 font-medium">Tier</th>
          <th className="py-2 font-medium w-24">Credits</th>
        </tr>
      </thead>
      <tbody>
        {ccCredits.map((mc: any) => (
          <tr key={mc.id} className="border-b">
            <td className="py-2">{mc.model}</td>
            <td className="py-2">
              <span className={`text-xs px-2 py-0.5 rounded-full ${mc.tier === 'unknown' ? 'bg-yellow-100 text-yellow-700' : 'bg-muted text-muted-foreground'}`}>
                {mc.tier || 'unknown'} {mc.tier === 'unknown' && '⚠'}
              </span>
            </td>
            <td className="py-2">
              <Input
                type="number"
                className="h-7 w-20"
                defaultValue={mc.credits}
                onBlur={e => {
                  const val = Number(e.target.value)
                  if (val !== mc.credits) {
                    updateModelCredit(mc.id, val, mc.tier)
                    setCcCredits(prev => prev.map(c => c.id === mc.id ? { ...c, credits: val } : c))
                  }
                }}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </CardContent>
</Card>
```

Repeat the same card for `codexCredits` with title "Codex Model Credits" and description "Credit cost per prompt for each OpenAI Codex model."

- [ ] **Step 2: Verify dashboard builds**

Run: `pnpm --filter dashboard build`

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard/src/pages/Settings.tsx
git commit -m "feat: add model credits management cards to Settings"
```

---

### Task 8: Dashboard — EditLimitsModal (Source Selector)

**Files:**
- Modify: `packages/dashboard/src/components/EditLimitsModal.tsx`

- [ ] **Step 1: Add source tabs to the modal**

The modal currently hardcodes CC models (Opus, Sonnet, Haiku). Add a source selector at the top that switches between CC and Codex model fields.

Add state:
```typescript
const [limitSource, setLimitSource] = useState<'claude_code' | 'codex'>('claude_code')
```

Add a tab selector at the top of `CardContent`:
```tsx
<div className="flex gap-2 mb-4">
  <Button
    type="button"
    variant={limitSource === 'claude_code' ? 'default' : 'outline'}
    size="sm"
    onClick={() => setLimitSource('claude_code')}
  >
    Claude Code
  </Button>
  <Button
    type="button"
    variant={limitSource === 'codex' ? 'default' : 'outline'}
    size="sm"
    onClick={() => setLimitSource('codex')}
  >
    Codex
  </Button>
</div>
```

When `limitSource === 'claude_code'`: show existing Opus/Sonnet/Haiku per-model fields.

When `limitSource === 'codex'`: show Codex per-model fields:
```tsx
<div className="flex gap-4 items-end">
  <div className="flex-1 space-y-2">
    <Label>gpt-5.4 Requests</Label>
    <Input type="number" placeholder="e.g. 50" value={limits.gpt54_cap} onChange={...} />
  </div>
  <div className="w-32 space-y-2">
    <select ...>{/* daily/weekly */}</select>
  </div>
</div>
<div className="flex gap-4 items-end">
  <div className="flex-1 space-y-2">
    <Label>gpt-5.4-mini Requests</Label>
    <Input type="number" placeholder="e.g. 200" value={limits.gpt54mini_cap} onChange={...} />
  </div>
  <div className="w-32 space-y-2">
    <select ...>{/* daily/weekly */}</select>
  </div>
</div>
```

Update `parseLimits` to handle the `source` field on each limit, separating CC from Codex limits.

Update `buildLimitsPayload` to include `source` on each limit object:
```typescript
limits.push({ type: 'per_model', model: 'gpt-5.4', window: form.gpt54_window, value: Number(form.gpt54_cap), source: 'codex' })
```

The credit budget section should also have separate CC and Codex fields, or the source tab controls which budget is being edited.

- [ ] **Step 2: Verify dashboard builds**

Run: `pnpm --filter dashboard build`

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard/src/components/EditLimitsModal.tsx
git commit -m "feat: add source selector to EditLimitsModal for CC/Codex limits"
```

---

### Task 9: Dashboard — Remaining Pages (Source Filters)

**Files:**
- Modify: `packages/dashboard/src/pages/Analytics.tsx`
- Modify: `packages/dashboard/src/pages/PromptsBrowser.tsx`
- Modify: `packages/dashboard/src/pages/AuditLog.tsx`
- Modify: `packages/dashboard/src/pages/Users.tsx`

These all follow the same pattern: add `SourceFilter` dropdown, pass source to API calls.

- [ ] **Step 1: Analytics.tsx**

Import `SourceFilter`. Add `source` state. Place `<SourceFilter>` in the page header next to the existing days selector. Pass `source` to all analytics API calls (`getAnalytics(days, source)`, `getLeaderboard(days, sortBy, source)`, etc.). These API functions already accept a source param (see api.ts lines 82-89).

- [ ] **Step 2: PromptsBrowser.tsx**

Import `SourceFilter`, `SourceBadge`. Add `source` state. Place `<SourceFilter>` next to existing filters. Add `source` to the params when calling `getAllPrompts`. In the table, add a `Source` column using `<SourceBadge source={prompt.source || 'claude_code'} />`. When `source === 'codex'`, show additional columns: `turn_id`, `input_tokens`, `output_tokens`.

- [ ] **Step 3: AuditLog.tsx**

Import `SourceFilter`. Add `source` state. Place `<SourceFilter>` next to existing filters. Pass `source` to `getAuditLog` params.

- [ ] **Step 4: Users.tsx**

Import `SourceFilter`. Add `source` state. Place `<SourceFilter>` in page header. Pass `source` to `getUsers(source)`. In user cards/table, show `codex_prompts` and `codex_credits` (already available from the API after Task 2).

- [ ] **Step 5: Verify dashboard builds**

Run: `pnpm --filter dashboard build`
Expected: Build succeeds

- [ ] **Step 6: Commit**

```bash
git add packages/dashboard/src/pages/Analytics.tsx packages/dashboard/src/pages/PromptsBrowser.tsx packages/dashboard/src/pages/AuditLog.tsx packages/dashboard/src/pages/Users.tsx
git commit -m "feat: add source filter to Analytics, PromptsBrowser, AuditLog, Users pages"
```

---

### Task 10: Full Build + Smoke Test

- [ ] **Step 1: Run server tests**

Run: `pnpm --filter @clawlens/server test`
Expected: All tests pass

- [ ] **Step 2: Build dashboard**

Run: `pnpm --filter dashboard build`
Expected: Build succeeds with no TypeScript errors

- [ ] **Step 3: Start dev server and visually verify**

Run: `PORT=3000 pnpm dev`

Check each page:
- Overview: Codex stats visible in user cards, source badges in live feed
- Users: Source filter works, Codex stats shown
- User Detail: CC/Codex credit cards visible, quota bars if user has Codex data
- Subscriptions: Source tabs work, Codex cards show quotas and plan info
- Settings: Model credits tables for CC and Codex, editable
- Analytics: Source filter changes chart data
- Prompts Browser: Source filter works, token columns for Codex prompts
- Audit Log: Source filter works

- [ ] **Step 4: Commit any fixes**

```bash
git add -A && git commit -m "fix: dashboard build adjustments"
```
