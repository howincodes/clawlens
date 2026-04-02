# HowinLens — Approach Testing Matrix

> Rule: NO approach gets chosen until we test it with real Claude Code on a real machine.
> Each test is a standalone script. No integration. Just: does this work?

---

# TEST GROUP 1: Credential Storage & Delivery

## What we need to learn:
- Where exactly does Claude Code read credentials from?
- What's the exact file format and which fields are required?
- Can we write this file externally and have Claude Code pick it up?
- Can we refresh tokens programmatically?
- What happens when we delete the file while Claude Code is running?
- Does Claude Code watch the file for changes or only read on startup?

## Test 1.1: Discover credential file location and format

```bash
# On a machine with Claude Code logged in:

# macOS/Linux
cat ~/.claude/.credentials.json
# or
find ~ -name ".credentials.json" -path "*claude*" 2>/dev/null

# Windows
type %USERPROFILE%\.claude\.credentials.json

# RECORD:
# - Exact file path
# - Full JSON structure (redact tokens but keep structure)
# - File permissions
# - Any other auth files nearby
ls -la ~/.claude/
```

**What we're looking for:**
- Is it `.credentials.json` or something else?
- Is there a `.credentials` directory vs file?
- Are there multiple credential files (per-org, per-project)?
- What fields exist beyond accessToken/refreshToken/expiresAt?

## Test 1.2: Can we write credentials externally?

```bash
# Step 1: Log OUT of Claude Code
claude auth logout

# Step 2: Verify Claude Code is not authenticated
claude auth status  # should show "not logged in"

# Step 3: Copy a REAL credentials file from another logged-in account
# (or from a backup before logout)
cp /path/to/backup/.credentials.json ~/.claude/.credentials.json

# Step 4: Check if Claude Code recognizes it
claude auth status  # does it show "logged in"?

# Step 5: Try to use Claude Code
echo "hello" | claude -p "say hi"  # does it work?

# RECORD:
# - Did Claude Code accept externally written credentials? YES/NO
# - Did it need a restart? Or picked up immediately?
# - Any errors in Claude Code logs?
```

## Test 1.3: What happens when we modify credentials while running?

```bash
# Step 1: Start a Claude Code session (interactive)
claude

# Step 2: In another terminal, modify the credentials file
# Replace accessToken with a different valid one
# (from another subscription or freshly refreshed)

# Step 3: Send a prompt in the running Claude session
# Does it use the old token or the new one?
# Does it crash? Error? Silently switch?

# RECORD:
# - Does Claude Code re-read on every API call? YES/NO
# - Or only on session start?
# - Any caching behavior?
```

## Test 1.4: What happens when we delete credentials while running?

```bash
# Step 1: Start Claude Code session
claude

# Step 2: In another terminal
rm ~/.claude/.credentials.json

# Step 3: Send a prompt in the running session
# What happens?

# Step 4: Start a NEW session
claude
# What happens?

# RECORD:
# - Running session: continues working? Errors out? When?
# - New session: fails immediately? Prompts re-auth?
```

## Test 1.5: Can we refresh tokens via API?

```bash
# We need to find Claude's OAuth token endpoint.
# Try these (test each):

# Attempt 1: Standard OAuth2 refresh
curl -X POST https://claude.ai/api/auth/oauth/token \
  -H "Content-Type: application/json" \
  -d '{
    "grant_type": "refresh_token",
    "refresh_token": "sk-ant-ort-REAL_TOKEN_HERE"
  }'

# Attempt 2: Anthropic's console API
curl -X POST https://console.anthropic.com/api/auth/oauth/token \
  -H "Content-Type: application/json" \
  -d '{
    "grant_type": "refresh_token",
    "refresh_token": "sk-ant-ort-REAL_TOKEN_HERE"
  }'

# Attempt 3: Check what Claude Code itself does
# Run Claude Code with debug logging
CLAUDE_DEBUG=1 claude auth status 2>&1 | tee /tmp/claude-auth-debug.log
# Search for refresh/token URLs in the output

# Attempt 4: Intercept Claude Code's network calls
# macOS: use Charles Proxy or mitmproxy
# Or check Claude Code source:
which claude
# Follow the binary/script to find the auth module

# RECORD:
# - Which endpoint works (if any)?
# - What's the request format?
# - What's the response format? (new accessToken? new refreshToken too?)
# - How long does the new accessToken last?
```

## Test 1.6: Can we revoke a token?

