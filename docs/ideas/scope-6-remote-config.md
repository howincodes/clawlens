# Scope 6: Remote Config Control — Raw Ideas

## Core Concept
Full remote control of developer's Claude Code and Codex environment from the ClawLens dashboard. Admin edits config → server pushes to client → client writes to local settings files → confirms back to server.

## What Can Be Controlled
- **Model control** — force which AI model users use (e.g. switch team to Sonnet for cost savings)
- **Permission/tool control** — enable/disable specific tools (Bash, Edit, Write), set allowed directories
- **Hook management** — add/remove/update hooks remotely
- **Settings override** — push any arbitrary settings.json or managed-settings.d values
- Full control of Claude Code and Codex configuration from dashboard

## Delivery Mechanism: WebSocket + Poll Fallback
- **Primary:** Push via WebSocket — server sends config change, client applies immediately. Near real-time.
- **Fallback:** HTTP poll — client periodically checks for pending config changes. Catches anything missed if WebSocket was disconnected.
- Both mechanisms already exist in the watcher infrastructure — extend them.

## Developer Notification Policy (admin-configurable)
- **Option: Silent** — config changes apply without notification
- **Option: Notify but enforce** — desktop notification ("Admin changed your model to Sonnet"), cannot override. Admin can include a message explaining why.
- Admin chooses notification policy globally or per config change
- Default: notify but enforce (transparency builds trust)

## Config Lifecycle
1. Admin opens config editor in dashboard
2. Selects target: specific user, project members, or everyone
3. Edits config values (model, permissions, tools, hooks, arbitrary settings)
4. Previews diff of what will change
5. Applies → server stores new config version + pushes to targets
6. Client receives → writes to local settings files → confirms back to server
7. Dashboard shows: applied, pending (client offline), or failed
8. Developer gets notification (if policy = notify)

## Audit & Versioning
- Every config change recorded: who changed what, when, for whom, previous value
- Config version history per user — can rollback to previous version
- Dashboard shows current config state per user (what's actually on their machine)
- Tamper detection: if developer manually edits a remotely-managed setting, server detects on next sync

## Targeting
- Per user — change config for specific person
- Per project — all members of a project get the change
- Global — everyone in the org
- Precedence: user-specific > project > global

## Data Model (rough)
- `config_templates` — id, name, description, config_json, created_by, created_at (reusable presets)
- `config_deployments` — id, template_id (nullable), target_type (user/project/global), target_id, config_json, deployed_by, deployed_at, message
- `config_state` — user_id, current_config_json, last_applied_at, last_confirmed_at, version
- `config_history` — user_id, config_json, changed_by, changed_at, change_type (remote_push/rollback/tamper_detected), previous_version

## Open Questions
- Should there be a "config lock" — prevent specific settings from being changed remotely? (e.g. user's personal keybindings)
- How to handle conflicts between remote config and enforced mode (managed-settings.d)?
- Config templates / presets? (e.g. "Cost Saver" preset = Sonnet model + stricter limits)
- Should project-level config auto-apply when user is assigned to project?
