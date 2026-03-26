# ClawLens Server — Go Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the ClawLens analytics server — REST API, SQLite database, WebSocket, AI summary engine, webhook alerts, background jobs — as a single Go binary.

**Architecture:** Single Go binary using stdlib `net/http` with Go 1.22+ pattern routing. SQLite via `modernc.org/sqlite` (pure Go, no CGO). WebSocket via `nhooyr.io/websocket`. Background jobs as goroutines with `time.Ticker`. Multi-tenant from day one (every query scoped by team_id). `CLAWLENS_MODE` env var gates SaaS vs self-host behavior. Dashboard placeholder for future `//go:embed`.

**Tech Stack:** Go 1.23, `modernc.org/sqlite`, `github.com/golang-jwt/jwt/v5`, `golang.org/x/crypto/bcrypt`, `nhooyr.io/websocket`, `github.com/google/uuid`

**Specs (read in order — later docs override earlier):**
- `docs/2026-03-26-clawlens-design.md` — base data model, API, hooks
- `docs/2026-03-26-clawlens-v1.1-addendum.md` — Go, local queue, 6 hooks, merged usage_event, alert table
- `docs/2026-03-26-multi-tenancy-plan.md` — team_id scoping, plan table, CLAWLENS_MODE
- `docs/2026-03-26-v2-roadmap.md` — future awareness only, don't build

**Key overrides from addendum:**
- Go binary, not Node.js
- `usage_event` table DROPPED — `credit_cost` + `prompt_truncated` columns added to `prompt`
- 5 hook API endpoints only: session-start, prompt, sync-batch, register, health
- `alert` table added (stuck, anomaly, secret_detected, rate_limit_anthropic)
- `plan` table added (SaaS mode), extra team columns (plan_id, admin_email, subdomain, etc.)
- Fail-open for rate limiting, fail-closed for kill/pause
- Session orphan cleanup, prompt truncation at 10k chars

**File structure (from addendum):**
```
clawlens/
├── cmd/
│   ├── clawlens/main.go           ← client binary (built in plan-2)
│   └── clawlens-server/main.go    ← server binary
├── internal/
│   ├── server/
│   │   ├── server.go              ← HTTP server + middleware + Run()
│   │   ├── store.go               ← SQLite schema + Store struct + core queries
│   │   ├── store_events.go        ← session/prompt/tool_event/alert queries
│   │   ├── store_analytics.go     ← summary/stats/activity/audit/plan queries
│   │   ├── routes_hook.go         ← /api/v1/* handlers
│   │   ├── routes_admin.go        ← /api/admin/* handlers
│   │   ├── ws.go                  ← WebSocket hub
│   │   ├── auth.go                ← JWT + token auth middleware
│   │   ├── limiter.go             ← rate limit evaluation
│   │   ├── analytics.go           ← computed analytics queries
│   │   ├── summary.go             ← AI summary engine
│   │   ├── webhook.go             ← Slack/Discord alerts
│   │   ├── export.go              ← CSV/JSON export
│   │   └── jobs.go                ← background schedulers
│   └── shared/
│       ├── types.go               ← shared types between client/server
│       └── crypto.go              ← hashing, token generation
├── go.mod
├── go.sum
├── Makefile
├── Dockerfile
├── docker-compose.yml
├── Caddyfile
├── .gitignore
└── LICENSE
```

---

### Task 1: Project scaffolding

**Files:**
- Create: `go.mod`, `go.sum`
- Create: `cmd/clawlens-server/main.go` (stub)
- Create: `cmd/clawlens/main.go` (stub)
- Create: `Makefile`, `.gitignore`, `LICENSE`

- [ ] **Step 1: Create directories**

```bash
cd /Users/basha/Documents/Howin/clawlens
mkdir -p cmd/clawlens-server cmd/clawlens internal/server internal/shared dashboard scripts
```

- [ ] **Step 2: Create go.mod**

```
module github.com/howincodes/clawlens

go 1.23.0

require (
	github.com/golang-jwt/jwt/v5 v5.2.1
	github.com/google/uuid v1.6.0
	golang.org/x/crypto v0.28.0
	modernc.org/sqlite v1.34.0
	nhooyr.io/websocket v1.8.17
)
```

