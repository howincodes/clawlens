# Codex Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add full OpenAI Codex support to ClawLens — hooks, rate limiting, kill switch, subscription tracking, credit system — with CC parity.

**Architecture:** New `codex-api.ts` route file with 5 endpoints, shared DB/auth/WebSocket layer. New `clawlens-codex.mjs` client hook. New `model_credits` and `provider_quotas` tables. Source column on all relevant tables. Existing CC code untouched.

**Tech Stack:** Express + TypeScript server, better-sqlite3, Zod validation, zero-dep Node.js client (.mjs)

**Spec:** `docs/superpowers/specs/2026-03-31-codex-integration-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `packages/server/src/services/db.ts` | New tables, columns, helpers |
| Create | `packages/server/src/schemas/codex-events.ts` | Zod schemas for Codex hook payloads |
| Create | `packages/server/src/routes/codex-api.ts` | 5 Codex hook endpoints |
| Modify | `packages/server/src/server.ts` | Mount codex router |
| Create | `client/clawlens-codex.mjs` | Codex hook handler (zero-dep) |
| Create | `packages/server/tests/codex-api.test.ts` | Codex route tests |
| Modify | `packages/server/tests/db.test.ts` | Tests for new DB helpers |

Dashboard changes deferred to a follow-up plan.

---

### Task 1: Database — New Tables + Migrations

**Files:**
- Modify: `packages/server/src/services/db.ts`

- [ ] **Step 1: Add `model_credits` table to `runMigrations`**

In `db.ts` `runMigrations()`, add after the existing `CREATE TABLE` block (before the indexes):

```sql
-- Model credit weights (configurable per model per source)
CREATE TABLE IF NOT EXISTS model_credits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  model TEXT NOT NULL,
  credits INTEGER DEFAULT 7,
  tier TEXT,
  UNIQUE(source, model)
);

-- Provider quotas (OpenAI rate limit windows)
CREATE TABLE IF NOT EXISTS provider_quotas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id),
  source TEXT NOT NULL,
  window_name TEXT NOT NULL,
  plan_type TEXT,
  used_percent REAL,
  window_minutes INTEGER,
  resets_at INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, source, window_name)
);
```

- [ ] **Step 2: Add incremental column migrations**

Add after the existing incremental migrations in `runMigrations()`:

```typescript
// Codex source columns
const sourceColumns = [
  { table: 'prompts', col: "source TEXT DEFAULT 'claude_code'" },
  { table: 'prompts', col: 'turn_id TEXT' },
  { table: 'prompts', col: 'input_tokens INTEGER' },
  { table: 'prompts', col: 'cached_tokens INTEGER' },
  { table: 'prompts', col: 'output_tokens INTEGER' },
  { table: 'prompts', col: 'reasoning_tokens INTEGER' },
  { table: 'tool_events', col: "source TEXT DEFAULT 'claude_code'" },
  { table: 'tool_events', col: 'tool_use_id TEXT' },
  { table: 'hook_events', col: "source TEXT DEFAULT 'claude_code'" },
  { table: 'limits', col: "source TEXT DEFAULT 'claude_code'" },
  { table: 'subscriptions', col: "source TEXT DEFAULT 'claude_code'" },
  { table: 'subscriptions', col: 'account_id TEXT' },
  { table: 'subscriptions', col: 'org_id TEXT' },
  { table: 'subscriptions', col: 'auth_provider TEXT' },
  { table: 'sessions', col: 'cli_version TEXT' },
  { table: 'sessions', col: 'model_provider TEXT' },
  { table: 'sessions', col: 'reasoning_effort TEXT' },
];
for (const { table, col } of sourceColumns) {
  try { database.exec(`ALTER TABLE ${table} ADD COLUMN ${col}`); } catch {}
}
```

- [ ] **Step 3: Seed default model credits**

Add at the end of `runMigrations()`:

```typescript
// Seed model credits if table is empty
const creditCount = database.prepare('SELECT COUNT(*) as c FROM model_credits').get() as any;
if (creditCount.c === 0) {
  const seed = database.prepare('INSERT OR IGNORE INTO model_credits (source, model, credits, tier) VALUES (?, ?, ?, ?)');
  // Claude Code
  seed.run('claude_code', 'opus', 10, 'flagship');
  seed.run('claude_code', 'sonnet', 3, 'mid');
  seed.run('claude_code', 'haiku', 1, 'mini');
  // Codex
  seed.run('codex', 'gpt-5.4', 10, 'flagship');
  seed.run('codex', 'gpt-5.3-codex', 10, 'flagship');
  seed.run('codex', 'gpt-5.3-codex-spark', 10, 'flagship');
  seed.run('codex', 'gpt-5.2-codex', 10, 'flagship');
  seed.run('codex', 'gpt-5.2', 7, 'mid');
  seed.run('codex', 'gpt-5.1-codex-max', 7, 'mid');
  seed.run('codex', 'gpt-5.1', 5, 'mid');
  seed.run('codex', 'gpt-5.1-codex', 5, 'mid');
  seed.run('codex', 'gpt-5-codex', 5, 'mid');
  seed.run('codex', 'gpt-5', 5, 'mid');
  seed.run('codex', 'gpt-5.4-mini', 2, 'mini');
  seed.run('codex', 'gpt-5.1-codex-mini', 2, 'mini');
  seed.run('codex', 'gpt-5-codex-mini', 2, 'mini');
}
```

- [ ] **Step 4: Run tests to verify migrations don't break existing DB**

Run: `pnpm --filter @clawlens/server test`
Expected: All 183 tests pass (migrations are additive, no breaking changes)

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/db.ts
git commit -m "feat: add model_credits, provider_quotas tables + codex columns"
```

---

### Task 2: Database — New Helper Functions

**Files:**
- Modify: `packages/server/src/services/db.ts`
- Modify: `packages/server/tests/db.test.ts`

- [ ] **Step 1: Add type interfaces**

Add after existing interfaces in `db.ts`:

