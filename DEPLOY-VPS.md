# HowinLens VPS Deployment Prompt

## Use this to start a Claude Code session on the VPS via SSH.

SSH into your VPS, open Claude Code, paste everything below the line:

---

## Context

You are deploying **HowinLens** (formerly ClawLens) — an AI-powered team operations platform that tracks developer AI tool usage across Claude Code, Codex, and Antigravity.

**Domain:** `howinlens.howincloud.com`
**Server:** Ubuntu 22/24 with Hestia Panel
**Dev workflow:** Development happens directly on this VPS via SSH + Claude Code CLI

## Step 1: Audit Current State

Before doing anything, check what's already running:

```bash
# Check if old ClawLens is running
docker ps
pm2 list 2>/dev/null
systemctl list-units --type=service | grep -i claw
systemctl list-units --type=service | grep -i howin

# Check Node.js / pnpm
node -v
pnpm -v

# Check if repo exists
ls -la /opt/clawlens 2>/dev/null || ls -la /home/*/clawlens 2>/dev/null || echo "No existing repo found"

# Check Hestia Panel domains
v-list-web-domains admin 2>/dev/null || echo "Hestia CLI not available — check via web panel"

# Check ports in use
ss -tlnp | grep -E '3000|5432|443|80'

# Check Docker
docker compose version
docker ps -a
```

Report what you find before proceeding.

## Step 2: Set Up the Repository

```bash
# Choose install location
INSTALL_DIR=/opt/howinlens

# Clone the repo (or pull if exists)
# Replace with actual git remote URL:
git clone https://github.com/user/clawlens.git $INSTALL_DIR
# OR if repo exists:
cd $INSTALL_DIR && git fetch && git checkout phase0/foundation && git pull

cd $INSTALL_DIR
```

## Step 3: Install Dependencies

```bash
# Ensure Node.js 20+ is installed
node -v || curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs

# Ensure pnpm is installed
pnpm -v || npm install -g pnpm

# Install project dependencies
cd $INSTALL_DIR
pnpm install
```

## Step 4: Set Up PostgreSQL via Docker

```bash
cd $INSTALL_DIR

# docker-compose.yml should already exist. Start Postgres:
docker compose up postgres -d

# Verify
docker compose ps
docker exec howinlens-db psql -U howinlens -c "SELECT 1;"
```

If docker-compose.yml doesn't exist, create it:
```yaml
services:
  postgres:
    image: postgres:17
    container_name: howinlens-db
    environment:
      POSTGRES_USER: howinlens
      POSTGRES_PASSWORD: howinlens
      POSTGRES_DB: howinlens
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U howinlens"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  pgdata:
```

## Step 5: Push Schema & Seed

```bash
cd $INSTALL_DIR/packages/server

# Push Drizzle schema to Postgres
DATABASE_URL=postgresql://howinlens:howinlens@localhost:5432/howinlens pnpm db:push

# If it asks about prompts→messages rename, select NO (drop + create)

# Start server once to run seed
DATABASE_URL=postgresql://howinlens:howinlens@localhost:5432/howinlens \
  ADMIN_EMAIL=admin@howinlens.local \
  ADMIN_PASSWORD=CHANGE_ME_STRONG_PASSWORD \
  JWT_SECRET=$(openssl rand -hex 32) \
  PORT=3000 \
  node --import tsx src/server.ts &

# Wait for seed to complete, then kill
sleep 5 && kill %1

# Verify seed
docker exec howinlens-db psql -U howinlens -d howinlens -c "SELECT slug FROM providers; SELECT COUNT(*) FROM permissions; SELECT email FROM users;"
```

## Step 6: Build Dashboard

```bash
cd $INSTALL_DIR
pnpm --filter dashboard build
```

## Step 7: Create Environment File

```bash
cat > /opt/howinlens/.env << 'EOF'
# Database
DATABASE_URL=postgresql://howinlens:howinlens@localhost:5432/howinlens

# Admin
ADMIN_EMAIL=admin@howinlens.local
ADMIN_PASSWORD=CHANGE_ME_STRONG_PASSWORD

# Security
JWT_SECRET=GENERATE_WITH_openssl_rand_hex_32

# Server
PORT=3000
NODE_ENV=production

# CORS — add your domain
CORS_ORIGINS=https://howinlens.howincloud.com,http://localhost:5173

# Optional
# HOWINLENS_DEBUG=1
EOF

# Generate JWT secret
sed -i "s/GENERATE_WITH_openssl_rand_hex_32/$(openssl rand -hex 32)/" /opt/howinlens/.env
```

## Step 8: Create systemd Service

```bash
cat > /etc/systemd/system/howinlens.service << 'EOF'
[Unit]
Description=HowinLens Server
After=network.target docker.service
Requires=docker.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/howinlens/packages/server
EnvironmentFile=/opt/howinlens/.env
ExecStart=/usr/bin/node --import tsx src/server.ts
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable howinlens
systemctl start howinlens
systemctl status howinlens

# Check logs
journalctl -u howinlens -f --no-pager -n 30
```

## Step 9: Configure Hestia Panel + Nginx + SSL

### 9a. Create the web domain in Hestia

Via Hestia web panel (`https://YOUR_VPS_IP:8083`):
1. Go to **Web** → **Add Web Domain**
2. Domain: `howinlens.howincloud.com`
3. Enable **SSL** → **Let's Encrypt**
4. Save

