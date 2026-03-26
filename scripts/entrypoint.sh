#!/bin/bash
set -e

SERVER="http://host.docker.internal:3000"
CODE="$1"

echo ""
echo "============================================"
echo "  ClawLens Full Integration Test"
echo "============================================"
echo ""

# Step 1: Check Claude Code
echo "[1] Claude Code version:"
claude --version || { echo "Claude Code not found!"; exit 1; }
echo ""

# Step 2: Login to Claude Code
echo "[2] Login to Claude Code"
echo "    Run: claude login"
echo "    It will give you a URL — open it in your browser."
echo ""
claude login
echo ""

# Step 3: Register with ClawLens server
echo "[3] Registering with ClawLens server..."
REGISTER=$(curl -sf -X POST "$SERVER/api/v1/register" \
  -H 'Content-Type: application/json' \
  -d "{\"code\":\"$CODE\"}")

AUTH_TOKEN=$(echo "$REGISTER" | jq -r '.auth_token')
USER_ID=$(echo "$REGISTER" | jq -r '.user_id')
echo "    Registered! User ID: $USER_ID"
echo ""

# Step 4: Write ClawLens config
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
echo "[4] ClawLens config written"

# Step 5: Write managed-settings.json (hooks Claude Code → ClawLens)
MANAGED="/root/.claude/managed-settings.json"
mkdir -p "$(dirname "$MANAGED")"
cat > "$MANAGED" <<'EOF'
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
EOF
echo "[5] managed-settings.json written — hooks active!"
echo ""

# Step 6: Verify
echo "[6] ClawLens doctor:"
clawlens doctor || true
echo ""

echo "============================================"
echo "  READY! Claude Code is hooked to ClawLens"
echo "============================================"
echo ""
echo "  Now run:  claude"
echo ""
echo "  Every prompt you send will appear in the"
echo "  dashboard at http://localhost:3000"
echo ""
echo "  Dropping you into a shell..."
echo ""

exec /bin/bash