Run `go mod tidy` to resolve transitive deps.

- [ ] **Step 3: Create cmd/clawlens-server/main.go** (minimal stub that compiles)

```go
package main

import "fmt"

var version = "dev"

func main() {
	fmt.Printf("clawlens-server %s\n", version)
}
```

- [ ] **Step 4: Create cmd/clawlens/main.go** (minimal stub)

```go
package main

import "fmt"

var version = "dev"

func main() {
	fmt.Printf("clawlens %s\n", version)
}
```

- [ ] **Step 5: Create Makefile**

```makefile
.PHONY: build server client test clean release

VERSION ?= 0.1.0
LDFLAGS := -ldflags "-s -w -X main.version=$(VERSION)"

build: server client

server:
	go build $(LDFLAGS) -o bin/clawlens-server ./cmd/clawlens-server

client:
	go build $(LDFLAGS) -o bin/clawlens ./cmd/clawlens

test:
	go test ./... -v -count=1 -race

clean:
	rm -rf bin/

release:
	GOOS=darwin GOARCH=arm64 go build $(LDFLAGS) -o bin/clawlens-darwin-arm64 ./cmd/clawlens
	GOOS=darwin GOARCH=amd64 go build $(LDFLAGS) -o bin/clawlens-darwin-amd64 ./cmd/clawlens
	GOOS=linux  GOARCH=amd64 go build $(LDFLAGS) -o bin/clawlens-linux-amd64  ./cmd/clawlens
	GOOS=linux  GOARCH=arm64 go build $(LDFLAGS) -o bin/clawlens-linux-arm64  ./cmd/clawlens
	GOOS=windows GOARCH=amd64 go build $(LDFLAGS) -o bin/clawlens-windows-amd64.exe ./cmd/clawlens
	GOOS=windows GOARCH=arm64 go build $(LDFLAGS) -o bin/clawlens-windows-arm64.exe ./cmd/clawlens
```

- [ ] **Step 6: Create .gitignore**

```
bin/
*.db
*.db-journal
*.db-wal
*.db-shm
.env
vendor/
dashboard/dist/
```

- [ ] **Step 7: Create LICENSE** — MIT, `Copyright (c) 2026 howincodes`

- [ ] **Step 8: Init git, install deps, verify**