```typescript
export interface ModelCreditRow {
  id: number;
  source: string;
  model: string;
  credits: number;
  tier: string | null;
}

export interface ProviderQuotaRow {
  id: number;
  user_id: string;
  source: string;
  window_name: string;
  plan_type: string | null;
  used_percent: number | null;
  window_minutes: number | null;
  resets_at: number | null;
  updated_at: string;
}
```

- [ ] **Step 2: Add `getCreditCostFromDb` helper**

```typescript
export function getCreditCostFromDb(model: string, source: string): number {
  const database = getDb();
  const row = database.prepare(
    'SELECT credits FROM model_credits WHERE source = ? AND model = ?'
  ).get(source, model) as { credits: number } | undefined;

  if (row) return row.credits;

  // Auto-insert unknown model with default credit
  const defaultCredit = source === 'claude_code' ? 3 : 7;
  database.prepare(
    'INSERT OR IGNORE INTO model_credits (source, model, credits, tier) VALUES (?, ?, ?, ?)'
  ).run(source, model, defaultCredit, 'unknown');

  return defaultCredit;
}
```

- [ ] **Step 3: Add `upsertProviderQuota` helper**

```typescript
export function upsertProviderQuota(params: {
  user_id: string;
  source: string;
  window_name: string;
  plan_type?: string;
  used_percent?: number;
  window_minutes?: number;
  resets_at?: number;
}): void {
  const database = getDb();
  database.prepare(`
    INSERT INTO provider_quotas (user_id, source, window_name, plan_type, used_percent, window_minutes, resets_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, source, window_name) DO UPDATE SET
      plan_type = excluded.plan_type,
      used_percent = excluded.used_percent,
      window_minutes = excluded.window_minutes,
      resets_at = excluded.resets_at,
      updated_at = datetime('now')
  `).run(params.user_id, params.source, params.window_name, params.plan_type ?? null, params.used_percent ?? null, params.window_minutes ?? null, params.resets_at ?? null);
}
```

- [ ] **Step 4: Add `getProviderQuotas` helper**

```typescript
export function getProviderQuotas(userId: string, source: string): ProviderQuotaRow[] {
  const database = getDb();
  return database.prepare(
    'SELECT * FROM provider_quotas WHERE user_id = ? AND source = ? ORDER BY window_name'
  ).all(userId, source) as ProviderQuotaRow[];
}
```

- [ ] **Step 5: Add `getModelCredits` and `upsertModelCredit` helpers**

```typescript
export function getModelCredits(source?: string): ModelCreditRow[] {
  const database = getDb();
  if (source) {
    return database.prepare('SELECT * FROM model_credits WHERE source = ? ORDER BY credits DESC').all(source) as ModelCreditRow[];
  }
  return database.prepare('SELECT * FROM model_credits ORDER BY source, credits DESC').all() as ModelCreditRow[];
}

export function upsertModelCredit(source: string, model: string, credits: number, tier?: string): void {
  const database = getDb();
  database.prepare(`
    INSERT INTO model_credits (source, model, credits, tier)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(source, model) DO UPDATE SET credits = excluded.credits, tier = excluded.tier
  `).run(source, model, credits, tier ?? null);
}
```

- [ ] **Step 6: Write tests for new helpers**

Add to `db.test.ts`:

```typescript
describe('Model Credits', () => {
  it('should return seeded credit for known model', () => {
    const cost = getCreditCostFromDb('gpt-5.4', 'codex');
    expect(cost).toBe(10);
  });

  it('should auto-insert unknown model with default 7 for codex', () => {
    const cost = getCreditCostFromDb('gpt-99-turbo', 'codex');
    expect(cost).toBe(7);
    const credits = getModelCredits('codex');
    expect(credits.find(c => c.model === 'gpt-99-turbo')).toBeDefined();
  });

  it('should auto-insert unknown model with default 3 for claude_code', () => {
    const cost = getCreditCostFromDb('claude-99', 'claude_code');
    expect(cost).toBe(3);
  });

  it('should upsert model credit', () => {
    upsertModelCredit('codex', 'gpt-5.4', 15, 'flagship');
    const cost = getCreditCostFromDb('gpt-5.4', 'codex');
    expect(cost).toBe(15);
  });
});

describe('Provider Quotas', () => {
  it('should upsert and retrieve provider quotas', () => {
    const user = createUser({ team_id: team.id, name: 'Quota User', auth_token: 'tok-quota' });
    upsertProviderQuota({
      user_id: user.id,
      source: 'codex',
      window_name: 'primary',
      plan_type: 'go',
      used_percent: 2.0,
      window_minutes: 10080,
      resets_at: 1775537916,
    });
    const quotas = getProviderQuotas(user.id, 'codex');
    expect(quotas).toHaveLength(1);
    expect(quotas[0].plan_type).toBe('go');
    expect(quotas[0].used_percent).toBe(2.0);
  });

  it('should update existing quota on conflict', () => {
    const user = createUser({ team_id: team.id, name: 'Quota User 2', auth_token: 'tok-quota2' });
    upsertProviderQuota({ user_id: user.id, source: 'codex', window_name: 'primary', used_percent: 2.0 });
    upsertProviderQuota({ user_id: user.id, source: 'codex', window_name: 'primary', used_percent: 15.0 });
    const quotas = getProviderQuotas(user.id, 'codex');
    expect(quotas).toHaveLength(1);
    expect(quotas[0].used_percent).toBe(15.0);
  });
});
```

- [ ] **Step 7: Run tests**

Run: `pnpm --filter @clawlens/server test`
Expected: All existing + new tests pass

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/services/db.ts packages/server/tests/db.test.ts
git commit -m "feat: add getCreditCostFromDb, provider quota, model credit helpers"
```

---

### Task 3: Zod Schemas for Codex Events

**Files:**
- Create: `packages/server/src/schemas/codex-events.ts`

- [ ] **Step 1: Create the schema file**

```typescript
import { z } from 'zod';

