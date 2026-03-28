#!/bin/bash
set -e
cd /opt/clawlens
git pull
pnpm install
pnpm build
systemctl restart clawlens
echo "ClawLens updated and restarted"
