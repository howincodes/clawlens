# HowinLens Phase 1: Client + Credential Control — Design Spec

## Overview

Phase 1 delivers the Electron desktop client, subscription credential management, usage monitoring, JSONL conversation tracking, and CLI companion. This is the phase that solves the biggest pain: manual credential sharing across 3 subscriptions / 6-8 devs.

## Architecture

### New Package: `packages/client/`

Electron app with:
- System tray (macOS/Windows/Linux)
- Webview panel loading server-hosted React pages
- Native modules: file watcher, credential manager, notifications
- CLI companion (`howinlens` command)
- Background heartbeat to server

### New Server Components

- Subscription credential vault (new DB tables + API endpoints)
- Usage polling service (polls claude.ai API per subscription)
- Client API endpoints (punch in/out, heartbeat, credential delivery)
- Dashboard pages for subscription monitoring

## 1.1 — Database Schema Additions

### `subscription_credentials` table
```
id: serial PK
email: varchar(255) — the subscription email
access_token: text — encrypted OAuth access token
refresh_token: text — encrypted OAuth refresh token
expires_at: timestamptz — when access token expires
org_id: varchar(255) — Claude organization ID
subscription_type: varchar(50) — pro/max/team
rate_limit_tier: varchar(100)
is_active: boolean default true
last_refreshed_at: timestamptz
created_at: timestamptz
```

### `credential_assignments` table
```
id: serial PK
credential_id: int FK → subscription_credentials
user_id: int FK → users
assigned_at: timestamptz
released_at: timestamptz nullable
status: varchar(20) — active/released
```

### `usage_snapshots` table
```
id: serial PK
credential_id: int FK → subscription_credentials
five_hour_utilization: real
seven_day_utilization: real
opus_weekly_utilization: real
sonnet_weekly_utilization: real
five_hour_resets_at: timestamptz
seven_day_resets_at: timestamptz
recorded_at: timestamptz
```

### `heartbeats` table
```
id: serial PK
user_id: int FK → users
client_version: varchar(50)
platform: varchar(20) — darwin/linux/win32
watch_status: varchar(20) — on/off
active_task_id: int nullable
last_ping_at: timestamptz
```

### `watch_events` table
```
id: serial PK
user_id: int FK → users
type: varchar(10) — on/off
timestamp: timestamptz
source: varchar(20) — tray/cli/mobile/auto
latitude: real nullable
longitude: real nullable
```

### `conversation_messages` table (from JSONL tracking)
```
id: serial PK
user_id: int FK → users
session_id: varchar(255)
type: varchar(20) — user/assistant
message_content: text
model: varchar(100)
input_tokens: int
output_tokens: int
cached_tokens: int
cwd: text
git_branch: varchar(255)
timestamp: timestamptz
synced_at: timestamptz
```

## 1.2 — Server API Endpoints

### Client Auth & Heartbeat
```
POST /api/v1/client/heartbeat        — client ping (every 30s)
POST /api/v1/client/watch/on         — punch in / start tracking
POST /api/v1/client/watch/off        — punch out / stop tracking
GET  /api/v1/client/status           — current user status, active credential, usage
GET  /api/v1/client/credential       — get assigned credential for writing to local machine
POST /api/v1/client/conversations    — sync JSONL conversation data
```

### Subscription Management (Admin)
```
GET    /api/admin/subscriptions/credentials     — list all subscription credentials
POST   /api/admin/subscriptions/credentials     — add subscription credential
DELETE /api/admin/subscriptions/credentials/:id  — remove credential
GET    /api/admin/subscriptions/usage           — all subscriptions with live usage %
GET    /api/admin/subscriptions/assignments     — who has which subscription
POST   /api/admin/subscriptions/rotate          — manually trigger rotation
POST   /api/admin/subscriptions/kill/:userId    — revoke credential from user
```

## 1.3 — Usage Monitoring Service

Server-side cron job that:
1. Every 60 seconds, for each active subscription credential:
   - Calls claude.ai Messages API with minimal request (haiku, 1 token)
   - Reads rate limit headers (5h utilization, 7d utilization, reset times)
   - Stores snapshot in `usage_snapshots` table
