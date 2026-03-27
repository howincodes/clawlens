package server

import (
	"fmt"
	"time"
)

// Analytics wraps a Store to provide team-level analytics queries.
type Analytics struct {
	store *Store
}

// NewAnalytics creates a new Analytics instance backed by the given store.
func NewAnalytics(store *Store) *Analytics {
	return &Analytics{store: store}
}

// ── Return types ──────────────────────────────────────────────────────────────

type TeamOverview struct {
	TotalUsers   int     `json:"total_users"`
	ActiveNow    int     `json:"active_now"`
	PromptsToday int     `json:"prompts_today"`
	CostToday    float64 `json:"cost_today"`
}

type UserLeaderboardEntry struct {
	UserID   string  `json:"user_id"`
	UserName string  `json:"user_name"`
	Prompts  int     `json:"prompts"`
	Sessions int     `json:"sessions"`
	CostUSD  float64 `json:"cost_usd"`
	AvgTurns float64 `json:"avg_turns"`
	TopModel string  `json:"top_model"`
}

type CostBreakdown struct {
	ByUser    []CostEntry `json:"by_user"`
	ByProject []CostEntry `json:"by_project"`
	ByModel   []CostEntry `json:"by_model"`
}

type CostEntry struct {
	Label string  `json:"label"`
	Cost  float64 `json:"cost"`
	Count int     `json:"count"`
}

type ModelDistribution struct {
	Model string `json:"model"`
	Count int    `json:"count"`
}

type ToolDistribution struct {
	Tool   string `json:"tool"`
	Count  int    `json:"count"`
	Errors int    `json:"errors"`
}

type DailyTrend struct {
	Date     string  `json:"date"`
	Prompts  int     `json:"prompts"`
	Sessions int     `json:"sessions"`
	Cost     float64 `json:"cost"`
}

type ProjectAnalytics struct {
	Project string  `json:"project"`
	Prompts int     `json:"prompts"`
	Users   int     `json:"users"`
	CostUSD float64 `json:"cost_usd"`
}

type PeakHour struct {
	Hour  int `json:"hour"`
	Count int `json:"count"`
}

// ── Methods ───────────────────────────────────────────────────────────────────

// GetTeamOverview returns high-level usage metrics for the team.
func (a *Analytics) GetTeamOverview(teamID string) (*TeamOverview, error) {
	var ov TeamOverview

	// Use Go time for today's start to match stored timestamp format
	now := time.Now().UTC()
	todayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	fiveMinAgo := now.Add(-5 * time.Minute)

	// Total users
	a.store.db.QueryRow(`SELECT COUNT(*) FROM user WHERE team_id = ?`, teamID).Scan(&ov.TotalUsers)

	// Active sessions (ended_at IS NULL, started recently)
	a.store.db.QueryRow(
		`SELECT COUNT(DISTINCT session.user_id)
		 FROM session JOIN user ON session.user_id = user.id
		 WHERE user.team_id = ? AND session.ended_at IS NULL AND session.started_at > ?`,
		teamID, fiveMinAgo,
	).Scan(&ov.ActiveNow)

	// Prompts today
	a.store.db.QueryRow(
		`SELECT COUNT(*) FROM prompt JOIN user ON prompt.user_id = user.id
		 WHERE user.team_id = ? AND prompt.timestamp >= ?`,
		teamID, todayStart,
	).Scan(&ov.PromptsToday)

	// Credits today (exclude blocked prompts)
	a.store.db.QueryRow(
		`SELECT COALESCE(SUM(CASE WHEN prompt.was_blocked = FALSE THEN prompt.credit_cost ELSE 0 END), 0) FROM prompt JOIN user ON prompt.user_id = user.id
		 WHERE user.team_id = ? AND prompt.timestamp >= ? AND prompt.was_blocked = FALSE`,
		teamID, todayStart,
	).Scan(&ov.CostToday)

	return &ov, nil
}

// GetUserLeaderboard returns per-user usage stats for the given time window,
// sorted by sortBy ("prompts", "cost", or "sessions").
func (a *Analytics) GetUserLeaderboard(teamID string, days int, sortBy string) ([]UserLeaderboardEntry, error) {
	since := time.Now().AddDate(0, 0, -days)

	// Validate / default sort column
	orderCol := "prompts"
	switch sortBy {
	case "cost":
		orderCol = "cost_usd"
	case "sessions":
		orderCol = "sessions"
	}

	rows, err := a.store.db.Query(
		`SELECT
		   u.id,
		   u.name,
		   COUNT(p.id)                         AS prompts,
		   COUNT(DISTINCT p.session_id)        AS sessions,
		   COALESCE(SUM(CASE WHEN p.was_blocked = FALSE THEN p.credit_cost ELSE 0 END), 0) AS cost_usd,
		   COALESCE((
		       SELECT model FROM prompt
		       WHERE user_id = u.id
		         AND timestamp >= ?
		         AND model IS NOT NULL
		       GROUP BY model
		       ORDER BY COUNT(*) DESC
		       LIMIT 1
		   ), '')                              AS top_model
		 FROM user u
		 LEFT JOIN prompt p
		   ON p.user_id = u.id AND p.timestamp >= ?
		 WHERE u.team_id = ?
		 GROUP BY u.id, u.name
		 ORDER BY `+orderCol+` DESC`,
		since, since, teamID,
	)
	if err != nil {
		return nil, fmt.Errorf("leaderboard query: %w", err)
	}
	defer rows.Close()

	var entries []UserLeaderboardEntry
	for rows.Next() {
		var e UserLeaderboardEntry
		if err := rows.Scan(&e.UserID, &e.UserName, &e.Prompts, &e.Sessions, &e.CostUSD, &e.TopModel); err != nil {
			return nil, fmt.Errorf("scan leaderboard row: %w", err)
		}
		if e.Sessions > 0 {
			e.AvgTurns = float64(e.Prompts) / float64(e.Sessions)
		}
		entries = append(entries, e)
	}
	return entries, rows.Err()
}

