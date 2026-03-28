#!/bin/bash
set -e

# ClawLens Server Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/howincodes/clawlens/main/scripts/install-server.sh | bash

echo ""
echo "  ClawLens Server Installer"
echo "  ========================="
echo ""

# ── Prompt config ─────────────────────────────────
ADMIN_PASS=""
while [ -z "$ADMIN_PASS" ]; do
  read -p "  Admin password: " ADMIN_PASS < /dev/tty
  [ -z "$ADMIN_PASS" ] && echo "  Cannot be empty!"
done

JWT_SECRET=""
while [ -z "$JWT_SECRET" ]; do
  read -p "  JWT secret: " JWT_SECRET < /dev/tty
  [ -z "$JWT_SECRET" ] && echo "  Cannot be empty!"
done

read -p "  Port [3000]: " PORT < /dev/tty
PORT="${PORT:-3000}"

# ── Detect install method ─────────────────────────
HAS_DOCKER=false
HAS_NODE=false
command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1 && HAS_DOCKER=true
if command -v node >/dev/null 2>&1; then
  NODE_VER=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
  [ "$NODE_VER" -ge 20 ] 2>/dev/null && HAS_NODE=true
fi

if $HAS_DOCKER && $HAS_NODE; then
  echo ""
  echo "  Both Docker and Node.js 20+ detected."
  read -p "  Install method: (d)ocker or (n)ode? [d]: " METHOD < /dev/tty
  METHOD="${METHOD:-d}"
elif $HAS_DOCKER; then
  METHOD="d"
elif $HAS_NODE; then
  METHOD="n"
else
  echo ""
  echo "  Neither Docker nor Node.js 20+ found."
  echo "  Install one of:"
  echo "    Docker: https://docs.docker.com/engine/install/"
  echo "    Node.js 20+: https://nodejs.org/"
  exit 1
fi

# ── Clone repo ────────────────────────────────────
echo ""
echo "[1/3] Getting ClawLens..."
if [ -d /opt/clawlens ]; then
  cd /opt/clawlens && git pull --ff-only 2>/dev/null || true
  echo "  -> Updated"
else
  git clone https://github.com/howincodes/clawlens.git /opt/clawlens
  cd /opt/clawlens
  echo "  -> Cloned"
fi

# ── Docker install ────────────────────────────────
if [ "$METHOD" = "d" ] || [ "$METHOD" = "D" ]; then
  echo "[2/3] Configuring Docker..."
  cat > /opt/clawlens/.env << EOF
ADMIN_PASSWORD=${ADMIN_PASS}
JWT_SECRET=${JWT_SECRET}
PORT=${PORT}
EOF
  echo "  -> .env written"

  echo "[3/3] Building and starting..."
  # Support both "docker compose" (v2) and "docker-compose" (v1)
  COMPOSE="docker compose"
  $COMPOSE version >/dev/null 2>&1 || COMPOSE="docker-compose"
  $COMPOSE down 2>/dev/null || true
  $COMPOSE up -d --build 2>&1 | tail -5

  sleep 3
  if curl -sf "http://localhost:${PORT}/health" > /dev/null 2>&1; then
    echo "  -> Running on port ${PORT} ✅"
  else
    echo "  -> Building... check: cd /opt/clawlens && $COMPOSE logs -f"
  fi

  echo ""
  echo "  ============================="
  echo "  ClawLens installed! (Docker)"
  echo "  ============================="
  echo "  Dashboard: http://localhost:${PORT}"
  echo "  Logs:      cd /opt/clawlens && $COMPOSE logs -f"
  echo "  Update:    cd /opt/clawlens && git pull && $COMPOSE up -d --build"
  echo ""
  exit 0
fi

# ── Node.js install ───────────────────────────────
echo "[2/3] Building..."
npm install -g pnpm 2>/dev/null || true
pnpm install 2>&1 | tail -1
pnpm --filter dashboard build 2>&1 | tail -1
pnpm --filter @clawlens/server bundle 2>&1 | tail -1
echo "  -> Built"

echo "[3/3] Creating systemd service..."
systemctl stop clawlens 2>/dev/null || true

cat > /etc/systemd/system/clawlens.service << EOF
[Unit]
Description=ClawLens Server
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/clawlens/release
ExecStart=$(which node) /opt/clawlens/release/server.mjs
Environment=PORT=${PORT}
Environment=NODE_ENV=production
Environment=DB_PATH=/opt/clawlens/data/clawlens.db
Environment=DASHBOARD_DIR=/opt/clawlens/release/dashboard
Environment=ADMIN_PASSWORD=${ADMIN_PASS}
Environment=JWT_SECRET=${JWT_SECRET}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

mkdir -p /opt/clawlens/data
systemctl daemon-reload
systemctl enable clawlens
systemctl start clawlens

sleep 2
if curl -sf "http://localhost:${PORT}/health" > /dev/null 2>&1; then
  echo "  -> Running on port ${PORT} ✅"
else
  echo "  -> Check: systemctl status clawlens"
fi

echo ""
echo "  =============================="
echo "  ClawLens installed! (Node.js)"
echo "  =============================="
echo "  Dashboard: http://localhost:${PORT}"
echo "  Logs:      journalctl -u clawlens -f"
echo "  Update:    curl -fsSL .../update-server.sh | bash"
echo ""
