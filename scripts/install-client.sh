#!/bin/bash
set -e

# ClawLens Client Installer for macOS/Linux
# Usage: curl -fsSL https://raw.githubusercontent.com/howincodes/clawlens/main/scripts/install-client.sh | bash

# Reconnect stdin to terminal so interactive prompts work when piped through curl
exec 3<&0
exec < /dev/tty

VERSION="${CLAWLENS_VERSION:-0.1.0}"
REPO="howincodes/clawlens"

OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)
case "$ARCH" in
  x86_64) ARCH="amd64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *) echo "Unsupported architecture: $ARCH"; exit 1 ;;
esac

INSTALL_DIR="$HOME/.clawlens"
BINARY="$INSTALL_DIR/clawlens"
CONFIG_FILE="$INSTALL_DIR/config.json"
CLAUDE_DIR="$HOME/.claude"
MANAGED_SETTINGS="$CLAUDE_DIR/managed-settings.json"

echo ""
echo "  ClawLens Client Installer"
echo "  ========================="
echo "  Version:  v${VERSION}"
echo "  Platform: ${OS}/${ARCH}"
echo ""

# --- Check existing installation ---
if [ -f "$CONFIG_FILE" ] || [ -f "$MANAGED_SETTINGS" ] || [ -f "$BINARY" ]; then
  echo "  Existing ClawLens installation detected:"
  [ -f "$BINARY" ] && echo "    Binary:  $BINARY"
  [ -f "$CONFIG_FILE" ] && echo "    Config:  $CONFIG_FILE"
  [ -f "$MANAGED_SETTINGS" ] && echo "    Hooks:   $MANAGED_SETTINGS"

  for old in "/usr/local/bin/clawlens" "/Library/Application Support/ClaudeCode/clawlens" "/etc/claude-code/clawlens"; do
    [ -e "$old" ] && echo "    Old:     $old"
  done

  echo ""
  read -p "  Clean all and reinstall from scratch? (y/n) " choice
  if [ "$choice" != "y" ] && [ "$choice" != "Y" ]; then
    echo "  Cancelled."
    exit 0
  fi

  echo ""
  echo "  Cleaning up..."
  rm -rf "$INSTALL_DIR" 2>/dev/null
  rm -f "$MANAGED_SETTINGS" 2>/dev/null
  sudo rm -f /usr/local/bin/clawlens 2>/dev/null || true
  sudo rm -rf "/Library/Application Support/ClaudeCode/clawlens" 2>/dev/null || true
  sudo rm -rf "/etc/claude-code/clawlens" 2>/dev/null || true
  echo "  Done."
  echo ""
fi

# --- Step 1: Download binary ---
echo "[1/4] Downloading ClawLens binary..."
URL="https://github.com/${REPO}/releases/download/v${VERSION}/clawlens-${OS}-${ARCH}"
mkdir -p "$INSTALL_DIR"
curl -fsSL "$URL" -o "$BINARY"
chmod +x "$BINARY"
echo "  -> $BINARY"

if [ -w /usr/local/bin ]; then
  ln -sf "$BINARY" /usr/local/bin/clawlens
  echo "  -> Symlinked to /usr/local/bin/clawlens"
elif command -v sudo &>/dev/null; then
  sudo ln -sf "$BINARY" /usr/local/bin/clawlens 2>/dev/null && echo "  -> Symlinked to /usr/local/bin/clawlens" || true
fi

# --- Step 2: Add to PATH ---
echo "[2/4] Configuring PATH..."
if ! echo "$PATH" | grep -q "$INSTALL_DIR"; then
  SHELL_RC=""
  if [ -f "$HOME/.zshrc" ]; then SHELL_RC="$HOME/.zshrc"
  elif [ -f "$HOME/.bashrc" ]; then SHELL_RC="$HOME/.bashrc"
  elif [ -f "$HOME/.bash_profile" ]; then SHELL_RC="$HOME/.bash_profile"
  fi
  if [ -n "$SHELL_RC" ]; then
    echo "export PATH=\"\$HOME/.clawlens:\$PATH\"" >> "$SHELL_RC"
    echo "  -> Added to $SHELL_RC"
  fi
  export PATH="$INSTALL_DIR:$PATH"
fi
echo "  -> PATH configured"

# --- Step 3: Setup ---
echo "[3/4] Setting up..."
echo ""

CODE=""
while [ -z "$CODE" ]; do
  read -p "  Install code (from dashboard, e.g. CLM-alice-abc123): " CODE
  if [ -z "$CODE" ]; then
    echo "  Code cannot be empty!"
  fi
done

SERVER=""
while [ -z "$SERVER" ]; do
  read -p "  Server URL (e.g. https://clawlens.howincloud.com): " SERVER
  if [ -z "$SERVER" ]; then
    echo "  Server URL cannot be empty!"
  fi
done
SERVER="${SERVER%/}"

echo ""
echo "  Registering with server..."
REG=$(curl -sf -X POST "$SERVER/api/v1/register" \
  -H 'Content-Type: application/json' \
  -d "{\"code\":\"$CODE\"}" 2>&1) || {
  echo "  Registration failed! Check install code and server URL."
  exit 1
}

AUTH_TOKEN=$(echo "$REG" | python3 -c "import sys,json; print(json.load(sys.stdin)['auth_token'])" 2>/dev/null)
USER_ID=$(echo "$REG" | python3 -c "import sys,json; print(json.load(sys.stdin)['user_id'])" 2>/dev/null)

if [ -z "$AUTH_TOKEN" ]; then
  echo "  Registration failed: $REG"
  exit 1
fi
echo "  -> Registered! User: $USER_ID"

cat > "$CONFIG_FILE" << EOF
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
  "client_version": "$VERSION",
  "credit_weights": {"opus": 10, "sonnet": 3, "haiku": 1}
}
EOF
echo "  -> Config written"

mkdir -p "$CLAUDE_DIR"
cat > "$MANAGED_SETTINGS" << EOF
{
  "allowManagedHooksOnly": true,
  "hooks": {
    "SessionStart": [{"matcher":"","hooks":[{"type":"command","command":"$BINARY hook session-start","timeout":10}]}],
    "UserPromptSubmit": [{"hooks":[{"type":"command","command":"$BINARY hook prompt","timeout":5}]}],
    "PreToolUse": [{"hooks":[{"type":"command","command":"$BINARY hook pre-tool","timeout":2}]}],
    "Stop": [{"hooks":[{"type":"command","command":"$BINARY hook stop","timeout":5}]}],
    "StopFailure": [{"matcher":"","hooks":[{"type":"command","command":"$BINARY hook stop-error","timeout":2}]}],
    "SessionEnd": [{"matcher":"","hooks":[{"type":"command","command":"$BINARY hook session-end","timeout":3}]}]
  }
}
EOF
echo "  -> Hooks installed"

# --- Step 4: Verify ---
echo "[4/4] Verifying..."
echo "  Binary:   $BINARY"
echo "  Config:   $CONFIG_FILE"
echo "  Hooks:    $MANAGED_SETTINGS"

if curl -sf "$SERVER/api/v1/health" > /dev/null 2>&1; then
  echo "  Server:   OK ($SERVER)"
else
  echo "  Server:   UNREACHABLE"
fi

echo ""
echo "  ============================="
echo "  ClawLens installed!"
echo "  ============================="
echo ""
echo "  NEXT: Close ALL terminals, then open a fresh one and run:"
echo "        claude"
echo ""
echo "  Every prompt will appear in your dashboard at $SERVER"
echo ""