export const CodexSessionStartEvent = z.object({
  session_id: z.string(),
  hook_event_name: z.literal('SessionStart').optional(),
  model: z.string().optional(),
  cwd: z.string().optional(),
  permission_mode: z.string().optional(),
  source: z.string().optional(),
  transcript_path: z.string().optional(),
  // Enriched by client from auth.json JWT
  subscription_email: z.string().optional(),
  plan_type: z.string().optional(),
  auth_provider: z.string().optional(),
  account_id: z.string().optional(),
  openai_user_id: z.string().optional(),
  subscription_active_start: z.string().optional(),
  subscription_active_until: z.string().optional(),
  org_id: z.string().optional(),
  org_title: z.string().optional(),
  cli_version: z.string().optional(),
  model_provider: z.string().optional(),
  reasoning_effort: z.string().optional(),
  hostname: z.string().optional(),
  platform: z.string().optional(),
});

export const CodexPromptEvent = z.object({
  session_id: z.string(),
  hook_event_name: z.literal('UserPromptSubmit').optional(),
  turn_id: z.string().optional(),
  prompt: z.string().optional(),
  model: z.string().optional(),
  cwd: z.string().optional(),
  permission_mode: z.string().optional(),
  transcript_path: z.string().optional(),
});

export const CodexPreToolUseEvent = z.object({
  session_id: z.string(),
  hook_event_name: z.literal('PreToolUse').optional(),
  turn_id: z.string().optional(),
  tool_name: z.string().optional(),
  tool_input: z.any().optional(),
  tool_use_id: z.string().optional(),
  model: z.string().optional(),
  cwd: z.string().optional(),
  permission_mode: z.string().optional(),
  transcript_path: z.string().optional(),
});

export const CodexPostToolUseEvent = z.object({
  session_id: z.string(),
  hook_event_name: z.literal('PostToolUse').optional(),
  turn_id: z.string().optional(),
  tool_name: z.string().optional(),
  tool_input: z.any().optional(),
  tool_response: z.string().optional(),
  tool_use_id: z.string().optional(),
  model: z.string().optional(),
  cwd: z.string().optional(),
  permission_mode: z.string().optional(),
  transcript_path: z.string().optional(),
});

export const CodexStopEvent = z.object({
  session_id: z.string(),
  hook_event_name: z.literal('Stop').optional(),
  turn_id: z.string().optional(),
  last_assistant_message: z.string().optional(),
  stop_hook_active: z.boolean().optional(),
  model: z.string().optional(),
  cwd: z.string().optional(),
  permission_mode: z.string().optional(),
  transcript_path: z.string().optional(),
  // Enriched by client from transcript token_count
  input_tokens: z.number().optional(),
  cached_tokens: z.number().optional(),
  output_tokens: z.number().optional(),
  reasoning_tokens: z.number().optional(),
  total_tokens: z.number().optional(),
  quota_primary_used_percent: z.number().optional(),
  quota_primary_window_minutes: z.number().optional(),
  quota_primary_resets_at: z.number().optional(),
  quota_secondary_used_percent: z.number().optional(),
  quota_secondary_window_minutes: z.number().optional(),
  quota_secondary_resets_at: z.number().optional(),
  quota_plan_type: z.string().optional(),
});
```

- [ ] **Step 2: Commit**

```bash
git add packages/server/src/schemas/codex-events.ts
git commit -m "feat: add Zod schemas for Codex hook events"
```

---

### Task 4: Server Routes — `codex-api.ts`

**Files:**
- Create: `packages/server/src/routes/codex-api.ts`

- [ ] **Step 1: Create the route file with session-start endpoint**

```typescript
import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  createSession,
  recordPrompt,
  recordHookEvent,
  recordToolEvent,
  touchUserLastEvent,
  getUserCreditUsage,
  getUserModelCreditUsage,
  getSessionById,
  incrementSessionPromptCount,
  getLimitsByUser,
  getDb,
  createSubscription,
  updateUser,
  getCreditCostFromDb,
  upsertProviderQuota,
} from '../services/db.js';
import { broadcast } from '../services/websocket.js';
import {
  CodexSessionStartEvent,
  CodexPromptEvent,
  CodexPreToolUseEvent,
  CodexPostToolUseEvent,
  CodexStopEvent,
} from '../schemas/codex-events.js';

const DEBUG = process.env.CLAWLENS_DEBUG === '1' || process.env.CLAWLENS_DEBUG === 'true';
function debug(msg: string): void {
  if (DEBUG) console.log(`[codex-api] ${msg}`);
}

const SOURCE = 'codex';

function ensureCodexSession(sessionId: string | undefined, userId: string, model?: string, cwd?: string) {
  if (!sessionId) return;
  const existing = getSessionById(sessionId);
  if (!existing) {
    try {
      const db = getDb();
      db.prepare(
        `INSERT INTO sessions (id, user_id, model, cwd, source) VALUES (?, ?, ?, ?, ?)`
      ).run(sessionId, userId, model ?? null, cwd ?? null, SOURCE);
    } catch {}
  }
}

export const codexRouter = Router();

