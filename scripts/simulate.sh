#!/bin/bash
# Simulates 3 developers using Claude Code for a day.
# Run with: bash scripts/simulate.sh

set -e

SERVER="http://localhost:3000"
ADMIN_PASS="test123"

echo "=== ClawLens Simulator ==="
echo ""

# --- Login ---
TOKEN=$(curl -s -X POST "$SERVER/api/admin/login" \
  -H 'Content-Type: application/json' \
  -d "{\"password\":\"$ADMIN_PASS\"}" | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
echo "Admin JWT acquired"

admin() {
  curl -s "$SERVER$1" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' "${@:2}"
}

# --- Create 3 developers ---
echo ""
echo "Creating developers..."

ALICE_CODE=$(admin "/api/admin/users" -X POST -d '{"name":"Alice Chen","slug":"alice"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['install_code'])")
echo "  Alice Chen  → $ALICE_CODE"

BOB_CODE=$(admin "/api/admin/users" -X POST -d '{"name":"Bob Martinez","slug":"bob"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['install_code'])")
echo "  Bob Martinez → $BOB_CODE"

CHARLIE_CODE=$(admin "/api/admin/users" -X POST -d '{"name":"Charlie Kim","slug":"charlie"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['install_code'])")
echo "  Charlie Kim  → $CHARLIE_CODE"

# --- Register devices (exchange install codes for auth tokens) ---
echo ""
echo "Registering devices..."

ALICE_TOKEN=$(curl -s -X POST "$SERVER/api/v1/register" \
  -H 'Content-Type: application/json' \
  -d "{\"code\":\"$ALICE_CODE\"}" | python3 -c "import sys,json; print(json.load(sys.stdin)['auth_token'])")
echo "  Alice registered"

BOB_TOKEN=$(curl -s -X POST "$SERVER/api/v1/register" \
  -H 'Content-Type: application/json' \
  -d "{\"code\":\"$BOB_CODE\"}" | python3 -c "import sys,json; print(json.load(sys.stdin)['auth_token'])")
echo "  Bob registered"

CHARLIE_TOKEN=$(curl -s -X POST "$SERVER/api/v1/register" \
  -H 'Content-Type: application/json' \
  -d "{\"code\":\"$CHARLIE_CODE\"}" | python3 -c "import sys,json; print(json.load(sys.stdin)['auth_token'])")
echo "  Charlie registered"

# --- Helper: simulate a dev session ---
hook() {
  local token="$1" endpoint="$2"
  shift 2
  curl -s -X POST "$SERVER$endpoint" \
    -H "Authorization: Bearer $token" \
    -H 'Content-Type: application/json' \
    "$@"
}

simulate_session() {
  local TOKEN="$1" NAME="$2" MODEL="$3" PROJECT="$4" PROMPTS="$5"
  local SESSION_ID="sess-$(openssl rand -hex 4)"
  local NAME_LOWER=$(echo "$NAME" | tr '[:upper:]' '[:lower:]')

  echo "  $NAME: session on $PROJECT ($MODEL, $PROMPTS prompts)"

  # Session start
  hook "$TOKEN" "/api/v1/session-start" -d "{
    \"session_id\":\"$SESSION_ID\",
    \"model\":\"claude-${MODEL}-4-20250514\",
    \"cwd\":\"/Users/${NAME_LOWER}/code/$PROJECT\",
    \"hostname\":\"${NAME_LOWER}-macbook\",
    \"platform\":\"darwin\",
    \"arch\":\"arm64\",
    \"os_version\":\"15.3.0\",
    \"go_version\":\"1.23.0\",
    \"claude_version\":\"1.0.33\",
    \"subscription_type\":\"max\",
    \"subscription_email\":\"${NAME_LOWER}@acmecorp.com\",
    \"client_version\":\"0.1.0\"
  }" > /dev/null

  # Simulate N prompts
  local PROMPT_TEXTS=(
    "Fix the auth middleware to handle expired tokens"
    "Add pagination to the users API endpoint"
    "Why is this Kafka consumer group rebalancing?"
    "Refactor the database connection pooling"
    "Write tests for the payment service"
    "Debug why the CI pipeline is failing on arm64"
    "Add rate limiting to the public API"
    "Explain this regex pattern in the router"
    "Implement the webhook retry logic with backoff"
    "Review this PR for security vulnerabilities"
    "Set up the Redis cache for session storage"
    "Migrate the user table to add the new fields"
  )

  local TOOLS=("Bash" "Read" "Write" "Edit" "Glob" "Grep" "Agent")

  for ((i=1; i<=PROMPTS; i++)); do
    local PROMPT_IDX=$(( (RANDOM % ${#PROMPT_TEXTS[@]}) ))
    local PROMPT_TEXT="${PROMPT_TEXTS[$PROMPT_IDX]}"
    local PROMPT_LEN=${#PROMPT_TEXT}
    local HAS_ERROR=$( [ $((RANDOM % 5)) -eq 0 ] && echo "true" || echo "false" )

    # Prompt (sync — rate limit gate)
    hook "$TOKEN" "/api/v1/prompt" -d "{
      \"session_id\":\"$SESSION_ID\",
      \"model\":\"claude-${MODEL}-4-20250514\",
      \"prompt_text\":\"$PROMPT_TEXT\",
      \"prompt_length\":$PROMPT_LEN,
      \"cwd\":\"/Users/${NAME_LOWER}/code/$PROJECT\",
      \"project_dir\":\"$PROJECT\"
    }" > /dev/null

    # Batch: tool calls + stop (async events)
    local NUM_TOOLS=$((RANDOM % 4 + 1))
    local TOOL_EVENTS=""
    local TOOLS_USED="["
    for ((t=0; t<NUM_TOOLS; t++)); do
      local TOOL="${TOOLS[$((RANDOM % ${#TOOLS[@]}))]}"
      local TOOL_SUCCESS=$( [ $HAS_ERROR = "true" ] && [ $t -eq $((NUM_TOOLS-1)) ] && echo "false" || echo "true" )
      TOOLS_USED+="\"$TOOL\""
      [ $t -lt $((NUM_TOOLS-1)) ] && TOOLS_USED+=","
      TOOL_EVENTS+="{\"type\":\"tool\",\"session_id\":\"$SESSION_ID\",\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"data\":{\"tool_name\":\"$TOOL\",\"tool_input_summary\":\"Running command...\",\"success\":$TOOL_SUCCESS}},"
    done
    TOOLS_USED+="]"

    # Credit cost based on model
    local COST=3
    [ "$MODEL" = "opus" ] && COST=10
    [ "$MODEL" = "haiku" ] && COST=1

    # Stop event
    local RESP_LEN=$((RANDOM % 2000 + 200))
    local DURATION=$((RANDOM % 8000 + 1000))
    TOOL_EVENTS+="{\"type\":\"stop\",\"session_id\":\"$SESSION_ID\",\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"data\":{\"model\":\"claude-${MODEL}-4-20250514\",\"response_length\":$RESP_LEN,\"tool_calls\":$NUM_TOOLS,\"tools_used\":\"$TOOLS_USED\",\"turn_duration_ms\":$DURATION,\"credit_cost\":$COST}}"

    # Send batch
    hook "$TOKEN" "/api/v1/sync-batch" -d "{\"events\":[${TOOL_EVENTS}]}" > /dev/null

    sleep 0.05
  done

  # End session
  hook "$TOKEN" "/api/v1/sync-batch" -d "{\"events\":[{\"type\":\"session_end\",\"session_id\":\"$SESSION_ID\",\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"data\":{\"reason\":\"exit\"}}]}" > /dev/null
}

# --- Simulate a day of work ---
echo ""
echo "Simulating dev sessions..."

# Alice — senior dev, uses opus for architecture, sonnet for regular work
simulate_session "$ALICE_TOKEN" "Alice" "opus" "api-gateway" 8
simulate_session "$ALICE_TOKEN" "Alice" "sonnet" "api-gateway" 12
simulate_session "$ALICE_TOKEN" "Alice" "opus" "auth-service" 6

# Bob — mid-level, mostly sonnet
simulate_session "$BOB_TOKEN" "Bob" "sonnet" "payment-service" 15
simulate_session "$BOB_TOKEN" "Bob" "sonnet" "payment-service" 10
simulate_session "$BOB_TOKEN" "Bob" "haiku" "scripts" 5

# Charlie — junior, learning, lots of haiku + some sonnet
simulate_session "$CHARLIE_TOKEN" "Charlie" "sonnet" "user-service" 8
simulate_session "$CHARLIE_TOKEN" "Charlie" "haiku" "user-service" 12
simulate_session "$CHARLIE_TOKEN" "Charlie" "sonnet" "docs" 4

# --- Set some rate limits on Charlie ---
echo ""
echo "Setting rate limits on Charlie..."
CHARLIE_ID=$(admin "/api/admin/users" | python3 -c "import sys,json; users=json.load(sys.stdin)['users']; print([u['id'] for u in users if u['slug']=='charlie'][0])")
admin "/api/admin/users/$CHARLIE_ID" -X PUT -d '{
  "limits": [
    {"id":"lim1","user_id":"'$CHARLIE_ID'","type":"credits","window":"daily","value":100},
    {"id":"lim2","user_id":"'$CHARLIE_ID'","type":"per_model","model":"opus","window":"daily","value":5}
  ]
}' > /dev/null
echo "  Charlie: 100 credits/day, 5 opus/day"

# --- Final stats ---
echo ""
echo "=== Simulation Complete ==="
echo ""
echo "Stats:"
admin "/api/admin/analytics?days=7" | python3 -c "
import sys, json
d = json.load(sys.stdin)
o = d['overview']
print(f\"  Users:        {o['total_users']}\")
print(f\"  Prompts today: {o['prompts_today']}\")
print(f\"  Active now:   {o['active_now']}\")
models = d.get('model_distribution', [])
for m in models:
    print(f\"  {m['model']}: {m['count']} prompts\")
"
echo ""
echo "Open http://localhost:3000 (or http://localhost:5173 with vite) to see the dashboard!"
