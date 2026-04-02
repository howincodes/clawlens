# HowinLens Core Workflow — Design Approaches

> Each approach has a standalone test you can run BEFORE integrating into the full system.
> Dev + testing on VPS: howinlens.howincloud.com
> Logging: verbose debug logging everywhere during dev stage.

---

# PILLAR 1: Credential Vault

## Background: How Claude Code Auth Works

Claude Code stores OAuth at `~/.claude/.credentials.json`:
```json
{
  "claudeAiOauth": {
    "accessToken": "sk-ant-oat-...",
    "refreshToken": "sk-ant-ort-...",
    "expiresAt": "2026-04-02T18:00:00.000Z",
    "scopes": ["user:inference", "user:profile"]
  }
}
```

- `accessToken`: short-lived (~1-2 hours), used for every API call
- `refreshToken`: long-lived (~30 days), used to get new accessTokens
- When accessToken expires, Claude Code automatically refreshes using refreshToken
- If refreshToken is revoked/expired, user must re-login via browser

## Approach A: Store refreshToken only, push accessToken (Recommended)

```
Server stores: refreshToken (encrypted)
Client gets:   accessToken (short-lived, 1-2h)
```

**How it works:**
1. Admin adds subscription: pastes refreshToken into dashboard
2. Server encrypts with AES-256-GCM, stores in `subscription_credentials`
3. Admin assigns subscription to User X
4. Server decrypts refreshToken, calls Claude OAuth to get fresh accessToken
5. Server pushes accessToken + expiresAt to User X's client
6. Client writes `~/.claude/.credentials.json` with the accessToken
7. When accessToken nears expiry, server auto-refreshes and pushes new one

**Rotation:** Server generates new accessToken from same refreshToken → push to client
**Revoke:** Server pushes "delete" command → client deletes credentials file
**If client offline:** accessToken expires naturally in 1-2h. User can't use Claude.

**Pros:**
- refreshToken never leaves server — most secure
- If dev's machine is compromised, attacker only gets short-lived token
- Server has full control over when/if to refresh

**Cons:**
- Server must proactively refresh before expiry (background job)
- If server goes down, no one gets refreshed tokens (but existing ones work until expiry)
- Slightly more complex: server needs to call Claude OAuth endpoint

**Standalone test:**
```bash
# Test: Can we refresh a token using Claude's OAuth?
# 1. Get a refreshToken from a real Claude account
# 2. Call the refresh endpoint
# 3. Verify we get a new accessToken
curl -X POST https://claude.ai/api/auth/oauth/token \
  -H "Content-Type: application/json" \
  -d '{"grant_type":"refresh_token","refresh_token":"sk-ant-ort-..."}'
# Expected: {"access_token":"sk-ant-oat-...","expires_in":3600,...}
```

## Approach B: Store both tokens, push both

```
Server stores: refreshToken + accessToken (both encrypted)
Client gets:   both tokens
```

