# Scope 4: Tracking System (Non-AI Work Detection) — Raw Ideas

## Core Concept
Track all developer work, not just AI-assisted work. "Work" is defined by observable output (file changes, commits, prompts, task activity), not screen time. App/window tracking is supplementary context, not a work measure.

## Monitoring Level: Moderate
- Local file watcher (detects file saves in project directories)
- Active window/app tracking with window titles (context, not work measurement)
- No screenshots, no keylogging, no keystroke counting

## What Counts as "Work"
- File saved in a watched project directory
- Git commit (local or pushed)
- Prompt/session activity (Claude Code, Codex, Antigravity)
- Task update/comment in ClawLens
- PR created/reviewed on GitHub
- **NOT counted:** app open time, window focus time — these are context only

## Project Directory Discovery (priority chain)
1. **Auto from hooks (C)** — SessionStart sends `cwd`, client reads `.git/config` remote URL, matches to project repo in ClawLens. Auto-links directory. Zero friction.
2. **Background scan (B)** — client periodically scans common dev directories, matches `.git/config` remotes to known project repos. Catches repos used without AI.
3. **Manual fallback (A)** — user links local folder to project in client app. Escape hatch for edge cases.

## File Watcher
- Monitors linked project directories for file changes
- Records: file path, timestamp, change type (create/modify/delete), file size delta
- Batches events (debounce rapid saves) and syncs to server periodically
- Only watches project-linked directories, not entire filesystem
- Ignores: node_modules, .git, build output, other standard excludions

## Window/App Tracking (Context Only)
- Tracks active app + window title
- "VS Code — auth.ts" → knows they were editing auth.ts
- "Chrome — GitHub PR #42" → correlates to specific task/PR
- Used for: enriching activity timeline, understanding workflow patterns
- NOT used for: calculating work hours or attendance

## Work Hours Calculation: Activity Window Bucketing
- Group activity events into work windows
- If gap between events > threshold (admin-configurable, e.g. 30 min) → new window
- Example: saves at 9:15, 9:30 → window 9:15-9:30. Gap. Saves at 10:45, 11:00 → window 10:45-11:00. Total: 1h30m, not 1h45m.
- Fair, auditable, hard to game

## Data Model (rough)
- `file_events` — user_id, project_id, file_path, event_type (create/modify/delete), timestamp, size_delta
- `activity_windows` — user_id, project_id, date, window_start, window_end, source (file_watch/git/prompt/task), event_count
- `app_tracking` — user_id, app_name, window_title, started_at, duration_seconds, date
- `project_directories` — user_id, project_id, local_path, discovered_via (hook_auto/scan/manual), linked_at
- `tracking_config` — gap_threshold_minutes, scan_directories, excluded_patterns

## Privacy & Trust
- No screenshots, no keylogging
- Window titles visible to admin but framed as workflow context
- File watcher only tracks metadata (path, timestamp, size) — NOT file contents
- Developer can see their own tracking data in the client app (transparency)

## Open Questions
- Should devs be able to pause tracking temporarily? (lunch, personal break)
- How to handle pair programming / mob programming? (two people, one machine)
- Meeting time tracking — integrate with calendar API or manual entry?
- Should the file watcher run as part of the existing watcher daemon or as a separate process?
