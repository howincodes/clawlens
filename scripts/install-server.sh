#!/bin/bash
set -e

# ClawLens Server Installer (Docker)
# Usage: curl -fsSL https://raw.githubusercontent.com/howincodes/clawlens/main/scripts/install-server.sh | bash

echo ""
echo "  ClawLens Server Installer"
echo "  ========================="
echo ""

# Check docker
if ! command -v docker >/dev/null 2>&1; then
  echo "  Error: Docker required. Install: https://docs.docker.com/engine/install/"
  exit 1
fi

# Prompt config
ADMIN_PASS=""
while [ -z "$ADMIN_PASS" ]; do
  read -p "  Admin password: " ADMIN_PASS
  [ -z "$ADMIN_PASS" ] && echo "  Cannot be empty!"
done

JWT_SECRET=""
while [ -z "$JWT_SECRET" ]; do
  read -p "  JWT secret: " JWT_SECRET
  [ -z "$JWT_SECRET" ] && echo "  Cannot be empty!"
done

read -p "  Port [3000]: " PORT
PORT="${PORT:-3000}"

# Clone or update
echo ""
echo "[1/3] Getting ClawLens..."
if [ -d /opt/clawlens ]; then
  cd /opt/clawlens && git pull --ff-only
  echo "  -> Updated"
else
  git clone https://github.com/howincodes/clawlens.git /opt/clawlens
  cd /opt/clawlens
  echo "  -> Cloned"
fi

# Write env file
echo "[2/3] Configuring..."
cat > /opt/clawlens/.env << EOF
ADMIN_PASSWORD=${ADMIN_PASS}
JWT_SECRET=${JWT_SECRET}
PORT=${PORT}
EOF
echo "  -> /opt/clawlens/.env"

# Build and start
echo "[3/3] Building and starting..."
docker compose down 2>/dev/null || true
docker compose up -d --build

# Verify
sleep 3
if curl -sf "http://localhost:${PORT}/health" > /dev/null 2>&1; then
  echo ""
  echo "  ============================="
  echo "  ClawLens server running!"
  echo "  ============================="
  echo ""
  echo "  Dashboard: http://localhost:${PORT}"
  echo "  Logs:      cd /opt/clawlens && docker compose logs -f"
  echo "  Stop:      cd /opt/clawlens && docker compose down"
  echo "  Update:    cd /opt/clawlens && git pull && docker compose up -d --build"
else
  echo ""
  echo "  Server may still be building. Check:"
  echo "    cd /opt/clawlens && docker compose logs -f"
fi
echo ""
