package client

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestDetectModelFromStdin(t *testing.T) {
	model := DetectModel("claude-opus-4-20250514", nil)
	if model != "claude-opus-4-20250514" {
		t.Errorf("got %q, want %q", model, "claude-opus-4-20250514")
	}
}

func TestDetectModelFromConfig(t *testing.T) {
	// No settings.json present; rely on cfg.DefaultModel.
	// We temporarily point HOME somewhere empty to avoid picking up a real
	// ~/.claude/settings.json on the test machine.
	t.Setenv("HOME", t.TempDir())

	cfg := &Config{DefaultModel: "claude-haiku-4-5-20251001"}
	model := DetectModel("", cfg)
	if model != "claude-haiku-4-5-20251001" {
		t.Errorf("got %q, want %q", model, "claude-haiku-4-5-20251001")
	}
}

func TestDetectModelFallback(t *testing.T) {
	// No stdin, no settings.json, no config.
	t.Setenv("HOME", t.TempDir())

	model := DetectModel("", nil)
	if model != "sonnet" {
		t.Errorf("got %q, want %q", model, "sonnet")
	}
}

func TestDetectModelFromSettingsJSON(t *testing.T) {
	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)

	claudeDir := filepath.Join(tmpHome, ".claude")
	if err := os.MkdirAll(claudeDir, 0755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}

	settings := map[string]any{"model": "claude-sonnet-4-20250514"}
	data, _ := json.Marshal(settings)
	if err := os.WriteFile(filepath.Join(claudeDir, "settings.json"), data, 0644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	model := DetectModel("", nil)
	if model != "claude-sonnet-4-20250514" {
		t.Errorf("got %q, want %q", model, "claude-sonnet-4-20250514")
	}
}

func TestNormalizeModel(t *testing.T) {
	cases := []struct {
		input string
		want  string
	}{
		{"claude-opus-4-20250514", "opus"},
		{"claude-sonnet-4-20250514", "sonnet"},
		{"claude-haiku-4-5-20251001", "haiku"},
		{"unknown", "sonnet"},
		{"CLAUDE-OPUS-LATEST", "opus"},
		{"", "sonnet"},
	}

	for _, tc := range cases {
		got := NormalizeModel(tc.input)
		if got != tc.want {
			t.Errorf("NormalizeModel(%q) = %q, want %q", tc.input, got, tc.want)
		}
	}
}