```bash
git init && go mod tidy && go build ./... && make server
```

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "scaffold: Go module, directories, Makefile"
```

---

### Task 2: Shared types + crypto

**Files:**
- Create: `internal/shared/types.go`
- Create: `internal/shared/crypto.go`
- Create: `internal/shared/crypto_test.go`

- [ ] **Step 1: Create types.go** — ALL shared structs

Every database model struct, every API request/response type, team settings, WebSocket event. Use `json` struct tags. Nullable fields use pointers. Passwords/tokens use `json:"-"` to prevent serialization.

Models to define (one struct each):
- `Team` (with plan_id, admin_email, subdomain, suspended fields from multi-tenancy doc)
- `TeamSettings` (full v1.1 settings from addendum: collection_level, collect_responses, secret_scrub, summary_*, credit_weights, prompt_retention_days, prompt_max_length, slack/discord webhooks, all alert_on_* flags, daily/weekly digest, sync_interval_seconds, export_enabled, auto_update, target_version, force_update)
- `CreditWeights` (opus, sonnet, haiku int)
- `Plan` (from multi-tenancy: id, name, max_users, max_prompts_per_day, max_storage_mb, ai_summaries, webhooks, export, rate_limiting, custom_branding)
- `Subscription`, `User`, `Device`, `LimitRule`
- `Session`, `Prompt` (with credit_cost, prompt_truncated from addendum), `ToolEvent`
- `AISummary`, `ProjectStats`, `DailyActivity`
- `InstallCode`, `AuditEntry`, `Alert`

API types:
- `SessionStartRequest/Response` (response includes UpdateInfo, settings, sync_interval)
- `PromptRequest/Response` (response: allowed, status, reason)
- `BatchSyncRequest` with `Event` (type + session_id + timestamp + json.RawMessage data)
- `ToolEventData`, `StopEventData`, `StopErrorEventData`, `SessionEndEventData`
- `RegisterRequest/Response`
- `LoginRequest/Response`
- `PaginatedResponse` (data, total, page, limit)
- `WSEvent` (type + data)

Use `encoding/json` import for `json.RawMessage`.

- [ ] **Step 2: Create crypto.go**

Functions:
- `GenerateID() string` — uuid v4
- `GenerateToken() string` — 32 random bytes, hex encoded (64 chars)
- `GenerateInstallCode(slug string) string` — `CLM-{slug}-{6 hex chars}`
- `HashPassword(password string) (string, error)` — bcrypt
- `VerifyPassword(hash, password string) bool` — bcrypt compare

- [ ] **Step 3: Create crypto_test.go**

Test: hash+verify round-trip, wrong password fails, GenerateID uniqueness, GenerateToken length=64, GenerateInstallCode format.

- [ ] **Step 4: Verify**

```bash
go test ./internal/shared/ -v
go build ./...
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: shared types and crypto utilities"
```

---

### Task 3: Database — schema + Store struct + core entity queries

**Files:**
- Create: `internal/server/store.go`
- Create: `internal/server/store_test.go`

- [ ] **Step 1: Create store.go — Store struct, NewStore, Init, Close, Seed**

`Store` wraps `*sql.DB`. `NewStore(dbPath)` opens SQLite with WAL mode + foreign keys. `Init()` runs the full schema. `Seed(adminPassword, mode)` creates default team (selfhost mode: single team; saas mode: seed demo plan).

**Schema — 15 tables total** (merged from all docs):

1. `plan` — SaaS plan definitions (from multi-tenancy doc)
2. `team` — with plan_id, admin_email, email_verified, subdomain, suspended, suspended_reason, created_by_ip
3. `subscription`
4. `user`
5. `device` (use `go_version` not `node_version`)
6. `limit_rule`
7. `session`
8. `prompt` — with `credit_cost INTEGER DEFAULT 0` and `prompt_truncated BOOLEAN DEFAULT FALSE` (NO usage_event table)
9. `tool_event`
10. `ai_summary`
11. `project_stats`
12. `daily_activity`
13. `install_code`
14. `audit_log`
15. `alert`

Plus `email_verification` table for SaaS.

All indexes from base spec + addendum:
- `idx_prompt_user_ts`, `idx_prompt_session`, `idx_prompt_user_ts_cost` (new for rate limiting)
- `idx_tool_event_user_ts`, `idx_tool_event_session`
- `idx_session_user`
- `idx_project_stats_user`, `idx_daily_activity_user`
- `idx_ai_summary_user`, `idx_audit_team`, `idx_subscription_team`, `idx_alert_team`

Use `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` throughout.

- [ ] **Step 2: Implement Seed**

```go
func (s *Store) Seed(adminPassword, mode string) error
```

- Always: create default team with hashed password, default TeamSettings JSON
- If mode == "saas": insert demo plan row, set team.plan_id = "demo"
- If mode == "selfhost": team.plan_id = NULL

- [ ] **Step 3: Core entity queries — Team**

- `GetTeam() (*Team, error)` — for selfhost (LIMIT 1)
- `GetTeamByID(id string) (*Team, error)` — for multi-tenant
- `GetTeamBySubdomain(subdomain string) (*Team, error)` — SaaS
- `GetTeamSettings(teamID string) (*TeamSettings, error)` — parse JSON
- `UpdateTeamSettings(teamID string, settings TeamSettings) error`
- `UpdateTeamName(teamID, name string) error`
- `UpdateAdminPassword(teamID, hash string) error`

- [ ] **Step 4: Core entity queries — User**

- `CreateUser(u *User) error`
- `GetUser(id string) (*User, error)`
- `GetUserByToken(token string) (*User, error)`
- `GetUsers(teamID string) ([]User, error)`
- `UpdateUserStatus(id, status string) error` — set killed_at if status=killed
- `UpdateUser(id string, name, subscriptionID, defaultModel *string) error`
- `DeleteUser(id string) error`
- `RotateUserToken(id string) (string, error)`
- `CountUsers(teamID string) (int, error)` — for plan enforcement

- [ ] **Step 5: Core entity queries — Subscription, Device, InstallCode, LimitRule**

Subscription: `UpsertSubscription`, `GetSubscriptions(teamID)`, `GetSubscriptionByEmail(teamID, email)`
Device: `UpsertDevice`, `GetDevices(userID)`
InstallCode: `CreateInstallCode(code, userID)`, `UseInstallCode(code) (*User, error)`
LimitRule: `GetLimitRules(userID)`, `ReplaceLimitRules(userID, rules)` (transaction: delete all + insert)
Plan: `GetPlan(id) (*Plan, error)`, `SeedPlans() error`

- [ ] **Step 6: Write store_test.go**

`newTestStore(t)` helper — creates temp DB, init, seed, cleanup.
Tests: Init+Seed, user CRUD, subscription upsert, device upsert, install code use, limit rule replacement, plan seeding.

- [ ] **Step 7: Run + commit**

```bash
go test ./internal/server/ -v -run TestStore
git add -A && git commit -m "feat: database schema + core entity queries (15 tables)"
```

---

### Task 4: Database — session, prompt, tool event, alert queries

**Files:**
- Create: `internal/server/store_events.go`
- Modify: `internal/server/store_test.go`

- [ ] **Step 1: Session queries**

- `CreateSession(sess *Session) error`
- `GetSession(id string) (*Session, error)`
- `EndSession(id, reason string) error`
- `UpdateSessionCounters(sessionID string, promptDelta, toolDelta int) error`
- `GetSessions(userID string, limit, offset int) ([]Session, int, error)` — paginated + total count
- `GetActiveSessions(teamID string) ([]Session, error)` — ended_at IS NULL AND started_at > -5min
- `CleanupOrphanSessions() (int64, error)` — close sessions idle >30 min

- [ ] **Step 2: Prompt queries**

- `RecordPrompt(p *Prompt) (int64, error)` — returns insert ID
- `UpdatePromptWithResponse(sessionID string, responseText *string, responseLength *int, toolCalls int, toolsUsed *string, turnDurationMS *int, creditCost int) error` — updates last prompt in session
- `GetPrompts(userID string, limit, offset int, search, model, project *string) ([]Prompt, int, error)` — paginated + filtered
- `GetPromptsForSummary(userID string, since, until time.Time) ([]Prompt, error)`
- `GetCreditUsage(userID string, since time.Time) (int, error)` — SUM(credit_cost) for rate limiting
- `GetModelUsageCount(userID, model string, since time.Time) (int, error)` — COUNT for per-model limits
- `CountPromptsToday(teamID string) (int, error)` — for plan enforcement
- `DeleteOldPrompts(days int) (int64, error)` — retention cleanup

- [ ] **Step 3: Tool event queries**

- `RecordToolEvent(te *ToolEvent) error`
- `GetToolEvents(userID string, limit, offset int) ([]ToolEvent, int, error)`

- [ ] **Step 4: Alert queries**

- `CreateAlert(a *Alert) error`
- `GetAlerts(teamID string, limit int, resolved *bool) ([]Alert, error)`
- `ResolveAlert(id int) error`

- [ ] **Step 5: Tests**

Test full lifecycle: create session → record prompt → record tool events → update prompt with response → end session → verify counters. Test credit usage and model usage count queries. Test alert CRUD. Test orphan cleanup.

- [ ] **Step 6: Run + commit**

```bash
go test ./internal/server/ -v -run "TestSession|TestPrompt|TestTool|TestAlert"
git add -A && git commit -m "feat: session, prompt, tool event, alert queries"
```

---

### Task 5: Database — analytics helper queries + remaining tables

**Files:**
- Create: `internal/server/store_analytics.go`
- Modify: `internal/server/store_test.go`

- [ ] **Step 1: AI Summary queries**

- `RecordSummary(s *AISummary) error`
- `GetSummaries(teamID string, userID, summaryType *string, limit int) ([]AISummary, error)`

- [ ] **Step 2: ProjectStats + DailyActivity**

- `UpsertProjectStats(ps *ProjectStats) error` — ON CONFLICT(user_id, project_path, model) DO UPDATE
- `GetProjectStats(userID string) ([]ProjectStats, error)`
- `UpsertDailyActivity(da *DailyActivity) error` — ON CONFLICT(user_id, date) DO UPDATE
- `GetDailyActivity(userID string, days int) ([]DailyActivity, error)`

- [ ] **Step 3: AuditLog queries**

- `RecordAudit(teamID, actor, action string, target, details *string) error`
- `GetAuditLog(teamID string, limit, offset int, action *string) ([]AuditEntry, int, error)`

- [ ] **Step 4: Tests + commit**

```bash
go test ./internal/server/ -v
git add -A && git commit -m "feat: summary, stats, activity, audit queries"
```

---

### Task 6: Auth middleware + rate limiter

**Files:**
- Create: `internal/server/auth.go`
- Create: `internal/server/limiter.go`
- Create: `internal/server/auth_test.go`
- Create: `internal/server/limiter_test.go`

- [ ] **Step 1: auth.go**

Context keys: `ctxUser`, `ctxTeam` (using typed `contextKey` string).

Helper functions:
- `UserFromContext(ctx) *User`
- `TeamFromContext(ctx) *Team`

`JWTManager` struct with secret `[]byte`:
- `NewJWTManager(secret string)` — auto-generates if empty
- `Create(teamID string) (string, error)` — HS256, 24h expiry
- `Verify(tokenStr string) (string, error)` — returns teamID

Middleware:
- `HookAuth(store *Store) func(http.Handler) http.Handler` — extracts Bearer token, looks up user by auth_token, attaches user+team to context
- `AdminAuth(jwtMgr *JWTManager, store *Store) func(http.Handler) http.Handler` — extracts Bearer JWT, verifies, attaches team to context

`extractBearer(r) string` — strips "Bearer " prefix.

- [ ] **Step 2: limiter.go**

`LimitResult` struct: Allowed bool, Reason *string.

`EvaluateLimits(store *Store, user *User, model string, weights CreditWeights) LimitResult`:
- If user.Status is killed/paused → blocked
- Iterate limit rules for user
- For "credits" type: check `GetCreditUsage` against rule.Value in rule.Window
- For "per_model" type: check `GetModelUsageCount` for matching model
- For "time_of_day" type: check current time in rule timezone against start/end

`CreditCost(model string, weights CreditWeights) int` — maps model name to weight (contains "opus" → opus weight, etc.)

`windowStart(window string, tz *string) time.Time`:
- "daily" → midnight today in tz
- "weekly" → Monday midnight in tz
- "monthly" → 1st of month in tz
- "sliding_24h" → now - 24h

- [ ] **Step 3: Tests**

Auth: JWT create/verify round-trip, expired token fails, HookAuth middleware with httptest.
Limiter: credit limit blocks when exceeded, per-model limit, time-of-day blocking, window calculations.

- [ ] **Step 4: Run + commit**

```bash
go test ./internal/server/ -v -run "TestJWT|TestAuth|TestLimiter|TestCredit|TestWindow"
git add -A && git commit -m "feat: auth middleware (JWT + token) and rate limiter"
```

---

### Task 7: WebSocket hub

**Files:**
- Create: `internal/server/ws.go`
- Create: `internal/server/ws_test.go`

- [ ] **Step 1: ws.go**

`WSHub` struct with `sync.RWMutex` protecting a `map[*wsClient]struct{}`.

`wsClient` struct: conn `*websocket.Conn`, ctx `context.Context`.

Methods:
- `NewWSHub() *WSHub`
- `HandleWS(w, r)` — accept connection, add to clients map, read loop (blocks until disconnect), remove on disconnect
- `Broadcast(event WSEvent)` — JSON marshal, write to all clients with 5s timeout per client
- `ClientCount() int`

Use `nhooyr.io/websocket` with `InsecureSkipVerify: true` in AcceptOptions.

- [ ] **Step 2: Test**

Test NewWSHub, ClientCount==0, Broadcast with no clients doesn't panic.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: WebSocket hub for live dashboard updates"
```

