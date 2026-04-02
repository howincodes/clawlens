# HowinLens — Implementation Phases

> Last updated: 2026-04-02
> Branch: phase0/foundation

---

## Phase 1: Server-side Credential Vault — DONE

**Status:** Built, deployed, ready for testing.

| Item | Status | Files |
|------|--------|-------|
| AES-256-GCM encryption service | DONE | `packages/server/src/services/encryption.ts` |
| Encryption tests (18 passing) | DONE | `packages/server/tests/encryption.test.ts` |
| Schema: encrypted columns, accountUuid, needsReauth, rawResponse | DONE | `packages/server/src/db/schema/credentials.ts` |
| Schema: oauth_pending_flows table | DONE | same file |
| DB queries: pending flows, credential lookup, reauth marking | DONE | `packages/server/src/db/queries/credentials.ts` |
| OAuth service: PKCE, auth URL, code exchange, token refresh, usage fetch | DONE | `packages/server/src/services/oauth.ts` |
| Routes: POST /oauth/start, /oauth/exchange, /credentials/:id/refresh | DONE | `packages/server/src/routes/subscription-api.ts` |
| Usage monitor: primary /api/oauth/usage + haiku fallback | DONE | `packages/server/src/services/usage-monitor.ts` |
| Usage monitor: real token refresh (rotates refresh_token) | DONE | same file |
| Usage monitor: needs-reauth alert on 401/403 | DONE | same file |
| Usage monitor: proactive refresh cron (every 6h) | DONE | same file |
| Usage monitor: credential push to clients via WebSocket on refresh | DONE | same file |
| Pace projection (6-tier: comfortable → runaway) | PRESERVED | same file |
| Dashboard: Credentials page with cards, usage bars, status badges | DONE | `packages/dashboard/src/pages/Credentials.tsx` |
| Dashboard: OAuth Add wizard (3-step) | DONE | `packages/dashboard/src/pages/CredentialAdd.tsx` |
| Dashboard: API functions (startOAuthFlow, exchangeOAuthCode, refreshCredential) | DONE | `packages/dashboard/src/lib/api.ts` |
| Dashboard: Router + Sidebar (Credential Vault with Lock icon) | DONE | `App.tsx` + `Sidebar.tsx` |
| Encryption key generated in .env | DONE | `.env` |
| Schema pushed to production DB | DONE | via `drizzle-kit push` |

---

## Phase 2: Client Daemon Fixes — NEXT

**Goal:** Make the background daemon correctly receive credentials from server and write them to Claude Code's storage, and fix the JSONL watcher.

### 2.1 Fix credential writer — add oauthAccount metadata
- **File:** `packages/client/src/main/services/credentials.ts`
- **What:** Currently writes `~/.claude/.credentials.json` and keychain. Does NOT update `oauthAccount` in `~/.claude.json`. Without this, `claude auth status` shows `email: null`.
- **Fix:** After writing credentials, read `~/.claude.json`, update/add the `oauthAccount` field with `{accountUuid, emailAddress, organizationUuid, displayName, organizationName}`, write back.
- **Platform specifics:**
  - macOS: Keychain write uses hex-encoded JSON (from CC source), account name = `process.env.USER`
  - Linux/Windows: File write to `~/.claude/.credentials.json` (mode 0600)
  - All platforms: Update `~/.claude.json` oauthAccount field

### 2.2 Add credential receiver via WebSocket
- **File:** `packages/client/src/main/services/credentials.ts` (or new `credential-receiver.ts`)
- **What:** Listen for `credential_update` WebSocket messages from server. When received, write the new credentials + metadata to disk/keychain.
- **Payload from server:**
  ```json
  {
    "claudeAiOauth": { "accessToken", "refreshToken", "expiresAt", "scopes", "subscriptionType", "rateLimitTier" },
    "oauthAccount": { "accountUuid", "emailAddress", "organizationUuid", "displayName", "organizationName" }
  }
  ```
