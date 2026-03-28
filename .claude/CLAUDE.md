# ClawLens Development Guidelines

## Product Standards
- This is an open-source product. All code must be production-quality.
- No hacks, no workarounds, no "good enough" shortcuts.
- Fix root causes, not symptoms. If something is broken, fix it properly.
- Every fix must be the professional, correct solution — not a patch.

## Architecture
- TypeScript monorepo (pnpm workspaces)
- `packages/server` — Express + better-sqlite3 + zod
- `packages/dashboard` — React + Vite + Tailwind
- `packages/plugin` — Claude Code plugin (hooks + scripts)
- `scripts/` — Enforcement and deployment scripts

## Testing
- Run `pnpm --filter @clawlens/server test` before every commit
- All API changes must have corresponding tests
- Test on Docker containers (clawlens-dev1/2/3) for integration

## Spec
- Design spec: `docs/superpowers/specs/2026-03-28-clawlens-v02-design.md`
- Build checklist: `CHECKLIST.md`
- Dashboard test checklist: `DASHBOARD-TEST-CHECKLIST.md`