```bash
# If we found the token endpoint in 1.5, try:

# Attempt 1: Revoke refresh token
curl -X POST https://claude.ai/api/auth/oauth/revoke \
  -H "Content-Type: application/json" \
  -d '{"token": "sk-ant-ort-REAL_TOKEN_HERE"}'

# Attempt 2: Just delete credentials + check
# Remove credentials file
rm ~/.claude/.credentials.json
# Try to use Claude Code
claude auth status
# Can someone re-use the old refreshToken?
# Write it back:
echo '{"claudeAiOauth":{"refreshToken":"sk-ant-ort-OLD_TOKEN"}}' > ~/.claude/.credentials.json
claude auth status
# Does it still work? If yes, revocation isn't just file deletion.

# RECORD:
# - Can we revoke via API? YES/NO
# - If no API revoke, does deleting the file effectively revoke? YES/NO
# - Can a copied refreshToken be re-used after deletion? YES/NO (security critical!)
```

## Test 1.7: Multiple subscriptions / orgs

```bash
# If the company has multiple Claude subscriptions (e.g. 8 Team seats):

# Question: Does each seat have its own refreshToken?
# Or does the org have one token and seats are just rate limit pools?

# Test: Log in with seat 1, capture credentials
cp ~/.claude/.credentials.json /tmp/seat1.json

# Log in with seat 2, capture credentials
# (log out first, log in as different user)
cp ~/.claude/.credentials.json /tmp/seat2.json

# Compare:
diff /tmp/seat1.json /tmp/seat2.json

# Are they different tokens? Same org but different users?

# RECORD:
# - One token per seat? Or one per org?
# - What identifies which "seat" a token belongs to?
# - Can we get org/user info from the token?
```

---

# TEST GROUP 2: Usage Tracking

## What we need to learn:
- How can we read usage data for a subscription?
- What granularity is available (5h, daily, per-model)?
- Can we use OAuth tokens to read usage?
- Is there a difference between what the dashboard shows and what API returns?

## Test 2.1: Claude usage API with OAuth token

```bash
# Using a real accessToken from .credentials.json:
TOKEN=$(cat ~/.claude/.credentials.json | jq -r '.claudeAiOauth.accessToken')

# Try various endpoints:

# Attempt 1: Direct usage endpoint
curl -s https://claude.ai/api/usage \
  -H "Authorization: Bearer $TOKEN"

# Attempt 2: Organization usage
# First get org ID
curl -s https://claude.ai/api/organizations \
  -H "Authorization: Bearer $TOKEN"
# Then:
curl -s https://claude.ai/api/organizations/{ORG_ID}/usage \
  -H "Authorization: Bearer $TOKEN"

# Attempt 3: Account info
curl -s https://claude.ai/api/account \
  -H "Authorization: Bearer $TOKEN"

# Attempt 4: Bootstrap (Claude Code calls this on start)
curl -s https://claude.ai/api/bootstrap \
  -H "Authorization: Bearer $TOKEN"

# RECORD for each:
# - HTTP status code
# - Response body (full JSON)
# - What usage data is included?
# - Per-model breakdown available?
# - Rate limit headers?
```

## Test 2.2: What Claude Code's stop hook already gives us

```bash
# Our hook already receives data on the /stop event.
# Check what fields come through.
# Look at existing hook_events table for Stop events:

docker exec howinlens-db psql -U howinlens -d howinlens -c "
  SELECT payload::json->>'last_assistant_message' IS NOT NULL as has_response,
         payload::json->>'input_tokens' as input_tokens,
         payload::json->>'output_tokens' as output_tokens,
         payload::json->>'cached_tokens' as cached_tokens,
         payload::json->>'stop_reason' as stop_reason
  FROM hook_events
  WHERE event_type = 'Stop'
  ORDER BY created_at DESC LIMIT 5;
"

# Also check: does Claude Code's stop hook include usage percentages?
# (Codex does — quota_primary_used_percent etc.)
# Look at raw payloads:
docker exec howinlens-db psql -U howinlens -d howinlens -c "
  SELECT payload FROM hook_events
  WHERE event_type = 'Stop' AND source = 'claude-code'
  ORDER BY created_at DESC LIMIT 1;
"

# RECORD:
# - What fields does CC's stop hook provide?
# - Does it include usage/quota info like Codex does?
# - Can we calculate usage from token counts alone?
```

## Test 2.3: Claude Code's built-in usage display

```bash
# Claude Code shows usage in its status line.
# How does it get this data?

# Run Claude Code with debug:
CLAUDE_DEBUG=1 claude 2>&1 | tee /tmp/claude-debug.log &

# After it starts, search for usage-related API calls:
grep -i "usage\|quota\|limit\|rate" /tmp/claude-debug.log

# Also check: does Claude Code have a local cache of usage data?
find ~/.claude -name "*usage*" -o -name "*quota*" -o -name "*limit*" 2>/dev/null
ls ~/.claude/statsig/  # Claude Code stores some state here

# RECORD:
# - What API does Claude Code call to get usage?
# - Can we replicate that call?
# - Is there a local file with usage data we can read?
```

