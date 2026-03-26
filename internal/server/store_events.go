package server

import (
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/howincodes/clawlens/internal/shared"
)

// ── Session ───────────────────────────────────────────────────────────────────

const sessionColumns = `id, user_id, device_id, model, project_dir, cwd,
	started_at, ended_at, end_reason, prompt_count, tool_count,
	total_input_tokens, total_output_tokens, total_cost_usd`

func scanSession(row interface {
	Scan(...any) error
}) (*shared.Session, error) {
	var sess shared.Session
	err := row.Scan(
		&sess.ID, &sess.UserID, &sess.DeviceID, &sess.Model,
		&sess.ProjectDir, &sess.CWD,
		&sess.StartedAt, &sess.EndedAt, &sess.EndReason,
		&sess.PromptCount, &sess.ToolCount,
		&sess.TotalInputTokens, &sess.TotalOutputTokens, &sess.TotalCostUSD,
	)
	if err != nil {
		return nil, err
	}
	return &sess, nil
}

// CreateSession inserts a new session record.
func (s *Store) CreateSession(sess *shared.Session) error {
	_, err := s.db.Exec(
		`INSERT INTO session (id, user_id, device_id, model, project_dir, cwd, started_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		sess.ID, sess.UserID, sess.DeviceID, sess.Model,
		sess.ProjectDir, sess.CWD, sess.StartedAt,
	)
	return err
}

// GetSession returns the session with the given ID.
func (s *Store) GetSession(id string) (*shared.Session, error) {
	row := s.db.QueryRow(
		`SELECT `+sessionColumns+` FROM session WHERE id = ?`, id,
	)
	sess, err := scanSession(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return sess, err
}

// EndSession marks a session as ended with the given reason.
func (s *Store) EndSession(id, reason string) error {
	_, err := s.db.Exec(
		`UPDATE session SET ended_at = CURRENT_TIMESTAMP, end_reason = ? WHERE id = ?`,
		reason, id,
	)
	return err
}

// UpdateSessionCounters increments prompt_count and tool_count for a session.
func (s *Store) UpdateSessionCounters(sessionID string, promptDelta, toolDelta int) error {
	_, err := s.db.Exec(
		`UPDATE session SET prompt_count = prompt_count + ?, tool_count = tool_count + ? WHERE id = ?`,
		promptDelta, toolDelta, sessionID,
	)
	return err
}

// GetSessions returns a paginated list of sessions for a user, ordered by
// started_at DESC. Also returns the total count.
func (s *Store) GetSessions(userID string, limit, offset int) ([]shared.Session, int, error) {
	var total int
	if err := s.db.QueryRow(
		`SELECT COUNT(*) FROM session WHERE user_id = ?`, userID,
	).Scan(&total); err != nil {
		return nil, 0, err
	}

	rows, err := s.db.Query(
		`SELECT `+sessionColumns+` FROM session WHERE user_id = ?
		 ORDER BY started_at DESC LIMIT ? OFFSET ?`,
		userID, limit, offset,
	)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var sessions []shared.Session
	for rows.Next() {
		sess, err := scanSession(rows)
		if err != nil {
			return nil, 0, err
		}
		sessions = append(sessions, *sess)
	}
	return sessions, total, rows.Err()
}

// GetActiveSessions returns sessions for a team that are currently active
// (ended_at IS NULL and started within the last 5 minutes).
func (s *Store) GetActiveSessions(teamID string) ([]shared.Session, error) {
	rows, err := s.db.Query(
		`SELECT `+sessionColumns+`
		 FROM session
		 JOIN user ON session.user_id = user.id
		 WHERE user.team_id = ?
		   AND session.ended_at IS NULL
		   AND session.started_at > datetime('now', '-5 minutes')`,
		teamID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var sessions []shared.Session
	for rows.Next() {
		sess, err := scanSession(rows)
		if err != nil {
			return nil, err
		}
		sessions = append(sessions, *sess)
	}
	return sessions, rows.Err()
}

// CleanupOrphanSessions ends sessions that have been idle for more than 30
// minutes (no recent prompts). Returns the number of sessions closed.
func (s *Store) CleanupOrphanSessions() (int64, error) {
	res, err := s.db.Exec(
		`UPDATE session
		 SET ended_at = CURRENT_TIMESTAMP, end_reason = 'timeout'
		 WHERE ended_at IS NULL
		   AND id NOT IN (
		       SELECT DISTINCT session_id FROM prompt
		       WHERE session_id IS NOT NULL
		         AND timestamp > datetime('now', '-30 minutes')
		   )
		   AND started_at < datetime('now', '-30 minutes')`,
	)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// ── Prompt ────────────────────────────────────────────────────────────────────

const promptColumns = `id, user_id, session_id, model, prompt_text, prompt_length,
	response_text, response_length, project_dir, cwd, tool_calls, tools_used,
	had_error, was_blocked, block_reason, turn_duration_ms, credit_cost,
	prompt_truncated, timestamp`

func scanPrompt(row interface {
	Scan(...any) error
}) (*shared.Prompt, error) {
	var p shared.Prompt
	err := row.Scan(
		&p.ID, &p.UserID, &p.SessionID, &p.Model,
		&p.PromptText, &p.PromptLength,
		&p.ResponseText, &p.ResponseLength,
		&p.ProjectDir, &p.CWD,
		&p.ToolCalls, &p.ToolsUsed,
		&p.HadError, &p.WasBlocked, &p.BlockReason,
		&p.TurnDurationMS, &p.CreditCost,
		&p.PromptTruncated, &p.Timestamp,
	)
	if err != nil {
		return nil, err
	}
	return &p, nil
}

// RecordPrompt inserts a new prompt record and returns its auto-generated ID.
func (s *Store) RecordPrompt(p *shared.Prompt) (int64, error) {
	res, err := s.db.Exec(
		`INSERT INTO prompt
		 (user_id, session_id, model, prompt_text, prompt_length,
		  response_text, response_length, project_dir, cwd, tool_calls,
		  tools_used, had_error, was_blocked, block_reason, turn_duration_ms,
		  credit_cost, prompt_truncated, timestamp)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		p.UserID, p.SessionID, p.Model, p.PromptText, p.PromptLength,
		p.ResponseText, p.ResponseLength, p.ProjectDir, p.CWD, p.ToolCalls,
		p.ToolsUsed, p.HadError, p.WasBlocked, p.BlockReason, p.TurnDurationMS,
		p.CreditCost, p.PromptTruncated, p.Timestamp,
	)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// UpdatePromptWithResponse updates the most recent prompt in a session with
// response data returned from Claude.
func (s *Store) UpdatePromptWithResponse(
	sessionID string,
	responseText *string,
	responseLength *int,
	toolCalls int,
	toolsUsed *string,
	turnDurationMS *int,
	creditCost int,
) error {
	_, err := s.db.Exec(
		`UPDATE prompt
		 SET response_text    = ?,
		     response_length  = ?,
		     tool_calls       = ?,
		     tools_used       = ?,
		     turn_duration_ms = ?,
		     credit_cost      = ?
		 WHERE id = (
		     SELECT id FROM prompt
		     WHERE session_id = ?
		     ORDER BY id DESC
		     LIMIT 1
		 )`,
		responseText, responseLength, toolCalls,
		toolsUsed, turnDurationMS, creditCost,
		sessionID,
	)
	return err
}

// GetPrompts returns a paginated, optionally filtered list of prompts for a
// user, ordered by timestamp DESC. Also returns the total count.
func (s *Store) GetPrompts(
	userID string,
	limit, offset int,
	search, model, project *string,
) ([]shared.Prompt, int, error) {
	where := "WHERE user_id = ?"
	args := []any{userID}

	if search != nil {
		where += fmt.Sprintf(" AND prompt_text LIKE '%%%s%%'", *search)
	}
	if model != nil {
		where += " AND model = ?"
		args = append(args, *model)
	}
	if project != nil {
		where += " AND project_dir = ?"
		args = append(args, *project)
	}

	var total int
	countArgs := make([]any, len(args))
	copy(countArgs, args)
	if err := s.db.QueryRow(
		`SELECT COUNT(*) FROM prompt `+where, countArgs...,
	).Scan(&total); err != nil {
		return nil, 0, err
	}

	pageArgs := make([]any, len(args), len(args)+2)
	copy(pageArgs, args)
	pageArgs = append(pageArgs, limit, offset)

	rows, err := s.db.Query(
		`SELECT `+promptColumns+` FROM prompt `+where+
			` ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
		pageArgs...,
	)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var prompts []shared.Prompt
	for rows.Next() {
		p, err := scanPrompt(rows)
		if err != nil {
			return nil, 0, err
		}
		prompts = append(prompts, *p)
	}
	return prompts, total, rows.Err()
}

// GetAllPrompts returns a paginated, optionally filtered list of prompts across
// all users in a team, ordered by timestamp DESC. Also returns the total count.
func (s *Store) GetAllPrompts(
	teamID string,
	limit, offset int,
	search, model, project, userID *string,
	wasBlocked *bool,
) ([]shared.Prompt, int, error) {
	where := "WHERE u.team_id = ?"
	args := []any{teamID}

	if userID != nil && *userID != "" {
		where += " AND p.user_id = ?"
		args = append(args, *userID)
	}
	if search != nil && *search != "" {
		where += " AND p.prompt_text LIKE ?"
		args = append(args, "%"+*search+"%")
	}
	if model != nil && *model != "" {
		where += " AND p.model LIKE ?"
		args = append(args, "%"+*model+"%")
	}
	if project != nil && *project != "" {
		where += " AND p.project_dir = ?"
		args = append(args, *project)
	}
	if wasBlocked != nil {
		where += " AND p.was_blocked = ?"
		args = append(args, *wasBlocked)
	}

	var total int
	countArgs := make([]any, len(args))
	copy(countArgs, args)
	if err := s.db.QueryRow(
		"SELECT COUNT(*) FROM prompt p JOIN user u ON p.user_id = u.id "+where,
		countArgs...,
	).Scan(&total); err != nil {
		return nil, 0, err
	}

	pageArgs := make([]any, len(args), len(args)+2)
	copy(pageArgs, args)
	pageArgs = append(pageArgs, limit, offset)

	query := fmt.Sprintf(
		`SELECT p.id, p.user_id, p.session_id, p.model, p.prompt_text, p.prompt_length,
		p.response_text, p.response_length, p.project_dir, p.cwd, p.tool_calls, p.tools_used,
		p.had_error, p.was_blocked, p.block_reason, p.turn_duration_ms, p.credit_cost,
		p.prompt_truncated, p.timestamp
		FROM prompt p JOIN user u ON p.user_id = u.id %s ORDER BY p.timestamp DESC LIMIT ? OFFSET ?`,
		where,
	)

	rows, err := s.db.Query(query, pageArgs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var prompts []shared.Prompt
	for rows.Next() {
		p, err := scanPrompt(rows)
		if err != nil {
			return nil, 0, err
		}
		prompts = append(prompts, *p)
	}
	return prompts, total, rows.Err()
}

// GetPromptsForSummary returns prompts for a user within a time range, used
// for AI summary generation.
func (s *Store) GetPromptsForSummary(userID string, since, until time.Time) ([]shared.Prompt, error) {
	rows, err := s.db.Query(
		`SELECT `+promptColumns+`
		 FROM prompt
		 WHERE user_id = ? AND timestamp >= ? AND timestamp <= ?
		 ORDER BY timestamp ASC`,
		userID, since, until,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var prompts []shared.Prompt
	for rows.Next() {
		p, err := scanPrompt(rows)
		if err != nil {
			return nil, err
		}
		prompts = append(prompts, *p)
	}
	return prompts, rows.Err()
}

// GetCreditUsage returns the total credit cost for a user since the given time.
// Used for rate limiting.
func (s *Store) GetCreditUsage(userID string, since time.Time) (int, error) {
	var total int
	err := s.db.QueryRow(
		`SELECT COALESCE(SUM(credit_cost), 0) FROM prompt WHERE user_id = ? AND timestamp >= ?`,
		userID, since,
	).Scan(&total)
	return total, err
}

// GetModelUsageCount returns the number of prompts for a user using a specific
// model since the given time. Used for per-model limits.
func (s *Store) GetModelUsageCount(userID, model string, since time.Time) (int, error) {
	var count int
	err := s.db.QueryRow(
		`SELECT COUNT(*) FROM prompt WHERE user_id = ? AND model = ? AND timestamp >= ?`,
		userID, model, since,
	).Scan(&count)
	return count, err
}

// CountPromptsToday returns the number of prompts submitted today across all
// users in a team. Used for plan enforcement.
func (s *Store) CountPromptsToday(teamID string) (int, error) {
	var count int
	err := s.db.QueryRow(
		`SELECT COUNT(*) FROM prompt
		 JOIN user ON prompt.user_id = user.id
		 WHERE user.team_id = ? AND prompt.timestamp >= date('now')`,
		teamID,
	).Scan(&count)
	return count, err
}

// DeleteOldPrompts removes prompts older than the given number of days.
// Returns the number of rows deleted.
func (s *Store) DeleteOldPrompts(days int) (int64, error) {
	res, err := s.db.Exec(
		`DELETE FROM prompt WHERE timestamp < datetime('now', ? || ' days')`,
		fmt.Sprintf("-%d", days),
	)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// ── ToolEvent ─────────────────────────────────────────────────────────────────

const toolEventColumns = `id, user_id, session_id, prompt_id, tool_name,
	tool_input_summary, success, error_message, timestamp`

func scanToolEvent(row interface {
	Scan(...any) error
}) (*shared.ToolEvent, error) {
	var te shared.ToolEvent
	err := row.Scan(
		&te.ID, &te.UserID, &te.SessionID, &te.PromptID,
		&te.ToolName, &te.ToolInputSummary,
		&te.Success, &te.ErrorMessage, &te.Timestamp,
	)
	if err != nil {
		return nil, err
	}
	return &te, nil
}

// RecordToolEvent inserts a tool event record.
func (s *Store) RecordToolEvent(te *shared.ToolEvent) error {
	_, err := s.db.Exec(
		`INSERT INTO tool_event
		 (user_id, session_id, prompt_id, tool_name, tool_input_summary,
		  success, error_message, timestamp)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		te.UserID, te.SessionID, te.PromptID, te.ToolName,
		te.ToolInputSummary, te.Success, te.ErrorMessage, te.Timestamp,
	)
	return err
}

// GetToolEvents returns a paginated list of tool events for a user, ordered
// by timestamp DESC. Also returns the total count.
func (s *Store) GetToolEvents(userID string, limit, offset int) ([]shared.ToolEvent, int, error) {
	var total int
	if err := s.db.QueryRow(
		`SELECT COUNT(*) FROM tool_event WHERE user_id = ?`, userID,
	).Scan(&total); err != nil {
		return nil, 0, err
	}

	rows, err := s.db.Query(
		`SELECT `+toolEventColumns+`
		 FROM tool_event WHERE user_id = ?
		 ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
		userID, limit, offset,
	)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var events []shared.ToolEvent
	for rows.Next() {
		te, err := scanToolEvent(rows)
		if err != nil {
			return nil, 0, err
		}
		events = append(events, *te)
	}
	return events, total, rows.Err()
}

// ── Alert ─────────────────────────────────────────────────────────────────────

const alertColumns = `id, team_id, user_id, type, severity, title, details,
	resolved, created_at`

func scanAlert(row interface {
	Scan(...any) error
}) (*shared.Alert, error) {
	var a shared.Alert
	err := row.Scan(
		&a.ID, &a.TeamID, &a.UserID, &a.Type, &a.Severity,
		&a.Title, &a.Details, &a.Resolved, &a.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &a, nil
}

// CreateAlert inserts a new alert record.
func (s *Store) CreateAlert(a *shared.Alert) error {
	_, err := s.db.Exec(
		`INSERT INTO alert (team_id, user_id, type, severity, title, details, resolved)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		a.TeamID, a.UserID, a.Type, a.Severity, a.Title, a.Details, a.Resolved,
	)
	return err
}

// GetAlerts returns alerts for a team, optionally filtered by resolved status.
func (s *Store) GetAlerts(teamID string, limit int, resolved *bool) ([]shared.Alert, error) {
	where := "WHERE team_id = ?"
	args := []any{teamID}

	if resolved != nil {
		where += " AND resolved = ?"
		args = append(args, *resolved)
	}

	args = append(args, limit)

	rows, err := s.db.Query(
		`SELECT `+alertColumns+` FROM alert `+where+
			` ORDER BY created_at DESC LIMIT ?`,
		args...,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var alerts []shared.Alert
	for rows.Next() {
		a, err := scanAlert(rows)
		if err != nil {
			return nil, err
		}
		alerts = append(alerts, *a)
	}
	return alerts, rows.Err()
}

// ResolveAlert marks the alert with the given ID as resolved.
func (s *Store) ResolveAlert(id int) error {
	_, err := s.db.Exec(`UPDATE alert SET resolved = TRUE WHERE id = ?`, id)
	return err
}
