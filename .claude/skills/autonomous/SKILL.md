---
name: autonomous
description: Autonomous execution of discussed plans, features, bug fixes, or any tasks using parallel sub-agents with senior engineer discipline. Use when the user says "execute", "go ahead", "do it", "start building", "implement this", "run the plan", or after a brainstorming/planning session when the user wants hands-off execution. Handles all project types (backend, frontend, infra, fullstack). Enforces no shortcuts, no hacks, thorough verification, and scalable architecture decisions.
---

# Autonomous Execution

Execute discussed tasks with senior engineer rigor using parallel sub-agents. No shortcuts. Nothing skipped. Everything verified.

## Execution Workflow

### Phase 0: Pre-flight

1. Ask the user: **"Would you like me to sleep the Mac after everything is done?"**
2. Remember the answer for Phase 4.

### Phase 1: Gather & Confirm

1. Review the full conversation to extract every task, requirement, and decision discussed with the user.
2. Build a numbered task list — every item matters, nothing is "minor" or "can do later."
3. Present the task list to the user for confirmation before proceeding.
4. Identify dependencies between tasks to determine execution order and parallelism opportunities.

### Phase 2: Execute

Launch sub-agents (Agent tool) for independent tasks in parallel. For dependent tasks, execute sequentially.

**For each task, the sub-agent MUST:**

- Read and understand all relevant existing code before making changes.
- Follow existing project patterns and conventions — never invent new patterns when established ones exist.
- Choose the scalable, recommended approach — not the quick hack.
  - Prefer proper abstractions over copy-paste.
  - Prefer database-level constraints over application-only validation.
  - Prefer proper error handling over silent failures.
  - Prefer proper typing over `any`.
  - Prefer migrations over manual DB changes.
  - Prefer proper state management over prop drilling through 5 levels.
- Write complete implementations — no TODOs, no "implement later" placeholders, no partial work.
- Handle edge cases, error states, and loading states.
- Follow the principle: "If it's worth doing, it's worth doing right."

**Sub-agent dispatch rules:**

- Always set a clear, detailed prompt — include file paths, requirements, and constraints.
- Use `subagent_type` matching the task domain when a specialized agent fits (e.g., `backend-development:backend-architect` for API design, `database-design:sql-pro` for queries).
- Group truly independent tasks into parallel Agent calls in a single message.
- Never fire-and-forget — always process each agent's result before moving on.

### Phase 3: Verify

After all tasks complete, run verification:

1. **Lint/Type check** — run the project's lint and type-check commands. Fix all errors.
2. **Tests** — run existing test suites. Fix any failures introduced by changes.
3. **Build** — ensure the project builds cleanly with no warnings.
4. **Browser testing** — if changes affect UI, use the `document-skills:webapp-testing` skill to launch Playwright and visually verify:
   - Pages render correctly.
   - User flows work end-to-end.
   - No console errors.
   - Responsive behavior if applicable.
5. **Manual review** — read through all changed files one final time to catch anything automated checks miss.

If any verification fails, fix the issue and re-verify. Do not skip failures.

### Phase 4: Report & Sleep

1. Present a summary of everything completed with file paths and brief descriptions.
2. List any issues encountered and how they were resolved.
3. If the user opted for sleep in Phase 0, run:
   ```bash
   pmset sleepnow
   ```

## Rules — Non-Negotiable

- **No hacks.** Every solution must be the proper, maintainable approach.
- **No skipping.** Every task in the list gets executed fully.
- **No laziness.** "I'll do this later" is not acceptable. Do it now.
- **No assumptions.** If something is unclear, ask the user before proceeding.
- **No silent failures.** Every error must be surfaced, diagnosed, and fixed.
- **Scalable decisions.** Always pick the approach that scales — proper indexing, normalized data, clean interfaces, separation of concerns.
- **Verify everything.** If it can be tested, test it. If it can be linted, lint it. If it can be built, build it.