// GetCostBreakdown returns cost grouped by user, project, and model.
func (a *Analytics) GetCostBreakdown(teamID string, days int) (*CostBreakdown, error) {
	since := time.Now().AddDate(0, 0, -days)
	var bd CostBreakdown

	// By user
	{
		rows, err := a.store.db.Query(
			`SELECT u.name, COALESCE(SUM(CASE WHEN p.was_blocked = FALSE THEN p.credit_cost ELSE 0 END), 0), COUNT(p.id)
			 FROM user u
			 LEFT JOIN prompt p ON p.user_id = u.id AND p.timestamp >= ?
			 WHERE u.team_id = ?
			 GROUP BY u.id, u.name
			 ORDER BY 2 DESC`,
			since, teamID,
		)
		if err != nil {
			return nil, fmt.Errorf("cost by user: %w", err)
		}
		defer rows.Close()
		for rows.Next() {
			var e CostEntry
			if err := rows.Scan(&e.Label, &e.Cost, &e.Count); err != nil {
				return nil, fmt.Errorf("scan cost by user: %w", err)
			}
			bd.ByUser = append(bd.ByUser, e)
		}
		if err := rows.Err(); err != nil {
			return nil, err
		}
	}

	// By project
	{
		rows, err := a.store.db.Query(
			`SELECT COALESCE(p.project_dir, 'unknown'), COALESCE(SUM(CASE WHEN p.was_blocked = FALSE THEN p.credit_cost ELSE 0 END), 0), COUNT(p.id)
			 FROM prompt p
			 JOIN user u ON p.user_id = u.id
			 WHERE u.team_id = ? AND p.timestamp >= ?
			 GROUP BY p.project_dir
			 ORDER BY 2 DESC`,
			teamID, since,
		)
		if err != nil {
			return nil, fmt.Errorf("cost by project: %w", err)
		}
		defer rows.Close()
		for rows.Next() {
			var e CostEntry
			if err := rows.Scan(&e.Label, &e.Cost, &e.Count); err != nil {
				return nil, fmt.Errorf("scan cost by project: %w", err)
			}
			bd.ByProject = append(bd.ByProject, e)
		}
		if err := rows.Err(); err != nil {
			return nil, err
		}
	}

	// By model
	{
		rows, err := a.store.db.Query(
			`SELECT COALESCE(p.model, 'unknown'), COALESCE(SUM(CASE WHEN p.was_blocked = FALSE THEN p.credit_cost ELSE 0 END), 0), COUNT(p.id)
			 FROM prompt p
			 JOIN user u ON p.user_id = u.id
			 WHERE u.team_id = ? AND p.timestamp >= ?
			 GROUP BY p.model
			 ORDER BY 2 DESC`,
			teamID, since,
		)
		if err != nil {
			return nil, fmt.Errorf("cost by model: %w", err)
		}
		defer rows.Close()
		for rows.Next() {
			var e CostEntry
			if err := rows.Scan(&e.Label, &e.Cost, &e.Count); err != nil {
				return nil, fmt.Errorf("scan cost by model: %w", err)
			}
			bd.ByModel = append(bd.ByModel, e)
		}
		if err := rows.Err(); err != nil {
			return nil, err
		}
	}

	return &bd, nil
}

// GetModelDistribution returns prompt counts grouped by model.
func (a *Analytics) GetModelDistribution(teamID string, days int) ([]ModelDistribution, error) {
	since := time.Now().AddDate(0, 0, -days)

	rows, err := a.store.db.Query(
		`SELECT COALESCE(p.model, 'unknown'), COUNT(*)
		 FROM prompt p
		 JOIN user u ON p.user_id = u.id
		 WHERE u.team_id = ? AND p.timestamp >= ?
		 GROUP BY p.model
		 ORDER BY 2 DESC`,
		teamID, since,
	)
	if err != nil {
		return nil, fmt.Errorf("model distribution: %w", err)
	}
	defer rows.Close()

	var dist []ModelDistribution
	for rows.Next() {
		var d ModelDistribution
		if err := rows.Scan(&d.Model, &d.Count); err != nil {
			return nil, fmt.Errorf("scan model distribution: %w", err)
		}
		dist = append(dist, d)
	}
	return dist, rows.Err()
}

