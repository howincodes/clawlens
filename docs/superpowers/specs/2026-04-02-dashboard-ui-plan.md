# HowinLens Dashboard UI — Complete Micro Flow Plan

Every page, every component, every interaction. Nothing skipped.

---

## 1. Sidebar Navigation (Updated)

```
Overview          — team dashboard with live stats
Users             — user list with roles, watch status, subscriptions
Projects          — project cards with member count, task count
Tasks             — task board with filters
Subscriptions     — subscription credential management with usage
Activity          — activity feed (admin: any user, dev: own)
Analytics         — charts and metrics
AI Intelligence   — developer profiles, team pulse
Prompts Browser   — search/filter prompts
Roles             — manage roles and permissions (admin only)
Audit Log         — hook event log
Settings          — system settings
```

Remove: "Summaries" (merged into AI Intelligence), "Sub Manager" (rename to "Subscriptions")

---

## 2. Login Page

**Current:** Email + password fields. ✅ Working.

**Add:**
- App name "HowinLens" with subtle branding
- "Forgot password" link (placeholder for now)
- Show role after login success in toast/redirect

---

## 3. Overview Page (Complete Rewrite)

**Current:** Old v0.2 team overview. Needs full rewrite.

**New layout:**

```
┌─────────────────────────────────────────────────────┐
│  Welcome, {user.name}                    {role badge}│
├──────────┬──────────┬──────────┬───────────────────── │
│ 👥 Users │ 📁 Proj  │ ✅ Tasks │ 🟢 On Watch        │
│    8     │    3     │   24     │    5/8              │
├──────────┴──────────┴──────────┴───────────────────── │
│                                                       │
│  Subscription Usage (live bars)                       │
│  ┌─────────────────────────────────────┐              │
│  │ sub1@email.com  ████████░░ 80% (5h) │ 3 users    │
│  │ sub2@email.com  ███░░░░░░░ 30% (5h) │ 2 users    │
│  │ sub3@email.com  █░░░░░░░░░ 10% (5h) │ 0 users    │
│  └─────────────────────────────────────┘              │
│                                                       │
│  Recent Activity                                      │
│  • Dev A went On Watch (2 min ago)                    │
│  • Dev B completed task "Build API" (15 min ago)      │
│  • Dev C pushed 3 commits (1h ago)                    │
│                                                       │
│  Users (quick view)                                   │
│  ┌──────┬────────┬────────┬──────────┬──────────────┐ │
│  │ Name │ Status │ Watch  │ Sub      │ Last Active  │ │
│  │ DevA │ active │ 🟢 On  │ sub1@... │ 2 min ago    │ │
│  │ DevB │ active │ ⚫ Off │ —        │ 1h ago       │ │
│  └──────┴────────┴────────┴──────────┴──────────────┘ │
│                                                       │
│  Projects (quick view)                                │
│  ┌────────────────┬───────┬────────┬─────────────┐    │
│  │ Project        │ Tasks │ Active │ Members     │    │
│  │ Payment Service│ 12    │ 5 open │ 3           │    │
│  │ Auth Module    │ 8     │ 3 open │ 2           │    │
│  └────────────────┴───────┴────────┴─────────────┘    │
└───────────────────────────────────────────────────────┘
```

**Data needed:**
- `GET /auth/me` — user info
- `GET /users` — user list with watch/subscription status
- `GET /projects` — project list
- `GET /tasks?projectId=all` or aggregate — task counts
- `GET /subscriptions/usage` — live usage
- `GET /subscriptions/credentials` — assignments

---

## 4. Users Page (Enhanced)

**Current:** User cards with basic stats.

**Add to each user card:**
- Role badge (Admin / PM / Developer / Viewer)
- Watch status indicator (🟢 On / ⚫ Off)
- Current subscription email (if assigned)
- GitHub ID
- Last active timestamp
- Projects they belong to (count or list)

**Add to page:**
- "Add User" button → modal with: name, email, password, role, GitHub ID
- Bulk actions: assign role, assign to project
- Filter by: role, watch status, project

**User card layout:**
```
┌────────────────────────────────────────┐
│ 👤 Dev Name              [Admin] badge │
│ dev@email.com                          │
│ GitHub: @devname                       │
│ ──────────────────────────────────     │
│ Watch: 🟢 On    Sub: sub1@email.com    │
│ Projects: Payment, Auth (2)            │
│ Last active: 2 min ago                 │
│ [Edit] [Assign Role] [View Detail]     │
└────────────────────────────────────────┘
```

---

## 5. UserDetail Page (Enhanced)

**Current:** v0.2 user detail with prompts/sessions/limits.

**Add tabs or sections:**
- **Profile** — name, email, GitHub ID, role, status, created date
- **Watch & Subscription** — current watch status, assigned subscription, watch history
- **Activity** — file events, app tracking, work windows (from activity endpoints)
- **Projects** — projects user belongs to, their role per project
- **Tasks** — tasks assigned to this user across all projects
- **Prompts** — existing prompt browser (keep)
- **Sessions** — existing session list (keep)
- **Limits** — existing rate limits (keep)

