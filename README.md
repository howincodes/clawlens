# ClawLens

AI usage analytics and team management for Claude Code.

Track prompts, credits, tool usage. Enforce rate limits. Kill switch. Tamper detection. Works with any Claude Code subscription.

## Quick Start

### Server
```bash
# Clone and install
git clone https://github.com/howincodes/clawlens.git
cd clawlens
pnpm install
pnpm build

# Start
PORT=3000 ADMIN_PASSWORD=your-secret JWT_SECRET=your-jwt-secret pnpm dev
```

### Client (per developer)
```bash
bash <(curl -fsSL https://raw.githubusercontent.com/howincodes/clawlens/main/scripts/install.sh)
```

### Enforced Mode (admin, optional)
```bash
curl -fsSL https://raw.githubusercontent.com/howincodes/clawlens/main/scripts/enforce.sh | sudo bash
```

## Architecture

- **Server**: Express + TypeScript + SQLite (better-sqlite3)
- **Dashboard**: React + Vite + Tailwind
- **Client**: Shell script hook registered in `~/.claude/settings.json`
- **Enforcement**: Managed settings with `allowManagedHooksOnly`

## Features

- 11 Claude Code hook events tracked (SessionStart, Prompt, Tool, Stop, etc.)
- Credit-based rate limiting (opus=10, sonnet=3, haiku=1)
- Kill/pause switch (blocks session + prompt + tool use)
- Tamper detection (ConfigChange, FileChanged)
- AI summaries via `claude -p --bare --json-schema`
- Real-time WebSocket feed
- Token rotation
- Two deployment modes: Standard (user settings) + Enforced (managed settings with auth revocation)

## Uninstall

```bash
# Client
bash <(curl -fsSL https://raw.githubusercontent.com/howincodes/clawlens/main/scripts/uninstall.sh)

# Enforced mode
curl -fsSL https://raw.githubusercontent.com/howincodes/clawlens/main/scripts/restore.sh | sudo bash
```

## License

MIT
