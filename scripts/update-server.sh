#!/bin/bash
set -e
cd /opt/clawlens
git pull --ff-only
docker compose up -d --build
echo "ClawLens updated and restarted"