**Add actions:**
- Change role dropdown
- Assign/remove from project
- Rotate subscription
- Revoke credential (kill)
- View watcher status

---

## 6. Projects Page (New)

**Not just a dropdown in Tasks page — needs its own page.**

**Layout:**
```
┌──────────────────────────────────────────────┐
│ Projects                    [+ New Project]  │
│                                              │
│ ┌──────────────────────────────────────────┐ │
│ │ 📁 Payment Service          [active]     │ │
│ │ Payment processing API                   │ │
│ │ github.com/howin/payment-service         │ │
│ │ 3 members • 12 tasks (5 open)            │ │
│ │ [View] [Edit] [Members]                  │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│ ┌──────────────────────────────────────────┐ │
│ │ 📁 Auth Module               [active]    │ │
│ │ Authentication and authorization         │ │
│ │ github.com/howin/auth-module             │ │
│ │ 2 members • 8 tasks (3 open)             │ │
│ │ [View] [Edit] [Members]                  │ │
│ └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

**Create Project modal:**
- Name (required)
- Description
- Initial members (multi-select from users)

**Note:** One project can have MULTIPLE repositories (frontend, backend, app, etc). GitHub Repo URL is NOT a single field on the project — it's a list. Repos are managed in the project Settings tab.

---

### Project Repositories (Multi-Repo)

Each project has a **Repositories** section (in Settings tab or its own tab):

```
┌──────────────────────────────────────────────────┐
│ Repositories                     [+ Add Repo]    │
│                                                  │
│ 📦 payment-service (backend)                     │
│    github.com/howin/payment-service              │
│    [Remove]                                      │
│                                                  │
│ 📦 payment-dashboard (frontend)                  │
│    github.com/howin/payment-dashboard            │
│    [Remove]                                      │
│                                                  │
│ 📦 payment-app (mobile)                          │
│    github.com/howin/payment-app                  │
│    [Remove]                                      │
└──────────────────────────────────────────────────┘
```

**Add Repo modal:** GitHub URL, label (backend/frontend/app/other)

---

## 7. ProjectDetail Page (Enhanced)

**Current:** Has Tasks, Members, Milestones, AI Generate tabs.

**Add:**
- **Settings tab** — edit name, description, GitHub URL, manage custom task statuses (CRUD), archive project
- **Members tab** — show role per member, add/remove with role picker
- **Overview section** at top — task count breakdown (open/in-progress/done/blocked), member count, recent activity

---

## 8. Tasks Page (Enhanced)

**Current:** Basic list with project dropdown, status filter, create form.

**Add:**
- Assignee column with avatar/name
- Effort badge (XS/S/M/L/XL)
- Milestone filter dropdown
- Assignee filter dropdown
- Search box (filter by title)
- Sort by: priority, created date, updated date
- Task count summary bar: "24 tasks: 10 open, 8 in progress, 5 done, 1 blocked"
- Click row → navigates to TaskDetail page

---

## 9. TaskDetail Page (Enhanced)

**Current:** Has edit, subtasks, comments, activity.

**Add:**
- Assignee display with avatar
- Milestone display
- Project name link
- Created by / created date
- GitHub Issue link (if synced)
- Better activity log formatting (icons per action type)

---

## 10. Subscriptions Page (Rewrite — merge old + new)

**Current:** Two separate pages — old "Subscriptions" (v0.2 email list) and new "SubscriptionsManager" (credentials).

**Merge into one page with two sections:**

**Section 1: Subscription Credentials (live)**
```
┌─────────────────────────────────────────────────┐
│ 📧 sub1@email.com            [Max] [Active]     │
│                                                  │
│ 5-Hour:  ████████░░ 80%    Resets in 2h 15m     │
│ 7-Day:   ███░░░░░░░ 30%    Resets in 3d 12h     │
│ Opus:    ██████░░░░ 60%                          │
│ Sonnet:  ██░░░░░░░░ 20%                          │
│                                                  │
│ Active Users: DevA, DevB, DevC                   │
│ [Rotate Users] [Revoke All] [Remove Credential]  │
└─────────────────────────────────────────────────┘
```
Auto-refreshes every 30 seconds.

**Section 2: User ↔ Subscription Assignments**
```
┌──────────┬─────────────────┬────────────┐
│ User     │ Subscription    │ Actions    │
│ DevA     │ sub1@email.com  │ [Rotate]   │
│ DevB     │ sub1@email.com  │ [Revoke]   │
│ DevC     │ sub2@email.com  │ [Rotate]   │
│ DevD     │ (none)          │ [Assign]   │
└──────────┴─────────────────┴────────────┘
```

---

## 11. Roles & Permissions Page (New)

```
┌──────────────────────────────────────────────────┐
│ Roles & Permissions                [+ New Role]  │
│                                                  │
│ ┌──────────────────────────────────────────────┐ │
│ │ 🔑 Admin                    [System] [4 users]│ │
│ │ Full system access                           │ │
│ │ Permissions: 26/26 ████████████████ All      │ │
│ │ [View Permissions] [Edit]                    │ │
│ └──────────────────────────────────────────────┘ │
│                                                  │
│ │ 🔑 Project Manager          [System] [2 users]│
│ │ Manage tasks, projects, and team             │ │
│ │ Permissions: 12/26 ██████░░░░░░               │
│ │ [View Permissions] [Edit]                    │ │
│                                                  │
│ │ 🔑 Developer                [System] [5 users]│
│ │ View and update own work                     │ │
│ │ Permissions: 5/26  ██░░░░░░░░░░               │
│ │ [View Permissions] [Edit]                    │ │
└──────────────────────────────────────────────────┘