- **Depends on:** WebSocket connection (already exists in heartbeat service)

### 2.3 Fix JSONL watcher
- **File:** `packages/client/src/main/services/jsonl-watcher.ts`
- **Issues found during testing:**
  - `**/*.jsonl` glob fails on some systems — watch specific project directories instead
  - Missing `cache_creation_input_tokens` in token counting
  - No retry logic for failed syncs (drops messages)
  - Line types: `user`, `assistant`, `system`, `file-history-snapshot`, `attachment`, `permission-mode`, `queue-operation`, `custom-title`, `last-prompt` — watcher should handle all of them
- **Fix:** Watch `~/.claude/projects/<hash>/` directories, not deep glob. Add retry queue for failed syncs. Handle all JSONL line types.

### 2.4 Add offline queue
- **File:** New `packages/client/src/main/services/offline-queue.ts`
- **What:** When server is unreachable, buffer events (JSONL chunks, file events, heartbeats) in a local queue file (`~/.howinlens/queue.json`). Flush when connection is restored.
- **Queue format:** Array of `{ type, payload, timestamp }` objects
- **Max queue size:** 1000 events or 10MB, whichever comes first

### 2.5 Fix heartbeat service
- **File:** `packages/client/src/main/services/heartbeat.ts`
- **Issues:** Hardcoded `watchStatus: 'on'` (should track actual state). No error retry.
- **Fix:** Track actual watch state. Add retry with backoff on failure.

---

## Phase 3: Electron UI

**Goal:** Make the Electron app usable — setup flow, tray, dashboard webview.

### 3.1 Setup flow
- **File:** `packages/client/src/main/index.ts` (modify)
- **What:** First-run wizard: enter server URL + auth token. Currently shows inline HTML instructions. Replace with proper setup window.
- **Flow:** Server URL input → Auth token input (from admin dashboard) → Verify connection → Save to `~/.howinlens/config.json` → Start services

### 3.2 Tray icon with real status
- **File:** `packages/client/src/main/tray.ts` (modify)
- **What:** Currently uses placeholder icons. Add real icons with status colors.
- **States:** Connected (green), Disconnected (red), Syncing (blue pulse), Alert (yellow)
- **Context menu:** Watch On/Off, Open Dashboard, Status, Quit
- **Assets needed:** `assets/tray-on.png`, `assets/tray-off.png`, `assets/tray-alert.png`, `assets/icon.png`

### 3.3 Dashboard webview
- **File:** `packages/client/src/main/window.ts` (modify)
- **What:** Currently loads remote URL. Add offline fallback (show last-known status). Add error page if server unreachable.
- **Window position:** Save/restore position and size across restarts

### 3.4 Settings panel
- **File:** New renderer component
- **What:** UI to edit config (server URL, auth token, auto-start toggle, notifications toggle). Currently must edit `~/.howinlens/config.json` by hand.

### 3.5 Notification system
- **File:** `packages/client/src/main/services/notifications.ts` (currently a stub)
- **What:** Connect to WebSocket events. Show native OS notifications for: credential rotated, usage alert, token expiring, needs-reauth.

---

## Phase 4: Hardening

**Goal:** Production reliability and release readiness.

### 4.1 Error recovery
- All background services: catch errors, log, retry with exponential backoff
- Service health monitor: if any service crashes, restart it
- Graceful shutdown sequencing (stop watchers → flush queues → disconnect WS → exit)

### 4.2 Cross-platform testing
- Test full flow on macOS, Linux (Ubuntu), Windows 10/11
- Test credential writing on all 3 platforms
- Test JSONL watching on all 3 platforms
- Test auto-start (launchd, systemd, schtasks) on all 3

### 4.3 Code signing
- macOS: Apple Developer certificate for DMG signing
- Windows: EV code signing certificate for NSIS installer
- Linux: AppImage doesn't require signing (but GPG sig recommended)