// GetToolDistribution returns tool invocation counts and error counts.
func (a *Analytics) GetToolDistribution(teamID string, days int) ([]ToolDistribution, error) {
	since := time.Now().AddDate(0, 0, -days)

	rows, err := a.store.db.Query(
		`SELECT te.tool_name,
		        COUNT(*)                                    AS total,
		        SUM(CASE WHEN te.success = FALSE THEN 1 ELSE 0 END) AS errors
		 FROM tool_event te
		 JOIN user u ON te.user_id = u.id
		 WHERE u.team_id = ? AND te.timestamp >= ?
		 GROUP BY te.tool_name
		 ORDER BY total DESC`,
		teamID, since,
	)
	if err != nil {
		return nil, fmt.Errorf("tool distribution: %w", err)
	}
	defer rows.Close()

	var dist []ToolDistribution
	for rows.Next() {
		var d ToolDistribution
		if err := rows.Scan(&d.Tool, &d.Count, &d.Errors); err != nil {
			return nil, fmt.Errorf("scan tool distribution: %w", err)
		}
		dist = append(dist, d)
	}
	return dist, rows.Err()
}

// GetDailyTrends returns per-day aggregates for the given window.
func (a *Analytics) GetDailyTrends(teamID string, days int) ([]DailyTrend, error) {
	since := time.Now().AddDate(0, 0, -days)

	rows, err := a.store.db.Query(
		`SELECT substr(p.timestamp, 1, 10)    AS day,
		        COUNT(*)                      AS prompts,
		        COUNT(DISTINCT p.session_id)  AS sessions,
		        COALESCE(SUM(CASE WHEN p.was_blocked = FALSE THEN p.credit_cost ELSE 0 END), 0) AS cost
		 FROM prompt p
		 JOIN user u ON p.user_id = u.id
		 WHERE u.team_id = ? AND p.timestamp >= ?
		 GROUP BY day
		 ORDER BY day ASC`,
		teamID, since,
	)
	if err != nil {
		return nil, fmt.Errorf("daily trends: %w", err)
	}
	defer rows.Close()

	var trends []DailyTrend
	for rows.Next() {
		var d DailyTrend
		if err := rows.Scan(&d.Date, &d.Prompts, &d.Sessions, &d.Cost); err != nil {
			return nil, fmt.Errorf("scan daily trend: %w", err)
		}
		trends = append(trends, d)
	}
	return trends, rows.Err()
}

// GetProjectAnalytics returns per-project usage stats.
func (a *Analytics) GetProjectAnalytics(teamID string, days int) ([]ProjectAnalytics, error) {
	since := time.Now().AddDate(0, 0, -days)

	rows, err := a.store.db.Query(
		`SELECT COALESCE(p.project_dir, 'unknown'),
		        COUNT(*)                        AS prompts,
		        COUNT(DISTINCT p.user_id)       AS users,
		        COALESCE(SUM(CASE WHEN p.was_blocked = FALSE THEN p.credit_cost ELSE 0 END), 0) AS cost_usd
		 FROM prompt p
		 JOIN user u ON p.user_id = u.id
		 WHERE u.team_id = ? AND p.timestamp >= ?
		 GROUP BY p.project_dir
		 ORDER BY prompts DESC`,
		teamID, since,
	)
	if err != nil {
		return nil, fmt.Errorf("project analytics: %w", err)
	}
	defer rows.Close()

	var projects []ProjectAnalytics
	for rows.Next() {
		var pa ProjectAnalytics
		if err := rows.Scan(&pa.Project, &pa.Prompts, &pa.Users, &pa.CostUSD); err != nil {
			return nil, fmt.Errorf("scan project analytics: %w", err)
		}
		projects = append(projects, pa)
	}
	return projects, rows.Err()
}

// GetPeakHours returns prompt counts grouped by hour-of-day (0–23).
func (a *Analytics) GetPeakHours(teamID string, days int) ([]PeakHour, error) {
	since := time.Now().AddDate(0, 0, -days)

	rows, err := a.store.db.Query(
		`SELECT CAST(substr(p.timestamp, 12, 2) AS INTEGER) AS hour,
		        COUNT(*) AS cnt
		 FROM prompt p
		 JOIN user u ON p.user_id = u.id
		 WHERE u.team_id = ? AND p.timestamp >= ?
		 GROUP BY hour
		 ORDER BY hour ASC`,
		teamID, since,
	)
	if err != nil {
		return nil, fmt.Errorf("peak hours: %w", err)
	}
	defer rows.Close()

	var hours []PeakHour
	for rows.Next() {
		var ph PeakHour
		if err := rows.Scan(&ph.Hour, &ph.Count); err != nil {
			return nil, fmt.Errorf("scan peak hour: %w", err)
		}
		hours = append(hours, ph)
	}
	return hours, rows.Err()
}
