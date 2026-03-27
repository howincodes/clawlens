# ClawLens v0.2 — Master Build Checklist

> Reference this file before and after every task. Check off items as completed.
> Spec: `docs/superpowers/specs/2026-03-28-clawlens-v02-design.md`

## Phase 0: Cleanup & Setup
- [ ] Remove all v0.1 Go code (`internal/`, `cmd/`, `bin/`)
- [ ] Remove old scripts (install-client.sh/ps1, update-client.sh/ps1, Dockerfiles, simulate.sh, etc.)
- [ ] Remove old config files (go.mod, go.sum, Makefile, Dockerfile, docker-compose.yml, Caddyfile, analytics.yml)
- [ ] Remove old test files (.playwright-cli/, old package.json, playwright.config.ts)
- [ ] Remove local DB files (clawlens.db*)
- [ ] Initialize pnpm monorepo (pnpm-workspace.yaml, root package.json, tsconfig.base.json)
- [ ] Set up packages/server, packages/dashboard, packages/plugin directories
- [ ] Commit: "chore: remove v0.1 code, initialize v0.2 monorepo"

## Phase 1: Server — Core Infrastructure
- [ ] Set up Express + TypeScript server scaffold (server.ts, package.json, tsconfig.json)
- [ ] Set up better-sqlite3 with schema (db.ts) — all tables from spec
- [ ] Implement auth middleware (hook-auth.ts for Bearer tokens, admin-auth.ts for JWT)
- [ ] Implement zod schemas for Claude Code hook events (schemas/hook-events.ts)
- [ ] Write tests for DB service
- [ ] Write tests for auth middleware
- [ ] Commit: "feat(server): core infrastructure — Express, SQLite, auth, schemas"