---

### Task 8: Hook API routes

**Files:**
- Create: `internal/server/routes_hook.go`
- Create: `internal/server/routes_hook_test.go`

5 endpoints from addendum:
1. `GET /api/v1/health` — no auth
2. `POST /api/v1/register` — no auth, exchange install code for token
3. `POST /api/v1/session-start` — hookAuth, synchronous
4. `POST /api/v1/prompt` — hookAuth, synchronous rate limit gate
5. `POST /api/v1/sync-batch` — hookAuth, batch event processing

- [ ] **Step 1: Helpers + route registration**

```go
func writeJSON(w http.ResponseWriter, status int, v any)
func readJSON(r *http.Request, v any) error

func RegisterHookRoutes(mux *http.ServeMux, store *Store, hub *WSHub)
```

Apply `HookAuth(store)` middleware to session-start, prompt, sync-batch.

- [ ] **Step 2: health + register**

`handleHealth` — returns `{"status":"ok"}`.

`handleRegister(store)` — reads RegisterRequest, calls `UseInstallCode`, returns RegisterResponse with auth_token + settings.

- [ ] **Step 3: session-start**

Reads `SessionStartRequest`. Upserts device. Upserts subscription if email provided. Creates session. Returns `SessionStartResponse` with user status, team settings, sync_interval. Broadcasts `session_started` WSEvent.

