# HowinLens — Credential Delivery Specification

> Discovered and tested: 2026-04-02
> Status: CONFIRMED on macOS, Linux, and Windows. All 3 platforms tested.

---

## How Claude Code Stores Credentials — Per Platform

### macOS

**Tokens:** macOS Keychain
```
Service name: "Claude Code-credentials"
Account name: <macOS username>  (e.g. "basha")
Value: JSON string (see format below)
```

**Account metadata:** `~/.claude.json`
```
Key: "oauthAccount"
Value: { accountUuid, emailAddress, organizationUuid, displayName, organizationName, ... }
```

**Read credentials:**
```bash
/usr/bin/security find-generic-password -s "Claude Code-credentials" -a "<username>" -w
```

**Write credentials:**
```bash
# Delete old entry first (required — add-generic-password won't overwrite)
security delete-generic-password -s "Claude Code-credentials" -a "<username>" 2>/dev/null
security add-generic-password -s "Claude Code-credentials" -a "<username>" -w '<json>'
```

**Fallback:** Claude Code also checks `~/.claude/.credentials.json` if Keychain entry is missing.

### Linux

**Tokens:** `~/.claude/.credentials.json` (mode 0600)

**Account metadata:** `~/.claude.json`
```
Key: "oauthAccount"
Value: { accountUuid, emailAddress, organizationUuid, displayName, organizationName, ... }
```

**Write credentials:**
```bash
cat > ~/.claude/.credentials.json << 'EOF'
<json>
EOF
chmod 600 ~/.claude/.credentials.json
```

### Windows (CONFIRMED)

**Tokens:** `%USERPROFILE%\.claude\.credentials.json` (inherits user profile ACL)

**Account metadata:** `%USERPROFILE%\.claude.json`
```
Key: "oauthAccount"
Value: { accountUuid, emailAddress, organizationUuid, displayName, organizationName, ... }
```

**Write credentials (PowerShell):**
```powershell
[System.IO.File]::WriteAllText("$env:USERPROFILE\.claude\.credentials.json", $credsJson)
```

**Write metadata (PowerShell):**
```powershell
$j = Get-Content "$env:USERPROFILE\.claude.json" -Raw | ConvertFrom-Json
if ($j.PSObject.Properties['oauthAccount']) {
    $j.oauthAccount = $metaObject
} else {
    $j | Add-Member -NotePropertyName 'oauthAccount' -NotePropertyValue $metaObject -Force
}
$j | ConvertTo-Json -Depth 10 | Set-Content "$env:USERPROFILE\.claude.json"
```

**Note:** After `claude auth logout`, the `oauthAccount` property is removed from `.claude.json`. Use `Add-Member` with `-Force` to recreate it.

**Custom path:** `%CLAUDE_CONFIG_DIR%\.credentials.json`

---

## Credential JSON Format

```json
{
  "claudeAiOauth": {
    "accessToken": "sk-ant-oat01-...",
    "refreshToken": "sk-ant-ort01-...",
    "expiresAt": 1775167047591,
    "scopes": [
      "user:file_upload",
      "user:inference",
      "user:mcp_servers",
      "user:profile",
      "user:sessions:claude_code"
    ],
    "subscriptionType": "team",
    "rateLimitTier": "default_raven"
  }
}
```

**Key fields:**
- `expiresAt`: UNIX milliseconds (number), NOT ISO string
- `accessToken` prefix: `sk-ant-oat01-` (short-lived, ~1-2h)
- `refreshToken` prefix: `sk-ant-ort01-` (long-lived, ~30 days)
- `subscriptionType`: "max", "team", "pro", etc.
- `rateLimitTier`: "default_raven" (team), "default_claude_max_5x" (max), etc.
- All 5 scopes must be present

---

## Account Metadata Format (oauthAccount in ~/.claude.json)

```json
{
  "oauthAccount": {
    "accountUuid": "0280ee77-10db-454d-8baa-9e2ffeb32988",
    "emailAddress": "ai1@howincloud.com",
    "organizationUuid": "be5d7037-dd46-43cb-9207-2192f11a38ac",
    "displayName": "HOWIN TEAM AI 1",
    "organizationRole": "user",
    "workspaceRole": null,
    "organizationName": "Howincloud",
    "hasExtraUsageEnabled": false,
    "billingType": "stripe_subscription"
  }
}
```

This is what `claude auth status` reads. Without it, email shows `null` (but API calls still work).

---

## OAuth Token Refresh

**Endpoint:** `POST https://platform.claude.com/v1/oauth/token`
**Content-Type:** `application/json` (NOT form-urlencoded — confirmed from source code)
**Auth method:** none (public client)

```bash
curl -X POST "https://platform.claude.com/v1/oauth/token" \
  -H "Content-Type: application/json" \
  -d '{
    "grant_type": "refresh_token",
    "refresh_token": "sk-ant-ort01-...",
    "client_id": "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
    "scope": "user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload"
  }'
```

