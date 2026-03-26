# ClawLens Client — Go Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the ClawLens client — a single Go binary that handles 6 Claude Code hook actions, local event queue, batch sync, secret scrubbing, installer, doctor, and self-update.

**Architecture:** Single Go binary installed at `/usr/local/bin/clawlens`. Hooks call `clawlens hook <action>` reading Claude Code's JSON from stdin. Only 2 synchronous server calls (session-start, prompt). All other events write to local SQLite queue and batch sync every 30s. Uses `modernc.org/sqlite` for local queue (same dep as server — no CGO). Config stored at platform-specific paths. Root-owned, user-readable managed-settings.json.

**Tech Stack:** Go 1.23, `modernc.org/sqlite`, stdlib `net/http`, `os/exec`, `encoding/json`, `regexp`

**Specs:**
- `docs/2026-03-26-clawlens-design.md` — base CLI, hooks, file sync
- `docs/2026-03-26-clawlens-v1.1-addendum.md` — 6 hooks, local queue, batch sync, secret scrubbing, doctor, auto-update

**6 hooks for v1 (from addendum):**
1. SessionStart — sync: check-in, get config, auto-update check
2. UserPromptSubmit — sync: rate limit gate + record prompt
3. PreToolUse — local only: kill/pause enforcement + write to queue
4. Stop — local only: write to queue (response data)
5. StopFailure — local only: write to queue (error data)
6. SessionEnd — local only: write to queue

**Data flow:**
```
SessionStart  → HTTP POST /api/v1/session-start (sync, 3s timeout)
Prompt        → HTTP POST /api/v1/prompt (sync, 3s timeout, rate limit gate)
PreToolUse    → local SQLite queue (<1ms)
Stop          → local SQLite queue (<1ms)
StopFailure   → local SQLite queue (<1ms)
SessionEnd    → local SQLite queue (<1ms)

Background goroutine (every 30s):
  → read unsynced events from local DB
  → POST /api/v1/sync-batch → server
  → mark events as synced locally
```

**File structure:**
```
internal/client/
├── config.go     ← config loading/saving, platform paths
├── queue.go      ← local SQLite event queue
├── sync.go       ← batch sync goroutine
├── hook.go       ← 6 hook action handlers
├── scrub.go      ← secret detection + redaction
├── model.go      ← model detection from Claude Code env
├── install.go    ← setup/uninstall/reinstall
├── doctor.go     ← diagnostic command
└── update.go     ← self-update mechanism

cmd/clawlens/main.go  ← CLI entry point
```

---

### Task 1: Client config + platform paths

**Files:**
- Create: `internal/client/config.go`
- Create: `internal/client/config_test.go`

- [ ] **Step 1: config.go — Config struct + platform paths**

`Config` struct:
- ServerURL string
- AuthToken string
- UserID string
- TeamID string
- Status string (active/paused/killed)
- DefaultModel string
- SyncInterval int (seconds, default 30)
- CollectionLevel string (off/summaries/full)
- CollectResponses bool
- SecretScrub string (redact/alert/off)
- PromptMaxLength int
- ClientVersion string
- LastSync time.Time

Platform paths:
- macOS: `/Library/Application Support/ClaudeCode/clawlens/`
- Linux: `/etc/claude-code/clawlens/`
- Windows: `C:\Program Files\ClaudeCode\clawlens\`

Files stored:
- `config.json` — serialized Config
- `queue.db` — local SQLite event queue
- `server.json` — cached server settings (for offline fallback)

Functions:
- `ConfigDir() string` — platform-appropriate path
- `ConfigPath() string` — ConfigDir + "config.json"
- `QueueDBPath() string` — ConfigDir + "queue.db"
- `LoadConfig() (*Config, error)` — read + unmarshal
- `SaveConfig(cfg *Config) error` — marshal + write
- `ManagedSettingsPath() string` — Claude Code's managed-settings.json path (macOS: `/Library/Application Support/ClaudeCode/managed-settings.json`, Linux: `/etc/claude-code/managed-settings.json`)

- [ ] **Step 2: Test + commit**

Test: ConfigDir returns correct path per GOOS. LoadConfig/SaveConfig round-trip to temp dir.

```bash
go test ./internal/client/ -v -run TestConfig
git add -A && git commit -m "feat(client): config loading, platform paths"
```

---

### Task 2: Local SQLite event queue

**Files:**
- Create: `internal/client/queue.go`
- Create: `internal/client/queue_test.go`

- [ ] **Step 1: queue.go**

`Queue` struct wrapping `*sql.DB`.

Schema (from addendum):
```sql
CREATE TABLE IF NOT EXISTS event_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at DATETIME NOT NULL,
  synced BOOLEAN DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_event_queue_synced ON event_queue(synced, created_at);