---

# TEST GROUP 3: Conversation Data (JSONL)

## What we need to learn:
- Exact JSONL file location and format
- How files grow during a session
- What data is in there (full responses? tool calls? token counts?)
- Can we tail/watch these files reliably?
- What happens with concurrent sessions?

## Test 3.1: Find and inspect JSONL files

```bash
# Find all JSONL files
find ~/.claude -name "*.jsonl" 2>/dev/null | head -20

# Check the directory structure
ls -la ~/.claude/projects/

# Pick a recent session file and inspect:
LATEST=$(find ~/.claude -name "*.jsonl" -newer ~/.claude/.credentials.json 2>/dev/null | head -1)
echo "File: $LATEST"
echo "Size: $(wc -c < "$LATEST") bytes"
echo "Lines: $(wc -l < "$LATEST")"
echo "First line:"
head -1 "$LATEST" | jq .
echo "Last line:"
tail -1 "$LATEST" | jq .

# RECORD:
# - Exact path pattern
# - JSON structure per line type (human, assistant, tool_use, tool_result, system)
# - Does each line have a timestamp?
# - Does assistant message include model name?
# - Does it include token counts?
# - File encoding (UTF-8?)
```

## Test 3.2: Watch file growth during a live session

```bash
# Terminal 1: Start watching a session file
# First, start Claude Code and note the session:
claude  # interactive mode

# Terminal 2: Find the active session file
ACTIVE=$(find ~/.claude -name "*.jsonl" -newer /tmp/before_session 2>/dev/null | tail -1)

# Watch it grow:
tail -f "$ACTIVE" | while read line; do
  echo "$(date +%H:%M:%S) | $(echo "$line" | jq -r '.type // "unknown"') | $(echo "$line" | wc -c) bytes"
done

# Back in Terminal 1: Send prompts, let Claude respond, use tools

# RECORD:
# - When does each line appear? (immediately or batched?)
# - Does the human message appear before the assistant response?
# - Do tool_use/tool_result appear between human and assistant?
# - Is the assistant response written as one line or streamed?
# - Does the file get flushed immediately or buffered?
```

## Test 3.3: Test offset-based reading

```bash
# Simulate what our watcher would do:

FILE="$ACTIVE"  # from test 3.2

# Read initial state
OFFSET=$(wc -c < "$FILE")
echo "Initial offset: $OFFSET"

# Wait for new data (send a prompt in Claude Code)
sleep 10

# Read only new bytes
NEW_SIZE=$(wc -c < "$FILE")
echo "New size: $NEW_SIZE"
DELTA=$((NEW_SIZE - OFFSET))
echo "New bytes: $DELTA"

# Read the delta
dd if="$FILE" bs=1 skip=$OFFSET count=$DELTA 2>/dev/null

# RECORD:
# - Does offset-based reading work cleanly?
# - Are new lines always complete (no partial JSON)?
# - Any issues with file locking?
```

## Test 3.4: Multiple concurrent sessions

```bash
# Open two Claude Code sessions in different directories:
# Terminal 1: cd ~/project-a && claude
# Terminal 2: cd ~/project-b && claude

# Find both session files:
find ~/.claude -name "*.jsonl" -newer /tmp/before_test 2>/dev/null

# RECORD:
# - Are they in different directories?
# - Can we watch both simultaneously?
# - Any file name conflicts?
# - How is the project hash determined?
```

## Test 3.5: Session file after session ends

```bash
# After closing a Claude Code session:
# Does the JSONL file change?
# Is there a "session end" marker?

# Check the last few lines:
tail -5 "$LATEST" | jq .type

# Does Claude Code add anything on exit?
# Does the file get moved/renamed/compressed?

# Start a new session in the same project:
# Does it create a new file or append to the old one?

# RECORD:
# - One file per session? Or appended?
# - Any session boundary markers?
# - File retention: does Claude Code ever delete old JSONL files?
```

---

# TEST GROUP 4: Client Application Basics

## Test 4.1: Can Electron write to credentials file?

```bash
# Simple Electron script that writes credentials:
# packages/client/test-cred-write.mjs

import { writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const credPath = join(homedir(), '.claude', '.credentials.json');

// Backup
const backup = readFileSync(credPath, 'utf-8');
console.log('Current credentials:', JSON.parse(backup));

// Write test (restore immediately)
writeFileSync(credPath, backup);
console.log('Write test: OK');

// Verify
const verify = readFileSync(credPath, 'utf-8');
console.log('Verify match:', backup === verify);
```