**Client ID:** `9d1c250a-e61b-44d9-88ed-5944d1962f5e` (from `constants/oauth.ts`)

**Expected response** (from source `OAuthTokenExchangeResponse`):
```json
{
  "access_token": "sk-ant-oat01-...",
  "refresh_token": "sk-ant-ort01-...",
  "expires_in": 3600,
  "scope": "user:profile user:inference ...",
  "account": { "uuid": "...", "email_address": "..." },
  "organization": { "uuid": "..." }
}
```

New `expiresAt` = `Date.now() + expires_in * 1000` (computed client-side).

**Refresh logic** (from `utils/auth.ts:1427`):
- 5-minute buffer before expiry triggers proactive refresh
- Filesystem lock prevents concurrent refresh races across processes
- On 401: clears cache, re-reads from disk, refreshes if same token
- Retries up to 5 times with 1-2s random backoff

**Status:** FULLY CONFIRMED (2026-04-02). Tested via Node.js `https` module from VPS.

**Actual response (tested):**
```json
{
  "access_token": "sk-ant-oat01-MPUCWRCF1bgQ...",
  "refresh_token": "sk-ant-ort01-mA1DISKTKfr4...",
  "expires_in": 28800,
  "scope": "user:file_upload user:inference user:mcp_servers user:profile user:sessions:claude_code",
  "account": { "uuid": "7f5c6bf6-...", "email_address": "ai4@howincloud.com" },
  "organization": { "uuid": "be5d7037-...", "name": "Howincloud" }
}
```

**Critical findings from live test:**
- **Refresh token ROTATES on every refresh** — must save the new refresh_token, old one becomes invalid
- **Access token lasts 8 hours** (`expires_in: 28800`), not 1-2h as originally assumed
- **Account + org metadata included in response** — no separate profile API call needed
- **curl gets rate-limited aggressively** — Node.js `https` module works fine (different TLS fingerprint)
- New `expiresAt` = `Date.now() + expires_in * 1000`

---

## Credential Rotation — Complete Recipe

### To assign/rotate credentials to a developer machine:

**Step 1:** Write the credential JSON (tokens + scopes + metadata)

| Platform | Where to write |
|----------|---------------|
| macOS | Keychain: `security delete-generic-password -s "Claude Code-credentials" -a "<user>" && security add-generic-password -s "Claude Code-credentials" -a "<user>" -w '<json>'` |
| Linux | File: `~/.claude/.credentials.json` (chmod 600) |
| Windows | File: `~/.claude/.credentials.json` (or `%CLAUDE_CONFIG_DIR%`) |

**Step 2:** Update account metadata in `~/.claude.json`

```bash
# Read current .claude.json, update oauthAccount field, write back
# Use node/jq/python — don't clobber other fields
```

The `oauthAccount` object must include at minimum:
- `accountUuid`
- `emailAddress`
- `organizationUuid`
- `displayName`
- `organizationName`

**Step 3:** No restart needed. Claude Code reads new credentials on the next prompt.

---

## Tested Behaviors

| Behavior | Result | Platform | Details |
|----------|--------|----------|---------|
| External credential write | PASS | All 3 | Write to keychain/file → CC accepts immediately |
| Rotation between accounts | PASS | All 3 | Swap creds + metadata → next `claude -p` uses new account |
| Cross-machine token use | PASS | All 3 | Token created in Docker on VPS, used on Mac + Windows |
| Hot-swap while streaming | PASS | macOS | Current response finishes, next prompt uses new creds |
| Delete while streaming | PASS | macOS | Current response finishes, next prompt says "Not logged in" |
| `claude auth logout` | Revokes server-side | All 3 | Old tokens get 401 "Invalid bearer token" |
| Missing oauthAccount | Cosmetic only | All 3 | `auth status` shows email=null, but API calls work |
| `auth status` without network | Works | Linux | Reads cached oauthAccount from ~/.claude.json |
| oauthAccount after logout | Property removed | Windows | Must use Add-Member -Force to recreate |
| Token refresh via API | PASS | VPS (Node.js) | Returns new access+refresh tokens, 8h expiry, account metadata |
| Refresh token rotates | CONFIRMED | VPS | Old refresh token invalid after refresh — must save new one |
| Usage API polling | PASS | VPS | `api.anthropic.com/api/oauth/usage` returns 5h/7d utilization % |
| No revocation API | CONFIRMED | Source code | Logout = local delete only. No server-side revoke endpoint |
| OAuth code exchange | PASS | VPS (Node.js) | Server generates URL → admin logs in → pastes code → server gets tokens |

---

## Usage API (CONFIRMED WORKING)

