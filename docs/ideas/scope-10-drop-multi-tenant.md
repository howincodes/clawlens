# Scope 10: Drop Multi-Tenant / SaaS Mode — Raw Ideas

## Decision
ClawLens is no longer open-source or SaaS. Single-organization deployment only.

## What Changes
- Remove `teams` table and `team_id` foreign key from all tables
- Remove `CLAWLENS_MODE=saas|selfhost` environment variable
- Remove `plan` table (SaaS billing plans)
- Remove team_id scoping from every database query
- Simplify auth: no team signup/onboarding flow
- Single admin password → proper RBAC system (Scope 1)
- Remove any multi-tenant isolation logic

## What This Enables
- Simpler data model (no team_id everywhere)
- Proper RBAC (custom roles + permissions) replaces team-based access
- Single org = single database, no partition concerns
- Easier to reason about data access patterns

## Migration
- Drop team_id columns (or stop using them — keep as null for safety)
- Existing data: assign all to a single implicit org
- Update all API endpoints to remove team context
- Update dashboard to remove team switching
