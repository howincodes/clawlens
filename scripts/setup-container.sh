#!/bin/sh
# Auto-setup ClawLens inside container. Just run: source /setup.sh
# Then: claude

SERVER="http://localhost:3000"
CODE="CLM-basha-docker-9d99a5"

mkdir -p /etc/claude-code/clawlens ~/.claude

REG=$(curl -sf -X POST "$SERVER/api/v1/register" -H 'Content-Type: application/json' -d "{\"code\":\"$CODE\"}")
TK=$(echo $REG | jq -r '.auth_token')
UID=$(echo $REG | jq -r '.user_id')

cat > /etc/claude-code/clawlens/config.json <<EOF
{"server_url":"$SERVER","auth_token":"$TK","user_id":"$UID","status":"active","default_model":"sonnet","sync_interval":5,"collection_level":"full","collect_responses":true,"secret_scrub":"redact","prompt_max_length":10000,"client_version":"0.1.0","credit_weights":{"opus":10,"sonnet":3,"haiku":1}}
EOF

cat > ~/.claude/managed-settings.json <<'EOF'
{"allowManagedHooksOnly":true,"hooks":{"SessionStart":[{"matcher":"","hooks":[{"type":"command","command":"/usr/local/bin/clawlens hook session-start","timeout":10}]}],"UserPromptSubmit":[{"hooks":[{"type":"command","command":"/usr/local/bin/clawlens hook prompt","timeout":5}]}],"PreToolUse":[{"hooks":[{"type":"command","command":"/usr/local/bin/clawlens hook pre-tool","timeout":2}]}],"Stop":[{"hooks":[{"type":"command","command":"/usr/local/bin/clawlens hook stop","timeout":5}]}],"StopFailure":[{"matcher":"","hooks":[{"type":"command","command":"/usr/local/bin/clawlens hook stop-error","timeout":2}]}],"SessionEnd":[{"matcher":"","hooks":[{"type":"command","command":"/usr/local/bin/clawlens hook session-end","timeout":3}]}]}}
EOF

echo "ClawLens installed! Run: claude"
