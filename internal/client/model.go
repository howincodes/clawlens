package client

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

// DetectModel resolves the model to use for a new session using the following
// priority order:
//  1. stdinModel – passed explicitly via command-line / stdin
//  2. ~/.claude/settings.json "model" field
//  3. cfg.DefaultModel
//  4. "sonnet" as the ultimate fallback
func DetectModel(stdinModel string, cfg *Config) string {
	// 1. Explicit stdin override.
	if stdinModel != "" {
		return stdinModel
	}

	// 2. ~/.claude/settings.json
	home, _ := os.UserHomeDir()
	if home != "" {
		settingsPath := filepath.Join(home, ".claude", "settings.json")
		if data, err := os.ReadFile(settingsPath); err == nil {
			var settings map[string]any
			if json.Unmarshal(data, &settings) == nil {
				if m, ok := settings["model"].(string); ok && m != "" {
					return m
				}
			}
		}
	}

	// 3. Config default.
	if cfg != nil && cfg.DefaultModel != "" {
		return cfg.DefaultModel
	}

	// 4. Ultimate fallback.
	return "sonnet"
}

// NormalizeModel maps a full model identifier to one of the three canonical
// tier names used internally: "opus", "haiku", or "sonnet".
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
