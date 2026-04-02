# Scope 3: Git History Analysis — Raw Ideas

## Core Concept
Collect and analyze git history per developer. Correlate with prompts, sessions, and tasks to build a complete picture of what was built, when, and by whom. Primary source of truth for developer work verification.

## Data Sources

### GitHub API (v0.3 primary)
- Webhook on push events from linked project repos
- Pull commit history, PR data, review activity
- Uses GitHub ID collected per user + repo linked per project
- Catches: all pushed commits, PRs, reviews, issues

### Local Git Tracking (future, ties to tracking system scope)
- Client-side monitoring of local git repos
- Catches: unpushed commits, uncommitted changes, file modification times
- Solves the "committed everything at EOD" problem
- Needs dedicated discussion in tracking system scope

## What We Extract & Show

### Activity Timeline
- Contribution graph (when, how frequently, which repos)
- Daily/weekly/monthly commit patterns
- Active hours derived from commit timestamps

### Work Content Analysis (AI-powered)
- AI reads commit diffs to understand what was built/fixed
- Correlates commits with tasks ("this commit relates to task #42")
- Generates summaries: "Monday: refactored auth module, Tuesday: payment API integration"
- Leverages existing AI Intelligence pipeline

### Metrics
- Lines changed, files touched
- Languages used breakdown
- PR review activity (reviews given/received)
- Time-to-merge
- Commit frequency and patterns

## File Change Time Problem
- Commit timestamp ≠ when code was written
- Developer may commit all work at EOD
- Solutions:
  1. Local file watcher (client-side) — most accurate, deferred to tracking system scope
  2. Correlate with prompt/session timestamps — available now with existing hook data (if dev was in Claude Code session in that cwd between 2-4pm, infer work window)
  3. IDE save event tracking — accurate but needs per-editor plugins
- For v0.3: use prompt/session correlation as primary signal, local file watcher as future enhancement

## Integration Points
- **Task Management** — auto-link commits to tasks (via branch name, commit message, or AI inference)
- **Attendance** — git activity as implicit attendance signal
- **AI Intelligence** — enrich developer profiles with git-derived skills, patterns, productivity
- **Dashboard** — per-user git activity view, per-project commit timeline, team-wide code velocity

## Data Model (rough)
- `repositories` — project_id, github_repo_url, github_webhook_id, last_synced_at
- `commits` — repo_id, user_id, sha, message, author_date, commit_date, files_changed, insertions, deletions, ai_summary
- `pull_requests` — repo_id, user_id, github_pr_id, title, status, created_at, merged_at, review_count
- `pr_reviews` — pr_id, reviewer_user_id, status (approved/changes_requested), submitted_at
- `file_changes` — commit_id, file_path, change_type (add/modify/delete), insertions, deletions, language

## Open Questions
- GitHub webhook vs polling? (webhook preferred, polling as fallback)
- GitLab / Bitbucket support needed? Or GitHub-only for now?
- How deep to analyze diffs? (full diff vs summary stats)
- Branch naming convention enforcement for task linking?
- Rate limits on GitHub API for large repos?