### 4.4 Auto-updater
- **File:** electron-updater config in `electron-builder.yml`
- **What:** Configure update server. Check for updates on startup + every 24h. Download + prompt to restart.
- **Server:** GitHub Releases or custom update server

### 4.5 Retry logic everywhere
- API client: retry 3x with exponential backoff (1s, 2s, 4s)
- WebSocket: auto-reconnect with backoff
- JSONL sync: retry failed chunks with backoff
- Token refresh: retry up to 5x with 1-2s random backoff (matching CC's own logic)

---

## Phase 5: Codex + Antigravity

**Goal:** Extend the credential and data collection workflow to other AI tools.

### 5.1 Codex credential management
- Same vault pattern: store Codex API tokens encrypted
- Codex uses different auth (not OAuth) — API key based
- Assign to users, push to client, client writes to Codex config
- Track Codex usage via hook events (already have codex adapter)

### 5.2 Antigravity data collection
- Personal accounts — no credential management needed
- Collect conversation data + timing + project context
- Need Antigravity adapter (exists as stub in `packages/server/src/providers/`)
- Client needs Antigravity file watcher (different file format than JSONL)

### 5.3 Multi-provider dashboard
- Unified usage view across Claude Code, Codex, Antigravity
- Per-user breakdown: which tools they're using, how much
- Cross-provider analytics

---

## Phase 6: Advanced Features

**Goal:** Full team operations platform.

### 6.1 RBAC enforcement
- **Files:** `packages/server/src/middleware/permission.ts` (exists, not applied)
- **What:** Apply `requirePermission()` middleware to all admin endpoints
- Currently all admin routes just need `adminAuth` — no role checking

### 6.2 Attendance + Salary
- No schema exists yet
- Track punch in/out (watch events already capture this)
- Salary calculation based on attendance + productivity
- Leave management

### 6.3 Git analysis
- Webhook receiver for GitHub push/PR events
- Track commits, PRs, code review activity per user
- Correlate with Claude Code sessions (same git branch = same work)

### 6.4 AI Summary Pipeline
- Batch daily/weekly/monthly summaries per user
- Team pulse (already has `teamPulses` table)
- User profiles (already has `userProfiles` table)
- Auto-standup generation from session data

### 6.5 Reports + Project Health
- Sprint velocity based on task completion
- Project health scores (activity, completion rate, risk flags)
- Manager dashboards with team overview
- Export to PDF/Slack

### 6.6 Remote Config
- Push configuration to client apps from server
- Feature flags per user/team
- Claude Code settings management (hooks, permissions)

---

## Key Technical Decisions (from testing)

| Decision | Choice | Evidence |
|----------|--------|----------|
| Credential storage | Per-platform: macOS Keychain, Linux/Windows file | Tested on all 3 |
| Token refresh | JSON POST to platform.claude.com, token rotates | Tested, confirmed 8h expiry |
| Usage polling | GET api.anthropic.com/api/oauth/usage (primary) + haiku headers (fallback) | Both tested |
| OAuth login | Server generates PKCE URL, admin pastes code | Tested end-to-end |
| JSONL sync | Offset-based, one file per session, complete JSON per line | Tested on VPS + Mac |
| Client auto-restart | launchd (macOS), systemd (Linux), schtasks (Windows) | systemd tested, launchd assumed |
| Token revocation | No API — delete locally, server stops pushing | Confirmed from source code |
| Metadata cache | oauthAccount in ~/.claude.json, needed for auth status email display | Tested on all 3 |

---

## Reference Documents

- `docs/design/credential-delivery-spec.md` — Complete credential delivery specification with per-platform recipes
- `docs/design/approach-testing-results.md` — All 17 test results
- `docs/design/approach-testing-matrix.md` — Original test plan
- `docs/design/credential-and-collection-design.md` — Design approaches document
- `HANDOFF.md` — Full project state
