package client

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"time"
)

// Config holds the local client configuration persisted to disk.
type Config struct {
	ServerURL        string    `json:"server_url"`
	AuthToken        string    `json:"auth_token"`
	UserID           string    `json:"user_id"`
	TeamID           string    `json:"team_id"`
	Status           string    `json:"status"`
	DefaultModel     string    `json:"default_model"`
	SyncInterval     int       `json:"sync_interval"`
	CollectionLevel  string    `json:"collection_level"`
	CollectResponses bool      `json:"collect_responses"`
	SecretScrub      string    `json:"secret_scrub"`
	PromptMaxLength  int       `json:"prompt_max_length"`
	ClientVersion    string    `json:"client_version"`
	LastSync         time.Time `json:"last_sync"`
}

// ConfigDir returns the platform-specific directory where ClawLens stores its
// configuration and queue database.
func ConfigDir() string {
	switch runtime.GOOS {
	case "darwin":
		return "/Library/Application Support/ClaudeCode/clawlens/"
	case "windows":
		return `C:\Program Files\ClaudeCode\clawlens\`
	default: // linux and others
		return "/etc/claude-code/clawlens/"
	}
}

// ConfigPath returns the full path to the config.json file.
func ConfigPath() string {
	return filepath.Join(ConfigDir(), "config.json")
}

// QueueDBPath returns the full path to the queue.db SQLite file.
func QueueDBPath() string {
	return filepath.Join(ConfigDir(), "queue.db")
}

// ManagedSettingsPath returns the platform-specific path to the managed
// settings file written by MDM/IT tooling.
func ManagedSettingsPath() string {
	switch runtime.GOOS {
	case "darwin":
		return "/Library/Application Support/ClaudeCode/managed-settings.json"
	case "windows":
		return `C:\Program Files\ClaudeCode\managed-settings.json`
	default:
		return "/etc/claude-code/managed-settings.json"
	}
}

// LoadConfig reads and unmarshals the config from the default platform path.
func LoadConfig() (*Config, error) {
	return LoadConfigFrom(ConfigPath())
}

// LoadConfigFrom reads and unmarshals the config from the given path.
// Useful for tests that supply a temporary path.
func LoadConfigFrom(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}

// SaveConfig marshals cfg and writes it to the default platform path with
// permissions 0644.
func SaveConfig(cfg *Config) error {
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(ConfigPath(), data, 0644)
}

// saveConfigTo is the internal helper used by tests (and SaveConfig) to write
// to an arbitrary path.
func saveConfigTo(path string, cfg *Config) error {
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0644)
}