```

Methods:
- `NewQueue(dbPath string) (*Queue, error)` — open SQLite, create table
- `Close() error`
- `Push(eventType string, payload []byte) error` — INSERT with created_at = now
- `PopUnsynced(limit int) ([]QueueEntry, error)` — SELECT WHERE synced=FALSE ORDER BY created_at LIMIT N
- `MarkSynced(ids []int64) error` — UPDATE synced=TRUE WHERE id IN (...)
- `CleanupSynced(olderThan time.Duration) (int64, error)` — DELETE synced entries older than N
- `UnsyncedCount() (int, error)` — COUNT WHERE synced=FALSE
- `DBSize() (int64, error)` — file size in bytes

`QueueEntry` struct: ID int64, EventType string, Payload json.RawMessage, CreatedAt time.Time.

- [ ] **Step 2: Test + commit**

Test: Push 5 events, PopUnsynced returns 5, MarkSynced 3, PopUnsynced returns 2. CleanupSynced removes old entries. UnsyncedCount correct.

```bash
go test ./internal/client/ -v -run TestQueue
git add -A && git commit -m "feat(client): local SQLite event queue"
```

---

### Task 3: Secret scrubbing + model detection

**Files:**
- Create: `internal/client/scrub.go`
- Create: `internal/client/scrub_test.go`
- Create: `internal/client/model.go`
- Create: `internal/client/model_test.go`

- [ ] **Step 1: scrub.go**

Precompiled regex patterns (from addendum):
1. API keys: `(sk-|pk-|api[_-]?key|token)[a-zA-Z0-9_-]{20,}`
2. AWS: `AKIA[0-9A-Z]{16}`
3. Connection strings: `(postgres|mysql|mongodb|redis)://[^\s]+`
4. Private keys: `-----BEGIN (RSA |EC |)PRIVATE KEY-----`
5. Generic secrets: `(password|secret|passwd)[\s]*[=:]\s*['"][^'"]{8,}`

Functions:
- `ScrubSecrets(text string) (string, []string)` — returns scrubbed text + list of detection labels (e.g., "api_key", "aws_key")
- `DetectSecrets(text string) []string` — returns detection labels only (for "alert" mode)
- `HasSecrets(text string) bool` — fast check

`ScrubSecrets` replaces each match with `[REDACTED-{TYPE}]` (e.g., `[REDACTED-API-KEY]`, `[REDACTED-AWS-KEY]`).

- [ ] **Step 2: Test scrub**

Test each pattern: real-looking API key gets redacted, AWS key gets redacted, postgres:// URL gets redacted, private key header detected, `password = "hunter2"` gets redacted. Test that normal code text is NOT modified.

- [ ] **Step 3: model.go**

Model detection chain (from spec):
1. Check Claude Code stdin data for `model` field → use it
2. Check `~/.claude/settings.json` for `model` field → use it
3. Fall back to `config.DefaultModel` (set during install from subscription type: max=opus, pro=sonnet)

Functions:
- `DetectModel(stdinModel string, cfg *Config) string`
- `NormalizeModel(model string) string` — lowercase, strip versions (e.g., "claude-sonnet-4-20250514" → "sonnet")

- [ ] **Step 4: Test model + commit**

Test DetectModel priority chain. Test NormalizeModel with various formats.

```bash
go test ./internal/client/ -v -run "TestScrub|TestModel"
git add -A && git commit -m "feat(client): secret scrubbing and model detection"
```

---

### Task 4: Hook actions

**Files:**
- Create: `internal/client/hook.go`
- Create: `internal/client/hook_test.go`

This is the core — handles all 6 hook actions.

- [ ] **Step 1: hook.go — infrastructure**

`readStdin() (json.RawMessage, error)` — reads all of stdin, returns raw JSON.

`serverRequest(method, url string, body any, authToken string, timeout time.Duration) (*http.Response, error)` — HTTP request with JSON body, Bearer auth, configurable timeout.

`debugLog(format, args...)` — writes to stderr if CLAWLENS_DEBUG is set.

- [ ] **Step 2: HandleSessionStart**

Reads stdin (session_id, model, cwd, etc.). Collects device info: hostname, runtime.GOOS, runtime.GOARCH, os version, Go version, Claude Code version (from `claude --version`).

Sync HTTP POST to `/api/v1/session-start` (3s timeout).
- On success: cache settings from response, check for update
- On failure: log, continue (fail-open)

If response has `update.available && update.required` → trigger self-update.

Output: nothing (no decision needed for SessionStart).

