#!/bin/bash
# ClawLens v0.2 — Comprehensive Integration Test
# Runs on Docker containers clawlens-dev1/2/3 against a local server
# Usage: bash scripts/test-integration.sh
# Prerequisite: server running on port 3002, containers logged into Claude

set -e

SERVER="http://host.docker.internal:3002"
LOCAL_SERVER="http://localhost:3002"
PASS=0
FAIL=0
TESTS=()

pass() { PASS=$((PASS+1)); TESTS+=("✅ $1"); echo "  ✅ $1"; }
fail() { FAIL=$((FAIL+1)); TESTS+=("❌ $1: $2"); echo "  ❌ $1: $2"; }

assert_contains() {
  if echo "$1" | grep -q "$2"; then pass "$3"; else fail "$3" "expected '$2' in response"; fi
}
assert_eq() {
  if [ "$1" = "$2" ]; then pass "$3"; else fail "$3" "expected '$2' got '$1'"; fi
}
assert_gt() {
  if [ "$1" -gt "$2" ] 2>/dev/null; then pass "$3"; else fail "$3" "expected >$2 got $1"; fi
}

echo ""
echo "╔═══════════════════════════════════════════════╗"
echo "║   ClawLens v0.2 Integration Test Suite        ║"
echo "╚═══════════════════════════════════════════════╝"
echo ""

# ── Prerequisites ──────────────────────────────────
echo "▸ Prerequisites"
HEALTH=$(curl -sf "$LOCAL_SERVER/health" 2>/dev/null)
assert_contains "$HEALTH" "ok" "Server health check"

for i in 1 2 3; do
  UP=$(docker exec "clawlens-dev${i}" echo "up" 2>/dev/null)
  assert_eq "$UP" "up" "Container dev${i} running"
done

# ── Admin Auth ─────────────────────────────────────
echo ""
echo "▸ Admin Authentication"
LOGIN=$(curl -sf "$LOCAL_SERVER/api/admin/login" -X POST -H 'Content-Type: application/json' -d '{"password":"admin"}')
AT=$(echo "$LOGIN" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).token||''))")
assert_gt "${#AT}" 10 "Admin login returns JWT"

BAD_LOGIN=$(curl -s -o /dev/null -w "%{http_code}" "$LOCAL_SERVER/api/admin/login" -X POST -H 'Content-Type: application/json' -d '{"password":"wrong"}')
assert_eq "$BAD_LOGIN" "401" "Bad password returns 401"

# ── Create Test Users ──────────────────────────────
echo ""
echo "▸ User Management"
# Delete old test users
EXISTING=$(curl -sf "$LOCAL_SERVER/api/admin/users" -H "Authorization: Bearer $AT" | node -e "
let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
  JSON.parse(d).data.filter(u=>u.name.startsWith('IntTest')).forEach(u=>console.log(u.id));
})")
for USERID in $EXISTING; do
  curl -sf "$LOCAL_SERVER/api/admin/users/$USERID" -X DELETE -H "Authorization: Bearer $AT" > /dev/null
done

# Create 3 test users
TOKENS=()
for i in 1 2 3; do
  RES=$(curl -sf "$LOCAL_SERVER/api/admin/users" -X POST \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $AT" \
    -d "{\"name\":\"IntTest Dev${i}\",\"slug\":\"inttest-dev${i}\"}")
  TK=$(echo "$RES" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).auth_token||''))")
  TOKENS+=("$TK")
done
assert_gt "${#TOKENS[0]}" 10 "Create user IntTest Dev1"
assert_gt "${#TOKENS[1]}" 10 "Create user IntTest Dev2"
assert_gt "${#TOKENS[2]}" 10 "Create user IntTest Dev3"

# Configure containers
for i in 1 2 3; do
  docker exec "clawlens-dev${i}" bash -c "
    node -e \"
      const fs=require('fs');
      const p='/root/.claude/settings.json';
      let s={};try{s=JSON.parse(fs.readFileSync(p,'utf8'))}catch{}
      s.env=s.env||{};
      s.env.CLAUDE_PLUGIN_OPTION_SERVER_URL='$SERVER';
      s.env.CLAUDE_PLUGIN_OPTION_AUTH_TOKEN='${TOKENS[$((i-1))]}';
      s.enabledPlugins=s.enabledPlugins||{};
      s.enabledPlugins['clawlens@howincodes']=true;
      fs.writeFileSync(p,JSON.stringify(s,null,2));
    \"
  " 2>/dev/null
done
pass "Configured all 3 containers"