- [ ] **Step 4: prompt (rate limit gate)**

Reads `PromptRequest`. Parses team settings for credit weights. Calls `EvaluateLimits`. Computes `CreditCost`. If SaaS mode, check `CountPromptsToday` against plan limit. Records prompt (truncate at prompt_max_length if needed). Updates session counters. Broadcasts `prompt_submitted` or `prompt_blocked`. Returns `PromptResponse`.

- [ ] **Step 5: sync-batch**

Reads `BatchSyncRequest`. Loops through events, switches on type:
- "tool" → unmarshal ToolEventData, RecordToolEvent, update session tool count, broadcast tool_used/tool_failed
- "stop" → unmarshal StopEventData, UpdatePromptWithResponse, broadcast turn_completed
- "stop_error" → unmarshal StopErrorEventData, broadcast rate_limit_hit if applicable
- "session_end" → unmarshal SessionEndEventData, EndSession, broadcast session_ended

Returns `{"processed": N}`.

- [ ] **Step 6: Integration tests**

Use httptest. Test each endpoint:
- Health returns 200
- Register with valid/invalid code
- Session-start creates session + device
- Prompt allows/blocks based on limits
- Sync-batch processes all event types

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: hook API — session-start, prompt gate, sync-batch, register, health"
```

---

### Task 9: Analytics service

**Files:**
- Create: `internal/server/analytics.go`
- Create: `internal/server/analytics_test.go`

- [ ] **Step 1: analytics.go**

`Analytics` struct wrapping `*Store`.

Return types: `TeamOverview`, `UserLeaderboardEntry`, `CostBreakdown`, `CostEntry`, `ModelDistribution`, `ToolDistribution`, `DailyTrend`, `ProjectAnalytics`, `PeakHour`.

Methods:
- `GetTeamOverview(teamID) (*TeamOverview, error)` — total users, active now (session in last 5 min), prompts today, cost today
- `GetUserLeaderboard(teamID, days, sortBy) ([]UserLeaderboardEntry, error)` — user stats with top model, avg turns
- `GetCostBreakdown(teamID, days) (*CostBreakdown, error)` — by user, project, model
- `GetModelDistribution(teamID, days) ([]ModelDistribution, error)`
- `GetToolDistribution(teamID, days) ([]ToolDistribution, error)` — with error count
- `GetDailyTrends(teamID, days) ([]DailyTrend, error)` — prompts, sessions, cost per day
- `GetProjectAnalytics(teamID, days) ([]ProjectAnalytics, error)` — prompts, users, cost per project
- `GetPeakHours(teamID, days) ([]PeakHour, error)` — 0-23 hour buckets

All queries join through user table for team_id scoping.

- [ ] **Step 2: Tests + commit**

Seed test data (users + prompts + tool events), verify analytics return correct counts.

```bash
git add -A && git commit -m "feat: analytics service — overview, leaderboard, costs, trends"
```

---

### Task 10: Admin API routes

**Files:**
- Create: `internal/server/routes_admin.go`
- Create: `internal/server/routes_admin_test.go`

- [ ] **Step 1: Route registration**

```go
func RegisterAdminRoutes(mux *http.ServeMux, store *Store, hub *WSHub, jwtMgr *JWTManager, analytics *Analytics)
```

All routes use `AdminAuth` middleware except `POST /api/admin/login`.

Routes:
- `POST /api/admin/login`
- `GET /api/admin/team`, `PUT /api/admin/team`
- `GET /api/admin/subscriptions`
- `GET /api/admin/users`, `POST /api/admin/users`
- `GET /api/admin/users/{id}`, `PUT /api/admin/users/{id}`, `DELETE /api/admin/users/{id}`
- `GET /api/admin/users/{id}/prompts`, `GET /api/admin/users/{id}/sessions`
- `POST /api/admin/users/{id}/rotate-token`
- `GET /api/admin/analytics`, `GET /api/admin/analytics/users`, `GET /api/admin/analytics/projects`, `GET /api/admin/analytics/costs`
- `GET /api/admin/summaries`, `POST /api/admin/summaries/generate`
- `GET /api/admin/audit-log`
- `GET /api/admin/export/{type}`

- [ ] **Step 2: Login handler**

Verify password with bcrypt. Create JWT. Return token + team.

- [ ] **Step 3: Team + user CRUD handlers**

Each write handler: audit log + WS broadcast for status changes.
`handleCreateUser`: creates user + generates install code. In SaaS mode, checks plan user limit via `CountUsers` + `GetPlan`.
`handleUpdateUser`: supports name, status, limits. Status change → WS broadcast.

- [ ] **Step 4: Analytics + summaries + audit + export handlers**

Read query params (days, page, limit, sortBy, userId, type, format). Call analytics/store methods. Return JSON. Export handler: set Content-Disposition header, stream CSV or JSON.

- [ ] **Step 5: Tests + commit**

Test login, user CRUD, analytics endpoint responses.

```bash
git add -A && git commit -m "feat: admin API — login, users, analytics, summaries, audit, export"
```

---

### Task 11: Webhook + Export services

**Files:**
- Create: `internal/server/webhook.go`
- Create: `internal/server/export.go`

- [ ] **Step 1: webhook.go**

`WebhookEvent` struct: Event, User, Model, Reason, Timestamp, DashboardURL.

`SendWebhook(settings *TeamSettings, event WebhookEvent)`:
- If slack_webhook set → goroutine `postSlack`
- If discord_webhook set → goroutine `postDiscord`

`postSlack(url, event)` — Slack Block Kit format, POST JSON.
`postDiscord(url, event)` — Discord Embed format, POST JSON.
`postJSON(url, payload)` — HTTP POST with 10s timeout.

- [ ] **Step 2: export.go**

`ExportPromptsCSV(store, teamID, days, w io.Writer) error` — writes CSV headers + rows.
`ExportUsageJSON(store, teamID, days, w io.Writer) error` — writes JSON array.

Wire into `handleExport` in routes_admin.go.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: webhook alerts (Slack/Discord) and data export"
```

