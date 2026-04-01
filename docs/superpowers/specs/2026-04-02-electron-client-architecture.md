# HowinLens Electron Client — Architecture

## Package Structure

```
packages/client/
├── package.json
├── tsconfig.json
├── electron-builder.yml
├── src/
│   ├── main/
│   │   ├── index.ts              — main process entry, app lifecycle
│   │   ├── tray.ts               — system tray icon + context menu
│   │   ├── window.ts             — webview window (BrowserWindow)
│   │   ├── ipc.ts                — IPC handlers (main ↔ renderer)
│   │   ├── services/
│   │   │   ├── api-client.ts     — HTTP client to HowinLens server
│   │   │   ├── credentials.ts    — write/delete Claude credentials (cross-platform)
│   │   │   ├── heartbeat.ts      — server heartbeat (30s interval)
│   │   │   ├── jsonl-watcher.ts  — watch ~/.claude/projects/ for conversations
│   │   │   ├── file-watcher.ts   — watch project directories for file changes
│   │   │   ├── app-tracker.ts    — active window/app tracking
│   │   │   ├── notifications.ts  — cross-platform desktop notifications
│   │   │   └── auto-updater.ts   — electron-updater integration
│   │   └── utils/
│   │       ├── config.ts         — local config (~/.howinlens/config.json)
│   │       ├── logger.ts         — file-based logging
│   │       └── platform.ts       — OS-specific helpers
│   └── preload/
│       └── index.ts              — contextBridge API for renderer
├── assets/
│   ├── tray-on.png               — tray icon (On Watch)
│   ├── tray-off.png              — tray icon (Off Watch)
│   ├── tray-alert.png            — tray icon (alert state)
│   └── icon.png                  — app icon
└── cli/
    └── index.ts                  — CLI companion (howinlens command)
```

## Key Design Decisions

### 1. Webview = Server-Hosted React Pages
The BrowserWindow loads pages from the HowinLens server URL (e.g. `https://server/client/dashboard`).
No bundled React code in the Electron app. UI updates = server deploy, no client update needed.

### 2. Thin Native Shell
The Electron main process handles ONLY native capabilities:
- System tray
- File system access (credentials, file watcher, JSONL watcher)
- OS notifications
- Background services (heartbeat, tracking)
- IPC bridge to webview

### 3. Config Storage
`~/.howinlens/config.json`:
```json
{
  "serverUrl": "https://your-server.com",
  "authToken": "user-auth-token",
  "watchedDirectories": [],
  "autoStart": true,
  "notificationsEnabled": true
}
```

### 4. JSONL Watcher
Watches `~/.claude/projects/` for `.jsonl` file changes.
On modification:
1. Read new lines since last position (track file offsets)
2. Parse each line (type: user/assistant/queue-operation/last-prompt)
3. For user/assistant messages: extract content, model, tokens, cwd, gitBranch
4. Batch POST to server every 10 seconds (or on session end)
5. Also store raw JSONL content for full session replay

### 5. File Watcher for Activity Tracking
Watches project directories linked via server.
Uses `chokidar` (cross-platform, debounced, handles renames).
Records: file path, event type (add/change/unlink), timestamp, size delta.
Ignores: node_modules, .git, dist, build, *.log, etc.
Batches events and syncs to server every 30 seconds.

### 6. App Tracker
macOS: `osascript` to get frontmost app name + window title
Linux: `xdotool` or `xprop` for active window
Windows: PowerShell `Get-Process` with MainWindowTitle
Polls every 5 seconds. Records app switches (not continuous polling).

### 7. Cross-Platform Credentials
See Phase 1 spec for full credential write/delete logic.
macOS: `security` CLI for Keychain
Linux: `secret-tool` for libsecret
Windows: credential file only (no native credential manager integration for v1)
All platforms: write to `~/.claude/.credentials.json`

## Dependencies
- electron: ^34.0.0
- electron-builder: ^26.0.0
- electron-updater: ^6.0.0
- chokidar: ^4.0.0 (file watching)
- node-fetch or built-in fetch (API calls)
- No React/frontend deps (webview loads from server)