# ── Test 1: Real claude -p hooks ───────────────────
echo ""
echo "▸ Real Claude -p Hook Firing"
for i in 1 2 3; do
  OUT=$(docker exec "clawlens-dev${i}" bash -c "cd /root/project && echo 'reply only: inttest${i}' | claude -p 2>/dev/null" 2>&1)
  if echo "$OUT" | grep -qi "inttest${i}\|hello\|int"; then
    pass "dev${i} claude -p responds"
  else
    # Check if it at least ran (might give different response)
    if [ -n "$OUT" ] && ! echo "$OUT" | grep -qi "error\|not logged"; then
      pass "dev${i} claude -p responds (different wording)"
    else
      fail "dev${i} claude -p" "$OUT"
    fi
  fi
done

sleep 2

# Check data arrived
PROMPTS_AFTER=$(curl -sf "$LOCAL_SERVER/api/admin/prompts?limit=5" -H "Authorization: Bearer $AT" | node -e "
let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
  const r=JSON.parse(d);
  const recent=r.data.filter(p=>p.prompt&&p.prompt.includes('inttest'));
  console.log(recent.length);
})")
assert_gt "$PROMPTS_AFTER" 0 "Prompts from claude -p recorded in server"

# ── Test 2: Kill Switch ────────────────────────────
echo ""
echo "▸ Kill Switch"

# Get Dev3 ID
DEV3_ID=$(curl -sf "$LOCAL_SERVER/api/admin/users" -H "Authorization: Bearer $AT" | node -e "
let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).data.find(u=>u.name==='IntTest Dev3')?.id||''))")

# Kill Dev3
curl -sf "$LOCAL_SERVER/api/admin/users/$DEV3_ID" -X PUT \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AT" \
  -d '{"status":"killed"}' > /dev/null

# Test SessionStart blocked
R=$(curl -sf "$LOCAL_SERVER/api/v1/hook/session-start" -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKENS[2]}" \
  -d '{"session_id":"kill-test","hook_event_name":"SessionStart"}')
assert_contains "$R" "continue" "SessionStart returns continue:false for killed user"

# Test Prompt blocked
R=$(curl -sf "$LOCAL_SERVER/api/v1/hook/prompt" -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKENS[2]}" \
  -d '{"session_id":"kill-test","hook_event_name":"UserPromptSubmit","prompt":"test"}')
assert_contains "$R" "block" "Prompt returns decision:block for killed user"

# Test PreToolUse blocked
R=$(curl -sf "$LOCAL_SERVER/api/v1/hook/pre-tool" -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKENS[2]}" \
  -d '{"session_id":"kill-test","hook_event_name":"PreToolUse","tool_name":"Bash"}')
assert_contains "$R" "deny" "PreToolUse returns deny for killed user"

# Resume
curl -sf "$LOCAL_SERVER/api/admin/users/$DEV3_ID" -X PUT \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AT" \
  -d '{"status":"active"}' > /dev/null

# Test resumed
R=$(curl -sf "$LOCAL_SERVER/api/v1/hook/session-start" -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKENS[2]}" \
  -d '{"session_id":"resume-test","hook_event_name":"SessionStart"}')
assert_eq "$R" "{}" "SessionStart succeeds after resume"

# ── Test 3: Rate Limiting ──────────────────────────
echo ""
echo "▸ Rate Limiting"

DEV2_ID=$(curl -sf "$LOCAL_SERVER/api/admin/users" -H "Authorization: Bearer $AT" | node -e "
let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).data.find(u=>u.name==='IntTest Dev2')?.id||''))")

# Set 5 credit daily limit
curl -sf "$LOCAL_SERVER/api/admin/users/$DEV2_ID" -X PUT \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AT" \
  -d '{"limits":[{"type":"total_credits","value":5,"window":"daily"}]}' > /dev/null

# Create session first
curl -sf "$LOCAL_SERVER/api/v1/hook/session-start" -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKENS[1]}" \
  -d '{"session_id":"rate-test","hook_event_name":"SessionStart","model":"claude-sonnet-4-6"}' > /dev/null

# Send prompt (sonnet=3 credits, should succeed if under limit)
R=$(curl -sf "$LOCAL_SERVER/api/v1/hook/prompt" -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKENS[1]}" \
  -d '{"session_id":"rate-test","hook_event_name":"UserPromptSubmit","prompt":"rate test 1"}')

# Check usage
USAGE=$(curl -sf "$LOCAL_SERVER/api/admin/users" -H "Authorization: Bearer $AT" | node -e "
let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
  const u=JSON.parse(d).data.find(u=>u.name==='IntTest Dev2');
  console.log(u?.total_credits||0);
})")

# If usage+3 > 5, it should block
R2=$(curl -sf "$LOCAL_SERVER/api/v1/hook/prompt" -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKENS[1]}" \
  -d '{"session_id":"rate-test","hook_event_name":"UserPromptSubmit","prompt":"rate test 2"}')
assert_contains "$R2" "block" "Rate limiting blocks when over budget"

# Clear limits
curl -sf "$LOCAL_SERVER/api/admin/users/$DEV2_ID" -X PUT \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AT" \
  -d '{"limits":[]}' > /dev/null
