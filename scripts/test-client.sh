#!/bin/sh
# Runs inside Docker — simulates a dev using Claude Code with ClawLens hooks
set -e

SERVER="http://host.docker.internal:3000"
CODE="$1"

if [ -z "$CODE" ]; then
  echo "Usage: test-client.sh <install-code>"
  exit 1
fi

echo "========================================="
echo " ClawLens Client Test (Docker)"
echo "========================================="
echo ""

# Step 1: Register with server
echo "[1/7] Registering with server..."
REGISTER=$(curl -sf -X POST "$SERVER/api/v1/register" \
  -H 'Content-Type: application/json' \
  -d "{\"code\":\"$CODE\"}")

AUTH_TOKEN=$(echo "$REGISTER" | jq -r '.auth_token')
USER_ID=$(echo "$REGISTER" | jq -r '.user_id')
echo "  Auth token: ${AUTH_TOKEN:0:16}..."
echo "  User ID:    $USER_ID"

# Write config manually (normally done by 'clawlens setup')
cat > /etc/claude-code/clawlens/config.json <<EOF
{
  "server_url": "$SERVER",
  "auth_token": "$AUTH_TOKEN",
  "user_id": "$USER_ID",
  "status": "active",
  "default_model": "sonnet",
  "sync_interval": 5,
  "collection_level": "full",
  "collect_responses": true,
  "secret_scrub": "redact",
  "prompt_max_length": 10000,
  "client_version": "0.1.0",
  "credit_weights": {"opus": 10, "sonnet": 3, "haiku": 1}
}
EOF
echo "  Config written to /etc/claude-code/clawlens/config.json"
echo ""

# Step 2: Session Start
echo "[2/7] SessionStart hook..."
echo '{
  "session_id": "docker-test-sess-001",
  "cwd": "/home/dev/projects/my-app",
  "model": "claude-sonnet-4-20250514"
}' | clawlens hook session-start 2>/dev/null
echo "  -> Session started"
echo ""

# Step 3: Prompt (rate limit gate — this one talks to server synchronously)
echo "[3/7] UserPromptSubmit hook (prompt 1 — should be ALLOWED)..."
RESULT=$(echo '{
  "input": "Explain how the authentication middleware works in this Express app",
  "session_id": "docker-test-sess-001",
  "cwd": "/home/dev/projects/my-app",
  "model": "claude-sonnet-4-20250514"
}' | clawlens hook prompt 2>/dev/null)
if [ -z "$RESULT" ]; then
  echo "  -> ALLOWED (no block decision)"
else
  echo "  -> Response: $RESULT"
fi
echo ""

# Step 4: PreToolUse (local only — kill/pause check + queue)
echo "[4/7] PreToolUse hook (Read tool)..."
RESULT=$(echo '{
  "tool_name": "Read",
  "tool_input": {"file_path": "/home/dev/projects/my-app/src/middleware/auth.js"},
  "session_id": "docker-test-sess-001"
}' | clawlens hook pre-tool 2>/dev/null)
if [ -z "$RESULT" ]; then
  echo "  -> ALLOWED"
else
  echo "  -> Response: $RESULT"
fi
echo ""

# Step 5: More prompts with a secret (test scrubbing!)
echo "[5/7] UserPromptSubmit hook (prompt 2 — contains a SECRET)..."
RESULT=$(echo '{
  "input": "Fix the database connection using postgres://admin:supersecretpass@db.internal:5432/myapp",
  "session_id": "docker-test-sess-001",
  "cwd": "/home/dev/projects/my-app",
  "model": "claude-sonnet-4-20250514"
}' | clawlens hook prompt 2>/dev/null)
if [ -z "$RESULT" ]; then
  echo "  -> ALLOWED (secret should be scrubbed before sending to server)"
else
  echo "  -> Response: $RESULT"
fi
echo ""

# Step 6: Stop (response data — local queue)
echo "[6/7] Stop hook (turn complete)..."
echo '{
  "response": "The auth middleware uses JWT tokens stored in httpOnly cookies...",
  "session_id": "docker-test-sess-001",
  "model": "claude-sonnet-4-20250514",
  "stop_reason": "end_turn"
}' | clawlens hook stop 2>/dev/null
echo "  -> Queued locally"
echo ""

# Step 7: Session End
echo "[7/7] SessionEnd hook..."
echo '{
  "session_id": "docker-test-sess-001"
}' | clawlens hook session-end 2>/dev/null
echo "  -> Session ended"
echo ""

# Wait for batch sync to flush
echo "Waiting 6s for batch sync to flush queue..."
sleep 6

# Check status
echo ""
echo "========================================="
echo " Results"
echo "========================================="
echo ""
clawlens doctor 2>/dev/null || echo "(doctor may fail without full setup)"
echo ""

# Verify data arrived at server
echo "Checking server for our data..."
PROMPTS=$(curl -sf "$SERVER/api/v1/health" && \
  curl -sf "http://host.docker.internal:3000/api/admin/login" \
    -X POST -H 'Content-Type: application/json' \
    -d '{"password":"test123"}' | jq -r '.token')

echo ""
echo "Done! Check the dashboard at http://localhost:3000"
echo "Login: test123"
echo "Look for user 'Basha' with the docker session data."
