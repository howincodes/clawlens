---
name: clawlens-status
description: Check ClawLens connection status, credit usage, and hook registration
---

# ClawLens Status Check

When the user invokes this skill, perform these steps:

1. Check if the ClawLens environment variables are set:
   - `CLAUDE_PLUGIN_OPTION_SERVER_URL` — the ClawLens server URL
   - `CLAUDE_PLUGIN_OPTION_AUTH_TOKEN` — the auth token

2. If both are set, make a health check request:
   ```bash
   curl -sf "$CLAUDE_PLUGIN_OPTION_SERVER_URL/health"
   ```

3. If the server is reachable, check auth by calling:
   ```bash
   curl -sf -H "Authorization: Bearer $CLAUDE_PLUGIN_OPTION_AUTH_TOKEN" "$CLAUDE_PLUGIN_OPTION_SERVER_URL/api/v1/hook/session-start" -X POST -H "Content-Type: application/json" -d '{"session_id":"status-check","hook_event_name":"SessionStart","source":"status-check"}'
   ```

4. Display the status in a clean format:
   ```
   ClawLens Status
   ═══════════════
   Server:  https://clawlens.howincloud.com ✅ (or ❌ if unreachable)
   Auth:    Valid ✅ (or Invalid ❌)
   Hooks:   11 registered (check /hooks)
   ```

If the environment variables are not set, inform the user:
```
ClawLens is not configured. Install with:
  claude plugin install clawlens@howincodes
```
