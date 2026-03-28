#!/bin/bash
set -e

# ClawLens Server Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/howincodes/clawlens/main/scripts/install-server.sh | bash
#
# Installs Node.js, pnpm, clones repo, builds, creates systemd service.
# Run as root on Ubuntu/Debian.

echo ""
echo "  ClawLens Server Installer"
echo "  ========================="
echo ""

# ── Check root ────────────────────────────────────────────
if [ "$(id -u)" -ne 0 ]; then
  echo "  Error: run as root (sudo bash)"
  exit 1
fi

# ── Prompt for config ─────────────────────────────────────
ADMIN_PASS=""
while [ -z "$ADMIN_PASS" ]; do
  read -p "  Admin password: " ADMIN_PASS
  [ -z "$ADMIN_PASS" ] && echo "  Cannot be empty!"
done

JWT_SECRET=""
while [ -z "$JWT_SECRET" ]; do
  read -p "  JWT secret (random string): " JWT_SECRET
  [ -z "$JWT_SECRET" ] && echo "  Cannot be empty!"
done

PORT="${CLAWLENS_PORT:-3000}"
read -p "  Port [${PORT}]: " INPUT_PORT
PORT="${INPUT_PORT:-$PORT}"

# ── Step 1: Install Node.js ──────────────────────────────
echo ""
echo "[1/5] Installing Node.js..."
if command -v node >/dev/null 2>&1; then
  NODE_VER=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
  if [ "$NODE_VER" -ge 20 ] 2>/dev/null; then
    echo "  -> Node.js $(node -v) already installed"
  else
    echo "  -> Node.js $(node -v) too old, upgrading..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
  fi
else
  echo "  -> Installing Node.js 22..."
  apt-get update -qq
  apt-get install -y curl git
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
echo "  -> Node.js $(node -v)"

# ── Step 2: Install pnpm ─────────────────────────────────
echo "[2/5] Installing pnpm..."
if command -v pnpm >/dev/null 2>&1; then
  echo "  -> pnpm $(pnpm -v) already installed"
else
  npm install -g pnpm
  echo "  -> pnpm $(pnpm -v) installed"
fi

# ── Step 3: Clone / update repo ──────────────────────────
echo "[3/5] Getting ClawLens..."
if [ -d /opt/clawlens ]; then
  echo "  -> Updating existing install..."
  cd /opt/clawlens
  git pull --ff-only
else
  echo "  -> Cloning fresh..."
  git clone https://github.com/howincodes/clawlens.git /opt/clawlens
  cd /opt/clawlens
fi

# ── Step 4: Build ─────────────────────────────────────────
echo "[4/5] Building..."
pnpm install 2>&1 | tail -1
pnpm build 2>&1 | tail -1
mkdir -p /opt/clawlens/data
echo "  -> Build complete"

# ── Step 5: Create systemd service ────────────────────────
echo "[5/5] Creating systemd service..."

# Stop old service if running
systemctl stop clawlens 2>/dev/null || true

cat > /etc/systemd/system/clawlens.service << EOF
[Unit]
Description=ClawLens Server
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/clawlens
ExecStart=$(which node) packages/server/dist/server.js
Environment=PORT=${PORT}
Environment=NODE_ENV=production
Environment=DB_PATH=/opt/clawlens/data/clawlens.db
Environment=ADMIN_PASSWORD=${ADMIN_PASS}
Environment=JWT_SECRET=${JWT_SECRET}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable clawlens
systemctl start clawlens

# Wait and verify
sleep 2
if curl -sf "http://localhost:${PORT}/health" > /dev/null 2>&1; then
  echo "  -> Server running on port ${PORT} ✅"
else
  echo "  -> Server may still be starting... check: systemctl status clawlens"
fi

echo ""
echo "  ============================="
echo "  ClawLens server installed!"
echo "  ============================="
echo ""
echo "  Dashboard: http://localhost:${PORT}"
echo "  Health:    http://localhost:${PORT}/health"
echo "  Logs:      journalctl -u clawlens -f"
echo ""
