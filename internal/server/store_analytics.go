package server

import (
	"fmt"

	"github.com/howincodes/clawlens/internal/shared"
)

// ── AISummary ─────────────────────────────────────────────────────────────────

const summaryColumns = `id, user_id, team_id, type, period_start, period_end,
	summary_text, categories, topics, productivity_score, prompt_quality_score,
	model_efficiency_score, generated_at, generated_by`

func scanSummary(row interface {
	Scan(...any) error
}) (*shared.AISummary, error) {
	var s shared.AISummary
	err := row.Scan(
		&s.ID, &s.UserID, &s.TeamID, &s.Type,
		&s.PeriodStart, &s.PeriodEnd,
		&s.SummaryText, &s.Categories, &s.Topics,
		&s.ProductivityScore, &s.PromptQualityScore, &s.ModelEfficiencyScore,
		&s.GeneratedAt, &s.GeneratedBy,
	)
	if err != nil {
		return nil, err
	}
	return &s, nil
}

// RecordSummary inserts a new AI summary record.
func (s *Store) RecordSummary(sum *shared.AISummary) error {
	_, err := s.db.Exec(
		`INSERT INTO ai_summary
		 (user_id, team_id, type, period_start, period_end, summary_text,
		  categories, topics, productivity_score, prompt_quality_score,
		  model_efficiency_score, generated_at, generated_by)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		sum.UserID, sum.TeamID, sum.Type,
		sum.PeriodStart, sum.PeriodEnd, sum.SummaryText,
		sum.Categories, sum.Topics,
		sum.ProductivityScore, sum.PromptQualityScore, sum.ModelEfficiencyScore,
		sum.GeneratedAt, sum.GeneratedBy,
	)
	return err
}

// GetSummaries returns AI summaries for a team (including per-user summaries
// belonging to that team), ordered by period_end DESC. Optional filters:
// userID restricts to a specific user; summaryType restricts to a summary type.
func (s *Store) GetSummaries(teamID string, userID, summaryType *string, limit int) ([]shared.AISummary, error) {
	where := `WHERE (team_id = ? OR user_id IN (SELECT id FROM user WHERE team_id = ?))`
	args := []any{teamID, teamID}

	if userID != nil {
		where += ` AND user_id = ?`
		args = append(args, *userID)
	}
	if summaryType != nil {
		where += ` AND type = ?`
		args = append(args, *summaryType)
	}

	args = append(args, limit)

	rows, err := s.db.Query(
		`SELECT `+summaryColumns+` FROM ai_summary `+where+
			` ORDER BY period_end DESC LIMIT ?`,
		args...,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var summaries []shared.AISummary
	for rows.Next() {
		sum, err := scanSummary(rows)
		if err != nil {
			return nil, err
		}
		summaries = append(summaries, *sum)
	}
	return summaries, rows.Err()
}

// ── ProjectStats ──────────────────────────────────────────────────────────────

const projectStatsColumns = `id, user_id, project_path, project_name, model,
	input_tokens, output_tokens, cache_read_tokens, cache_create_tokens,
	cost_usd, lines_added, lines_removed, web_search_count, synced_at`

func scanProjectStats(row interface {
	Scan(...any) error
}) (*shared.ProjectStats, error) {
	var ps shared.ProjectStats
	err := row.Scan(
		&ps.ID, &ps.UserID, &ps.ProjectPath, &ps.ProjectName, &ps.Model,
		&ps.InputTokens, &ps.OutputTokens, &ps.CacheReadTokens, &ps.CacheCreateTokens,
		&ps.CostUSD, &ps.LinesAdded, &ps.LinesRemoved, &ps.WebSearchCount,
		&ps.SyncedAt,
	)
	if err != nil {
		return nil, err
	}
	return &ps, nil
}

// UpsertProjectStats inserts or updates project stats. On conflict on
// (user_id, project_path, model) all numeric fields and synced_at are updated.
func (s *Store) UpsertProjectStats(ps *shared.ProjectStats) error {
	_, err := s.db.Exec(
		`INSERT INTO project_stats
		 (user_id, project_path, project_name, model,
		  input_tokens, output_tokens, cache_read_tokens, cache_create_tokens,
		  cost_usd, lines_added, lines_removed, web_search_count, synced_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(user_id, project_path, model) DO UPDATE SET
		   project_name       = excluded.project_name,
		   input_tokens       = excluded.input_tokens,
		   output_tokens      = excluded.output_tokens,
		   cache_read_tokens  = excluded.cache_read_tokens,
		   cache_create_tokens = excluded.cache_create_tokens,
		   cost_usd           = excluded.cost_usd,
		   lines_added        = excluded.lines_added,
		   lines_removed      = excluded.lines_removed,
		   web_search_count   = excluded.web_search_count,
		   synced_at          = excluded.synced_at`,
		ps.UserID, ps.ProjectPath, ps.ProjectName, ps.Model,
		ps.InputTokens, ps.OutputTokens, ps.CacheReadTokens, ps.CacheCreateTokens,
		ps.CostUSD, ps.LinesAdded, ps.LinesRemoved, ps.WebSearchCount,
		ps.SyncedAt,
	)
	return err
}

// GetProjectStats returns all project stats for a user, ordered by cost_usd DESC.
func (s *Store) GetProjectStats(userID string) ([]shared.ProjectStats, error) {
	rows, err := s.db.Query(
		`SELECT `+projectStatsColumns+`
		 FROM project_stats WHERE user_id = ?
		 ORDER BY cost_usd DESC`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var stats []shared.ProjectStats
	for rows.Next() {
		ps, err := scanProjectStats(rows)
		if err != nil {
			return nil, err
		}
		stats = append(stats, *ps)
	}
	return stats, rows.Err()
}

// ── DailyActivity ─────────────────────────────────────────────────────────────

const dailyActivityColumns = `id, user_id, date, message_count, session_count,
	tool_call_count, synced_at`

func scanDailyActivity(row interface {
	Scan(...any) error
}) (*shared.DailyActivity, error) {
	var da shared.DailyActivity
	err := row.Scan(
		&da.ID, &da.UserID, &da.Date,
		&da.MessageCount, &da.SessionCount, &da.ToolCallCount,
		&da.SyncedAt,
	)
	if err != nil {
		return nil, err
	}
	return &da, nil
}

// UpsertDailyActivity inserts or updates a daily activity record. On conflict
// on (user_id, date) the counts and synced_at are updated.
func (s *Store) UpsertDailyActivity(da *shared.DailyActivity) error {
	_, err := s.db.Exec(
		`INSERT INTO daily_activity
		 (user_id, date, message_count, session_count, tool_call_count, synced_at)
		 VALUES (?, ?, ?, ?, ?, ?)
		 ON CONFLICT(user_id, date) DO UPDATE SET
		   message_count   = excluded.message_count,
		   session_count   = excluded.session_count,
		   tool_call_count = excluded.tool_call_count,
		   synced_at       = excluded.synced_at`,
		da.UserID, da.Date,
		da.MessageCount, da.SessionCount, da.ToolCallCount,
		da.SyncedAt,
	)
	return err
}

// GetDailyActivity returns daily activity records for a user covering the last
// N days, ordered by date ASC.
func (s *Store) GetDailyActivity(userID string, days int) ([]shared.DailyActivity, error) {
	rows, err := s.db.Query(
		`SELECT `+dailyActivityColumns+`
		 FROM daily_activity
		 WHERE user_id = ? AND date >= date('now', ?)
		 ORDER BY date`,
		userID, fmt.Sprintf("-%d days", days),
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var activity []shared.DailyActivity
	for rows.Next() {
		da, err := scanDailyActivity(rows)
		if err != nil {
			return nil, err
		}
		activity = append(activity, *da)
	}
	return activity, rows.Err()
}

// ── AuditLog ──────────────────────────────────────────────────────────────────

const auditColumns = `id, team_id, actor, action, target, details, timestamp`

func scanAuditEntry(row interface {
	Scan(...any) error
}) (*shared.AuditEntry, error) {
	var ae shared.AuditEntry
	err := row.Scan(
		&ae.ID, &ae.TeamID, &ae.Actor, &ae.Action,
		&ae.Target, &ae.Details, &ae.Timestamp,
	)
	if err != nil {
		return nil, err
	}
	return &ae, nil
}

// RecordAudit inserts a new audit log entry.
func (s *Store) RecordAudit(teamID, actor, action string, target, details *string) error {
	_, err := s.db.Exec(
		`INSERT INTO audit_log (team_id, actor, action, target, details)
		 VALUES (?, ?, ?, ?, ?)`,
		teamID, actor, action, target, details,
	)
	return err
}

// GetAuditLog returns a paginated list of audit entries for a team, ordered by
// timestamp DESC. An optional action filter can be applied. Returns the entries
// and the total matching count.
func (s *Store) GetAuditLog(teamID string, limit, offset int, action *string) ([]shared.AuditEntry, int, error) {
	where := `WHERE team_id = ?`
	args := []any{teamID}

	if action != nil {
		where += ` AND action = ?`
		args = append(args, *action)
	}

	var total int
	countArgs := make([]any, len(args))
	copy(countArgs, args)
	if err := s.db.QueryRow(
		`SELECT COUNT(*) FROM audit_log `+where, countArgs...,
	).Scan(&total); err != nil {
		return nil, 0, err
	}

	pageArgs := make([]any, len(args), len(args)+2)
	copy(pageArgs, args)
	pageArgs = append(pageArgs, limit, offset)

	rows, err := s.db.Query(
		`SELECT `+auditColumns+` FROM audit_log `+where+
			` ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
		pageArgs...,
	)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var entries []shared.AuditEntry
	for rows.Next() {
		ae, err := scanAuditEntry(rows)
		if err != nil {
			return nil, 0, err
		}
		entries = append(entries, *ae)
	}
	return entries, total, rows.Err()
}

