#!/bin/bash
set -e
# ClawLens Server Installer
# Clones repo, installs deps, builds, sets up systemd service

VERSION="${CLAWLENS_VERSION:-0.2.0}"

echo "ClawLens Server Installer v${VERSION}"

# Check prerequisites
command -v node >/dev/null || { echo "Node.js 20+ required"; exit 1; }
command -v pnpm >/dev/null || { echo "pnpm required (npm install -g pnpm)"; exit 1; }

# Clone or update
if [ -d /opt/clawlens ]; then
  cd /opt/clawlens && git pull
else
  git clone https://github.com/howincodes/clawlens.git /opt/clawlens
  cd /opt/clawlens
fi

# Install and build
pnpm install
pnpm build

# Create systemd service
cat > /etc/systemd/system/clawlens.service << EOF
[Unit]
Description=ClawLens Server
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/clawlens
ExecStart=$(which node) packages/server/dist/server.js
Environment=PORT=3000
Environment=NODE_ENV=production
Environment=DB_PATH=/opt/clawlens/data/clawlens.db
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

mkdir -p /opt/clawlens/data

echo ""
echo "Set these env vars in /etc/systemd/system/clawlens.service:"
echo "  Environment=ADMIN_PASSWORD=your-password"
echo "  Environment=JWT_SECRET=your-jwt-secret"
echo ""
echo "Then run:"
echo "  systemctl daemon-reload"
echo "  systemctl enable clawlens"
echo "  systemctl start clawlens"