OR via CLI:
```bash
v-add-web-domain admin howinlens.howincloud.com
v-add-letsencrypt-domain admin howinlens.howincloud.com
```

### 9b. Configure Nginx Proxy

Hestia uses nginx templates. Create a custom proxy template:

```bash
# Find where Hestia stores nginx templates
ls /usr/local/hestia/data/templates/web/nginx/

# Create proxy template for Node.js app
cat > /usr/local/hestia/data/templates/web/nginx/howinlens.tpl << 'NGINX'
server {
    listen      %ip%:%web_port%;
    server_name %domain_idn% %alias_idn%;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }

    location /error/ {
        alias /home/%user%/web/%domain%/document_errors/;
    }

    include /home/%user%/conf/web/%domain%/nginx.conf_*;
}
NGINX

# Create SSL version
cat > /usr/local/hestia/data/templates/web/nginx/howinlens.stpl << 'NGINX'
server {
    listen      %ip%:%web_ssl_port% ssl;
    server_name %domain_idn% %alias_idn%;

    ssl_certificate     %ssl_pem%;
    ssl_certificate_key %ssl_key%;

    # Force HTTPS
    if ($scheme = http) {
        return 301 https://$server_name$request_uri;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }

    location /error/ {
        alias /home/%user%/web/%domain%/document_errors/;
    }

    include /home/%user%/conf/web/%domain%/nginx.ssl_conf_*;
}
NGINX

# Apply the template to the domain
v-change-web-domain-proxy-tpl admin howinlens.howincloud.com howinlens

# Restart nginx
systemctl restart nginx
```

**Alternative (simpler):** If Hestia already has a `default` proxy template, you can just add a custom nginx config:

```bash
# Find your domain's nginx conf directory
ls /home/admin/conf/web/howinlens.howincloud.com/

# Add proxy pass
cat > /home/admin/conf/web/howinlens.howincloud.com/nginx.conf_custom << 'EOF'
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 86400;
}
EOF

systemctl restart nginx
```

## Step 10: Verify Everything

```bash
# Health check
curl -s https://howinlens.howincloud.com/health

# Login test
curl -s https://howinlens.howincloud.com/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@howinlens.local","password":"CHANGE_ME_STRONG_PASSWORD"}'

# Provider route test (get admin auth_token first)
AUTH_TOKEN=$(docker exec howinlens-db psql -U howinlens -d howinlens -t -c "SELECT auth_token FROM users LIMIT 1;" | tr -d ' \n')
curl -s https://howinlens.howincloud.com/api/v1/providers/claude-code/session-start \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"session_id":"deploy-test","hook_event_name":"SessionStart","model":"sonnet"}'

# WebSocket test
curl -s -N -H "Connection: Upgrade" -H "Upgrade: websocket" \
  https://howinlens.howincloud.com/ws 2>&1 | head -5

# Dashboard should load in browser
echo "Open https://howinlens.howincloud.com in browser"
```

## Step 11: Configure Hook Script on Developer Machines

Each developer needs to update their Claude Code hooks to point to the VPS:

```bash
# Set environment variables
export HOWINLENS_SERVER=https://howinlens.howincloud.com
export HOWINLENS_TOKEN=<user_auth_token_from_dashboard>

# Copy hook script
cp /opt/howinlens/client/hooks/howinlens-hook.mjs ~/.claude/hooks/

# Update Claude Code settings.json to use the hook
# (or use the install script when ready)
```

## Step 12: Development Workflow on VPS

For ongoing development via SSH + Claude Code:

```bash
# SSH into VPS
ssh root@YOUR_VPS_IP

# Navigate to repo
cd /opt/howinlens

# Start dev mode (auto-restarts on file changes)
PORT=3000 pnpm dev

# OR restart the systemd service after changes
systemctl restart howinlens

# Run tests
pnpm --filter @howinlens/server test

# Build dashboard after UI changes
pnpm --filter dashboard build

# View logs
journalctl -u howinlens -f
```

## Architecture on VPS

```
Internet → howinlens.howincloud.com
         → Hestia nginx (SSL termination)
         → proxy_pass http://127.0.0.1:3000
         → Node.js (Express + Drizzle)
         → PostgreSQL 17 (Docker, port 5432)

Files:
  /opt/howinlens/              — git repo
  /opt/howinlens/.env          — environment config
  /etc/systemd/system/howinlens.service — systemd unit

Manage:
  systemctl start/stop/restart howinlens
  journalctl -u howinlens -f
  docker compose up/down postgres
```

## Tech Stack
- Server: Express 4, TypeScript, Drizzle ORM, postgres.js, Zod
- Dashboard: React 19, Vite 8, Tailwind CSS, Zustand, Radix UI
- DB: PostgreSQL 17 (Docker)
- Runtime: Node.js 20+, pnpm, tsx

## Important Notes
- The server serves the dashboard as static files from `packages/dashboard/dist/`
- WebSocket endpoints: `/ws` (live feed), `/ws/watcher` (client watcher)
- Provider API: `/api/v1/providers/:provider/*` (unified)
- Backward compat: `/api/v1/hook/*` → claude-code, `/api/v1/codex/*` → codex
- Admin API: `/api/admin/*` (JWT auth)
- Client API: `/api/v1/client/*` (bearer token auth)
