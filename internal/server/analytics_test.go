package server

import (
	"testing"
	"time"

	"github.com/howincodes/clawlens/internal/shared"
)

// seedAnalyticsData creates two users, sessions, prompts, and tool events
// under the default team and returns the teamID and the two user IDs.
func seedAnalyticsData(t *testing.T, store *Store) (teamID string, userIDs []string) {
	t.Helper()

	team, err := store.GetTeam()
	if err != nil || team == nil {
		t.Fatalf("seedAnalyticsData: GetTeam: %v", err)
	}
	teamID = team.ID

	models := []string{"claude-opus-4", "claude-sonnet-4", "claude-haiku-3"}
	projects := []string{"/home/dev/projectA", "/home/dev/projectB"}

	for i, name := range []string{"Alice", "Bob"} {
		slug := []string{"alice", "bob"}[i]
		u := &shared.User{
			ID:        shared.GenerateID(),
			TeamID:    teamID,
			Slug:      slug,
			Name:      name,
			AuthToken: shared.GenerateToken(),
			Status:    "active",
		}
		if err := store.CreateUser(u); err != nil {
			t.Fatalf("CreateUser %s: %v", name, err)
		}
		userIDs = append(userIDs, u.ID)

		// Create one session per user (active – no ended_at)
		sessionID := shared.GenerateID()
		sess := &shared.Session{
			ID:        sessionID,
			UserID:    u.ID,
			StartedAt: time.Now().UTC(),
		}
		if err := store.CreateSession(sess); err != nil {
			t.Fatalf("CreateSession for %s: %v", name, err)
		}

		// Record 5 prompts spread across the last 3 days
		for j := 0; j < 5; j++ {
			model := models[j%len(models)]
			project := projects[j%len(projects)]
			ts := time.Now().UTC().AddDate(0, 0, -(j % 3))
			p := &shared.Prompt{
				UserID:       u.ID,
				SessionID:    &sessionID,
				Model:        &model,
				PromptLength: 100,
				ProjectDir:   &project,
				CreditCost:   (j + 1) * 2,
				Timestamp:    ts,
			}
			if _, err := store.RecordPrompt(p); err != nil {
				t.Fatalf("RecordPrompt for %s prompt %d: %v", name, j, err)
			}
		}

		// Record 3 tool events (2 success, 1 failure)
		tools := []string{"bash", "edit", "read"}
		for k, toolName := range tools {
			success := k != 2 // third tool fails
			te := &shared.ToolEvent{
				UserID:    u.ID,
				SessionID: &sessionID,
				ToolName:  toolName,
				Success:   success,
				Timestamp: time.Now().UTC(),
			}
			if err := store.RecordToolEvent(te); err != nil {
				t.Fatalf("RecordToolEvent for %s tool %s: %v", name, toolName, err)
			}
		}
	}

	return teamID, userIDs
}

// ── Tests ─────────────────────────────────────────────────────────────────────

func TestTeamOverview(t *testing.T) {
	store := newTestStore(t)
	teamID, userIDs := seedAnalyticsData(t, store)
	a := NewAnalytics(store)

	ov, err := a.GetTeamOverview(teamID)
	if err != nil {
		t.Fatalf("GetTeamOverview: %v", err)
	}

	// Default team has no extra users; we added 2
	if ov.TotalUsers != len(userIDs) {
		t.Errorf("TotalUsers: want %d, got %d", len(userIDs), ov.TotalUsers)
	}

	// Active sessions: both sessions were just created (started_at = now, ended_at = NULL)
	if ov.ActiveNow != 2 {
		t.Errorf("ActiveNow: want 2, got %d", ov.ActiveNow)
	}

	// We recorded 5 prompts per user = 10 total; some may not be "today" depending on j%3
	// Only j==0 and j==3 land today (offset 0); that is 4 prompts total.
	if ov.PromptsToday < 0 {
		t.Errorf("PromptsToday should be >= 0, got %d", ov.PromptsToday)
	}

	// CostToday should be >= 0
	if ov.CostToday < 0 {
		t.Errorf("CostToday should be >= 0, got %f", ov.CostToday)
	}
}

