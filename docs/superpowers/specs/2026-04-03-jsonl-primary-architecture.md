# Architecture Decision: JSONL-Primary Message Architecture

**Date:** 2026-04-03  
**Status:** Approved  
**Authors:** BashaMac, Claude Code (Opus 4.6)  
**Reviewers:** Database Architect Agent, Backend Architect Agent, Codex

---

## Problem Statement

HowinLens has two disconnected message stores:

1. **`messages` table** — Written by hooks at prompt time. Has model, credit_cost, blocked status. **No content** (Claude Code hooks don't include prompt text).
2. **`conversation_messages` table** — Written by JSONL file watcher. Has full content, tokens, model. **Zero readers** in the entire codebase.

The dashboard reads `messages` and shows "Prompt text not collected." The JSONL data with actual content goes to a dead-end table nobody queries.

Additionally, hooks and JSONL share **no common identifier** (hooks lack the `uuid` that JSONL messages have), making merge/correlation between the two sources fragile.

## Decision

**JSONL watcher becomes the sole data source for the `messages` table (Claude Code).  
Hooks become control-plane only (rate limiting, blocking, notifications).**

### Data Flow

```
Hooks (control plane — real-time):
  → Read messages table for rate-limit check
  → Return allow/block decision to Claude Code CLI
  → Write to hook_events (audit trail)
  → Claude Code: do NOT write to messages (JSONL handles it)
  → Codex: DO write to messages (no JSONL available)

JSONL Watcher (data plane — near-real-time):
  → Parse ~/.claude/projects/<hash>/<session>.jsonl
  → Write to messages table with uuid-based dedup
  → INSERT ON CONFLICT (uuid) DO NOTHING
  → Debounced 500ms sync on file change + 5s fallback interval

Provider-specific write paths:
  Claude Code  → JSONL watcher → messages (localFiles: true)
  Codex        → hooks → messages (localFiles: false, no JSONL)
  Antigravity  → extension → messages (future)
```

### Deduplication Strategy

Every JSONL user/assistant message has a stable `uuid` field (verified: 643 UUIDs in a 685-line session, 100% unique, zero duplicates). This is the natural dedup key.

```sql
CREATE UNIQUE INDEX idx_messages_uuid ON messages (uuid) WHERE uuid IS NOT NULL;

-- JSONL watcher upsert:
INSERT INTO messages (..., uuid, ...) VALUES (...)
ON CONFLICT (uuid) DO NOTHING;
```

- **JSONL restart** → re-processes old lines → `ON CONFLICT DO NOTHING` = idempotent
- **Hooks** → write to `hook_events` only (no uuid, no conflict)
- **Codex** → hooks write to `messages` directly (no JSONL path, no uuid conflict)
- **Blocked prompts** → recorded in `hook_events` only (JSONL never sees them because Claude Code stops processing)

## Alternatives Considered

### Alternative A: Hook+JSONL Merge (Single Table, Upsert)

Hook creates a row at prompt time (no content). JSONL enriches it later via timestamp-window matching or message_index correlation.

**Rejected because:**
- Hooks and JSONL share no common identifier (hooks lack uuid)
- Timestamp-window matching (session_id + type + timestamp within 5s) is fragile
- Hook writes produce structurally incomplete records (no tokens, no content)
- Two writers to the same table creates complex merge logic
- Claude Code's `Stop` hook carries minimal data (no reliable token counts)

### Alternative B: Separate Tables, Join in Queries

Keep `messages` for hooks, `conversation_messages` for JSONL, JOIN/UNION in dashboard queries.

**Rejected because:**
- UNION across tables with different column shapes is expensive and breaks pagination
- Drizzle ORM does not make this ergonomic
- Filtering and search across a UNION cannot push predicates efficiently
- Adding a third provider means a third table — does not scale
- `conversation_messages` is already dead code (zero active readers)

### Alternative C: Separate credit_ledger Table

Hooks write to a `credit_ledger` for rate limiting. JSONL writes to `messages` for content.

**Rejected because:**
- Creates a dual-write problem in the hook hot path (two tables per prompt)
- Consistency risk if one write succeeds and the other fails
- A partial index on `messages (user_id, timestamp) WHERE credit_cost > 0` makes rate-limit queries equally fast on a single table
- Analytics would need to query both tables to understand "what happened"

### Alternative D: Event Sourcing with Materialized Views

Every event (hook, JSONL, extension) as an immutable event. Materialized views for prompts, conversations, analytics.

**Rejected because:**
- PostgreSQL materialized views are not incrementally refreshable (full recompute)
- Significant operational complexity for an open-source product
- The workload is a merge problem, not an event-sourcing problem
- `session_raw_data` already serves as the raw event archive

## Rate Limiting Gap Analysis

With JSONL as the sole data writer, there's a ~1 second delay before new messages appear in the database. The hook must check credit budget against potentially stale data.

**Why this is acceptable:**

1. **Claude Code is serial** — a user cannot submit prompt N+1 until prompt N's response completes (30s+ response time). By then, JSONL data for prompt N has long been synced.
2. **Even concurrent sessions**: each hook handler is synchronous per-request.
3. **Worst case**: one extra prompt slips through (cost ~3 credits against a typical 200-credit limit = 1.5% overrun).
4. **Mitigation if needed**: in-memory pending-cost counter in the hook handler (not DB, just a Map). Reset when JSONL sync arrives.

## Schema Changes

```sql
ALTER TABLE messages ADD COLUMN uuid VARCHAR(255);
ALTER TABLE messages ADD COLUMN parent_uuid VARCHAR(255);
ALTER TABLE messages ADD COLUMN cache_creation_tokens INTEGER;

CREATE UNIQUE INDEX idx_messages_uuid 
  ON messages (uuid) WHERE uuid IS NOT NULL;

CREATE INDEX idx_messages_session_timestamp 
  ON messages (session_id, timestamp);
```

## JSONL Near-Real-Time Strategy

Current: 10-second polling interval.  
New: debounced chokidar-triggered sync (500ms) with 5-second fallback.

```
File change detected (chokidar) → parse new lines → debounce 500ms → HTTP sync
Fallback interval: 5 seconds (catches edge cases where chokidar misses events)
```

Estimated latency improvement: **10,000ms → ~500ms** (20x faster).

## Bugs Also Fixed

| Bug | Root Cause | Fix |
|-----|-----------|-----|
| "Prompt text not collected" | Hooks write no content | JSONL writes full content |
| Dashboard renders `p.prompt` not `p.content` | Field naming mismatch (API returns `content`) | Change dashboard to read `p.content` |
| `fileOffsets` in-memory only | JSONL watcher restart re-reads entire files | Persist to `~/.howinlens/offsets.json` |
| `conversation_messages` is dead code | Zero active readers | Drop table after migration |

## Migration Path

1. Add `uuid`, `parent_uuid`, `cache_creation_tokens` columns to `messages`
2. Gate `recordMessage()` in pipeline on `!adapter.capabilities.localFiles`
3. JSONL watcher: add uuid to ParsedMessage, debounced sync, persist offsets
4. Server `/client/conversations`: write to `messages` with ON CONFLICT (uuid) DO NOTHING
5. Fix dashboard field naming (`content` not `prompt`)
6. Backfill `conversation_messages` → `messages`
7. Drop `conversation_messages` table

## Future Considerations

- **>50M rows**: Range partition `messages` by month on `timestamp`
- **Full-text search**: Add GIN index on `to_tsvector('english', content)`
- **Codex with JSONL**: If Codex adds local file support, switch its write path to JSONL too
- **WebSocket sync**: Push JSONL lines via WebSocket instead of HTTP (lower latency, more complex)
