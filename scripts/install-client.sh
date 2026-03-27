#!/bin/bash
set -e

# ClawLens Client Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/howincodes/clawlens/main/scripts/install-client.sh | sudo bash

VERSION="${CLAWLENS_VERSION:-0.1.0}"
REPO="howincodes/clawlens"

# Detect platform
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)
case "$ARCH" in
  x86_64)  ARCH="amd64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *) echo "Unsupported architecture: $ARCH"; exit 1 ;;
esac

BINARY="clawlens-${OS}-${ARCH}"
URL="https://github.com/${REPO}/releases/download/v${VERSION}/${BINARY}"

echo ""
echo "  ClawLens Client Installer"
echo "  ========================="
echo "  Version:  v${VERSION}"
echo "  Platform: ${OS}/${ARCH}"
echo ""

# Download
echo "Downloading ${BINARY}..."
curl -fsSL "$URL" -o /tmp/clawlens
chmod +x /tmp/clawlens

# Install
if [ "$(id -u)" -eq 0 ]; then
  mv /tmp/clawlens /usr/local/bin/clawlens
else
  echo "Need sudo to install to /usr/local/bin"
  sudo mv /tmp/clawlens /usr/local/bin/clawlens
fi

echo ""
echo "  Installed at /usr/local/bin/clawlens"
echo "  Version: $(clawlens version 2>/dev/null || echo 'v'${VERSION})"
echo ""
echo "  Next steps:"
echo "    clawlens setup --code <YOUR_INSTALL_CODE> --server <SERVER_URL>"
echo ""
