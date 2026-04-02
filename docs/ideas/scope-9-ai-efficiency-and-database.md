# Scope 9: AI Efficiency Architecture & PostgreSQL Migration — Raw Ideas

## Part A: Unified AI Summary Layer

### Problem
Multiple AI features (standups, profiles, health scores, team pulse, task correlation) all need activity data. Without coordination, each feature re-reads raw events independently — expensive, slow, wasteful.

### Solution: Layered Summary Architecture

```
Layer 0: Raw Events (prompts, commits, file changes, task updates)
         ↓ (batch every 5-10 min)
Layer 1: Batch Summaries (one AI call per batch of events)
         ↓ (rolled up on schedule)
Layer 2: Daily Digests (per-user-per-project daily activity summary)
         ↓ (consumed by all AI features)
Layer 3: AI Features (standups, profiles, health, knowledge map, reports)
```

### Rules
- Layer 3 features NEVER read Layer 0 raw data
- Layer 2 reads only Layer 1 batch summaries
- Layer 1 is generated in batches, not per-event
- Cross-user features (team pulse, project health) read Layer 2 digests from multiple users

### Batch Micro-Summaries (Layer 0 → Layer 1)
- Every 5-10 minutes (configurable), collect all new unsummarized events
- One AI call summarizes the entire batch
- If no new events → skip (no empty AI calls)
- Session end triggers an immediate flush (natural boundary)
- Example: 50 events in 10 minutes → 1 AI call, not 50

### Roll-Up Schedule (Layer 1 → Layer 2 → Layer 3)
- Batch summaries: every 5-10 min (or on session end)
- Daily digests: cron job each morning (roll up yesterday's batch summaries)
- Developer profiles: update after daily digest (reads daily digests, not raw events)
- Weekly reports: Monday morning (roll up daily digests)
- Monthly reports: 1st of month (roll up weekly reports)
- Project health: nightly (roll up per-project daily digests)
- Team pulse: weekly (roll up developer profiles + project health)

### Example Flows
- **Daily standup**: reads yesterday's daily digest → formats as standup. NOT re-reading 500 prompts.
- **Developer profile update**: reads this week's daily digests → updates profile. One AI call.
- **Project health score**: reads daily digests for all project members → scores. NOT scanning all commits.
- **Task assignee suggestion**: reads developer profiles (precomputed) + task description → suggests. No raw data.
- **Knowledge map**: reads developer profiles + git file paths + project membership → builds graph.

## Part B: PostgreSQL Migration

### Why Migrate
- SQLite (better-sqlite3) was fine for v0.2 team-scale analytics
- v0.3 adds: task management, attendance, salary, git analysis, concurrent writers, more complex queries
- Need: proper concurrent writes, joins across many tables, full-text search, better indexing
- Future-proof: pgvector extension available if embeddings needed later (one CREATE EXTENSION away)

### Migration Plan
- Move from better-sqlite3 (synchronous) to PostgreSQL
- All existing 12 tables migrate + new tables from all scopes
- Keep same query patterns where possible
- Connection pooling (pg-pool or similar)
- Environment config: DATABASE_URL connection string

### No Embeddings for v0.3
- Embeddings (pgvector) dropped — cost concern and not essential at team scale (5-20 devs)
- Simple heuristics replace semantic search:
  - Task-to-activity correlation: cwd + file paths + branch names + keyword matching
  - Knowledge map: git file paths + languages + project membership
  - Deduplication: exact/fuzzy string matching + timestamp proximity
  - Assignee suggestion: project members + git history in similar files
  - Retrieval for summaries: watermark-based batching (not vector search)
- pgvector can be added later with zero schema migration (just add extension + vector columns)

## Data Model Additions
- `batch_summaries` — id, user_id, project_id, batch_start, batch_end, event_count, summary_text, watermarks_json
- `daily_digests` — id, user_id, date, projects_json (per-project summary), overall_summary, generated_at
- `weekly_digests` — id, user_id, week_start, summary_json, generated_at
- `monthly_digests` — id, user_id, month, summary_json, generated_at
- `project_health_snapshots` — id, project_id, date, health_json, score, generated_at

## Open Questions
- PostgreSQL hosting: self-hosted on same VPS, or managed service (Supabase, Neon, etc.)?
- Migration strategy: big bang or gradual (dual-write)?
- Connection pooling library choice?
- Batch interval: 5 min or 10 min default?
- AI provider for summaries: Claude only, or configurable?
