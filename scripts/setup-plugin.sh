#!/bin/bash
# ClawLens Plugin Setup
# Usage: bash <(curl -fsSL https://raw.githubusercontent.com/howincodes/clawlens/main/scripts/setup-plugin.sh)
#
# This script:
# 1. Adds the howincodes marketplace
# 2. Installs the clawlens plugin
# 3. Configures server URL and auth token in ~/.claude/settings.json

set -e

echo ""
echo "  ClawLens Plugin Setup"
echo "  ====================="
echo ""

# Check claude is available
if ! command -v claude >/dev/null 2>&1; then
  echo "  Error: claude command not found. Install Claude Code first."
  exit 1
fi

# Prompt for config
SERVER_URL=""
while [ -z "$SERVER_URL" ]; do
  read -p "  Server URL (e.g. https://clawlens.howincloud.com): " SERVER_URL
  SERVER_URL="${SERVER_URL%/}"
  if [ -z "$SERVER_URL" ]; then echo "  URL cannot be empty!"; fi
done

AUTH_TOKEN=""
while [ -z "$AUTH_TOKEN" ]; do
  read -p "  Auth token (from admin dashboard): " AUTH_TOKEN
  if [ -z "$AUTH_TOKEN" ]; then echo "  Token cannot be empty!"; fi
done

# Step 1: Add marketplace (ignore error if already added)
echo ""
echo "[1/3] Adding marketplace..."
claude plugin install clawlens@howincodes 2>/dev/null || true
echo "  Done"

# Step 2: Configure env vars in settings.json
echo "[2/3] Configuring..."
SETTINGS_FILE="$HOME/.claude/settings.json"
mkdir -p "$(dirname "$SETTINGS_FILE")"

if [ -f "$SETTINGS_FILE" ]; then
  # Merge env vars into existing settings
  if command -v jq >/dev/null 2>&1; then
    jq --arg url "$SERVER_URL" --arg token "$AUTH_TOKEN" \
      '.env = (.env // {}) + {"CLAUDE_PLUGIN_OPTION_SERVER_URL": $url, "CLAUDE_PLUGIN_OPTION_AUTH_TOKEN": $token}' \
      "$SETTINGS_FILE" > "${SETTINGS_FILE}.tmp" && mv "${SETTINGS_FILE}.tmp" "$SETTINGS_FILE"
  elif command -v node >/dev/null 2>&1; then
    node -e "
      const fs = require('fs');
      const s = JSON.parse(fs.readFileSync('$SETTINGS_FILE','utf8'));
      s.env = s.env || {};
      s.env.CLAUDE_PLUGIN_OPTION_SERVER_URL = '$SERVER_URL';
      s.env.CLAUDE_PLUGIN_OPTION_AUTH_TOKEN = '$AUTH_TOKEN';
      fs.writeFileSync('$SETTINGS_FILE', JSON.stringify(s, null, 2));
    "
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c "
import json
with open('$SETTINGS_FILE') as f: s = json.load(f)
s.setdefault('env', {})
s['env']['CLAUDE_PLUGIN_OPTION_SERVER_URL'] = '$SERVER_URL'
s['env']['CLAUDE_PLUGIN_OPTION_AUTH_TOKEN'] = '$AUTH_TOKEN'
with open('$SETTINGS_FILE', 'w') as f: json.dump(s, f, indent=2)
"
  else
    echo "  Error: Need jq, node, or python3 to update settings"
    exit 1
  fi
else
  # Create new settings file
  cat > "$SETTINGS_FILE" << EOF
{
  "env": {
    "CLAUDE_PLUGIN_OPTION_SERVER_URL": "$SERVER_URL",
    "CLAUDE_PLUGIN_OPTION_AUTH_TOKEN": "$AUTH_TOKEN"
  }
}
EOF
fi
echo "  -> Configured in $SETTINGS_FILE"

# Step 3: Verify
echo "[3/3] Verifying..."
if curl -sf "$SERVER_URL/health" >/dev/null 2>&1; then
  echo "  -> Server: OK ($SERVER_URL)"
else
  echo "  -> Server: UNREACHABLE (check URL)"
fi

echo ""
echo "  ========================"
echo "  ClawLens plugin ready!"
echo "  ========================"
echo ""
echo "  Close this terminal and open a fresh one, then run: claude"
echo ""
