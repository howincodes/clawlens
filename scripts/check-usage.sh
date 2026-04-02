#!/bin/bash
# Check Claude rate limits using CLI OAuth credentials
# Usage: bash scripts/check-usage.sh

TOKEN=$(security find-generic-password -s "Claude Code-credentials" -a "$(whoami)" -w 2>/dev/null | python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('claudeAiOauth',{}).get('accessToken',''))" 2>/dev/null)

if [ -z "$TOKEN" ]; then
  echo "ERROR: Could not read Claude credentials from Keychain"
  exit 1
fi

python3 -c "
import urllib.request, urllib.error, json, sys, datetime

token = '$TOKEN'
req = urllib.request.Request('https://api.anthropic.com/v1/messages', method='POST')
req.add_header('Authorization', f'Bearer {token}')
req.add_header('Content-Type', 'application/json')
req.add_header('anthropic-version', '2023-06-01')
req.add_header('anthropic-beta', 'oauth-2025-04-20')
req.add_header('User-Agent', 'claude-code/2.1.5')
data = json.dumps({'model':'claude-haiku-4-5-20251001','max_tokens':1,'messages':[{'role':'user','content':'hi'}]}).encode()

try:
    resp = urllib.request.urlopen(req, data, timeout=15)
    h = dict(resp.headers)
except urllib.error.HTTPError as e:
    h = dict(e.headers)

u5h = float(h.get('anthropic-ratelimit-unified-5h-utilization', 0))
u7d = float(h.get('anthropic-ratelimit-unified-7d-utilization', 0))
r5h = int(h.get('anthropic-ratelimit-unified-5h-reset', 0))
r7d = int(h.get('anthropic-ratelimit-unified-7d-reset', 0))

now = datetime.datetime.now()
reset_5h = datetime.datetime.fromtimestamp(r5h) if r5h else now
reset_7d = datetime.datetime.fromtimestamp(r7d) if r7d else now
remaining_5h = max(0, (reset_5h - now).total_seconds() / 60)
remaining_7d = max(0, (reset_7d - now).total_seconds() / 3600)

color_5h = '\033[92m' if u5h < 0.5 else '\033[93m' if u5h < 0.8 else '\033[91m'
color_7d = '\033[92m' if u7d < 0.5 else '\033[93m' if u7d < 0.8 else '\033[91m'
reset = '\033[0m'

print(f'┌─────────────────────────────────────┐')
print(f'│     Claude Usage Monitor            │')
print(f'├─────────────────────────────────────┤')
print(f'│  5h window: {color_5h}{u5h*100:.0f}%{reset} used  (resets in {remaining_5h:.0f}m)  │')
print(f'│  7d window: {color_7d}{u7d*100:.0f}%{reset} used  (resets in {remaining_7d:.1f}h)  │')
print(f'└─────────────────────────────────────┘')

if u5h >= 0.9:
    print('⚠️  CRITICAL: 5h limit almost reached! Use Codex for heavy work.')
elif u5h >= 0.75:
    print('⚠️  WARNING: 5h at 75%+. Lean on Codex for implementation.')
else:
    print('✅ Safe to proceed with Claude subagents.')
" 2>/dev/null
