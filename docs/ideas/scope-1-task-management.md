# Scope 1: Task Management — Raw Ideas

## Core Concept
Full task management system built into ClawLens. PMs/Team Leads paste requirements or meeting notes (or upload docs), AI generates structured tasks, developers execute, ClawLens tracks progress automatically.

## Key Decisions
- **No multi-tenant / SaaS** — single org deployment, drop teams concept
- **RBAC** — custom roles with permission matrix (Admin creates roles, assigns granular permissions like manage_users, create_tasks, view_salary, etc.)
- **Projects** — first-class entity. Users assigned to projects with roles/permissions. Each project links to a GitHub repo.
- **GitHub IDs** — collected per user for git integration
- **GitHub Issues sync** — ClawLens is source of truth. Import existing Issues on first link, then one-way push to GitHub going forward.
- **Project permissions** — per-project, role-based (who can add tasks, assign, view, etc.)

## Task Lifecycle
1. PM/Team Lead inputs raw requirements or meeting notes (paste text or upload docs)
2. AI processes input → generates structured tasks with:
   - Title + description
   - Suggested priority
   - Estimated effort
   - Suggested assignee (from project's existing members, leveraging AI Intelligence developer profiles)
   - Grouped under milestones if applicable
3. Human reviews AI suggestions, approves/edits/rejects
4. Tasks published to project backlog
5. Tasks optionally synced to GitHub Issues on linked repo
6. Developers work on tasks
7. ClawLens correlates prompt activity + git commits to tasks

## Task-to-Activity Correlation
- Developer can manually set active task (via visible client or command)
- If not set, AI infers from cwd (maps to project/repo) + prompt content matching
- Both methods coexist — manual overrides AI inference

## Data Model (rough)
- `roles` — custom roles with names
- `permissions` — granular permission definitions
- `role_permissions` — which role has which permissions
- `user_roles` — user-to-role assignments (global or per-project)
- `projects` — name, description, linked repo, settings
- `project_members` — user + project + project-level role
- `tasks` — title, description, status, priority, effort, assignee, project, milestone, created_by, github_issue_id
- `task_comments` — threaded discussion on tasks
- `task_activity` — status changes, reassignments, etc. (audit trail)
- `milestones` — grouping for tasks within a project
- `requirement_inputs` — raw text/docs that AI processed to generate tasks

## Open Questions
- Task statuses: simple (open/in-progress/done) or customizable per project?
- Do we need subtasks / task dependencies?
- File upload storage: local disk or S3-compatible?
- Should AI re-analyze requirements if they're updated?
