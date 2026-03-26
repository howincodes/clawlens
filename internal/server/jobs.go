package server

import (
	"fmt"
	"log"
	"time"

	"github.com/howincodes/clawlens/internal/shared"
)

// JobRunner runs background maintenance and alerting goroutines for a team.
type JobRunner struct {
	store     *Store
	hub       *WSHub
	summary   *SummaryEngine
	analytics *Analytics
	teamID    string
	stopCh    chan struct{}
}

// NewJobRunner creates a new JobRunner. Call Start() to launch the goroutines.
func NewJobRunner(store *Store, hub *WSHub, summary *SummaryEngine, analytics *Analytics, teamID string) *JobRunner {
	return &JobRunner{
		store:     store,
		hub:       hub,
		summary:   summary,
		analytics: analytics,
		teamID:    teamID,
		stopCh:    make(chan struct{}),
	}
}

// Start launches all background goroutines. It is safe to call once.
func (j *JobRunner) Start() {
	go j.runSummaryScheduler()
	go j.runOrphanCleanup()
	go j.runRetentionCleanup()
	go j.runStuckDetection()
}

// Stop signals all goroutines to exit.
func (j *JobRunner) Stop() {
	close(j.stopCh)
}

// runSummaryScheduler fires AI summary generation at the interval configured
// in team settings. Skipped if SummaryIntervalHours == 0.
func (j *JobRunner) runSummaryScheduler() {
	settings, err := j.store.GetTeamSettings(j.teamID)
	if err != nil || settings.SummaryIntervalHours == 0 {
		return
	}

	interval := time.Duration(settings.SummaryIntervalHours) * time.Hour
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			// Re-read settings in case they changed.
			s, err := j.store.GetTeamSettings(j.teamID)
			if err != nil {
				log.Printf("jobs: summary scheduler: get settings: %v", err)
				continue
			}
			if s.SummaryIntervalHours == 0 {
				continue
			}
			if err := j.summary.GenerateForAllUsers(j.teamID, s.SummaryIntervalHours); err != nil {
				log.Printf("jobs: summary generation: %v", err)
			}
		case <-j.stopCh:
			return
		}
	}
}

// runOrphanCleanup closes sessions that have been idle for more than 30 minutes.
// Runs every 10 minutes.
func (j *JobRunner) runOrphanCleanup() {
	ticker := time.NewTicker(10 * time.Minute)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			n, err := j.store.CleanupOrphanSessions()
			if err != nil {
				log.Printf("jobs: orphan cleanup: %v", err)
			} else if n > 0 {
				log.Printf("jobs: orphan cleanup: closed %d idle sessions", n)
			}
		case <-j.stopCh:
			return
		}
	}
}

// runRetentionCleanup deletes prompts older than PromptRetentionDays.
// Runs every 24 hours. Skipped if PromptRetentionDays == 0.
func (j *JobRunner) runRetentionCleanup() {
	ticker := time.NewTicker(24 * time.Hour)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			s, err := j.store.GetTeamSettings(j.teamID)
			if err != nil {
				log.Printf("jobs: retention cleanup: get settings: %v", err)
				continue
			}
			if s.PromptRetentionDays <= 0 {
				continue
			}
			n, err := j.store.DeleteOldPrompts(s.PromptRetentionDays)
			if err != nil {
				log.Printf("jobs: retention cleanup: %v", err)
			} else if n > 0 {
				log.Printf("jobs: retention cleanup: deleted %d old prompts", n)
			}
		case <-j.stopCh:
			return
		}
	}
}

// stuckRow holds one row returned by the stuck-detection query.
type stuckRow struct {
	userID     string
	userName   string
	sessionID  string
	projectDir string
	cnt        int
	errors     int
}

// runStuckDetection queries for users who appear stuck (many errors in a short
// window) and fires alerts + webhooks. Runs every 60 seconds when AlertOnStuck
// is enabled.
func (j *JobRunner) runStuckDetection() {
	ticker := time.NewTicker(60 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			s, err := j.store.GetTeamSettings(j.teamID)
			if err != nil {
				log.Printf("jobs: stuck detection: get settings: %v", err)
				continue
			}
			if !s.AlertOnStuck {
				continue
			}
			j.detectStuck(s)
		case <-j.stopCh:
			return
		}
	}
}

// detectStuck runs the stuck-user query and creates alerts / sends webhooks.
func (j *JobRunner) detectStuck(settings *shared.TeamSettings) {
	rows, err := j.store.db.Query(`
		SELECT p.user_id, u.name, p.session_id, p.project_dir,
		       COUNT(*) AS cnt,
		       SUM(CASE WHEN p.had_error THEN 1 ELSE 0 END) AS errors
		FROM prompt p
		JOIN user u ON p.user_id = u.id
		WHERE u.team_id = ? AND p.timestamp > datetime('now', '-20 minutes')
		GROUP BY p.user_id, p.session_id
		HAVING cnt >= 5 AND errors > cnt / 2`,
		j.teamID,
	)
	if err != nil {
		log.Printf("jobs: stuck detection query: %v", err)
		return
	}
	defer rows.Close()

	var matches []stuckRow
	for rows.Next() {
		var r stuckRow
		var projectDir *string
		if err := rows.Scan(&r.userID, &r.userName, &r.sessionID, &projectDir, &r.cnt, &r.errors); err != nil {
			log.Printf("jobs: stuck detection scan: %v", err)
			continue
		}
		if projectDir != nil {
			r.projectDir = *projectDir
		}
		matches = append(matches, r)
	}

	for _, r := range matches {
		userID := r.userID
		title := fmt.Sprintf("User %s may be stuck (%d/%d errors)", r.userName, r.errors, r.cnt)
		details := fmt.Sprintf(`{"session_id":%q,"project_dir":%q,"prompt_count":%d,"error_count":%d}`,
			r.sessionID, r.projectDir, r.cnt, r.errors)

		alert := &shared.Alert{
			TeamID:   j.teamID,
			UserID:   &userID,
			Type:     "stuck",
			Severity: "warning",
			Title:    title,
			Details:  &details,
		}
		if err := j.store.CreateAlert(alert); err != nil {
			log.Printf("jobs: create alert: %v", err)
		}

		SendWebhook(settings, WebhookEvent{
			Event:  "user_stuck",
			User:   r.userName,
			Reason: fmt.Sprintf("%d errors in last 20 minutes", r.errors),
		})
	}
}
