# ClawLens v0.2 — Master Build Checklist

> Reference this file before and after every task. Check off items as completed.
> Spec: `docs/superpowers/specs/2026-03-28-clawlens-v02-design.md`

## Phase 0: Cleanup & Setup
- [x] Remove all v0.1 Go code (`internal/`, `cmd/`, `bin/`)
- [x] Remove old scripts (install-client.sh/ps1, update-client.sh/ps1, Dockerfiles, simulate.sh, etc.)
- [x] Remove old config files (go.mod, go.sum, Makefile, Dockerfile, docker-compose.yml, Caddyfile, analytics.yml)
- [x] Remove old test files (.playwright-cli/, old package.json, playwright.config.ts)
- [x] Remove local DB files (clawlens.db*)
- [x] Initialize pnpm monorepo (pnpm-workspace.yaml, root package.json, tsconfig.base.json)
- [x] Set up packages/server and packages/dashboard directories
- [x] Commit: "chore: remove v0.1 code, initialize v0.2 monorepo"

## Phase 1: Server — Core Infrastructure
- [x] Set up Express + TypeScript server scaffold (server.ts, package.json, tsconfig.json)
- [x] Set up better-sqlite3 with schema (db.ts) — 12 tables, 9 indexes
- [x] Implement auth middleware (hook-auth.ts for Bearer tokens, admin-auth.ts for JWT)
- [x] Implement zod schemas for Claude Code hook events (schemas/hook-events.ts)
- [x] Write tests for DB service (47 tests)
- [x] Write tests for auth middleware (16 tests)

## Phase 2: Server — Hook API Endpoints
- [x] All 11 hook endpoints implemented and tested
- [x] Rate limiting built into prompt handler (credit-based, per-model, time-of-day)
- [x] Kill switch on session-start, prompt, pre-tool (3 blocking layers)
- [x] Dead man's switch timestamp update on every hook
- [x] 21 hook API tests

## Phase 3: Server — Rate Limiting & Kill Switch (built into Phase 2)
- [x] Credit-based: opus=10, sonnet=3, haiku=1
- [x] Per-model caps, daily budget, time-of-day restrictions
- [x] Kill: continue:false + decision:block + permissionDecision:deny
- [x] Pause: same blocking, different message
- [x] Bug fix: FK error in killed-user prompt handler (wrapped in inner try/catch)

## Phase 4: Server — Tamper Detection
- [x] Dead man's switch background job (deadman.ts + node-cron, every 5 min)
- [x] Hook integrity hash verification (tamper.ts)
- [x] ConfigChange + FileChanged event processing -> tamper alerts
- [x] Auto-resolve inactive alerts when user sends events
- [x] 19 tamper detection tests

## Phase 5: Server — Admin API
- [x] 22 admin endpoints: login, team, users CRUD, analytics, prompts, summaries, audit log
- [x] Token generation (clwt_<slug>_<hex> format)
- [x] User status management (active/paused/killed)
- [x] Tamper alerts API (list, resolve)
- [x] 39 admin API tests

## Phase 6: Server — AI Service & Misc
- [x] Claude AI wrapper (claude-ai.ts): claude -p --bare --json-schema
- [x] Concurrency queue (max 2 parallel)
- [x] WebSocket live event feed at /ws
- [x] Broadcast hook events to dashboard
- [x] Summary generation wired to real AI service
- [x] Static dashboard serving with SPA fallback
- [x] Health endpoints (/health, /api/v1/health)
- [x] 7 AI service tests

## Phase 7: Client Install Script
- [x] install.sh: registers hooks in ~/.claude/settings.json
- [x] uninstall.sh: removes hooks from settings.json
- [x] enforce.sh: managed settings with allowManagedHooksOnly
- [x] restore.sh: clean removal of enforced mode

## Phase 8: Enforcement Scripts
- [x] enforce.sh: macOS/Linux Standard + Enforced (managed hooks + watchdog)
- [x] enforce.ps1: Windows equivalent
- [x] restore.sh: clean removal
- [x] restore.ps1: Windows clean removal
- [x] Watchdog: launchd (macOS), systemd (Linux), Task Scheduler (Windows)

## Phase 9: Dashboard Updates
- [x] Tamper alerts panel on Overview
- [x] User status indicators (Active/Inactive/Killed/Paused/Tampered)
- [x] AddUserModal: install instructions + token display
- [x] UserDetail: tamper alert history
- [x] Server: /tamper-alerts and /tamper-alerts/:id/resolve endpoints
- [x] Dashboard builds successfully

## Phase 10: Integration Testing
- [x] Server starts and health endpoints work
- [x] Hook endpoints accept Claude Code format JSON (all 11 tested via curl)
- [x] Session creation + prompt recording + credit tracking works
- [x] Kill switch works on session-start (continue:false)
- [x] Kill switch works on prompt (decision:block) — fixed FK bug
- [x] Kill switch works on pre-tool (permissionDecision:deny)
- [x] Analytics returns correct data
- [x] Admin API: user creation with token, status update, user listing
- [x] Test hook script on Docker containers with env vars — all hooks fire
- [x] Test with 3 dev containers (clawlens-dev1/2/3) — data flows to server
- [x] Playwright E2E: all 9 dashboard pages load, Add User flow works

## Phase 11: Remaining (for user to verify)
- [ ] Test with real Claude Code interactive session
- [ ] Deploy server to VPS (clawlens.howincloud.com)
- [ ] Test Enforced mode: enforce.sh on a machine

## Test Summary
- 149 unit/integration tests passing
- Server: 47 db + 16 auth + 21 hook-api + 19 tamper + 39 admin + 7 ai = 149
- Integration: hook script tested on 3 Docker containers — data flows correctly
- Kill switch: all 3 layers verified (continue:false, decision:block, permissionDecision:deny)
- Rate limiting: blocks correctly when credits exceed daily limit
- Tamper detection: ConfigChange + FileChanged create alerts, dashboard shows "tampered"
- Token rotation: old token rejected (401), new token works (200)
- User deletion: cascading cleanup, deleted token rejected
- Dashboard: all 9 pages load, Add User creates user + shows token + install steps
