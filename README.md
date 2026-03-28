# ClawLens

AI usage analytics and team management for Claude Code.

Track prompts, credits, tool usage. Enforce rate limits. Kill switch. Tamper detection.

## Deploy Server

```bash
git clone https://github.com/howincodes/clawlens.git
cd clawlens
cp .env.example .env
nano .env                  # set ADMIN_PASSWORD
docker compose up -d
```

Dashboard: `http://your-server:3000`

## Install on Developer Machines

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/howincodes/clawlens/main/scripts/install.sh)
```

Prompts for server URL and auth token (admin creates tokens in dashboard).

## Enforced Mode (optional, requires sudo)

Hooks in managed settings — developers cannot disable them.

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/howincodes/clawlens/main/scripts/enforce.sh)
```

## Features

- 11 Claude Code hook events tracked
- Credit-based rate limiting (opus=10, sonnet=3, haiku=1)
- Kill/pause switch (blocks session + prompt + tool use)
- Tamper detection (ConfigChange, FileChanged alerts)
- AI summaries via `claude -p`
- Real-time WebSocket dashboard
- Two modes: Standard (user settings) + Enforced (managed settings + auth revocation)

## Uninstall

```bash
# Developer machine
bash <(curl -fsSL https://raw.githubusercontent.com/howincodes/clawlens/main/scripts/uninstall.sh)

# Enforced mode
bash <(curl -fsSL https://raw.githubusercontent.com/howincodes/clawlens/main/scripts/restore.sh)
```

## Development

```bash
pnpm install
pnpm dev                   # start server on :3000
pnpm test                  # run 149 tests
pnpm --filter dashboard dev  # dashboard dev server on :5173
```

## License

MIT
