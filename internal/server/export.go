package server

import (
	"database/sql"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"strconv"
	"time"
)

// ExportPromptsCSV writes a CSV of all prompts for teamID over the last `days`
// days to w.
func ExportPromptsCSV(store *Store, teamID string, days int, w io.Writer) error {
	since := time.Now().UTC().Add(-time.Duration(days) * 24 * time.Hour)

	rows, err := store.db.Query(`
		SELECT p.timestamp, u.name, p.model, p.prompt_length, p.response_length,
		       p.tool_calls, p.project_dir, p.credit_cost, p.had_error, p.was_blocked
		FROM prompt p
		JOIN user u ON p.user_id = u.id
		WHERE u.team_id = ? AND p.timestamp >= ?
		ORDER BY p.timestamp DESC`,
		teamID, since,
	)
	if err != nil {
		return fmt.Errorf("export prompts query: %w", err)
	}
	defer rows.Close()

	cw := csv.NewWriter(w)
	if err := cw.Write([]string{
		"timestamp", "user", "model", "prompt_length", "response_length",
		"tool_calls", "project_dir", "credit_cost", "had_error", "was_blocked",
	}); err != nil {
		return err
	}

	for rows.Next() {
		var (
			ts             time.Time
			userName       string
			model          sql.NullString
			promptLength   int
			responseLength sql.NullInt64
			toolCalls      int
			projectDir     sql.NullString
			creditCost     int
			hadError       bool
			wasBlocked     bool
		)
		if err := rows.Scan(
			&ts, &userName, &model, &promptLength, &responseLength,
			&toolCalls, &projectDir, &creditCost, &hadError, &wasBlocked,
		); err != nil {
			return fmt.Errorf("export prompts scan: %w", err)
		}

		respLen := ""
		if responseLength.Valid {
			respLen = strconv.FormatInt(responseLength.Int64, 10)
		}

		if err := cw.Write([]string{
			ts.UTC().Format(time.RFC3339),
			userName,
			model.String,
			strconv.Itoa(promptLength),
			respLen,
			strconv.Itoa(toolCalls),
			projectDir.String,
			strconv.Itoa(creditCost),
			strconv.FormatBool(hadError),
			strconv.FormatBool(wasBlocked),
		}); err != nil {
			return err
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	cw.Flush()
	return cw.Error()
}

// usageEntry is a single row in the usage JSON export.
type usageEntry struct {
	User        string  `json:"user"`
	PromptCount int     `json:"prompt_count"`
	TotalCost   float64 `json:"total_cost"`
}

// ExportUsageJSON writes a JSON array of per-user usage summaries for teamID
// over the last `days` days to w.
func ExportUsageJSON(store *Store, teamID string, days int, w io.Writer) error {
	since := time.Now().UTC().Add(-time.Duration(days) * 24 * time.Hour)

	rows, err := store.db.Query(`
		SELECT u.name, COUNT(*), COALESCE(SUM(p.credit_cost), 0)
		FROM prompt p
		JOIN user u ON p.user_id = u.id
		WHERE u.team_id = ? AND p.timestamp >= ?
		GROUP BY u.id
		ORDER BY SUM(p.credit_cost) DESC`,
		teamID, since,
	)
	if err != nil {
		return fmt.Errorf("export usage query: %w", err)
	}
	defer rows.Close()

	var entries []usageEntry
	for rows.Next() {
		var e usageEntry
		if err := rows.Scan(&e.User, &e.PromptCount, &e.TotalCost); err != nil {
			return fmt.Errorf("export usage scan: %w", err)
		}
		entries = append(entries, e)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if entries == nil {
		entries = []usageEntry{}
	}

	return json.NewEncoder(w).Encode(entries)
}
