# ClawLens

**AI usage analytics and team management for Claude Code**

[![Go](https://img.shields.io/badge/Go-1.25-00ADD8?logo=go)](https://go.dev)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker)](https://ghcr.io/howincodes/clawlens)

---

## What is ClawLens?

ClawLens is a self-hostable observability layer for teams using Claude Code. It is built for engineering leads at startups with 5-20 developers who want visibility into how AI is being used across their team — without asking developers to change how they work.

Deploy one server, distribute an install code to each developer, and get a live dashboard showing who is using Claude, how much, which models, what it is costing, and where people are getting stuck.

---

## Features

- **Real-time usage tracking** — prompts, sessions, tool calls, and turn durations captured via Claude Code hooks
- **Per-user rate limiting** — credit budgets, per-model caps, and time-of-day rules enforced before prompts reach Anthropic
- **AI-powered intelligence briefs** — daily per-user summaries and weekly team digests generated via `claude -p`
- **Client-side secret scrubbing** — API keys, AWS credentials, and connection strings are redacted on the developer's machine before any data is sent
- **Model detection** — Opus, Sonnet, and Haiku identified with configurable credit weights for cost normalisation
- **WebSocket live feed** — dashboard updates in real time without polling
- **Stuck detection** — server alerts when a developer has been in the same session without progress
- **CSV / JSON data export** — full prompt and session history available for external analysis
- **Multi-tenant** — SaaS mode (multiple teams) and self-host mode (single team) supported from the same binary
- **Docker + Caddy deployment** — production-ready compose file and Caddyfile included

---

## Server Installation

One command installs the server binary, dashboard, and systemd service:

```bash
curl -fsSL https://raw.githubusercontent.com/howincodes/clawlens/main/scripts/install-server.sh | bash -s -- --password YOUR_ADMIN_PASSWORD
```

Open your server URL, log in with the admin password, create a user, and share the install code.

**Update server:**

```bash
curl -fsSL https://raw.githubusercontent.com/howincodes/clawlens/main/scripts/update-server.sh | bash
```

---

## Client Installation

The install script downloads the binary, registers with the server, and configures Claude Code hooks — all in one step. It will ask for the install code and server URL interactively.

**macOS / Linux:**

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/howincodes/clawlens/main/scripts/install-client.sh)
```

**Windows (PowerShell):**

```powershell
irm https://raw.githubusercontent.com/howincodes/clawlens/main/scripts/install-client.ps1 | iex
```

After installation, close all terminals and restart Claude Code. Every prompt will appear in the dashboard.

**Update client:**

```bash
# macOS / Linux
bash <(curl -fsSL https://raw.githubusercontent.com/howincodes/clawlens/main/scripts/update-client.sh)

# Windows (PowerShell)
irm https://raw.githubusercontent.com/howincodes/clawlens/main/scripts/update-client.ps1 | iex
```

---

## Architecture

```
┌─────────────────────────────────────────────┐
│  ClawLens Server                            │
│  Go binary  +  SQLite  +  React dashboard  │
└────────────────────┬────────────────────────┘
                     │  HTTPS (REST + WebSocket)
        ┌────────────┴────────────┐
        │                         │
┌───────▼───────┐         ┌───────▼───────┐
│  clawlens     │         │  clawlens     │
│  (alice)      │         │  (bob)        │
│  Go binary    │         │  Go binary    │
│  Claude hooks │         │  Claude hooks │
└───────────────┘         └───────────────┘
```

Each developer runs the `clawlens` binary as a Claude Code hook. It captures prompt and tool events locally, scrubs secrets, and batches them to the server over HTTPS. The server stores everything in SQLite and pushes live events to the dashboard over WebSocket.

---

## Dashboard Pages

| Page | Description |
|------|-------------|
| **Overview** | Live activity feed, active sessions, and team-wide snapshot |
| **Analytics** | Aggregated charts for prompts, tool calls, credit spend, and model mix over time |
| **Users** | List of all team members with status, credit usage, and last-seen timestamps |
| **User Detail** | Per-user drill-down with session history, prompt browser, and rate limit controls |
| **Prompts Browser** | Searchable full-text view of all recorded prompts across the team |
| **Summaries** | AI-generated daily and weekly intelligence briefs per user and for the team |
| **Subscriptions** | Claude subscription tracking (Pro, Max, Team, API) linked to team members |
| **Audit Log** | Chronological log of admin actions and system events |
| **Settings** | Team configuration — credit weights, rate limits, sync interval, and password |

---

## Configuration

All configuration is provided via environment variables or CLI flags on the server binary.

| Variable | Default | Description |
|----------|---------|-------------|
| `ADMIN_PASSWORD` | required | Password for the admin dashboard |
| `PORT` | `3000` | HTTP port the server listens on |
| `DB_PATH` | `clawlens.db` | Path to the SQLite database file |
| `CLAWLENS_MODE` | `selfhost` | `selfhost` (single team) or `saas` (multi-tenant) |
| `DASHBOARD_DIR` | — | Path to the compiled dashboard `dist/` directory |
| `JWT_SECRET` | auto-generated | Secret used to sign admin session tokens |

---

## Development

```bash
git clone https://github.com/howincodes/clawlens
cd clawlens
make build
ADMIN_PASSWORD=test ./bin/clawlens-server --dashboard ./dashboard/dist
```

Dashboard development (hot reload):

```bash
cd dashboard && npm run dev
```

Run tests:

```bash
make test
```

Build release binaries for all platforms:

```bash
make release
```

---

## License

MIT — see [LICENSE](LICENSE).
