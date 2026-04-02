# Scope 7: Real-Time Activity Tracking & Antigravity Integration — Raw Ideas

## Core Problem
- Current tracking has delays (batch collection, not real-time)
- Antigravity has no hook system — need to synthesize hook-like events
- Team relies heavily on Antigravity (free tier) — must track it properly
- Need to avoid duplicate data when same developer uses both Claude Code and Antigravity

## Antigravity Integration Architecture

### Primary: VS Code Extension (near-real-time)
- Mature the existing `clawlens-antigravity-probe` (v0.0.1) into a production extension
- Uses `antigravity-sdk` v1.7.0 (already bundled in probe)
- Subscribe to SDK events:
  - `onStepCountChanged` — fires when conversation gains new steps (~3-5s polling lag)
  - `onNewConversation` — new session created
  - `onActiveSessionChanged` — user switches conversations
- On each event: fetch new step(s) via `GetCascadeTrajectorySteps`, POST to ClawLens server
- Also reads: workspace URIs (for project correlation), user status, model info
- ~3-5 second latency — good enough for analytics (not gating prompts)

### Fallback: Collector Script (batch)
- Existing `antigravity-collector.mjs` — discovers LanguageServer processes via gRPC-Web API
- Runs periodically to backfill gaps, catch pre-extension history
- Handles cases where extension fails to load

### Antigravity is Tracking-Only
- No kill switch, no rate limiting, no prompt blocking for Antigravity
- It's free tier — no cost control needed
- Pure analytics: record prompts, responses, sessions, activity timestamps

## Available Data from Antigravity SDK

### Real-Time Events (polling-based, 3-5s lag)
- New conversation created
- Conversation step count changed (must fetch to get content)
- Active conversation switched
- USS state changes (noisy, filter needed)

### On-Demand Data
- Full conversation history (prompts, responses, tool calls, timestamps)
- User status (tier, available models)
- Agent preferences (16 settings)
- Workspace URIs (project directory correlation)
- System diagnostics (version, LS port)

### NOT Available
- True real-time WebSocket events
- AI thinking chains
- Streaming responses (only final)
- Tool execution output (only tool name + input)

## Deduplication Concerns
- Same developer may use Claude Code and Antigravity on the same project
- Same file changes may appear in both tool streams
- Need careful dedup strategy — discuss in detailed design
- Possible approach: correlate by timestamp + cwd + user, tag source on every event

## Improved Dashboard Real-Time
- WebSocket broadcast of activity events to dashboard (extend existing ws infrastructure)
- Live activity feed: "User X just submitted prompt in Project Y (via Antigravity)"
- Real-time credit burn rate for Claude Code (Antigravity is free, no credits)
- Per-user "currently active" indicator with source (CC/Codex/AG)

## Data Model Additions
- Extend existing `sessions` and `prompts` tables with source tagging (already exists)
- `antigravity_sync_state` — per-user last synced cascade_id + step_index (avoid re-processing)
- Ensure all activity tables have `source` column (claude-code/codex/antigravity)

## Open Questions
- Should the extension auto-install via the client installer, or separate installation?
- Extension update mechanism — VS Code marketplace or manual VSIX push?
- How to handle Antigravity offline mode (if they work without internet)?
- Deduplication strategy needs deep discussion
- Codex IDE integration — same extension approach or different?
