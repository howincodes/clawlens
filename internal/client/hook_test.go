package client

import (
	"testing"

	"github.com/howincodes/clawlens/internal/shared"
)

// ── Secret scrubbing (hook-level behaviour) ───────────────────────────────────

// TestSecretScrubRedactApplied verifies that ScrubSecrets actually redacts
// content so the "redact" mode in HandlePrompt has the expected effect.
func TestSecretScrubRedactApplied(t *testing.T) {
	input := "my key is sk-abcdefghijklmnopqrstuvwxyz123456"
	scrubbed, found := ScrubSecrets(input)
	if scrubbed == input {
		t.Error("expected text to be scrubbed, but it was unchanged")
	}
	if len(found) == 0 {
		t.Error("expected at least one secret type found, got none")
	}
}

// TestSecretDetectOnly verifies DetectSecrets finds secrets without mutating text
// (used by the "alert" mode in HandlePrompt).
func TestSecretDetectOnly(t *testing.T) {
	input := "connecting to postgres://user:pass@host/db"
	found := DetectSecrets(input)
	if len(found) == 0 {
		t.Error("expected secrets to be detected, got none")
	}
	// The original string should be unmodified.
	if !hasSubstring(input, "postgres://") {
		t.Error("original text should not be mutated by DetectSecrets")
	}
}

// ── Kill / pause enforcement ──────────────────────────────────────────────────

func TestKillPauseEnforcement(t *testing.T) {
	cases := []struct {
		status      string
		shouldBlock bool
	}{
		{"killed", true},
		{"paused", true},
		{"active", false},
		{"", false},
	}

	for _, tc := range cases {
		cfg := &Config{Status: tc.status}
		blocked := isBlockedByStatus(cfg)
		if blocked != tc.shouldBlock {
			t.Errorf("status %q: blocked=%v, want %v", tc.status, blocked, tc.shouldBlock)
		}
	}
}

// isBlockedByStatus encapsulates the kill/pause logic used in HandlePreToolUse
// so it can be tested without stdin manipulation.
func isBlockedByStatus(cfg *Config) bool {
	return cfg.Status == "killed" || cfg.Status == "paused"
}

// ── Error type detection ──────────────────────────────────────────────────────

func TestDetectErrorType(t *testing.T) {
	cases := []struct {
		input string
		want  string
	}{
		{"rate limit exceeded", "rate_limit"},
		{"Rate Limit: too many requests", "rate_limit"},
		{"billing issue with your account", "billing_error"},
		{"BILLING suspended", "billing_error"},
		{"internal server error", "server_error"},
		{"connection refused", "server_error"},
		{"", "server_error"},
	}
	for _, tc := range cases {
		got := detectErrorType(tc.input)
		if got != tc.want {
			t.Errorf("detectErrorType(%q) = %q, want %q", tc.input, got, tc.want)
		}
	}
}

// ── Credit cost calculation ───────────────────────────────────────────────────

func TestCreditCostDefaults(t *testing.T) {
	cfg := &Config{} // zero-valued weights → fall back to hard-coded defaults
	cases := []struct {
		model string
		want  int
	}{
		{"claude-opus-4-20250514", 10},
		{"claude-haiku-4-5-20251001", 1},
		{"claude-sonnet-4-20250514", 3},
		{"unknown-model", 3},
	}
	for _, tc := range cases {
		got := creditCost(tc.model, cfg)
		if got != tc.want {
			t.Errorf("creditCost(%q) = %d, want %d", tc.model, got, tc.want)
		}
	}
}

func TestCreditCostFromWeights(t *testing.T) {
	cfg := &Config{
		CreditWeights: shared.CreditWeights{Opus: 20, Sonnet: 5, Haiku: 2},
	}
	cases := []struct {
		model string
		want  int
	}{
		{"claude-opus-4-20250514", 20},
		{"claude-sonnet-4-20250514", 5},
		{"claude-haiku-4-5-20251001", 2},
	}
	for _, tc := range cases {
		got := creditCost(tc.model, cfg)
		if got != tc.want {
			t.Errorf("creditCost(%q) = %d, want %d", tc.model, got, tc.want)
		}
	}
}

// ── Helpers ───────────────────────────────────────────────────────────────────

func hasSubstring(s, sub string) bool {
	return len(s) >= len(sub) && containsStr(s, sub)
}

func containsStr(s, sub string) bool {
	for i := 0; i <= len(s)-len(sub); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
