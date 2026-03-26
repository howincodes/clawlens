# ClawLens Multi-Tenancy & SaaS Plan

---

## Strategy

Build multi-tenant from day one. Two deployment modes:

| Mode | Who sees it | How it works |
|------|------------|-------------|
| **SaaS** (clawlens.com) | Public teams | Multi-tenant, teams sign up, demo plan |
| **Self-host** | Open source users | Single-tenant, multi-tenancy hidden, no plan limits |

Same codebase. A single env var controls the mode:

```
CLAWLENS_MODE=saas      → multi-tenant, registration enabled, plans enforced
CLAWLENS_MODE=selfhost  → single-tenant, no registration, no plan limits (default)
```

---

## Multi-Tenancy Architecture

### Every query scoped by team_id

Every database query MUST include `WHERE team_id = ?`. No exceptions. This is enforced at the service layer — never trust the route handler to remember.

```go
// WRONG — leaks data across teams
func GetUsers() []User {
    return db.Query("SELECT * FROM user")
}

// RIGHT — always scoped
func GetUsers(teamID string) []User {
    return db.Query("SELECT * FROM user WHERE team_id = ?", teamID)
}
```

The `team_id` comes from:
- **Admin API:** extracted from JWT token (set during login)
- **Hook API:** looked up from user's `auth_token` → user → team_id

### Database: shared tables, row-level isolation

All teams share the same SQLite file (or Postgres in future). Data is isolated by `team_id` on every row. No schema-per-tenant — too complex for SQLite.

### Subdomain routing (SaaS only)

```
acme.clawlens.com     → team_id = "acme-uuid"
startup.clawlens.com  → team_id = "startup-uuid"
clawlens.com/signup   → registration page
```

Server extracts team from subdomain → sets team context for all requests.

Self-host mode: no subdomain routing, single team, accessed at `your-server:3000`.

---

## Plans & Limits

### SaaS Plans

```sql
CREATE TABLE plan (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,       -- "demo" | "starter" | "pro" | "enterprise"
  max_users   INTEGER NOT NULL,    -- max users per team
  max_prompts_per_day INTEGER NOT NULL, -- across all users
  max_storage_mb INTEGER NOT NULL, -- prompt/response text storage
  ai_summaries BOOLEAN NOT NULL,   -- AI summary feature enabled
  webhooks    BOOLEAN NOT NULL,    -- Slack/Discord alerts enabled
  export      BOOLEAN NOT NULL,    -- CSV/JSON export enabled
  rate_limiting BOOLEAN NOT NULL,  -- rate limiting feature enabled
  custom_branding BOOLEAN NOT NULL,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Demo Plan (free, early bird)

```json
{
  "id": "demo",
  "name": "Demo (Early Bird)",
  "max_users": 5,
  "max_prompts_per_day": 500,
  "max_storage_mb": 100,
  "ai_summaries": true,
  "webhooks": true,
  "export": true,
  "rate_limiting": true,
  "custom_branding": false
}
```

**Important restrictions on demo plan:**
- Clearly labeled everywhere: "Demo Plan — Early Bird Access"
- Banner in dashboard: "You're on the free Demo plan. This plan is temporary and will be removed when paid plans launch. Enjoy full access while it lasts."
- No payment required
- No time limit (but we reserve the right to remove it)
- When paid plans launch: demo teams get 30-day notice to migrate or lose access

### Future paid plans (NOT built now — just the schema)

| Plan | Users | Prompts/day | Storage | AI Summaries | Price |
|------|-------|------------|---------|-------------|-------|
| Demo | 5 | 500 | 100MB | Yes | Free (temporary) |
| Starter | 10 | 2,000 | 500MB | Yes | $19/mo |
| Pro | 25 | 10,000 | 2GB | Yes | $49/mo |
| Enterprise | Unlimited | Unlimited | Unlimited | Yes | Custom |

### Self-host mode: no plans, no limits

```go
if mode == "selfhost" {
    // Skip all plan checks
    // Hide plan UI from dashboard
    // Hide registration page
    // Single team, unlimited everything
}
```

---

## Team Registration (SaaS only)

### Signup flow

```
1. User visits clawlens.com/signup
2. Enters: team name, admin email, admin password
3. Email verification (simple code, not OAuth)
4. Team created on demo plan
5. Subdomain assigned: {slug}.clawlens.com
6. Redirect to dashboard → Add User → get install codes
```

### New tables for SaaS

```sql
-- Team additions (add columns to existing team table)
ALTER TABLE team ADD COLUMN plan_id TEXT REFERENCES plan(id) DEFAULT 'demo';
ALTER TABLE team ADD COLUMN admin_email TEXT;
ALTER TABLE team ADD COLUMN email_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE team ADD COLUMN subdomain TEXT UNIQUE;
ALTER TABLE team ADD COLUMN suspended BOOLEAN DEFAULT FALSE;
ALTER TABLE team ADD COLUMN suspended_reason TEXT;
ALTER TABLE team ADD COLUMN created_by_ip TEXT;