## Test 4.2: Can chokidar watch JSONL files?

```bash
# Simple watcher test:
# packages/client/test-jsonl-watch.mjs

import chokidar from 'chokidar';
import { homedir } from 'os';
import { join } from 'path';

const watchPath = join(homedir(), '.claude', 'projects');
console.log('Watching:', watchPath);

const watcher = chokidar.watch(watchPath + '/**/*.jsonl', {
  persistent: true,
  ignoreInitial: true,
  awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 100 },
});

watcher.on('change', (path, stats) => {
  console.log(`CHANGED: ${path} (${stats?.size} bytes)`);
});

watcher.on('add', (path) => {
  console.log(`NEW FILE: ${path}`);
});

// Now open Claude Code in another terminal and use it.
// Watch the output here.
```

## Test 4.3: Does launchd auto-restart work? (macOS)

```bash
# Create a test plist that runs a simple script:
cat > ~/Library/LaunchAgents/com.howinlens.test.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.howinlens.test</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>-e</string>
    <string>setInterval(() => require('fs').appendFileSync('/tmp/howinlens-alive.log', new Date().toISOString() + '\n'), 5000);</string>
  </array>
  <key>KeepAlive</key><true/>
  <key>RunAtLoad</key><true/>
</dict>
</plist>
EOF

# Load it
launchctl load ~/Library/LaunchAgents/com.howinlens.test.plist

# Verify it's running
launchctl list | grep howinlens
cat /tmp/howinlens-alive.log

# Kill it
kill $(launchctl list | grep howinlens | awk '{print $1}')

# Wait 5 seconds, check if it restarted
sleep 5
cat /tmp/howinlens-alive.log  # should have new entries

# Clean up
launchctl unload ~/Library/LaunchAgents/com.howinlens.test.plist
rm ~/Library/LaunchAgents/com.howinlens.test.plist /tmp/howinlens-alive.log
```

## Test 4.4: Does systemd auto-restart work? (Linux)

```bash
# Similar test with systemd user service
mkdir -p ~/.config/systemd/user

cat > ~/.config/systemd/user/howinlens-test.service << 'EOF'
[Unit]
Description=HowinLens Restart Test

[Service]
ExecStart=/usr/bin/node -e "setInterval(() => require('fs').appendFileSync('/tmp/howinlens-alive.log', new Date().toISOString() + '\n'), 5000);"
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user start howinlens-test
systemctl --user status howinlens-test

# Kill it, verify restart
kill $(systemctl --user show howinlens-test --property=MainPID --value)
sleep 5
systemctl --user status howinlens-test  # should be running again

# Clean up
systemctl --user stop howinlens-test
systemctl --user disable howinlens-test
rm ~/.config/systemd/user/howinlens-test.service
```

---

# TESTING ORDER

```
Day 1: Test Group 1 (Credentials)
  1.1 → Find credential file format        (5 min)
  1.2 → Write credentials externally       (10 min)
  1.3 → Modify while running               (10 min)
  1.4 → Delete while running               (10 min)
  1.5 → Refresh via API                    (30 min — may need research)
  1.6 → Revoke behavior                    (15 min)
  1.7 → Multi-subscription tokens          (15 min)

Day 2: Test Group 2 (Usage) + Test Group 3 (JSONL)
  2.1 → Usage API with OAuth               (30 min)
  2.2 → What stop hook gives us            (10 min)
  2.3 → How Claude Code gets usage         (20 min)
  3.1 → Inspect JSONL files                (10 min)
  3.2 → Watch file growth live             (15 min)
  3.3 → Offset-based reading               (15 min)
  3.4 → Concurrent sessions                (10 min)
  3.5 → Session end behavior               (10 min)

Day 3: Test Group 4 (Client basics)
  4.1 → Electron credential write          (10 min)
  4.2 → chokidar JSONL watching            (15 min)
  4.3 → launchd restart (macOS)            (15 min)
  4.4 → systemd restart (Linux)            (15 min)
```

After ALL tests: we review results, choose approaches based on REAL data, then build.

---

# RESULTS TEMPLATE

After running each test, record:

```
## Test X.X: [name]
**Date:** YYYY-MM-DD
**Machine:** macOS/Linux/Windows, Claude Code version
**Result:** PASS / FAIL / PARTIAL

**Findings:**
- [what we learned]
- [exact format/values observed]
- [any surprises]

**Implications for design:**
- [which approach this confirms/eliminates]
```