**Endpoint:** `GET https://api.anthropic.com/api/oauth/usage`
**Auth:** `Authorization: Bearer <accessToken>`
**Required header:** `anthropic-beta: oauth-2025-04-20`

**Tested response (from VPS, 2026-04-02):**
```json
{
  "five_hour": { "utilization": 12.0, "resets_at": "2026-04-02T19:00:00.833694+00:00" },
  "seven_day": { "utilization": 2.0, "resets_at": "2026-04-09T14:00:00.833718+00:00" },
  "seven_day_opus": null,
  "seven_day_sonnet": null,
  "extra_usage": { "is_enabled": false, "monthly_limit": null, "used_credits": null, "utilization": null }
}
```

**Key insight:** This endpoint is on `api.anthropic.com` (no Cloudflare challenge), NOT `claude.ai`. Our earlier Test 2.1 failed because we were hitting `claude.ai/api/*`. The correct endpoint works with a simple Bearer token.

**This means Approach A (Usage polling via API) IS VIABLE after all.**

**Usage fields explained:**
- `five_hour.utilization`: Percentage of 5-hour rate limit used (e.g. 12.0 = 12%)
- `seven_day.utilization`: Percentage of 7-day rate limit used
- `seven_day_opus` / `seven_day_sonnet`: Per-model breakdowns (null if not applicable)
- `extra_usage`: Overage/extra credits info (team/enterprise)
- `resets_at`: ISO timestamp when the rate limit window resets

---

## Token Revocation

**No explicit revocation endpoint exists.** From source code analysis:

- `claude auth logout` just deletes local credentials (keychain + file + oauthAccount)
- Server revokes old tokens implicitly when a new login happens
- API returns `403` with `"OAuth token has been revoked"` for revoked tokens
- Claude Code handles this in `isOAuthTokenRevokedError()` — treats same as 401

**For our vault:** To revoke access from a developer, either:
1. Stop pushing new accessTokens (they expire in ~1-2h)
2. Delete credentials from their machine via the client app
3. There's no server-side "revoke this refreshToken" API we can call

---

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `CLAUDE_CONFIG_DIR` | Override `~/.claude` path for credential file |
| `ANTHROPIC_API_KEY` | Takes precedence over OAuth (sent as X-Api-Key) |
| `ANTHROPIC_AUTH_TOKEN` | Bearer token override (for LLM gateway/proxy) |
| `CLAUDE_CODE_API_KEY_HELPER_TTL_MS` | Custom refresh interval for apiKeyHelper |

---

## Server-Side OAuth Code Exchange (CONFIRMED)

The server can generate OAuth URLs and exchange authorization codes for tokens.
No `claude auth login` CLI needed. This enables the dashboard "Add Subscription" and "Re-authenticate" flows.

**Step 1: Generate auth URL (server-side)**
```javascript
const codeVerifier = crypto.randomBytes(32).toString('base64url');
const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
const state = crypto.randomBytes(32).toString('base64url');

const authUrl = `https://claude.com/cai/oauth/authorize?` +
  `code=true&client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e&` +
  `response_type=code&` +
  `redirect_uri=${encodeURIComponent('https://platform.claude.com/oauth/code/callback')}&` +
  `scope=${encodeURIComponent('user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload')}&` +
  `code_challenge=${codeChallenge}&code_challenge_method=S256&state=${state}`;

// Store codeVerifier + state in DB/session — needed for exchange
```

**Step 2: Admin opens URL → logs in → gets redirected to callback page showing `code#state`**

**Step 3: Exchange code for tokens (server-side)**
```javascript
const response = await fetch('https://platform.claude.com/v1/oauth/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    grant_type: 'authorization_code',
    code: authorizationCode,        // part before #
    redirect_uri: 'https://platform.claude.com/oauth/code/callback',
    client_id: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
    code_verifier: codeVerifier,     // from step 1
    state: state                     // from step 1
  })
});
// Response: { access_token, refresh_token, expires_in: 28800, account: {uuid, email_address}, organization: {uuid, name} }
```

**Key notes:**
- `code=true` in the auth URL triggers the manual redirect flow (shows code on page instead of localhost redirect)
- The callback page shows `code#state` — split on `#`, use only the code part
- `code_verifier` must match the `code_challenge` from the auth URL (PKCE)
- `state` must be included in the token exchange body
- Server stores `codeVerifier` + `state` temporarily while admin is logging in

---

## Security Notes

- `claude auth logout` revokes tokens server-side — old tokens cannot be reused
- accessToken is short-lived (~1-2h), refreshToken is long-lived (~30 days)
- On macOS, credentials are encrypted at rest via Keychain
- On Linux, credentials are plaintext in file (protected by 0600 permissions)
- refreshToken should be stored encrypted in our vault (AES-256-GCM)
- accessToken can be pushed to clients — if compromised, expires quickly
