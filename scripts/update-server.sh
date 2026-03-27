#!/bin/bash
set -e

# ClawLens Server Updater
# Usage: curl -fsSL https://raw.githubusercontent.com/howincodes/clawlens/main/scripts/update-server.sh | bash

VERSION="${CLAWLENS_VERSION:-0.1.0}"
REPO="howincodes/clawlens"

OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)
case "$ARCH" in
  x86_64) ARCH="amd64" ;;
  aarch64|arm64) ARCH="arm64" ;;
esac

BASE="https://github.com/${REPO}/releases/download/v${VERSION}"

echo ""
echo "  ClawLens Server Updater"
echo "  ======================="
echo "  Version: v${VERSION}"
echo ""

# 1. Download new server binary
echo "[1/4] Downloading server binary..."
curl -fsSL "${BASE}/clawlens-server-${OS}-${ARCH}" -o /tmp/clawlens-server
chmod +x /tmp/clawlens-server
mv /tmp/clawlens-server /usr/local/bin/clawlens-server
echo "  -> Binary updated"

# 2. Download new client binary
echo "[2/4] Downloading client binary..."
curl -fsSL "${BASE}/clawlens-${OS}-${ARCH}" -o /tmp/clawlens
chmod +x /tmp/clawlens
mv /tmp/clawlens /usr/local/bin/clawlens
echo "  -> Client updated"

# 3. Update dashboard
echo "[3/4] Updating dashboard..."
curl -fsSL "${BASE}/dashboard-dist.tar.gz" -o /tmp/dashboard-dist.tar.gz
rm -rf /opt/clawlens/dist
tar -xzf /tmp/dashboard-dist.tar.gz -C /opt/clawlens/
rm /tmp/dashboard-dist.tar.gz
echo "  -> Dashboard updated"

# 4. Restart service
echo "[4/4] Restarting service..."
systemctl restart clawlens 2>/dev/null && echo "  -> Service restarted" || echo "  -> No systemd service found, restart manually"

sleep 2
if curl -sf http://127.0.0.1:3000/api/v1/health > /dev/null 2>&1; then
  echo ""
  echo "  Updated to v${VERSION} — server is running!"
else
  echo ""
  echo "  Binary updated. Check: systemctl status clawlens"
fi
echo ""