**How it works:**
1. Admin adds subscription: pastes both tokens (or server extracts from login flow)
2. Server encrypts both, stores
3. On assign: server pushes both to client
4. Client writes full `~/.claude/.credentials.json`
5. Claude Code handles its own refresh (it already knows how)
6. Server periodically reads back the current state (usage polling tells us if it's working)

**Rotation:** Server calls OAuth refresh, gets new pair, pushes both
**Revoke:** Push "delete" command + optionally revoke refreshToken at Claude's end

**Pros:**
- Simpler: client gets full credentials, Claude Code handles refresh itself
- Works even if server goes down (client can refresh on its own)
- Less server-side complexity

**Cons:**
- refreshToken is on the dev's machine — if compromised, attacker has long-lived access
- Less control: dev could extract refreshToken and use it independently
- Can't guarantee revocation without network call to Claude's revoke endpoint

**Standalone test:**
```bash
# Test: Write credentials file, verify Claude Code works
echo '{"claudeAiOauth":{"accessToken":"sk-ant-oat-...","refreshToken":"sk-ant-ort-...","expiresAt":"2026-04-03T00:00:00.000Z"}}' > ~/.claude/.credentials.json
# Start Claude Code, verify it works
claude --version  # should show logged-in status
```

## Approach C: Session-based with server as refresh proxy

```
Server stores: refreshToken (encrypted)
Client gets:   accessToken + a HowinLens session token
```

**How it works:**
1. Server stores refreshToken encrypted
2. On assign: generates accessToken + a HowinLens session token
3. Client gets both. Writes accessToken to credentials file.
4. When accessToken expires, CLIENT asks HowinLens server: "refresh me" (using session token)
5. Server validates session token, refreshes via Claude OAuth, returns new accessToken
6. Client writes new accessToken to file

**Rotation:** Client triggers refresh, or server pushes new one
**Revoke:** Server invalidates the HowinLens session token. Client can't refresh anymore.

**Pros:**
- refreshToken never on client
- Server controls refresh lifecycle
- Revocation is instant (invalidate session token)
- Client is simpler (just asks server when it needs refresh)

**Cons:**
- Requires client to be online when token expires
- Extra round-trip for refresh

**Standalone test:**
```bash
# Test: Server refresh endpoint
# 1. Create a session token (JWT signed by server)
# 2. Client calls: POST /api/v1/client/refresh-credential
# 3. Server validates JWT, refreshes at Claude, returns new accessToken
```

## My Recommendation: Approach A (refreshToken on server only)

But we MUST first test: **Can we actually call Claude's OAuth refresh endpoint programmatically?** If yes, Approach A is clearly best. If Claude doesn't expose a standard OAuth refresh endpoint, we fall back to Approach B.

---

# PILLAR 1b: Encryption

## Approach: AES-256-GCM (industry standard)

```
CREDENTIAL_ENCRYPTION_KEY = random 32 bytes (stored in .env, NEVER in DB)

encrypt(plaintext):
  iv = random 16 bytes
  cipher = aes-256-gcm(key, iv)
  encrypted = cipher.update(plaintext) + cipher.final()
  tag = cipher.getAuthTag()
  return base64(iv + tag + encrypted)

decrypt(ciphertext):
  raw = base64decode(ciphertext)
  iv = raw[0:16], tag = raw[16:32], encrypted = raw[32:]
  decipher = aes-256-gcm(key, iv)
  decipher.setAuthTag(tag)
  return decipher.update(encrypted) + decipher.final()
```

**Standalone test:**
```typescript
// Test: encrypt/decrypt roundtrip
const key = crypto.randomBytes(32);
const encrypted = encrypt("sk-ant-ort-test-token", key);
const decrypted = decrypt(encrypted, key);
assert(decrypted === "sk-ant-ort-test-token");
```

---

# PILLAR 2: Usage Tracking

## How to poll Claude's usage API

Claude's usage is visible at `claude.ai/api/organizations/{orgId}/usage` but this requires a browser session cookie, not an OAuth token.

**Alternative approaches:**

### Approach A: Use the OAuth accessToken to poll /api/usage
Some Claude API endpoints accept OAuth tokens. We need to test if the usage endpoint does.

### Approach B: Store a session cookie per subscription
Admin provides a sessionKey (from browser). Server uses it to poll.
Problem: session cookies expire, need manual refresh.

### Approach C: Parse usage from Claude Code's status line
Claude Code shows usage in its status line. The hook script could capture it.
Our Codex hooks already do this (quota_primary_used_percent in stop events).

### Approach D: Calculate usage from our own data
We record every prompt + model. We know the credit cost per model.
We can calculate approximate usage from our own messages table.
Not as accurate as the official API but zero external dependencies.

**Recommended: Test A first, fallback to C+D**

We already have Approach C working for Codex (quota fields in stop events). For Claude Code, we need to test if OAuth tokens work with the usage endpoint.

**Standalone test:**
```bash
# Test: Does OAuth accessToken work for usage API?
curl https://claude.ai/api/organizations/{orgId}/usage \
  -H "Authorization: Bearer sk-ant-oat-..."
# If 200: Approach A works
# If 401: Need session cookie (Approach B) or calculate ourselves (D)
```

---

# PILLAR 3: Conversation Collection

## The JSONL File Structure

```
~/.claude/projects/
  {project-hash}/
    sessions/
      {session-id}.jsonl     # one file per session
```

Each line is a complete JSON object. File grows during a session.

## Sync Strategy: Offset-based append

### How it works:

```
Client state (per session file):
  session_id: "abc123"
  file_path: "~/.claude/projects/xxx/sessions/abc123.jsonl"
  last_synced_byte: 4096    # how far we've read
  last_synced_at: timestamp

Sync loop:
  1. File change detected (chokidar)
  2. Read from last_synced_byte to end of file
  3. POST raw bytes to server: POST /api/v1/client/session-jsonl
     Body: { session_id, offset: last_synced_byte, data: <raw bytes> }
  4. Server appends to session_raw_data table
  5. Server parses new lines into messages table
  6. Server returns: { next_offset: 8192 }
  7. Client updates last_synced_byte = 8192
```

### Deduplication (no duplicates guaranteed):

**Method: Offset-based idempotency**
- Client always sends: `session_id` + `offset` (byte position in file)
- Server stores: last received offset per session
- If client sends offset=4096 but server already has offset=8192 → skip (already synced)
- If client sends offset=4096 and server has offset=4096 → accept (new data)
- If client sends offset=0 → full re-sync (server replaces, not appends)

This means:
- Client crash + restart → re-reads from last known offset → no duplicates
- Server crash + restart → client re-sends from its offset → server skips if already has it
- Network timeout + retry → same offset sent again → server ignores duplicate

### Efficiency:

- Only send NEW bytes (delta), not the whole file
- Debounce file changes (wait 2-5 seconds for rapid writes to settle)
- Batch multiple sessions into one HTTP request if needed
- Compress payload if >10KB (gzip)

### Server-side storage:

```sql
-- Raw archive (one row per session, append-only)
session_raw_data:
  session_id (PK), raw_jsonl (TEXT), byte_length (INT), last_offset (INT), updated_at

-- Parsed messages (one row per human/assistant turn)
messages:
  id, provider, session_id, user_id, type, content, model, tokens, ...
```

**Server parse flow:**
1. Receive raw bytes + offset
2. Append to `session_raw_data.raw_jsonl`
3. Split new bytes by newlines
4. Parse each JSON line
5. For `type: "human"` → INSERT into messages (type='user')
6. For `type: "assistant"` → INSERT into messages (type='assistant')
7. Skip tool_use/tool_result (JSONL has them but we don't need them in messages)
8. Or optionally store tool events too (configurable)

**Dedup in messages table:**
- UNIQUE constraint on (session_id, type, content hash or timestamp)
- Or simpler: use the byte offset — if we parsed up to offset X, only parse after X

**Standalone test:**
```bash
# Test 1: Client-side offset reading
# Create a fake JSONL file, read 100 bytes, then read next 100
echo '{"type":"human","message":{"content":"hello"}}' > /tmp/test.jsonl
echo '{"type":"assistant","message":{"content":"hi there"}}' >> /tmp/test.jsonl
# Read first line (offset 0-47), then second line (offset 48-end)

# Test 2: Server-side parsing
# POST raw bytes to server, verify messages table gets populated
curl -X POST https://howinlens.howincloud.com/api/v1/client/session-jsonl \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"session_id":"test-123","offset":0,"data":"..."}'
```

---

# PILLAR 4: Client Application

## Architecture: Electron + daemon child process

```
┌─────────────────────────────────────┐
│ OS Service (launchd/systemd/schtasks)│
│ Starts: electron main process        │
│ RestartPolicy: always                │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│ Electron Main Process               │
│ ├── Tray icon (On Watch / Off Watch)│
│ ├── BrowserWindow (webview → server)│
│ ├── IPC handlers                    │
│ └── Spawns daemon child process     │
│     └── daemon.ts (detached)        │
└──────────────┬──────────────────────┘
               │ spawn(detached: true)
┌──────────────▼──────────────────────┐
│ Background Daemon (Node.js child)   │
│ ├── JSONL watcher (chokidar)        │
│ ├── Credential receiver (WebSocket) │
│ ├── Heartbeat (30s ping)            │
│ ├── File watcher (project dirs)     │
│ └── Self-watchdog (write PID file)  │
│                                     │
│ If Electron dies: daemon keeps going│
│ Daemon has its own PID file         │
│ OS service restarts Electron → it   │
│ re-attaches to existing daemon      │
└─────────────────────────────────────┘
```

### Why this design:
- **Electron** for rich UI: tray, notifications, webview (dashboard in-app)
- **Daemon** for reliability: detached child process survives Electron crashes
- **OS service** for non-killable: restarts the whole thing on crash/reboot
- **PID file** for re-attachment: if Electron restarts, checks if daemon is still running

### Non-killable strategy per OS:

**macOS:**
```xml
<!-- ~/Library/LaunchAgents/com.howinlens.client.plist -->
<key>KeepAlive</key><true/>
<key>RunAtLoad</key><true/>
<key>ProcessType</key><string>Background</string>
```

**Linux:**
```ini
# /etc/systemd/user/howinlens.service
[Service]
ExecStart=/usr/bin/howinlens-client
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
```

**Windows:**
```powershell
# Task Scheduler: run at logon, restart on failure
$action = New-ScheduledTaskAction -Execute "howinlens-client.exe"
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Seconds 10)
Register-ScheduledTask -TaskName "HowinLens" -Action $action -Trigger $trigger -Settings $settings
```

### Standalone tests:
```bash
# Test 1: Electron starts with tray
cd packages/client && pnpm dev
# Verify: tray icon appears, webview loads dashboard

# Test 2: Daemon survives Electron kill
# Start client, note daemon PID
# Kill Electron process
# Verify daemon PID still running
# Restart Electron, verify it re-attaches

# Test 3: OS service restarts after kill
# Install launchd/systemd service
# Kill entire process tree
# Wait 5 seconds
# Verify it restarted automatically
```

---

# LOGGING STRATEGY

Since we're in dev stage, log EVERYTHING:

```typescript
// Every module gets a debug logger
const log = createLogger('jsonl-watcher');

log.info('file changed', { path, size, offset });
log.debug('raw bytes read', { bytes: data.length, from: offset });
log.info('synced to server', { session_id, offset, response_time_ms });
log.error('sync failed', { error, retry_in: 5000 });
```

**Server-side:** Winston or pino with structured JSON logs
**Client-side:** Write to `~/.howinlens/logs/client.log` + stderr
**Rotation:** Keep last 7 days, max 50MB

---

# IMPLEMENTATION ORDER (step by step, test each)

```
Step 1: Test Claude OAuth refresh (standalone script)
        → Determines credential approach

Step 2: Build credential encryption module (standalone, unit tested)
        → AES-256-GCM encrypt/decrypt

Step 3: Build credential vault API (server endpoints)
        → Add, assign, rotate, revoke
        → Test via curl

Step 4: Test usage polling (standalone script)
        → Determine which API works with our tokens

Step 5: Build JSONL parser (standalone, unit tested)
        → Parse Claude Code JSONL format
        → Handle partial lines, malformed JSON

Step 6: Build server-side JSONL receiver endpoint
        → Offset-based append + parse
        → Dedup logic
        → Test via curl with real JSONL data

Step 7: Build client JSONL watcher
        → chokidar + offset tracking
        → Test standalone (no Electron needed)

Step 8: Build client credential receiver
        → Pull on start + WebSocket push
        → Write to ~/.claude/.credentials.json
        → Test standalone

Step 9: Integrate into Electron shell
        → Tray + webview + daemon spawn
        → Test per-OS

Step 10: OS service auto-start
         → launchd / systemd / schtasks
         → Kill test + restart verification
```

Each step is independently testable before moving to the next.