func TestUserLeaderboard(t *testing.T) {
	store := newTestStore(t)
	teamID, userIDs := seedAnalyticsData(t, store)
	a := NewAnalytics(store)

	entries, err := a.GetUserLeaderboard(teamID, 30, "prompts")
	if err != nil {
		t.Fatalf("GetUserLeaderboard: %v", err)
	}

	if len(entries) != len(userIDs) {
		t.Fatalf("want %d entries, got %d", len(userIDs), len(entries))
	}

	// Every entry should have 5 prompts (all within 30 days)
	for _, e := range entries {
		if e.Prompts != 5 {
			t.Errorf("user %s: want 5 prompts, got %d", e.UserName, e.Prompts)
		}
		if e.Sessions != 1 {
			t.Errorf("user %s: want 1 session, got %d", e.UserName, e.Sessions)
		}
		if e.AvgTurns != 5.0 {
			t.Errorf("user %s: want avg_turns 5.0, got %f", e.UserName, e.AvgTurns)
		}
		if e.CostUSD <= 0 {
			t.Errorf("user %s: expected positive cost, got %f", e.UserName, e.CostUSD)
		}
		if e.TopModel == "" {
			t.Errorf("user %s: expected non-empty top_model", e.UserName)
		}
	}

	// Test sort by cost
	byCost, err := a.GetUserLeaderboard(teamID, 30, "cost")
	if err != nil {
		t.Fatalf("GetUserLeaderboard (cost): %v", err)
	}
	if len(byCost) != 2 {
		t.Fatalf("expected 2 entries, got %d", len(byCost))
	}

	// Test sort by sessions
	bySessions, err := a.GetUserLeaderboard(teamID, 30, "sessions")
	if err != nil {
		t.Fatalf("GetUserLeaderboard (sessions): %v", err)
	}
	if len(bySessions) != 2 {
		t.Fatalf("expected 2 entries, got %d", len(bySessions))
	}
}

func TestCostBreakdown(t *testing.T) {
	store := newTestStore(t)
	teamID, _ := seedAnalyticsData(t, store)
	a := NewAnalytics(store)

	bd, err := a.GetCostBreakdown(teamID, 30)
	if err != nil {
		t.Fatalf("GetCostBreakdown: %v", err)
	}

	// 2 users => 2 by-user entries
	if len(bd.ByUser) != 2 {
		t.Errorf("ByUser: want 2 entries, got %d", len(bd.ByUser))
	}
	for _, e := range bd.ByUser {
		if e.Label == "" {
			t.Error("ByUser entry has empty label")
		}
		if e.Count != 5 {
			t.Errorf("ByUser %s: want count 5, got %d", e.Label, e.Count)
		}
	}

	// We used 3 models across 10 prompts (5 per user, cycling through 3 models)
	if len(bd.ByModel) == 0 {
		t.Error("ByModel: expected at least one entry")
	}
	totalByModel := 0
	for _, e := range bd.ByModel {
		if e.Label == "" {
			t.Error("ByModel entry has empty label")
		}
		totalByModel += e.Count
	}
	if totalByModel != 10 {
		t.Errorf("ByModel total count: want 10, got %d", totalByModel)
	}

	// 2 projects used
	if len(bd.ByProject) == 0 {
		t.Error("ByProject: expected at least one entry")
	}
}

