#!/bin/bash
set -e

# Detect platform
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)
case "$ARCH" in
  x86_64) ARCH="amd64" ;;
  aarch64|arm64) ARCH="arm64" ;;
esac

VERSION="${CLAWLENS_VERSION:-latest}"
BASE_URL="${CLAWLENS_SERVER:-https://github.com/howincodes/clawlens/releases/latest/download}"
BINARY="clawlens-${OS}-${ARCH}"

echo "Installing ClawLens client (${OS}/${ARCH})..."
curl -fsSL "${BASE_URL}/${BINARY}" -o /tmp/clawlens
chmod +x /tmp/clawlens
mv /tmp/clawlens /usr/local/bin/clawlens

echo ""
echo "ClawLens installed at /usr/local/bin/clawlens"
echo ""
echo "Next: clawlens setup --code <YOUR_CODE> --server <SERVER_URL>"