## Phase 2: Server — Hook API Endpoints
- [ ] POST /api/v1/hook/session-start (kill switch, session creation, dead man's switch)
- [ ] POST /api/v1/hook/prompt (rate limiting, credit check, prompt recording)
- [ ] POST /api/v1/hook/pre-tool (kill switch backup, tool event recording)
- [ ] POST /api/v1/hook/stop (response recording, credit cost)
- [ ] POST /api/v1/hook/stop-error (error logging)
- [ ] POST /api/v1/hook/session-end (session finalization)
- [ ] POST /api/v1/hook/post-tool (tool usage analytics)
- [ ] POST /api/v1/hook/subagent-start (subagent tracking)
- [ ] POST /api/v1/hook/post-tool-failure (error analytics)
- [ ] POST /api/v1/hook/config-change (tamper detection)
- [ ] POST /api/v1/hook/file-changed (tamper detection)
- [ ] Write tests for each hook endpoint
- [ ] Commit: "feat(server): 11 hook API endpoints"

## Phase 3: Server — Rate Limiting & Kill Switch
- [ ] Implement credit-based rate limiter (limiter.ts)
- [ ] Per-model caps (opus=10, sonnet=3, haiku=1)
- [ ] Daily credit budget enforcement
- [ ] Time-of-day restrictions
- [ ] Kill switch: return `continue: false` / `decision: block` / `permissionDecision: deny`
- [ ] Pause switch: same blocking, different message
- [ ] Write tests for limiter
- [ ] Commit: "feat(server): rate limiting + kill switch"

## Phase 4: Server — Tamper Detection
- [ ] Dead man's switch background job (deadman.ts + node-cron)
- [ ] Hook integrity hash verification (tamper.ts)
- [ ] ConfigChange event processing
- [ ] FileChanged event processing
- [ ] Tamper alert creation and resolution
- [ ] Write tests for tamper detection
- [ ] Commit: "feat(server): tamper detection system"

## Phase 5: Server — Admin API
- [ ] Port existing admin endpoints from Go (users, sessions, prompts, analytics, subscriptions, limits, alerts)
- [ ] Token generation endpoint (for Add User flow)
- [ ] User status update (active/paused/killed)
- [ ] Tamper alerts API (list, resolve)
- [ ] Team settings API (dead man's switch threshold)
- [ ] Write tests for admin API
- [ ] Commit: "feat(server): admin API"

## Phase 6: Server — AI Service & Misc
- [ ] Claude AI wrapper service (claude-ai.ts) using `claude -p --bare --json-schema`
- [ ] Summary generation endpoint
- [ ] WebSocket for live event feed (ws)
- [ ] Static dashboard serving
- [ ] CORS configuration
- [ ] Health endpoint
- [ ] Write tests for AI service
- [ ] Commit: "feat(server): AI service, WebSocket, health"

## Phase 7: Plugin
- [ ] Create plugin.json with userConfig
- [ ] Create hooks/hooks.json (8 HTTP + 2 command hooks + 1 FileChanged command)
- [ ] Create scripts/clawlens-hook.sh (command hook handler)
- [ ] Create skills/clawlens-status/SKILL.md
- [ ] Test plugin locally with `--plugin-dir`
- [ ] Commit: "feat(plugin): Claude Code plugin with hooks and status skill"

## Phase 8: Plugin Marketplace
- [ ] Create howincodes/claude-plugins marketplace repo structure
- [ ] Create marketplace.json
- [ ] Package plugin into marketplace structure
- [ ] Test marketplace install flow
- [ ] Commit: "feat(plugin): marketplace packaging"

## Phase 9: Dashboard Updates
- [ ] Update dashboard to work with new server API
- [ ] Add tamper alerts panel
- [ ] Add user status indicators (Active/Inactive/Tampered/Killed/Paused)
- [ ] Update Add User modal with plugin install instructions + token display
- [ ] Update Analytics page for new data sources (PostToolUse, SubagentStart)
- [ ] Build dashboard for production
- [ ] Commit: "feat(dashboard): tamper alerts, status indicators, install flow"

## Phase 10: Enforcement Scripts
- [ ] enforce.sh (macOS/Linux) — Tier 2 + Tier 3 support
- [ ] enforce.ps1 (Windows)
- [ ] restore.sh (macOS/Linux)
- [ ] restore.ps1 (Windows)
- [ ] Watchdog daemon configs (launchd plist, systemd timer, Task Scheduler)
- [ ] Commit: "feat(scripts): enforce/restore scripts + watchdog"

## Phase 11: Integration Testing
- [ ] Test Tier 1: Plugin install → hooks fire → data reaches server → dashboard shows data
- [ ] Test Tier 1: Rate limiting blocks prompts when over budget
- [ ] Test Tier 1: Kill switch blocks session via HTTP response
- [ ] Test Tier 1: Dead man's switch detects inactive user
- [ ] Test Tier 2: Managed settings → allowManagedHooksOnly → hooks can't be disabled
- [ ] Test Tier 2: Watchdog restores tampered managed settings
- [ ] Test Tier 3: Kill switch triggers `claude auth logout`
- [ ] Test tamper detection: remove hooks → server detects → dashboard shows alert
- [ ] Test AI summaries: `claude -p --bare --json-schema` returns structured output
- [ ] Test on Docker devbox (`docker exec -it devbox sh`)
- [ ] Playwright E2E tests for dashboard

## Phase 12: Server Deployment
- [ ] Update install-server.sh for Node.js server
- [ ] Update update-server.sh
- [ ] Deploy to VPS (clawlens.howincloud.com)
- [ ] Verify health endpoint
- [ ] Commit: "feat(deploy): server deployment scripts"

## Phase 13: Final Verification
- [ ] Full end-to-end test: install plugin → use Claude → check dashboard
- [ ] Verify all 11 hooks fire correctly
- [ ] Verify rate limiting works
- [ ] Verify kill switch works (all 3 tiers)
- [ ] Verify tamper detection works
- [ ] Clean up any temp files
- [ ] Final commit