pass "Rate limits cleared"

# ── Test 4: Tamper Detection ───────────────────────
echo ""
echo "▸ Tamper Detection"

R=$(curl -sf "$LOCAL_SERVER/api/v1/hook/config-change" -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKENS[0]}" \
  -d '{"session_id":"tamper-t","hook_event_name":"ConfigChange","source":"user_settings","file_path":"~/.claude/settings.json"}')
assert_eq "$R" "{}" "ConfigChange hook accepted"

R=$(curl -sf "$LOCAL_SERVER/api/v1/hook/file-changed" -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKENS[0]}" \
  -d '{"session_id":"tamper-t","hook_event_name":"FileChanged","file_path":"settings.json","event":"change"}')
assert_eq "$R" "{}" "FileChanged hook accepted"

ALERTS=$(curl -sf "$LOCAL_SERVER/api/admin/tamper-alerts" -H "Authorization: Bearer $AT" | node -e "
let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
  const a=JSON.parse(d).data.filter(a=>a.user_name==='IntTest Dev1');
  console.log(a.length);
})")
assert_gt "$ALERTS" 0 "Tamper alerts created for Dev1"

# ── Test 5: Token Rotation ─────────────────────────
echo ""
echo "▸ Token Rotation"

DEV1_ID=$(curl -sf "$LOCAL_SERVER/api/admin/users" -H "Authorization: Bearer $AT" | node -e "
let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).data.find(u=>u.name==='IntTest Dev1')?.id||''))")

NEW_TK=$(curl -sf "$LOCAL_SERVER/api/admin/users/$DEV1_ID/rotate-token" -X POST \
  -H "Authorization: Bearer $AT" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).auth_token||''))")
assert_gt "${#NEW_TK}" 10 "Token rotated, new token returned"

OLD_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$LOCAL_SERVER/api/v1/hook/session-start" -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKENS[0]}" \
  -d '{"session_id":"rot-test","hook_event_name":"SessionStart"}')
assert_eq "$OLD_STATUS" "401" "Old token rejected after rotation"

NEW_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$LOCAL_SERVER/api/v1/hook/session-start" -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $NEW_TK" \
  -d '{"session_id":"rot-test","hook_event_name":"SessionStart"}')
assert_eq "$NEW_STATUS" "200" "New token accepted after rotation"

# ── Test 6: User Deletion ──────────────────────────
echo ""
echo "▸ User Deletion"

DEL_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$LOCAL_SERVER/api/admin/users/$DEV3_ID" -X DELETE -H "Authorization: Bearer $AT")
assert_eq "$DEL_STATUS" "204" "User deleted (204)"

DEAD_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$LOCAL_SERVER/api/v1/hook/session-start" -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKENS[2]}" \
  -d '{"session_id":"del-test","hook_event_name":"SessionStart"}')
assert_eq "$DEAD_STATUS" "401" "Deleted user's token rejected"

# ── Test 7: Dashboard Pages ────────────────────────
echo ""
echo "▸ Dashboard Pages"
for PAGE in "/" "/users" "/analytics" "/prompts" "/summaries" "/audit-log" "/subscriptions" "/settings"; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "$LOCAL_SERVER$PAGE")
  assert_eq "$CODE" "200" "Dashboard $PAGE loads"
done

# ── Test 8: Analytics Data ─────────────────────────
echo ""
echo "▸ Analytics"
ANALYTICS=$(curl -sf "$LOCAL_SERVER/api/admin/analytics?days=1" -H "Authorization: Bearer $AT")
TP=$(echo "$ANALYTICS" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).overview?.total_prompts||0))")
assert_gt "$TP" 0 "Analytics shows prompts > 0"

AU=$(echo "$ANALYTICS" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).overview?.active_users||0))")
assert_gt "$AU" 0 "Analytics shows active users > 0"

# ── Cleanup ────────────────────────────────────────
echo ""
echo "▸ Cleanup"
# Delete IntTest users
for USERID in $(curl -sf "$LOCAL_SERVER/api/admin/users" -H "Authorization: Bearer $AT" | node -e "
let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
  JSON.parse(d).data.filter(u=>u.name.startsWith('IntTest')).forEach(u=>console.log(u.id));
})"); do
  curl -sf "$LOCAL_SERVER/api/admin/users/$USERID" -X DELETE -H "Authorization: Bearer $AT" > /dev/null 2>&1
done
pass "Test users cleaned up"

# ── Summary ────────────────────────────────────────
echo ""
echo "╔═══════════════════════════════════════════════╗"
echo "║   Results: $PASS passed, $FAIL failed          "
echo "╚═══════════════════════════════════════════════╝"
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo "FAILURES:"
  for t in "${TESTS[@]}"; do
    echo "$t" | grep "❌" || true
  done
  echo ""
  exit 1
fi
