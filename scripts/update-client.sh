#!/bin/bash
set -e

# ClawLens Client Updater for macOS/Linux
# Usage: curl -fsSL https://raw.githubusercontent.com/howincodes/clawlens/main/scripts/update-client.sh | bash

VERSION="${CLAWLENS_VERSION:-0.1.0}"
REPO="howincodes/clawlens"

OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)
case "$ARCH" in
  x86_64) ARCH="amd64" ;;
  aarch64|arm64) ARCH="arm64" ;;
esac

INSTALL_DIR="$HOME/.clawlens"
BINARY="$INSTALL_DIR/clawlens"
URL="https://github.com/${REPO}/releases/download/v${VERSION}/clawlens-${OS}-${ARCH}"

echo ""
echo "  ClawLens Client Updater"
echo "  ======================="
echo "  Version: v${VERSION}"
echo ""

# Download
echo "Downloading..."
curl -fsSL "$URL" -o /tmp/clawlens
chmod +x /tmp/clawlens

# Replace
mkdir -p "$INSTALL_DIR"
mv /tmp/clawlens "$BINARY"

# Update symlink
if [ -w /usr/local/bin ] || command -v sudo &>/dev/null; then
  sudo ln -sf "$BINARY" /usr/local/bin/clawlens 2>/dev/null || true
fi

echo "  Updated to v${VERSION}!"
echo "  Restart Claude Code for changes to take effect."
echo ""
