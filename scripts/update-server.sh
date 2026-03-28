#!/bin/bash
set -e
cd /opt/clawlens
git pull --ff-only

# Detect which method was used
if [ -f docker-compose.yml ] && docker compose ps 2>/dev/null | grep -q clawlens; then
  echo "Updating via Docker..."
  docker compose up -d --build
else
  echo "Updating via Node.js..."
  pnpm install 2>&1 | tail -1
  pnpm --filter dashboard build 2>&1 | tail -1
  pnpm --filter @clawlens/server bundle 2>&1 | tail -1
  systemctl restart clawlens
fi

echo "ClawLens updated!"
