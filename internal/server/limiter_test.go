package server

import (
	"testing"
	"time"

	"github.com/howincodes/clawlens/internal/shared"
)

// defaultWeights is the standard credit weight configuration used in tests.
var defaultWeights = shared.CreditWeights{
	Opus:   10,
	Sonnet: 3,
	Haiku:  1,
}

// makeUserWithStatus creates and persists a user with the given status.
func makeUserWithStatus(t *testing.T, store *Store, slug, status string) *shared.User {
	t.Helper()
	u := &shared.User{
		ID:        shared.GenerateID(),
		TeamID:    "default",
		Slug:      slug,
		Name:      slug,
		AuthToken: shared.GenerateToken(),
		Status:    status,
	}
	if err := store.CreateUser(u); err != nil {
		t.Fatalf("CreateUser %s: %v", slug, err)
	}
	return u
}

// addPrompt records a prompt with the given model and credit cost.
func addPrompt(t *testing.T, store *Store, userID, model string, cost int) {
	t.Helper()
	p := &shared.Prompt{
		UserID:       userID,
		Model:        &model,
		PromptLength: 10,
		CreditCost:   cost,
		Timestamp:    time.Now(),
	}
	if _, err := store.RecordPrompt(p); err != nil {
		t.Fatalf("RecordPrompt: %v", err)
	}
}

// addRule appends a limit rule for the user.
func addRule(t *testing.T, store *Store, rule shared.LimitRule) {
	t.Helper()
	existing, err := store.GetLimitRules(rule.UserID)
	if err != nil {
		t.Fatalf("GetLimitRules: %v", err)
	}
	existing = append(existing, rule)
	if err := store.ReplaceLimitRules(rule.UserID, existing); err != nil {
		t.Fatalf("ReplaceLimitRules: %v", err)
	}
}

// ── Status tests ──────────────────────────────────────────────────────────────

func TestEvaluateLimits_KilledUser(t *testing.T) {
	store := newTestStore(t)
	user := makeUserWithStatus(t, store, "killed-user", "killed")

	result := EvaluateLimits(store, user, "claude-sonnet-4", defaultWeights)
	if result.Allowed {
		t.Error("expected killed user to be blocked")
	}
	if result.Reason == nil {
		t.Error("expected a reason for blocked user")
	}
}

func TestEvaluateLimits_PausedUser(t *testing.T) {
	store := newTestStore(t)
	user := makeUserWithStatus(t, store, "paused-user", "paused")

	result := EvaluateLimits(store, user, "claude-sonnet-4", defaultWeights)
	if result.Allowed {
		t.Error("expected paused user to be blocked")
	}
	if result.Reason == nil {
		t.Error("expected a reason for blocked user")
	}
}

func TestEvaluateLimits_NoRules(t *testing.T) {
	store := newTestStore(t)
	user := makeUserWithStatus(t, store, "free-user", "active")

	result := EvaluateLimits(store, user, "claude-sonnet-4", defaultWeights)
	if !result.Allowed {
		t.Errorf("expected active user with no rules to be allowed, got blocked: %v", result.Reason)
	}
}

// ── Credit limit tests ─────────────────────────────────────────────────────────

func TestEvaluateLimits_CreditLimit_Allowed(t *testing.T) {
	store := newTestStore(t)
	user := makeUserWithStatus(t, store, "credit-user-ok", "active")

	limit := 20
	window := "daily"
	rule := shared.LimitRule{
		ID:     shared.GenerateID(),
		UserID: user.ID,
		Type:   "credits",
		Window: &window,
		Value:  &limit,
	}
	addRule(t, store, rule)

	// Add 15 credits — under limit.
	addPrompt(t, store, user.ID, "claude-sonnet-4", 15)

	result := EvaluateLimits(store, user, "claude-sonnet-4", defaultWeights)
	if !result.Allowed {
		t.Errorf("expected allowed (15 < 20), got blocked: %v", result.Reason)
	}
}

func TestEvaluateLimits_CreditLimit_Blocked(t *testing.T) {
	store := newTestStore(t)
	user := makeUserWithStatus(t, store, "credit-user-blocked", "active")

	limit := 20
	window := "daily"
	rule := shared.LimitRule{
		ID:     shared.GenerateID(),
		UserID: user.ID,
		Type:   "credits",
		Window: &window,
		Value:  &limit,
	}
	addRule(t, store, rule)

	// Add exactly 20 credits — at limit, should be blocked.
	addPrompt(t, store, user.ID, "claude-sonnet-4", 20)

	result := EvaluateLimits(store, user, "claude-sonnet-4", defaultWeights)
	if result.Allowed {
		t.Error("expected blocked (used == limit), got allowed")
	}
}

// ── Per-model limit tests ──────────────────────────────────────────────────────