Permission Matrix (expanded):
┌───────────────────┬───────┬────┬─────┬────────┐
│ Permission        │ Admin │ PM │ Dev │ Viewer │
│ users.manage      │  ✅   │ ❌ │ ❌  │   ❌   │
│ users.view        │  ✅   │ ✅ │ ❌  │   ✅   │
│ tasks.create      │  ✅   │ ✅ │ ❌  │   ❌   │
│ tasks.view        │  ✅   │ ✅ │ ✅  │   ✅   │
│ salary.manage     │  ✅   │ ❌ │ ❌  │   ❌   │
│ ...               │       │    │     │        │
└───────────────────┴───────┴────┴─────┴────────┘
```

**Create Role modal:** name, description, permission checkboxes grouped by category.

---

## 12. Activity Page (Enhanced)

**Current:** Shows own activity only.

**For Admin:** Add user selector dropdown at top — view any user's activity.

**Layout:**
```
┌──────────────────────────────────────────────┐
│ Activity           [User: All ▼] [Date: Today]│
│                                               │
│ Summary Cards                                 │
│ ┌─────────┬──────────┬──────────┬──────────┐ │
│ │ 4h 30m  │ 156      │ 12       │ 3        │ │
│ │ Worked  │ Files    │ Prompts  │ Commits  │ │
│ └─────────┴──────────┴──────────┴──────────┘ │
│                                               │
│ Work Windows                                  │
│ 09:15 ─ 10:30  │ file_watch │ 45 events      │
│ 10:45 ─ 12:00  │ prompt     │ 23 events      │
│ 13:30 ─ 15:45  │ file_watch │ 67 events      │
│                                               │
│ App Usage                                     │
│ VS Code          2h 15m  ███████████████       │
│ Chrome           1h 30m  █████████             │
│ Terminal         0h 45m  ████                   │
│                                               │
│ Watch Events                                  │
│ 09:10 🟢 On Watch (tray)                      │
│ 12:05 ⚫ Off Watch (auto)                     │
│ 13:25 🟢 On Watch (cli)                       │
│ 17:35 ⚫ Off Watch (tray)                     │
└──────────────────────────────────────────────┘
```

---

## 13. Analytics Page (Enhanced)

**Current:** v0.2 analytics with prompt/credit charts.

**Add:**
- Task metrics: tasks created/completed per day chart
- Activity metrics: work hours per user per day
- Subscription usage trends chart
- Top users by: prompts, tasks completed, work hours
- Project breakdown: which project gets most AI usage

---

## 14. Settings Page (Enhanced)

**Current:** Stub with password change (501).

**New sections:**
- **Profile** — edit own name, email, password
- **System** — admin only: default role for new users, work schedule defaults
- **Danger Zone** — admin only: export all data, delete all data

---

## 15. AddUserModal (Enhanced)

**Current:** Name + slug.

**New fields:**
- Name (required)
- Email (required)
- Password (required)
- Role (dropdown: Admin, PM, Developer, Viewer)
- GitHub ID (optional)
- Assign to projects (multi-select, optional)

---

## 16. Components Needed

- **RoleBadge** — colored badge: Admin (red), PM (blue), Developer (green), Viewer (gray)
- **WatchStatusIndicator** — 🟢/⚫ dot with "On Watch"/"Off Watch" text
- **UsageBar** — reusable progress bar with color thresholds (green/yellow/red)
- **PermissionMatrix** — checkbox grid: roles × permissions
- **CreateProjectModal** — name, description, GitHub URL, initial members
- **AssignRoleModal** — select role for a user (global or per-project)
- **UserSelector** — dropdown to pick a user (used in Activity, Tasks filters)
- **ProjectSelector** — dropdown to pick a project

---

## Implementation Order

1. Shared components (RoleBadge, WatchStatusIndicator, UsageBar, selectors)
2. Overview page (rewrite)
3. Projects page (new)
4. Roles & Permissions page (new)
5. Users page (enhance — add role, watch, subscription display)
6. UserDetail page (enhance — add tabs)
7. AddUserModal (enhance — add email, password, role, GitHub ID)
8. Subscriptions page (merge old + new)
9. Tasks page (enhance — filters, assignee, search)
10. ProjectDetail page (enhance — settings tab)
11. Activity page (enhance — user selector, admin view)
12. Analytics page (enhance — task/activity metrics)
13. Settings page (enhance — profile, system)
14. Sidebar update (reorder, add Projects, Roles)