- [ ] **Step 3: HandlePrompt (the gate)**

Reads stdin (prompt text, session_id, cwd, etc.). Detect model.

Apply secret scrubbing (if config.SecretScrub != "off"):
- "redact" → scrub prompt text before sending
- "alert" → detect only, include detection labels in request

Sync HTTP POST to `/api/v1/prompt` (3s timeout).
- On success: if `response.allowed == false` → output `{"decision":"block","reason":"..."}` to stdout
- On timeout: evaluate limits LOCALLY from cached config (fail-open)
- On no cache: ALLOW (don't block devs)

Also write prompt event to local queue for sync.

- [ ] **Step 4: HandlePreToolUse (local only)**

Reads stdin (tool_name, tool_input). Local kill/pause enforcement:
- If cached status == "killed" → re-check server (1s timeout), if still killed → `{"decision":"block","reason":"User killed"}`
- If cached status == "paused" → `{"decision":"block","reason":"User paused"}`

Write tool event to local queue:
```json
{"type":"tool","session_id":"...","data":{"tool_name":"Bash","tool_input_summary":"first 200 chars","success":true}}
```

- [ ] **Step 5: HandleStop (local only)**

Reads stdin (response text, session_id, model, etc.). Write to local queue:
```json
{"type":"stop","session_id":"...","data":{"model":"sonnet","response_length":1234,"tool_calls":3,"tools_used":"[\"Bash\",\"Read\"]","turn_duration_ms":5400,"credit_cost":3}}
```

- [ ] **Step 6: HandleStopFailure (local only)**

Reads stdin (error info). Detect error type (rate_limit, billing_error, etc.) from error text patterns. Write to local queue:
```json
{"type":"stop_error","session_id":"...","data":{"error_type":"rate_limit","error_details":"..."}}
```

- [ ] **Step 7: HandleSessionEnd (local only)**

Reads stdin (session_id, reason). Write to local queue:
```json
{"type":"session_end","session_id":"...","data":{"reason":"exit"}}
```

- [ ] **Step 8: Tests**

Test each handler with mock stdin input. Test secret scrubbing integration in prompt handler. Test kill/pause enforcement in pre-tool handler. Test fail-open behavior when server is unreachable.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat(client): 6 hook action handlers"
```

---

### Task 5: Batch sync goroutine

**Files:**
- Create: `internal/client/sync.go`
- Create: `internal/client/sync_test.go`

- [ ] **Step 1: sync.go**

`Syncer` struct: queue *Queue, config *Config, stopCh chan struct{}.

`NewSyncer(queue, config) *Syncer`

`Start()` — launches goroutine:
```
ticker := time.NewTicker(config.SyncInterval * time.Second)
for {
  select {
  case <-ticker.C:
    syncBatch()
  case <-stopCh:
    syncBatch() // final flush
    return
  }
}
```

`Stop()` — closes stopCh, waits for final flush.

`syncBatch() error`:
1. `queue.PopUnsynced(100)` — get up to 100 unsynced events
2. If 0 events → return
3. Build `BatchSyncRequest` with events array
4. HTTP POST to `/api/v1/sync-batch` (10s timeout)
5. On success → `queue.MarkSynced(ids)`
6. On failure → log, leave unsynced for next round
7. `queue.CleanupSynced(24 * time.Hour)` — remove synced entries older than 24h

- [ ] **Step 2: Test + commit**

Test that syncBatch reads from queue, posts to server (mock), marks synced. Test that failed POST leaves events unsynced.

```bash
git add -A && git commit -m "feat(client): batch sync goroutine"
```

---

### Task 6: Installer

**Files:**
- Create: `internal/client/install.go`
- Create: `internal/client/install_test.go`

- [ ] **Step 1: install.go — Setup flow**

`Setup(code, serverURL string) error`:

1. **Pre-flight checks:**
   - Check running as root (os.Geteuid() == 0)
   - Check Claude Code installed (`claude --version`)
   - Detect subscription type from `~/.claude.json` → `oauthAccount.planType`
   - Detect subscription email from `~/.claude.json` → `oauthAccount.emailAddress`
   - Collect device info

2. **Register with server:**
   - POST `/api/v1/register` with install code
   - Receive auth_token, user_id, settings

3. **Write config:**
   - Create config dir (ConfigDir) with 755 permissions
   - Write config.json with server URL, auth token, user ID, settings
   - Set file permissions: root-owned (0644)

4. **Write managed-settings.json:**
   ```json
   {
     "allowManagedHooksOnly": true,
     "hooks": {
       "SessionStart": [{"matcher":"","hooks":[{"type":"command","command":"/usr/local/bin/clawlens hook session-start","timeout":10}]}],
       "UserPromptSubmit": [{"hooks":[{"type":"command","command":"/usr/local/bin/clawlens hook prompt","timeout":5}]}],
       "PreToolUse": [{"hooks":[{"type":"command","command":"/usr/local/bin/clawlens hook pre-tool","timeout":2}]}],
       "Stop": [{"hooks":[{"type":"command","command":"/usr/local/bin/clawlens hook stop","timeout":5}]}],
       "StopFailure": [{"matcher":"","hooks":[{"type":"command","command":"/usr/local/bin/clawlens hook stop-error","timeout":2}]}],
       "SessionEnd": [{"matcher":"","hooks":[{"type":"command","command":"/usr/local/bin/clawlens hook session-end","timeout":3}]}]
     }
   }
   ```
   Write to ManagedSettingsPath(), root-owned (0644).

5. **Initialize local queue DB**

6. **Print success + status**

- [ ] **Step 2: Uninstall flow**

`Uninstall() error`:
- Remove managed-settings.json (or restore backup if exists)
- Remove config dir
- Print confirmation

- [ ] **Step 3: Status command**

`Status() error`:
- Load config, show server URL, user status, last sync, unsynced count, collection level

- [ ] **Step 4: Sync command**

`SyncNow() error`:
- Force immediate batch sync

- [ ] **Step 5: Tests + commit**

Test managed-settings.json generation matches expected format. Test config write/read. Test pre-flight detection logic.

```bash
git add -A && git commit -m "feat(client): installer — setup, uninstall, status, sync"
```

---

### Task 7: Doctor + Self-update

**Files:**
- Create: `internal/client/doctor.go`
- Create: `internal/client/update.go`

- [ ] **Step 1: doctor.go**

`Doctor() error`:

Prints diagnostic report (from addendum spec):
```
ClawLens Diagnostics
  Binary version:     {version}
  Server URL:         {config.ServerURL}
  Server reachable:   ✓ (45ms) / ✗ (error)
  Auth token valid:   ✓ / ✗
  managed-settings:   ✓ configured / ✗ missing
  Local DB size:      {queue.DBSize()} formatted
  Unsynced events:    {queue.UnsyncedCount()}
  Last sync:          {config.LastSync} ago
  Collection level:   {config.CollectionLevel}
  Secret scrubbing:   {config.SecretScrub}
  Client version:     {version}
```

Each check: try the operation, print ✓/✗ with detail.

- [ ] **Step 2: update.go**

`CheckAndUpdate(updateInfo *UpdateInfo) error`:

From session-start response:
1. If `!updateInfo.Available` → return nil
2. Download binary from `updateInfo.URL` (relative to server URL)
3. Compute SHA-256 of downloaded file
4. Compare with `updateInfo.SHA256` — abort if mismatch
5. Atomic replace: write to temp file in same dir → `os.Rename` (atomic on same FS)
6. Log success

`selfPath() string` — `os.Executable()` resolved.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(client): doctor diagnostics and self-update"
```

---

### Task 8: CLI entry point

**Files:**
- Modify: `cmd/clawlens/main.go`

- [ ] **Step 1: main.go — command dispatch**

```
clawlens hook <action>      ← called by Claude Code hooks (stdin)
clawlens setup --code X --server URL
clawlens uninstall
clawlens status
clawlens sync
clawlens doctor
clawlens version
clawlens --help
```

Parse os.Args. Route to appropriate handler.

For `hook` subcommand: read action from args[2], dispatch to HandleSessionStart/HandlePrompt/etc. Start batch syncer in background for the duration of the hook call (handles async queue flush). Respect hook timeouts — defer syncer.Stop() with context deadline.

- [ ] **Step 2: Build + verify**

```bash
make client
./bin/clawlens version
./bin/clawlens --help
```

- [ ] **Step 3: Integration test**

Start server with ADMIN_PASSWORD=test. Create user via admin API. Run setup with install code. Verify config written. Run `clawlens doctor`. Simulate prompt hook with echo + pipe to stdin.

- [ ] **Step 4: Commit**

```bash
go test ./... -v -count=1
git add -A && git commit -m "feat(client): CLI entry point — hook dispatch, setup, doctor"
```

---

### Task 9: Build verification + Makefile update

**Files:**
- Modify: `Makefile`

- [ ] **Step 1: Update Makefile release target for both binaries**

Add server cross-compile targets alongside client. Add `make all` target.

- [ ] **Step 2: Full build + test**

```bash
make clean && make build
go test ./... -v -count=1 -race
make release  # verify cross-compilation works
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: complete build system — server + client, cross-compilation"
```