2. If any subscription hits 80% on 5h window:
   - Alerts admin via WebSocket
   - Optionally triggers auto-rotation
3. Pace projection: based on usage rate, project when limit will be hit

## 1.4 — Smart Credential Rotation

When a subscription approaches its limit:
1. Find the least-used subscription
2. Find users on the exhausted subscription
3. Push new credentials to those users' clients via WebSocket
4. Client writes new credentials to local machine
5. Old credentials released
6. Transparent to developer — Claude Code keeps working

## 1.5 — Electron Client

### Tech Stack
- Electron 34+ (latest stable)
- electron-builder for packaging
- electron-updater for auto-updates

### Structure
```
packages/client/
├── package.json
├── tsconfig.json
├── electron-builder.yml
├── src/
│   ├── main/
│   │   ├── index.ts          — main process entry
│   │   ├── tray.ts           — system tray management
│   │   ├── window.ts         — webview window management
│   │   ├── ipc.ts            — IPC handlers
│   │   ├── credentials.ts    — credential write/delete (cross-platform)
│   │   ├── heartbeat.ts      — server heartbeat (30s interval)
│   │   ├── jsonl-watcher.ts  — watch ~/.claude/projects/ for conversations
│   │   ├── notifications.ts  — cross-platform desktop notifications
│   │   └── auto-updater.ts   — electron-updater integration
│   └── preload/
│       └── index.ts          — preload script for webview
├── assets/
│   ├── icon.png              — tray icon (on watch)
│   ├── icon-off.png          — tray icon (off watch)
│   └── icon-alert.png        — tray icon (alert)
└── cli/
    └── index.ts              — CLI companion (howinlens command)
```

### Cross-Platform Credential Management
```typescript
// credentials.ts
async function writeCredentials(accessToken: string, refreshToken: string): Promise<void> {
  const platform = process.platform;
  const credPath = path.join(os.homedir(), '.claude', '.credentials.json');

  // Write to credentials file (all platforms)
  const creds = { claudeAiOauth: { accessToken, refreshToken, expiresAt: Date.now() + 7200000 } };
  await fs.writeFile(credPath, JSON.stringify(creds, null, 2));

  // Write to platform keychain
  if (platform === 'darwin') {
    execSync(`security delete-generic-password -s "Claude Code-credentials" -a "${os.userInfo().username}" 2>/dev/null; security add-generic-password -s "Claude Code-credentials" -a "${os.userInfo().username}" -w '${JSON.stringify(creds)}' -U`);
  } else if (platform === 'linux') {
    // Use secret-tool (libsecret)
    execSync(`echo '${JSON.stringify(creds)}' | secret-tool store --label="Claude Code" service "Claude Code-credentials" account "${os.userInfo().username}"`);
  } else if (platform === 'win32') {
    // Use cmdkey or write to credential file only
    await fs.writeFile(credPath, JSON.stringify(creds, null, 2));
  }
}

async function deleteCredentials(): Promise<void> {
  const credPath = path.join(os.homedir(), '.claude', '.credentials.json');
  await fs.unlink(credPath).catch(() => {});

  if (process.platform === 'darwin') {
    execSync(`security delete-generic-password -s "Claude Code-credentials" -a "${os.userInfo().username}" 2>/dev/null`);
  }
  // Also run claude auth logout
  execSync('claude auth logout 2>/dev/null').catch(() => {});
}
```

## 1.6 — CLI Companion

Standalone Node.js script that talks directly to the server:
```
howinlens status          — watch state, active task, usage %
howinlens watch-on        — start tracking (punch in)
howinlens watch-off       — stop tracking (punch out)
howinlens task set <id>   — set active task
howinlens task list       — show assigned tasks
howinlens config          — view/edit local config
```

Config stored at `~/.howinlens/config.json`:
```json
{
  "serverUrl": "https://your-server.com",
  "authToken": "user-auth-token",
  "autoStart": true
}
```
