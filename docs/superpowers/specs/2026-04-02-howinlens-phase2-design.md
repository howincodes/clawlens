# HowinLens Phase 2: Activity Tracking + Task Management — Design Spec

## Overview

Phase 2 adds activity tracking (file watcher, app tracking, project directory discovery) and a full task management system with AI-powered task generation. Builds on Phase 1's Electron client and server foundation.

## 2.1 — Database Schema Additions

### `tasks` table
```
id: serial PK
project_id: int FK → projects
title: varchar(500) NOT NULL
description: text
status: varchar(50) default 'open' — open/in_progress/done/blocked
priority: varchar(20) default 'medium' — low/medium/high/urgent
effort: varchar(20) — xs/s/m/l/xl
assignee_id: int FK → users nullable
milestone_id: int FK → milestones nullable
parent_task_id: int FK → tasks nullable (subtasks)
github_issue_id: int nullable
github_issue_url: varchar(500) nullable
created_by: int FK → users
created_at: timestamptz
updated_at: timestamptz
```

### `task_comments` table
```
id: serial PK
task_id: int FK → tasks
user_id: int FK → users
content: text NOT NULL
created_at: timestamptz
```

### `task_activity` table
```
id: serial PK
task_id: int FK → tasks
user_id: int FK → users
action: varchar(50) — status_changed/assigned/commented/created/priority_changed
old_value: varchar(255)
new_value: varchar(255)
created_at: timestamptz
```

### `milestones` table
```
id: serial PK
project_id: int FK → projects
name: varchar(200) NOT NULL
description: text
due_date: date nullable
status: varchar(20) default 'open'
created_at: timestamptz
```

### `task_status_configs` table (custom statuses per project)
```
id: serial PK
project_id: int FK → projects
name: varchar(100) NOT NULL
color: varchar(7) — hex color
position: int — sort order
is_done_state: boolean default false
```

### `requirement_inputs` table
```
id: serial PK
project_id: int FK → projects
input_type: varchar(20) — text/document
content: text
file_name: varchar(255) nullable
file_path: varchar(500) nullable
processed: boolean default false
created_by: int FK → users
created_at: timestamptz
```

### `ai_task_suggestions` table
```
id: serial PK
requirement_input_id: int FK → requirement_inputs
project_id: int FK → projects
suggested_tasks: jsonb — array of task suggestions
status: varchar(20) default 'pending' — pending/approved/rejected
reviewed_by: int FK → users nullable
reviewed_at: timestamptz nullable
created_at: timestamptz
```

### `file_events` table
```
id: serial PK
user_id: int FK → users
project_id: int nullable
file_path: text NOT NULL
event_type: varchar(20) — create/modify/delete
size_delta: int
timestamp: timestamptz
```

### `app_tracking` table
```
id: serial PK
user_id: int FK → users
app_name: varchar(200)
window_title: text
started_at: timestamptz
duration_seconds: int
date: date
```

### `project_directories` table
```
id: serial PK
user_id: int FK → users
project_id: int FK → projects
local_path: text NOT NULL
discovered_via: varchar(20) — hook_auto/scan/manual
linked_at: timestamptz
```

### `activity_windows` table
```
id: serial PK
user_id: int FK → users
project_id: int nullable
date: date
window_start: timestamptz
window_end: timestamptz
source: varchar(20) — file_watch/git/prompt/task
event_count: int
```

## 2.2 — Server API Endpoints

### Tasks
```
GET    /api/admin/tasks                     — list tasks (filter by project, assignee, status)
POST   /api/admin/tasks                     — create task
GET    /api/admin/tasks/:id                 — task detail with comments + activity
PUT    /api/admin/tasks/:id                 — update task
DELETE /api/admin/tasks/:id                 — delete task
POST   /api/admin/tasks/:id/comments        — add comment
GET    /api/admin/tasks/:id/activity        — task activity log
PUT    /api/admin/tasks/:id/assign          — assign task to user
PUT    /api/admin/tasks/:id/status          — change task status
```

### Milestones
```
GET    /api/admin/projects/:id/milestones   — list milestones
POST   /api/admin/projects/:id/milestones   — create milestone
PUT    /api/admin/milestones/:id            — update milestone
DELETE /api/admin/milestones/:id            — delete milestone
```

### AI Task Generation
```
POST   /api/admin/requirements              — submit requirements text or upload
GET    /api/admin/requirements/:id/suggestions — get AI-generated task suggestions
POST   /api/admin/requirements/:id/approve   — approve suggestions → create tasks
POST   /api/admin/requirements/:id/reject    — reject suggestions
```

### Activity Tracking
```
POST   /api/v1/client/file-events           — batch sync file change events
POST   /api/v1/client/app-tracking          — sync app usage data
GET    /api/v1/client/project-directories   — get known project directories for user
POST   /api/v1/client/project-directories   — register a discovered project directory
GET    /api/admin/activity/:userId          — activity timeline for user
GET    /api/admin/activity/windows/:userId  — activity windows for user
```

### Task Status Config
```
GET    /api/admin/projects/:id/statuses     — list custom statuses
POST   /api/admin/projects/:id/statuses     — create custom status
PUT    /api/admin/statuses/:id              — update status config
DELETE /api/admin/statuses/:id              — delete status config
```

### Client Task Endpoints
```
GET    /api/v1/client/tasks                 — my assigned tasks
PUT    /api/v1/client/tasks/:id/status      — quick status update
PUT    /api/v1/client/active-task           — set active task
```

## 2.3 — AI Task Generation Service

Uses existing `claude -p` wrapper (`claude-ai.ts`):

1. User submits requirements text or uploads document
2. Server stores in `requirement_inputs` table
3. AI service reads input + project context (members, existing tasks)
4. Generates structured suggestions: title, description, priority, effort, suggested assignee
5. Stores in `ai_task_suggestions` as JSONB
6. Admin reviews in dashboard → approve/edit/reject
7. Approved suggestions become real tasks

## 2.4 — Dashboard Pages

### Projects Page (enhance existing)
- Project cards with member count, task count, health indicator
- Click → project detail

### Project Detail Page (enhance existing)
- Members tab (existing)
- Tasks tab (new) — kanban or list view
- Milestones tab (new)
- Settings tab (custom statuses, GitHub link)

### Task Board Page (new)
- Kanban columns by status (or list view toggle)
- Drag-and-drop between columns
- Filter by assignee, priority, milestone
- Quick-create task form
- Click task → detail slide-over

### Task Detail Page (new)
- Title, description, status, priority, effort, assignee
- Comments thread
- Activity log
- Subtasks list
- Edit all fields inline

### AI Requirements Page (new)
- Text area to paste requirements / meeting notes
- Upload document button
- "Generate Tasks" button
- Review panel: list of AI suggestions with approve/edit/reject per item
- "Approve All" button
