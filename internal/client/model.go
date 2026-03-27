package client

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

// sessionModelPath returns the path to the cached session model file.
// Written by SessionStart, read by all other hooks.
func sessionModelPath() string {
	return filepath.Join(ConfigDir(), "session-model.txt")
}

// CacheSessionModel writes the detected model to a file so subsequent hooks
// (which don't receive model in stdin) can read it.
func CacheSessionModel(model string) {
	if model == "" {
		return
	}
	_ = os.WriteFile(sessionModelPath(), []byte(model), 0644)
}

// DetectModel resolves the active model using the same priority chain as
// claude-code-limiter:
//
//  1. stdinModel — passed explicitly in SessionStart stdin
//  2. User settings: ~/.claude/settings.json "model" field
//  3. Project local settings: ./.claude/settings.local.json "model" field
//  4. Project settings: ./.claude/settings.json "model" field
//  5. Cached session-model.txt (written by SessionStart)
//  6. ANTHROPIC_MODEL or CLAUDE_MODEL env vars
//  7. cfg.DefaultModel (set during install from subscription type)
//  8. "sonnet" as ultimate fallback
func DetectModel(stdinModel string, cfg *Config) string {
	// 1. Explicit stdin (only available in SessionStart).
	if stdinModel != "" {
		return stdinModel
	}

	home, _ := os.UserHomeDir()

	// 2. User settings: ~/.claude/settings.json
	if home != "" {
		if m := readModelFromJSON(filepath.Join(home, ".claude", "settings.json")); m != "" {
			return m
		}
	}

	// 3. Project local settings: ./.claude/settings.local.json
	if cwd, err := os.Getwd(); err == nil {
		if m := readModelFromJSON(filepath.Join(cwd, ".claude", "settings.local.json")); m != "" {
			return m
		}
		// 4. Project settings: ./.claude/settings.json
		if m := readModelFromJSON(filepath.Join(cwd, ".claude", "settings.json")); m != "" {
			return m
		}
	}

	// 5. Cached session model (written by SessionStart hook).
	if data, err := os.ReadFile(sessionModelPath()); err == nil {
		if m := strings.TrimSpace(string(data)); m != "" {
			return m
		}
	}

	// 6. Environment variables.
	if m := os.Getenv("ANTHROPIC_MODEL"); m != "" {
		return m
	}
	if m := os.Getenv("CLAUDE_MODEL"); m != "" {
		return m
	}

	// 7. Config default.
	if cfg != nil && cfg.DefaultModel != "" {
		return cfg.DefaultModel
	}

	// 8. Ultimate fallback.
	return "sonnet"
}

// readModelFromJSON reads a "model" field from a JSON settings file.
func readModelFromJSON(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	var settings map[string]any
	if json.Unmarshal(data, &settings) != nil {
		return ""
	}
	if m, ok := settings["model"].(string); ok && m != "" {
		return m
	}
	return ""
}

// NormalizeModel maps a full model identifier to one of the three canonical
// tier names: "opus", "haiku", or "sonnet".
func NormalizeModel(model string) string {
	m := strings.ToLower(model)
	if strings.Contains(m, "opus") {
		return "opus"
	}
	if strings.Contains(m, "haiku") {
		return "haiku"
	}
	return "sonnet"
}