---

### Task 12: AI Summary engine + Background jobs

**Files:**
- Create: `internal/server/summary.go`
- Create: `internal/server/jobs.go`

- [ ] **Step 1: summary.go**

`SummaryEngine` struct wrapping `*Store`.

`GenerateForAllUsers(teamID string, periodHours int) error`:
- For each user with prompts since last period → build prompt text → call AI → parse JSON response → store summary

`callAI(prompt string, settings *TeamSettings) (string, error)`:
- "claude-code" → `exec.Command("claude", "-p", prompt, "--output-format", "text")`
- "anthropic-api" → HTTP POST to `api.anthropic.com/v1/messages`
- "openai" → HTTP POST to `api.openai.com/v1/chat/completions`
- "custom" → HTTP POST to settings.SummaryAPIURL

Summary prompt asks AI to return structured JSON with: summary, categories, topics, productivity_score, prompt_quality_score, model_efficiency_score.

- [ ] **Step 2: jobs.go**

`JobRunner` struct: store, hub, summaryEngine, analytics, teamID, stopCh.

`Start()` — launches goroutines:
- `runSummaryScheduler` — `time.Ticker` at summary_interval_hours
- `runOrphanCleanup` — every 10 min, calls `CleanupOrphanSessions`
- `runRetentionCleanup` — every 24h, calls `DeleteOldPrompts`
- `runStuckDetection` — every 60s, queries for users with 5+ prompts + >50% errors in last 20 min per session → creates alert + sends webhook