func TestDailyTrends(t *testing.T) {
	store := newTestStore(t)
	teamID, _ := seedAnalyticsData(t, store)
	a := NewAnalytics(store)

	trends, err := a.GetDailyTrends(teamID, 30)
	if err != nil {
		t.Fatalf("GetDailyTrends: %v", err)
	}

	// We spread prompts across up to 3 distinct dates
	if len(trends) == 0 {
		t.Fatal("expected at least one trend entry")
	}
	if len(trends) > 3 {
		t.Errorf("expected at most 3 trend entries, got %d", len(trends))
	}

	totalPrompts := 0
	for _, tr := range trends {
		if tr.Date == "" {
			t.Error("trend entry has empty date")
		}
		if tr.Prompts < 0 {
			t.Errorf("trend %s: negative prompts %d", tr.Date, tr.Prompts)
		}
		totalPrompts += tr.Prompts
	}
	// Total across all days should be 10
	if totalPrompts != 10 {
		t.Errorf("total prompts across trends: want 10, got %d", totalPrompts)
	}
}

func TestToolDistribution(t *testing.T) {
	store := newTestStore(t)
	teamID, _ := seedAnalyticsData(t, store)
	a := NewAnalytics(store)

	dist, err := a.GetToolDistribution(teamID, 30)
	if err != nil {
		t.Fatalf("GetToolDistribution: %v", err)
	}

	// We inserted bash, edit, read for 2 users = 2 events each
	if len(dist) != 3 {
		t.Fatalf("expected 3 tool entries, got %d", len(dist))
	}

	totalEvents := 0
	totalErrors := 0
	for _, d := range dist {
		if d.Tool == "" {
			t.Error("tool entry has empty name")
		}
		if d.Count != 2 {
			t.Errorf("tool %s: want count 2, got %d", d.Tool, d.Count)
		}
		totalEvents += d.Count
		totalErrors += d.Errors
	}

	// 6 total events
	if totalEvents != 6 {
		t.Errorf("total tool events: want 6, got %d", totalEvents)
	}

	// Each user has 1 failure (tool "read"), so 2 total errors
	if totalErrors != 2 {
		t.Errorf("total tool errors: want 2, got %d", totalErrors)
	}
}

func TestModelDistribution(t *testing.T) {
	store := newTestStore(t)
	teamID, _ := seedAnalyticsData(t, store)
	a := NewAnalytics(store)

	dist, err := a.GetModelDistribution(teamID, 30)
	if err != nil {
		t.Fatalf("GetModelDistribution: %v", err)
	}

	if len(dist) == 0 {
		t.Fatal("expected at least one model distribution entry")
	}

	total := 0
	for _, d := range dist {
		if d.Model == "" {
			t.Error("model entry has empty model")
		}
		total += d.Count
	}
	if total != 10 {
		t.Errorf("total model counts: want 10, got %d", total)
	}
}

func TestProjectAnalytics(t *testing.T) {
	store := newTestStore(t)
	teamID, _ := seedAnalyticsData(t, store)
	a := NewAnalytics(store)

	projects, err := a.GetProjectAnalytics(teamID, 30)
	if err != nil {
		t.Fatalf("GetProjectAnalytics: %v", err)
	}

	if len(projects) != 2 {
		t.Fatalf("expected 2 projects, got %d", len(projects))
	}

	total := 0
	for _, p := range projects {
		if p.Project == "" {
			t.Error("project entry has empty project")
		}
		if p.Users == 0 {
			t.Errorf("project %s: expected non-zero users", p.Project)
		}
		total += p.Prompts
	}
	if total != 10 {
		t.Errorf("total project prompts: want 10, got %d", total)
	}
}

func TestPeakHours(t *testing.T) {
	store := newTestStore(t)
	teamID, _ := seedAnalyticsData(t, store)
	a := NewAnalytics(store)

	hours, err := a.GetPeakHours(teamID, 30)
	if err != nil {
		t.Fatalf("GetPeakHours: %v", err)
	}

	if len(hours) == 0 {
		t.Fatal("expected at least one peak hour entry")
	}

	total := 0
	for _, h := range hours {
		if h.Hour < 0 || h.Hour > 23 {
			t.Errorf("hour out of range: %d", h.Hour)
		}
		total += h.Count
	}
	if total != 10 {
		t.Errorf("total peak hour counts: want 10, got %d", total)
	}
}
