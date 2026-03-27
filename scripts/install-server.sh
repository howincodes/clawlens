#!/bin/bash
set -e

# ClawLens Server Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/howincodes/clawlens/main/scripts/install-server.sh | bash

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

if [[ "$OS" != "linux" && "$OS" != "darwin" ]]; then
  echo "Server install is supported on Linux and macOS only."
  echo "For Windows, download manually from GitHub releases."
  exit 1
fi

BINARY="clawlens-server-${OS}-${ARCH}"
URL="https://github.com/${REPO}/releases/download/v${VERSION}/${BINARY}"

echo ""
echo "  ClawLens Server Installer"
echo "  ========================="
echo "  Version:  v${VERSION}"
echo "  Platform: ${OS}/${ARCH}"
echo ""

# Download
echo "Downloading ${BINARY}..."
curl -fsSL "$URL" -o /tmp/clawlens-server
chmod +x /tmp/clawlens-server

# Install binary
if [ "$(id -u)" -eq 0 ]; then
  mv /tmp/clawlens-server /usr/local/bin/clawlens-server
else
  echo "Need sudo to install to /usr/local/bin"
  sudo mv /tmp/clawlens-server /usr/local/bin/clawlens-server
fi

echo "Binary installed at /usr/local/bin/clawlens-server"

# Download dashboard
echo "Downloading dashboard..."
DASH_URL="https://github.com/${REPO}/releases/download/v${VERSION}/dashboard-dist.tar.gz"
mkdir -p /opt/clawlens
curl -fsSL "$DASH_URL" -o /tmp/dashboard-dist.tar.gz
tar -xzf /tmp/dashboard-dist.tar.gz -C /opt/clawlens/
rm /tmp/dashboard-dist.tar.gz

# Create data dir
mkdir -p /opt/clawlens/data

echo ""
echo "  Installation complete!"
echo ""
echo "  Quick start:"
echo "    clawlens-server --admin-password YOUR_PASSWORD --dashboard /opt/clawlens/dashboard/dist"
echo ""
echo "  Production (systemd):"
echo "    1. Create /etc/systemd/system/clawlens.service"
echo "    2. Set: ExecStart=/usr/local/bin/clawlens-server \\"
echo "         --port 3000 \\"
echo "         --db /opt/clawlens/data/clawlens.db \\"
echo "         --dashboard /opt/clawlens/dashboard/dist \\"
echo "         --admin-password YOUR_STRONG_PASSWORD"
echo "    3. systemctl enable --now clawlens"
echo ""