-- Email verification codes
CREATE TABLE email_verification (
  id          TEXT PRIMARY KEY,
  team_id     TEXT NOT NULL REFERENCES team(id),
  code        TEXT NOT NULL,
  expires_at  DATETIME NOT NULL,
  used        BOOLEAN DEFAULT FALSE,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Plan enforcement

Every request checks plan limits:

```go
func enforceplan(team Team, action string) error {
    plan := getPlan(team.PlanID)

    switch action {
    case "add_user":
        if countUsers(team.ID) >= plan.MaxUsers {
            return errors.New("User limit reached on your plan")
        }
    case "record_prompt":
        if countPromptsToday(team.ID) >= plan.MaxPromptsPerDay {
            return errors.New("Daily prompt limit reached on your plan")
        }
    case "ai_summary":
        if !plan.AISummaries {
            return errors.New("AI summaries not available on your plan")
        }
    }
    return nil
}
```

Self-host mode skips all of this.

---

## How Self-Host Hides Multi-Tenancy

In self-host mode, the system:

1. **Auto-creates a single team on first boot** (same as current behavior)
2. **Hides all plan/subscription UI** from the dashboard
3. **Hides the registration page** — no signup, admin sets password via env var
4. **Removes plan limits** — all features enabled, unlimited users/prompts
5. **No subdomain routing** — single origin
6. **No email verification** — not needed

The code is the same — just gated by `CLAWLENS_MODE`:

```go
// In admin routes
func handleCreateUser(w http.ResponseWriter, r *http.Request) {
    team := getTeamFromContext(r)

    // Plan enforcement only in SaaS mode
    if config.Mode == "saas" {
        if err := enforcePlan(team, "add_user"); err != nil {
            http.Error(w, err.Error(), 403)
            return
        }
    }

    // ... create user (same logic for both modes)
}
```

Dashboard conditionally renders:

```tsx
// React dashboard
{mode === 'saas' && <PlanBanner plan={team.plan} />}
{mode === 'saas' && <UpgradeButton />}
// Self-host never sees these
```

---

## API Changes

### New SaaS-only endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/auth/signup` | Create team + admin account |
| POST | `/api/auth/verify-email` | Verify email with code |
| GET | `/api/auth/plan` | Current plan details + usage |
| POST | `/api/auth/upgrade` | (Future) Upgrade plan |

These endpoints don't exist in self-host mode (return 404).

### Modified endpoints

All existing admin endpoints now include plan info in responses:

```json
// GET /api/admin/team response (SaaS mode)
{
  "id": "...",
  "name": "Acme Corp",
  "subdomain": "acme",
  "plan": {
    "name": "Demo (Early Bird)",
    "max_users": 5,
    "current_users": 3,
    "max_prompts_per_day": 500,
    "prompts_today": 127,
    "storage_used_mb": 23,
    "max_storage_mb": 100
  },
  "demo_notice": "This is a free Demo plan. It will be removed when paid plans launch. Enjoy full access while it lasts."
}

// GET /api/admin/team response (self-host mode)
{
  "id": "...",
  "name": "My Team",
  "plan": null  // no plan in self-host
}
```

---

## Dashboard Changes

### SaaS mode shows:

1. **Plan banner** at top of every page:
   > "Demo Plan — Early Bird Access. 3/5 users, 127/500 prompts today. This plan is temporary and will be removed when paid subscriptions launch."

2. **Usage meters** in settings:
   - Users: 3/5
   - Daily prompts: 127/500
   - Storage: 23MB/100MB

3. **Registration page** at `/signup`

4. **Team subdomain** shown in settings

### Self-host mode hides:

1. No plan banner
2. No usage meters (unlimited)
3. No registration page
4. No subdomain settings
5. No upgrade prompts

---

## Server Configuration

```bash
# SaaS deployment
docker run -d \
  -e CLAWLENS_MODE=saas \
  -e ADMIN_EMAIL=admin@clawlens.com \
  -e SMTP_HOST=smtp.sendgrid.net \
  -e SMTP_USER=apikey \
  -e SMTP_PASS=SG.xxx \
  -e DOMAIN=clawlens.com \
  ghcr.io/howincodes/clawlens:latest

# Self-host deployment (default — no multi-tenancy visible)
docker run -d \
  -e ADMIN_PASSWORD=secret \
  ghcr.io/howincodes/clawlens:latest
# CLAWLENS_MODE defaults to "selfhost"
```

---

## Migration Path: Demo → Paid

When paid plans launch:

1. All demo teams get email: "Paid plans are live. Your demo access continues for 30 days. After that, choose a plan or your team will be suspended."
2. After 30 days: demo teams get `suspended = true`, dashboard shows "Please upgrade to continue."
3. Data is NOT deleted — just access is blocked. Teams can upgrade anytime to restore access.
4. Self-host users: unaffected. They run their own server, no plans apply.

---

## Implementation Notes

1. **Build multi-tenant from day one** — every query scoped by team_id
2. **SaaS features are a thin layer** — registration, plans, email. Core product is identical.
3. **`CLAWLENS_MODE` env var** gates everything SaaS-specific
4. **Demo plan seeded on first boot** (SaaS mode only)
5. **No payment integration now** — just plan limits enforced. Stripe comes later.
6. **Email verification** — simple 6-digit code, not OAuth. Can use any SMTP provider.