func TestEvaluateLimits_PerModelLimit_Blocked(t *testing.T) {
	store := newTestStore(t)
	user := makeUserWithStatus(t, store, "model-user", "active")

	limit := 5
	window := "daily"
	modelName := "claude-opus-4"
	rule := shared.LimitRule{
		ID:     shared.GenerateID(),
		UserID: user.ID,
		Type:   "per_model",
		Model:  &modelName,
		Window: &window,
		Value:  &limit,
	}
	addRule(t, store, rule)

	// Record 5 opus prompts.
	for i := 0; i < 5; i++ {
		addPrompt(t, store, user.ID, modelName, 10)
	}

	result := EvaluateLimits(store, user, modelName, defaultWeights)
	if result.Allowed {
		t.Error("expected blocked after 5 opus prompts at limit 5")
	}
}

func TestEvaluateLimits_PerModelLimit_OtherModelAllowed(t *testing.T) {
	store := newTestStore(t)
	user := makeUserWithStatus(t, store, "model-user2", "active")

	limit := 5
	window := "daily"
	modelName := "claude-opus-4"
	rule := shared.LimitRule{
		ID:     shared.GenerateID(),
		UserID: user.ID,
		Type:   "per_model",
		Model:  &modelName,
		Window: &window,
		Value:  &limit,
	}
	addRule(t, store, rule)

	// Hit the opus limit.
	for i := 0; i < 5; i++ {
		addPrompt(t, store, user.ID, modelName, 10)
	}

	// Sonnet should still be allowed.
	result := EvaluateLimits(store, user, "claude-sonnet-4", defaultWeights)
	if !result.Allowed {
		t.Errorf("expected sonnet to be allowed when only opus is at limit, got: %v", result.Reason)
	}
}

// ── CreditCost tests ──────────────────────────────────────────────────────────

func TestCreditCost(t *testing.T) {
	weights := shared.CreditWeights{Opus: 10, Sonnet: 3, Haiku: 1}

	cases := []struct {
		model    string
		expected int
	}{
		{"claude-opus-4", 10},
		{"claude-opus-4-5", 10},
		{"CLAUDE-OPUS-3", 10},
		{"claude-haiku-3", 1},
		{"claude-haiku-3-5", 1},
		{"claude-sonnet-4", 3},
		{"claude-sonnet-4-5", 3},
		{"unknown-model", 3}, // default → sonnet
		{"", 3},
	}

	for _, tc := range cases {
		t.Run(tc.model, func(t *testing.T) {
			got := CreditCost(tc.model, weights)
			if got != tc.expected {
				t.Errorf("CreditCost(%q) = %d, want %d", tc.model, got, tc.expected)
			}
		})
	}
}

// ── windowStart tests ─────────────────────────────────────────────────────────

func TestWindowStart(t *testing.T) {
	utc := "UTC"

	t.Run("daily", func(t *testing.T) {
		ws := windowStart("daily", &utc)
		now := time.Now().UTC()
		expected := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
		if !ws.Equal(expected) {
			t.Errorf("daily windowStart = %v, want %v", ws, expected)
		}
	})

	t.Run("weekly", func(t *testing.T) {
		ws := windowStart("weekly", &utc)
		now := time.Now().UTC()
		// The result should be a Monday midnight.
		if ws.Weekday() != time.Monday {
			t.Errorf("weekly windowStart weekday = %v, want Monday", ws.Weekday())
		}
		// It should be at midnight.
		h, m, s := ws.Clock()
		if h != 0 || m != 0 || s != 0 {
			t.Errorf("weekly windowStart time = %02d:%02d:%02d, want 00:00:00", h, m, s)
		}
		// It should be in the past or today.
		if ws.After(now) {
			t.Errorf("weekly windowStart %v is in the future", ws)
		}
	})

	t.Run("monthly", func(t *testing.T) {
		ws := windowStart("monthly", &utc)
		now := time.Now().UTC()
		if ws.Day() != 1 {
			t.Errorf("monthly windowStart day = %d, want 1", ws.Day())
		}
		if ws.Month() != now.Month() || ws.Year() != now.Year() {
			t.Errorf("monthly windowStart = %v, want same month/year as now", ws)
		}
	})

	t.Run("sliding_24h", func(t *testing.T) {
		before := time.Now().Add(-24 * time.Hour)
		ws := windowStart("sliding_24h", &utc)
		after := time.Now().Add(-24 * time.Hour)

		if ws.Before(before.Add(-time.Second)) || ws.After(after.Add(time.Second)) {
			t.Errorf("sliding_24h windowStart %v not within expected range [%v, %v]", ws, before, after)
		}
	})

	t.Run("default", func(t *testing.T) {
		before := time.Now().Add(-24 * time.Hour)
		ws := windowStart("unknown", &utc)
		after := time.Now().Add(-24 * time.Hour)

		if ws.Before(before.Add(-time.Second)) || ws.After(after.Add(time.Second)) {
			t.Errorf("default windowStart %v not within expected range", ws)
		}
	})

	t.Run("nil_tz_uses_UTC", func(t *testing.T) {
		ws := windowStart("daily", nil)
		now := time.Now().UTC()
		expected := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
		if !ws.Equal(expected) {
			t.Errorf("nil tz daily windowStart = %v, want %v", ws, expected)
		}
	})
}
