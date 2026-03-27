#!/bin/bash
set -e

# ClawLens Server Installer — single script, does everything
# Usage: curl -fsSL https://raw.githubusercontent.com/howincodes/clawlens/main/scripts/install-server.sh | bash -s -- --password YOUR_PASSWORD

VERSION="${CLAWLENS_VERSION:-0.1.0}"
REPO="howincodes/clawlens"
PORT="${CLAWLENS_PORT:-3000}"
PASSWORD=""

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --password) PASSWORD="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --version) VERSION="$2"; shift 2 ;;
    *) shift ;;
  esac
done

if [ -z "$PASSWORD" ]; then
  echo ""
  echo "Usage: curl -fsSL ... | bash -s -- --password YOUR_ADMIN_PASSWORD"
  echo ""
  echo "Options:"
  echo "  --password  (required) Admin dashboard password"
  echo "  --port      Server port (default: 3000)"
  echo "  --version   Version to install (default: 0.1.0)"
  exit 1
fi

# Detect platform
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)
case "$ARCH" in
  x86_64) ARCH="amd64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *) echo "Unsupported architecture: $ARCH"; exit 1 ;;
esac

BASE="https://github.com/${REPO}/releases/download/v${VERSION}"

echo ""
echo "  ClawLens Server Installer"
echo "  ========================="
echo "  Version:  v${VERSION}"
echo "  Platform: ${OS}/${ARCH}"
echo "  Port:     ${PORT}"
echo ""

# 1. Download server binary
echo "[1/5] Downloading server binary..."
curl -fsSL "${BASE}/clawlens-server-${OS}-${ARCH}" -o /tmp/clawlens-server
chmod +x /tmp/clawlens-server
mv /tmp/clawlens-server /usr/local/bin/clawlens-server
echo "  -> /usr/local/bin/clawlens-server"

# 2. Download client binary (so install.sh endpoint works)
echo "[2/5] Downloading client binary..."
curl -fsSL "${BASE}/clawlens-${OS}-${ARCH}" -o /tmp/clawlens
chmod +x /tmp/clawlens
mv /tmp/clawlens /usr/local/bin/clawlens
echo "  -> /usr/local/bin/clawlens"

# 3. Download dashboard
echo "[3/5] Downloading dashboard..."
mkdir -p /opt/clawlens/data
curl -fsSL "${BASE}/dashboard-dist.tar.gz" -o /tmp/dashboard-dist.tar.gz
tar -xzf /tmp/dashboard-dist.tar.gz -C /opt/clawlens/
rm /tmp/dashboard-dist.tar.gz
echo "  -> /opt/clawlens/dist/"

# 4. Create systemd service
echo "[4/5] Creating systemd service..."
cat > /etc/systemd/system/clawlens.service << EOF
[Unit]
Description=ClawLens - AI Usage Analytics for Claude Code
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/clawlens-server \\
  --port ${PORT} \\
  --db /opt/clawlens/data/clawlens.db \\
  --dashboard /opt/clawlens/dist \\
  --admin-password ${PASSWORD}
Restart=always
RestartSec=5
Environment=CLAWLENS_MODE=selfhost

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable clawlens
systemctl restart clawlens
echo "  -> systemd service created and started"

# 5. Verify
echo "[5/5] Verifying..."
sleep 2
if curl -sf "http://127.0.0.1:${PORT}/api/v1/health" > /dev/null 2>&1; then
  echo "  -> Health check passed!"
else
  echo "  -> WARNING: Health check failed. Check: journalctl -u clawlens -f"
fi

echo ""
echo "  =================================="
echo "  ClawLens is running on port ${PORT}"
echo "  =================================="
echo ""
echo "  Dashboard:  http://$(hostname -f 2>/dev/null || echo 'your-server'):${PORT}"
echo "  Password:   ${PASSWORD}"
echo ""
echo "  Commands:"
echo "    systemctl status clawlens     # check status"
echo "    systemctl restart clawlens    # restart"
echo "    journalctl -u clawlens -f     # view logs"
echo ""
echo "  Next: set up a reverse proxy (nginx/Caddy) with SSL"
echo "  for your domain, pointing to 127.0.0.1:${PORT}"
echo ""