`Stop()` — closes stopCh.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: AI summary engine and background jobs"
```

---

### Task 13: Server wiring + main

**Files:**
- Create: `internal/server/server.go`
- Modify: `cmd/clawlens-server/main.go`

- [ ] **Step 1: server.go**

`Config` struct: Port, AdminPassword, DBPath, JWTSecret, Mode (saas/selfhost).

`Run(cfg Config) error`:
1. NewStore → Init → Seed
2. NewWSHub, NewJWTManager, NewAnalytics, NewSummaryEngine
3. Build mux, RegisterHookRoutes, RegisterAdminRoutes
4. Mount `/ws` handler
5. Mount `/` placeholder (dashboard coming later)
6. Wrap with corsMiddleware + loggingMiddleware
7. Start JobRunner
8. ListenAndServe

`loggingMiddleware` — logs method, path, duration.
`corsMiddleware` — Allow-Origin *, standard headers, OPTIONS passthrough.

- [ ] **Step 2: Wire main.go**

Parse flags: `--port`, `--db`, `--admin-password`, `--jwt-secret`, `--mode`. Env var fallbacks: PORT, DB_PATH, ADMIN_PASSWORD, JWT_SECRET, CLAWLENS_MODE. Require ADMIN_PASSWORD. Graceful shutdown on SIGINT/SIGTERM.

- [ ] **Step 3: Build + smoke test**

```bash
make server
ADMIN_PASSWORD=test123 ./bin/clawlens-server &
curl http://localhost:3000/api/v1/health
curl -X POST http://localhost:3000/api/admin/login -H 'Content-Type: application/json' -d '{"password":"test123"}'
kill %1
```

- [ ] **Step 4: Full test suite + commit**

```bash
go test ./... -v -count=1
git add -A && git commit -m "feat: server wiring — HTTP server, middleware, main entry point"
```

---

### Task 14: Dockerfile + docker-compose

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Create: `Caddyfile`

- [ ] **Step 1: Dockerfile**

```dockerfile
FROM golang:1.23-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -ldflags "-s -w" -o /clawlens-server ./cmd/clawlens-server

FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata
COPY --from=builder /clawlens-server /usr/local/bin/clawlens-server
VOLUME /data
EXPOSE 3000
ENV DB_PATH=/data/clawlens.db
ENTRYPOINT ["clawlens-server"]
```

- [ ] **Step 2: docker-compose.yml**

ClawLens server + Caddy reverse proxy. Env vars for ADMIN_PASSWORD, DB_PATH, DOMAIN.

- [ ] **Step 3: Caddyfile**

`{$DOMAIN:localhost}` reverse_proxy to clawlens:3000.

- [ ] **Step 4: Build + verify**

```bash
docker build -t clawlens:test .
docker run --rm -e ADMIN_PASSWORD=test -p 3099:3000 clawlens:test &
curl http://localhost:3099/api/v1/health
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: Docker support — Dockerfile, docker-compose, Caddy"
```