// POST /session-start
codexRouter.post('/session-start', (req: Request, res: Response) => {
  debug('──── codex /session-start ────');
  try {
    const user = req.user!;
    const body = req.body;
    const parsed = CodexSessionStartEvent.safeParse(body);
    const data = parsed.success ? parsed.data : body;

    if (user.status === 'killed' || user.status === 'paused') {
      recordHookEvent({ user_id: user.id, session_id: data.session_id, event_type: 'SessionStart', payload: JSON.stringify(body) });
      touchUserLastEvent(user.id);
      // For hard kill, tell client to run codex logout
      if (user.status === 'killed') {
        res.json({ decision: 'block', killed: true, hard: true });
      } else {
        res.json({ decision: 'block' });
      }
      return;
    }

    const model = data.model || user.default_model || 'gpt-5.4';

    // Create session with source = 'codex'
    const db = getDb();
    db.prepare(
      `INSERT INTO sessions (id, user_id, model, cwd, source, cli_version, model_provider, reasoning_effort)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(data.session_id, user.id, model, data.cwd ?? null, SOURCE, data.cli_version ?? null, data.model_provider ?? 'openai', data.reasoning_effort ?? null);

    // Update user email from subscription if needed
    const userUpdates: Record<string, string> = {};
    if (data.subscription_email && (!user.email || user.email === '')) {
      userUpdates.email = data.subscription_email;
    }
    if (data.model && data.model !== user.default_model) {
      userUpdates.default_model = data.model;
    }
    if (Object.keys(userUpdates).length > 0) {
      try { updateUser(user.id, userUpdates); } catch {}
    }

    // Handle subscription
    if (data.subscription_email || data.plan_type) {
      try {
        const sub = createSubscription({
          email: data.subscription_email || user.email || '',
          subscription_type: data.plan_type || 'go',
          plan_name: data.org_title || undefined,
        });
        // Update subscription source fields
        if (sub) {
          db.prepare(`UPDATE subscriptions SET source = ?, account_id = ?, org_id = ?, auth_provider = ? WHERE id = ?`)
            .run(SOURCE, data.account_id ?? null, data.org_id ?? null, data.auth_provider ?? null, sub.id);
          if (!user.subscription_id) {
            updateUser(user.id, { subscription_id: String(sub.id) });
          }
        }
      } catch {}
    }

    touchUserLastEvent(user.id);
    recordHookEvent({ user_id: user.id, session_id: data.session_id, event_type: 'SessionStart', payload: JSON.stringify(body) });

    broadcast({
      type: 'session_start',
      source: SOURCE,
      user_id: user.id,
      user_name: user.name,
      model,
      subscription_email: data.subscription_email,
      hostname: data.hostname,
      platform: data.platform,
    });

    res.json({});
  } catch (err: any) {
    console.error('[codex-api] session-start error:', err);
    res.json({});
  }
});
```

- [ ] **Step 2: Add prompt endpoint with rate limiting**

```typescript
// POST /prompt
codexRouter.post('/prompt', (req: Request, res: Response) => {
  debug('──── codex /prompt ────');
  try {
    const user = req.user!;
    const body = req.body;
    const parsed = CodexPromptEvent.safeParse(body);
    const data = parsed.success ? parsed.data : body;

    if (user.status === 'killed' || user.status === 'paused') {
      try {
        recordPrompt({
          session_id: data.session_id,
          user_id: user.id,
          prompt: data.prompt,
          model: user.default_model ?? undefined,
          credit_cost: 0,
          blocked: true,
          block_reason: 'Account suspended.',
        });
      } catch {}
      try {
        recordHookEvent({ user_id: user.id, session_id: data.session_id, event_type: 'UserPromptSubmit', payload: JSON.stringify(body) });
      } catch {}
      touchUserLastEvent(user.id);
      res.json({ decision: 'block' });
      return;
    }

    ensureCodexSession(data.session_id, user.id, data.model, data.cwd);
    const session = getSessionById(data.session_id);
    const model = data.model || session?.model || user.default_model || 'gpt-5.4';

    if (data.model && session && data.model !== session.model) {
      const db = getDb();
      db.prepare('UPDATE sessions SET model = ? WHERE id = ?').run(data.model, data.session_id);
    }

    const creditCost = getCreditCostFromDb(model, SOURCE);

    // Check credit limits (same logic as CC)
    const limits = getLimitsByUser(user.id);
    let blocked = false;
    let blockReason = '';

    for (const limit of limits) {
      if (limit.type === 'total_credits') {
        const window = limit.window as 'daily' | 'hourly' | 'monthly';
        const usage = getUserCreditUsage(user.id, window);
        if (usage + creditCost > limit.value) {
          blocked = true;
          blockReason = `Credit limit reached. ${window} usage: ${usage}/${limit.value}`;
          break;
        }
      } else if (limit.type === 'per_model') {
        if (!limit.model) continue;
        const window = limit.window as 'daily' | 'hourly' | 'monthly';
        const usage = getUserModelCreditUsage(user.id, limit.model, window);
        if (usage + creditCost > limit.value) {
          blocked = true;
          blockReason = `Credit limit reached. ${limit.model} ${window} usage: ${usage}/${limit.value}`;
          break;
        }
      } else if (limit.type === 'time_of_day') {
        const currentHour = new Date().getHours();
        if (currentHour >= (limit.start_hour ?? 0) && currentHour < (limit.end_hour ?? 24)) {
          blocked = true;
          blockReason = `Usage blocked during hours ${limit.start_hour}-${limit.end_hour}.`;
          break;
        }
      }
    }

    if (blocked) {
      recordPrompt({ session_id: data.session_id, user_id: user.id, prompt: data.prompt, model, credit_cost: 0, blocked: true, block_reason: blockReason });
      recordHookEvent({ user_id: user.id, session_id: data.session_id, event_type: 'UserPromptSubmit', payload: JSON.stringify(body) });
      touchUserLastEvent(user.id);
      broadcast({ type: 'prompt', source: SOURCE, user_id: user.id, user_name: user.name, prompt: data.prompt?.slice(0, 100), blocked: true });
      res.json({ decision: 'block' });
      return;
    }

    // Record prompt with turn_id
    const db = getDb();
    db.prepare(
      `INSERT INTO prompts (session_id, user_id, prompt, model, credit_cost, source, turn_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(data.session_id, user.id, data.prompt ?? null, model, creditCost, SOURCE, data.turn_id ?? null);

    incrementSessionPromptCount(data.session_id, creditCost);
    touchUserLastEvent(user.id);
    recordHookEvent({ user_id: user.id, session_id: data.session_id, event_type: 'UserPromptSubmit', payload: JSON.stringify(body) });
    broadcast({ type: 'prompt', source: SOURCE, user_id: user.id, user_name: user.name, prompt: data.prompt?.slice(0, 100), blocked: false });

    res.json({});
  } catch (err: any) {
    console.error('[codex-api] prompt error:', err);
    res.json({});
  }
});
```

- [ ] **Step 3: Add pre-tool, post-tool, and stop endpoints**

```typescript
// POST /pre-tool-use
codexRouter.post('/pre-tool-use', (req: Request, res: Response) => {
  debug('──── codex /pre-tool-use ────');
  try {
    const user = req.user!;
    const body = req.body;
    const parsed = CodexPreToolUseEvent.safeParse(body);
    const data = parsed.success ? parsed.data : body;

    if (user.status === 'killed' || user.status === 'paused') {
      recordHookEvent({ user_id: user.id, session_id: data.session_id, event_type: 'PreToolUse', payload: JSON.stringify(body) });
      touchUserLastEvent(user.id);
      res.json({ decision: 'block' });
      return;
    }

    const db = getDb();
    db.prepare(
      `INSERT INTO tool_events (user_id, session_id, tool_name, tool_input, source, tool_use_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(user.id, data.session_id, data.tool_name ?? 'unknown', JSON.stringify(data.tool_input)?.slice(0, 500), SOURCE, data.tool_use_id ?? null);

    touchUserLastEvent(user.id);
    recordHookEvent({ user_id: user.id, session_id: data.session_id, event_type: 'PreToolUse', payload: JSON.stringify(body) });
    broadcast({ type: 'tool_use', source: SOURCE, user_id: user.id, user_name: user.name, tool_name: data.tool_name });

    res.json({});
  } catch (err: any) {
    console.error('[codex-api] pre-tool-use error:', err);
    res.json({});
  }
});

// POST /post-tool-use
codexRouter.post('/post-tool-use', (req: Request, res: Response) => {
  debug('──── codex /post-tool-use ────');
  try {
    const user = req.user!;
    const body = req.body;
    const parsed = CodexPostToolUseEvent.safeParse(body);
    const data = parsed.success ? parsed.data : body;

    // Update tool_output on existing tool event
    if (data.tool_use_id) {
      const db = getDb();
      db.prepare(
        `UPDATE tool_events SET tool_output = ?, success = 1 WHERE tool_use_id = ? AND source = ?`
      ).run((data.tool_response ?? '').slice(0, 2000), data.tool_use_id, SOURCE);
    }

    touchUserLastEvent(user.id);
    recordHookEvent({ user_id: user.id, session_id: data.session_id, event_type: 'PostToolUse', payload: JSON.stringify(body) });

    res.json({});
  } catch (err: any) {
    console.error('[codex-api] post-tool-use error:', err);
    res.json({});
  }
});

// POST /stop
codexRouter.post('/stop', (req: Request, res: Response) => {
  debug('──── codex /stop ────');
  try {
    const user = req.user!;
    const body = req.body;
    const parsed = CodexStopEvent.safeParse(body);
    const data = parsed.success ? parsed.data : body;

    ensureCodexSession(data.session_id, user.id, data.model);
    const session = getSessionById(data.session_id);
    const model = session?.model ?? data.model ?? user.default_model ?? 'gpt-5.4';

    // Update last prompt with response text and token counts
    if (data.last_assistant_message || data.output_tokens) {
      const db = getDb();
      db.prepare(
        `UPDATE prompts SET response = ?, input_tokens = ?, cached_tokens = ?, output_tokens = ?, reasoning_tokens = ?
         WHERE session_id = ? AND source = ? AND response IS NULL ORDER BY id DESC LIMIT 1`
      ).run(
        data.last_assistant_message ?? null,
        data.input_tokens ?? null,
        data.cached_tokens ?? null,
        data.output_tokens ?? null,
        data.reasoning_tokens ?? null,
        data.session_id,
        SOURCE,
      );
    }

    // Update provider quotas
    if (data.quota_primary_used_percent != null) {
      upsertProviderQuota({
        user_id: user.id,
        source: SOURCE,
        window_name: 'primary',
        plan_type: data.quota_plan_type,
        used_percent: data.quota_primary_used_percent,
        window_minutes: data.quota_primary_window_minutes,
        resets_at: data.quota_primary_resets_at,
      });
    }
    if (data.quota_secondary_used_percent != null) {
      upsertProviderQuota({
        user_id: user.id,
        source: SOURCE,
        window_name: 'secondary',
        plan_type: data.quota_plan_type,
        used_percent: data.quota_secondary_used_percent,
        window_minutes: data.quota_secondary_window_minutes,
        resets_at: data.quota_secondary_resets_at,
      });
    }

    touchUserLastEvent(user.id);
    recordHookEvent({ user_id: user.id, session_id: data.session_id, event_type: 'Stop', payload: JSON.stringify(body) });
    broadcast({ type: 'stop', source: SOURCE, user_id: user.id, user_name: user.name, model });

    res.json({});
  } catch (err: any) {
    console.error('[codex-api] stop error:', err);
    res.json({});
  }
});
```

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/routes/codex-api.ts
git commit -m "feat: add codex-api.ts with 5 hook endpoints"
```

---

### Task 5: Mount Codex Router in Server

**Files:**
- Modify: `packages/server/src/server.ts`

- [ ] **Step 1: Add import and mount**

Add import at the top with other route imports:

```typescript
import { codexRouter } from './routes/codex-api.js';
```

Add after the existing hook route mount (`app.use('/api/v1/hook', hookAuth, hookRouter);`):

```typescript
app.use('/api/v1/codex', hookAuth, codexRouter);
```

- [ ] **Step 2: Run tests**

Run: `pnpm --filter @clawlens/server test`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/server.ts
git commit -m "feat: mount codex router at /api/v1/codex"
```

---

### Task 6: Tests for Codex API Routes

**Files:**
- Create: `packages/server/tests/codex-api.test.ts`

- [ ] **Step 1: Create test file with setup**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import {
  initDb,
  closeDb,
  createTeam,
  createUser,
  createLimit,
  getSessionById,
  getDb,
  getProviderQuotas,
  getCreditCostFromDb,
  type UserRow,
  type TeamRow,
} from '../src/services/db.js';
import { app } from '../src/server.js';

let team: TeamRow;
let activeUser: UserRow;
let killedUser: UserRow;

const ACTIVE_TOKEN = 'tok-codex-active';
const KILLED_TOKEN = 'tok-codex-killed';

beforeEach(() => {
  initDb(':memory:');
  team = createTeam({ name: 'Codex Test Team', slug: 'codex-test' });
  activeUser = createUser({ team_id: team.id, name: 'Codex User', auth_token: ACTIVE_TOKEN });
  killedUser = createUser({ team_id: team.id, name: 'Killed Codex User', auth_token: KILLED_TOKEN });
  const db = getDb();
  db.prepare(`UPDATE users SET status = 'killed' WHERE id = ?`).run(killedUser.id);
  killedUser = db.prepare(`SELECT * FROM users WHERE id = ?`).get(killedUser.id) as UserRow;
});

afterEach(() => { closeDb(); });

describe('Codex API - Session Start', () => {
  it('should create a codex session with source=codex', async () => {
    const res = await request(app)
      .post('/api/v1/codex/session-start')
      .set('Authorization', `Bearer ${ACTIVE_TOKEN}`)
      .send({ session_id: 'codex-sess-1', model: 'gpt-5.4', cwd: '/tmp', hook_event_name: 'SessionStart' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
    const session = getSessionById('codex-sess-1');
    expect(session).toBeDefined();
    expect(session!.source).toBe('codex');
    expect(session!.model).toBe('gpt-5.4');
  });

  it('should block killed user with hard kill', async () => {
    const res = await request(app)
      .post('/api/v1/codex/session-start')
      .set('Authorization', `Bearer ${KILLED_TOKEN}`)
      .send({ session_id: 'codex-sess-killed', model: 'gpt-5.4' });
    expect(res.status).toBe(200);
    expect(res.body.decision).toBe('block');
    expect(res.body.killed).toBe(true);
    expect(res.body.hard).toBe(true);
  });
});

describe('Codex API - Prompt', () => {
  it('should record prompt with codex credit cost', async () => {
    await request(app).post('/api/v1/codex/session-start').set('Authorization', `Bearer ${ACTIVE_TOKEN}`)
      .send({ session_id: 'codex-sess-2', model: 'gpt-5.4' });

    const res = await request(app)
      .post('/api/v1/codex/prompt')
      .set('Authorization', `Bearer ${ACTIVE_TOKEN}`)
      .send({ session_id: 'codex-sess-2', prompt: 'hello codex', turn_id: 'turn-1', model: 'gpt-5.4' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({});

    const db = getDb();
    const prompt = db.prepare('SELECT * FROM prompts WHERE session_id = ? AND source = ?').get('codex-sess-2', 'codex') as any;
    expect(prompt).toBeDefined();
    expect(prompt.prompt).toBe('hello codex');
    expect(prompt.turn_id).toBe('turn-1');
    expect(prompt.credit_cost).toBe(10); // gpt-5.4 = 10 credits
  });

  it('should block prompt when credit limit exceeded', async () => {
    createLimit({ user_id: activeUser.id, type: 'total_credits', value: 5, window: 'daily' });
    await request(app).post('/api/v1/codex/session-start').set('Authorization', `Bearer ${ACTIVE_TOKEN}`)
      .send({ session_id: 'codex-sess-3', model: 'gpt-5.4' });

    // First prompt uses 10 credits (gpt-5.4), which exceeds 5 limit
    const res = await request(app)
      .post('/api/v1/codex/prompt')
      .set('Authorization', `Bearer ${ACTIVE_TOKEN}`)
      .send({ session_id: 'codex-sess-3', prompt: 'should be blocked', model: 'gpt-5.4' });
    expect(res.body.decision).toBe('block');
  });

  it('should block killed user prompt', async () => {
    const res = await request(app)
      .post('/api/v1/codex/prompt')
      .set('Authorization', `Bearer ${KILLED_TOKEN}`)
      .send({ session_id: 'codex-sess-killed', prompt: 'hey' });
    expect(res.body.decision).toBe('block');
  });
});

describe('Codex API - Tool Use', () => {
  it('should record pre and post tool events with tool_use_id', async () => {
    await request(app).post('/api/v1/codex/session-start').set('Authorization', `Bearer ${ACTIVE_TOKEN}`)
      .send({ session_id: 'codex-sess-4', model: 'gpt-5.4' });

    await request(app).post('/api/v1/codex/pre-tool-use').set('Authorization', `Bearer ${ACTIVE_TOKEN}`)
      .send({ session_id: 'codex-sess-4', tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: 'call_abc123' });

    await request(app).post('/api/v1/codex/post-tool-use').set('Authorization', `Bearer ${ACTIVE_TOKEN}`)
      .send({ session_id: 'codex-sess-4', tool_name: 'Bash', tool_response: 'file1.txt', tool_use_id: 'call_abc123' });

    const db = getDb();
    const tool = db.prepare('SELECT * FROM tool_events WHERE tool_use_id = ? AND source = ?').get('call_abc123', 'codex') as any;
    expect(tool).toBeDefined();
    expect(tool.tool_name).toBe('Bash');
    expect(tool.tool_output).toBe('file1.txt');
  });
});

describe('Codex API - Stop', () => {
  it('should update provider quotas on stop', async () => {
    await request(app).post('/api/v1/codex/session-start').set('Authorization', `Bearer ${ACTIVE_TOKEN}`)
      .send({ session_id: 'codex-sess-5', model: 'gpt-5.4' });
    await request(app).post('/api/v1/codex/prompt').set('Authorization', `Bearer ${ACTIVE_TOKEN}`)
      .send({ session_id: 'codex-sess-5', prompt: 'test', model: 'gpt-5.4' });

    const res = await request(app).post('/api/v1/codex/stop').set('Authorization', `Bearer ${ACTIVE_TOKEN}`)
      .send({
        session_id: 'codex-sess-5',
        last_assistant_message: 'Done!',
        output_tokens: 100,
        input_tokens: 5000,
        quota_primary_used_percent: 5.0,
        quota_primary_window_minutes: 10080,
        quota_primary_resets_at: 1775537916,
        quota_plan_type: 'go',
      });
    expect(res.status).toBe(200);

    const quotas = getProviderQuotas(activeUser.id, 'codex');
    expect(quotas).toHaveLength(1);
    expect(quotas[0].used_percent).toBe(5.0);
    expect(quotas[0].plan_type).toBe('go');

    const db = getDb();
    const prompt = db.prepare('SELECT * FROM prompts WHERE session_id = ? AND source = ?').get('codex-sess-5', 'codex') as any;
    expect(prompt.response).toBe('Done!');
    expect(prompt.output_tokens).toBe(100);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `pnpm --filter @clawlens/server test`
Expected: All existing + new Codex tests pass

- [ ] **Step 3: Commit**

```bash
git add packages/server/tests/codex-api.test.ts
git commit -m "test: add codex-api route tests"
```

---

### Task 7: Client — `clawlens-codex.mjs`

**Files:**
- Create: `client/clawlens-codex.mjs`

- [ ] **Step 1: Create the client hook handler**

This is a standalone zero-dep Node.js script that mirrors `clawlens.mjs` but for Codex. Full file at `client/clawlens-codex.mjs`:

```javascript
#!/usr/bin/env node

// ClawLens Codex Hook Handler
// Reads Codex hook JSON from stdin, enriches it, POSTs to server.
// Returns server response to stdout (for blocking decisions).
// Fails open on any error — never breaks Codex.

import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir, hostname, platform, release } from 'os';

const VERSION = '1.0.0';
const HOME = homedir();
const CODEX_DIR = join(HOME, '.codex');
const HOOKS_DIR = join(CODEX_DIR, 'hooks');
const DEBUG = true;
const LOG_FILE = join(HOOKS_DIR, '.clawlens-codex-debug.log');

function debug(msg) {
  if (!DEBUG) return;
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  try { process.stderr.write(line + '\n'); } catch {}
  try {
    mkdirSync(dirname(LOG_FILE), { recursive: true });
    appendFileSync(LOG_FILE, line + '\n');
  } catch {}
}

const SERVER_URL = process.env.CLAWLENS_SERVER || '';
const AUTH_TOKEN = process.env.CLAWLENS_TOKEN || '';

debug(`──── ClawLens Codex hook v${VERSION} starting ────`);
debug(`SERVER_URL=${SERVER_URL || '(empty)'}`);
debug(`AUTH_TOKEN=${AUTH_TOKEN ? AUTH_TOKEN.slice(0, 8) + '...' : '(empty)'}`);

if (!SERVER_URL || !AUTH_TOKEN) {
  debug('EXITING: missing SERVER_URL or AUTH_TOKEN');
  process.exit(0);
}

// ── Helpers ──────────────────────────────────────────

function readJSON(filepath) {
  try {
    const raw = readFileSync(filepath, 'utf8');
    const obj = JSON.parse(raw);
    debug(`readJSON(${filepath}): OK`);
    return obj;
  } catch {
    debug(`readJSON(${filepath}): failed`);
    return null;
  }
}

function readStdin() {
  try {
    return readFileSync(0, 'utf8').trim();
  } catch {
    return '';
  }
}

// ── Event Path Map ──────────────────────────────────

const EVENT_PATHS = {
  SessionStart: 'session-start',
  UserPromptSubmit: 'prompt',
  PreToolUse: 'pre-tool-use',
  PostToolUse: 'post-tool-use',
  Stop: 'stop',
};

// ── JWT decode (base64url, no verification) ─────────

function decodeJwtPayload(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = Buffer.from(parts[1], 'base64url').toString('utf8');
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

// ── Subscription info from auth.json ────────────────

function getSubscriptionInfo() {
  const auth = readJSON(join(CODEX_DIR, 'auth.json'));
  if (!auth?.tokens?.id_token) return {};

  const jwt = decodeJwtPayload(auth.tokens.id_token);
  if (!jwt) return {};

  const oai = jwt['https://api.openai.com/auth'] || {};
  const orgs = oai.organizations || [];
  const defaultOrg = orgs.find(o => o.is_default) || orgs[0];

  return {
    subscription_email: jwt.email || '',
    plan_type: oai.chatgpt_plan_type || '',
    auth_provider: jwt.auth_provider || '',
    account_id: oai.chatgpt_account_id || '',
    openai_user_id: oai.chatgpt_user_id || '',
    subscription_active_start: oai.chatgpt_subscription_active_start || '',
    subscription_active_until: oai.chatgpt_subscription_active_until || '',
    org_id: defaultOrg?.id || '',
    org_title: defaultOrg?.title || '',
  };
}

// ── Transcript token reader ─────────────────────────

function readTranscriptTokens(transcriptPath) {
  if (!transcriptPath) return {};
  try {
    const raw = readFileSync(transcriptPath, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    let lastTokenCount = null;
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.payload?.type === 'token_count' && entry.payload?.info?.total_token_usage) {
          lastTokenCount = entry.payload;
        }
      } catch {}
    }
    if (!lastTokenCount) return {};
    const usage = lastTokenCount.info.total_token_usage;
    const rl = lastTokenCount.rate_limits || {};
    const primary = rl.primary || {};
    const secondary = rl.secondary || {};
    return {
      input_tokens: usage.input_tokens,
      cached_tokens: usage.cached_input_tokens,
      output_tokens: usage.output_tokens,
      reasoning_tokens: usage.reasoning_output_tokens,
      total_tokens: usage.total_tokens,
      quota_primary_used_percent: primary.used_percent,
      quota_primary_window_minutes: primary.window_minutes,
      quota_primary_resets_at: primary.resets_at,
      quota_secondary_used_percent: secondary?.used_percent,
      quota_secondary_window_minutes: secondary?.window_minutes,
      quota_secondary_resets_at: secondary?.resets_at,
      quota_plan_type: rl.plan_type,
    };
  } catch (e) {
    debug(`readTranscriptTokens failed: ${e.message}`);
    return {};
  }
}

// ── POST to server ──────────────────────────────────

async function postToServer(path, payload) {
  const url = `${SERVER_URL}/api/v1/codex/${path}`;
  debug(`POST ${url}`);
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AUTH_TOKEN}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const text = await resp.text();
    debug(`response: ${resp.status} ${text.slice(0, 200)}`);
    if (resp.ok && text) {
      try { return JSON.parse(text); } catch {}
    }
    return {};
  } catch (e) {
    debug(`POST failed: ${e.message}`);
    return {};
  }
}

// ── Main ────────────────────────────────────────────

async function main() {
  const raw = readStdin();
  if (!raw) { debug('empty stdin — exiting'); process.exit(0); }

  let payload = {};
  try { payload = JSON.parse(raw); } catch {
    debug('stdin JSON parse failed — exiting');
    process.exit(0);
  }

  const event = payload.hook_event_name || 'unknown';
  const path = EVENT_PATHS[event];
  debug(`event=${event}, path=${path || '(unmapped)'}`);

  if (!path) {
    debug(`unknown event "${event}" — exiting`);
    process.exit(0);
  }

  // Enrich based on event type
  if (event === 'SessionStart') {
    const sub = getSubscriptionInfo();
    Object.assign(payload, sub);
    payload.hostname = hostname();
    payload.platform = platform();
    payload.os_version = release();
    payload.node_version = process.version;
    debug(`enriched SessionStart: email=${sub.subscription_email}, plan=${sub.plan_type}`);
  }

  if (event === 'Stop') {
    const tokens = readTranscriptTokens(payload.transcript_path);
    Object.assign(payload, tokens);
    debug(`enriched Stop: output_tokens=${tokens.output_tokens}, quota=${tokens.quota_primary_used_percent}%`);
  }

  // POST to server
  const response = postToServer(path, payload);
  const result = await response;

  // Handle kill switch
  if (result.killed && result.hard) {
    debug('HARD KILL — running codex logout');
    try {
      const { execSync } = await import('child_process');
      execSync('codex logout', { timeout: 5000, stdio: 'ignore' });
    } catch {}
  }

  // Return response to Codex
  const output = JSON.stringify(result);
  debug(`stdout: ${output}`);
  process.stdout.write(output);
}

main().catch((e) => {
  debug(`FATAL: ${e.message}`);
  process.stdout.write('{}');
  process.exit(0);
});
```

- [ ] **Step 2: Test manually**

```bash
echo '{"hook_event_name":"SessionStart","session_id":"test-123","model":"gpt-5.4","cwd":"/tmp"}' | CLAWLENS_SERVER=http://localhost:3000 CLAWLENS_TOKEN=test node client/clawlens-codex.mjs
```

Expected: outputs `{}` (or block response), debug log written to `~/.codex/hooks/.clawlens-codex-debug.log`

- [ ] **Step 3: Commit**

```bash
git add client/clawlens-codex.mjs
git commit -m "feat: add clawlens-codex.mjs client hook handler"
```

---

### Task 8: Update Install Script

**Files:**
- Modify: `scripts/install.sh`

- [ ] **Step 1: Add Codex installation prompt after CC installation**

After the existing CC hook installation section, add:

```bash
# ── Codex Installation ──────────────────────────────

echo ""
read -p "  Install for OpenAI Codex? (Y/n) " INSTALL_CODEX
INSTALL_CODEX=${INSTALL_CODEX:-Y}

if [[ "$INSTALL_CODEX" =~ ^[Yy]$ ]]; then
  # Check codex version
  if ! command -v codex &>/dev/null; then
    echo "  ⚠ codex not found in PATH — skipping Codex installation"
  else
    CODEX_VERSION=$(codex --version 2>&1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
    echo "  Codex version: $CODEX_VERSION"

    # Ensure hooks feature is enabled
    CODEX_CONFIG="$HOME/.codex/config.toml"
    if ! grep -q 'codex_hooks' "$CODEX_CONFIG" 2>/dev/null; then
      echo "" >> "$CODEX_CONFIG"
      echo "[features]" >> "$CODEX_CONFIG"
      echo "codex_hooks = true" >> "$CODEX_CONFIG"
      echo "  ✓ codex_hooks enabled in config.toml"
    fi

    # Deploy clawlens-codex.mjs
    CODEX_HOOKS_DIR="$HOME/.codex/hooks"
    mkdir -p "$CODEX_HOOKS_DIR"
    CODEX_HOOK_URL="https://raw.githubusercontent.com/howincodes/clawlens/main/client/clawlens-codex.mjs"
    CACHE_BUST=$(date +%s)
    curl -fsSL "$CODEX_HOOK_URL?v=$CACHE_BUST" -o "$CODEX_HOOKS_DIR/clawlens-codex.mjs"
    echo "  ✓ clawlens-codex.mjs deployed"

    # Write hooks.json
    CODEX_HOOKS_JSON="$HOME/.codex/hooks.json"
    HOOK_CMD="CLAWLENS_SERVER=$SERVER_URL CLAWLENS_TOKEN=$AUTH_TOKEN node $CODEX_HOOKS_DIR/clawlens-codex.mjs"
    cat > "$CODEX_HOOKS_JSON" << HOOKEOF
{
  "hooks": {
    "SessionStart": [{"hooks": [{"type": "command", "command": "$HOOK_CMD", "timeout": 10}]}],
    "UserPromptSubmit": [{"hooks": [{"type": "command", "command": "$HOOK_CMD", "timeout": 10}]}],
    "PreToolUse": [{"hooks": [{"type": "command", "command": "$HOOK_CMD", "timeout": 10}]}],
    "PostToolUse": [{"hooks": [{"type": "command", "command": "$HOOK_CMD", "timeout": 10}]}],
    "Stop": [{"hooks": [{"type": "command", "command": "$HOOK_CMD", "timeout": 10}]}]
  }
}
HOOKEOF
    echo "  ✓ hooks.json configured"
    echo "  ✓ Codex integration complete"
  fi
fi
```

- [ ] **Step 2: Commit**

```bash
git add scripts/install.sh
git commit -m "feat: add Codex installation to install.sh"
```

---

### Task 9: Final Integration Test

- [ ] **Step 1: Build and start server**

```bash
PORT=3000 pnpm dev
```

- [ ] **Step 2: Run all tests**

Run: `pnpm --filter @clawlens/server test`
Expected: All tests pass (existing 183 + new ~15 Codex tests)

- [ ] **Step 3: Manual smoke test with real Codex**

Deploy hooks:
```bash
CLAWLENS_SERVER=http://localhost:3000 CLAWLENS_TOKEN=<your-token> node client/clawlens-codex.mjs
```

Update `~/.codex/hooks.json` to point to `client/clawlens-codex.mjs` with env vars. Start Codex, send a prompt, verify data appears in dashboard.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: integration test adjustments"
```
