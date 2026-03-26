package client

import (
	"path/filepath"
	"testing"
	"time"
)

func TestConfigRoundTrip(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")

	original := &Config{
		ServerURL:        "https://example.com",
		AuthToken:        "tok-abc123",
		UserID:           "user-1",
		TeamID:           "team-1",
		Status:           "active",
		DefaultModel:     "sonnet",
		SyncInterval:     60,
		CollectionLevel:  "full",
		CollectResponses: true,
		SecretScrub:      "strict",
		PromptMaxLength:  4096,
		ClientVersion:    "1.0.0",
		LastSync:         time.Date(2025, 1, 15, 10, 0, 0, 0, time.UTC),
	}

	if err := saveConfigTo(path, original); err != nil {
		t.Fatalf("saveConfigTo: %v", err)
	}

	loaded, err := LoadConfigFrom(path)
	if err != nil {
		t.Fatalf("LoadConfigFrom: %v", err)
	}

	if loaded.ServerURL != original.ServerURL {
		t.Errorf("ServerURL: got %q, want %q", loaded.ServerURL, original.ServerURL)
	}
	if loaded.AuthToken != original.AuthToken {
		t.Errorf("AuthToken: got %q, want %q", loaded.AuthToken, original.AuthToken)
	}
	if loaded.UserID != original.UserID {
		t.Errorf("UserID: got %q, want %q", loaded.UserID, original.UserID)
	}
	if loaded.TeamID != original.TeamID {
		t.Errorf("TeamID: got %q, want %q", loaded.TeamID, original.TeamID)
	}
	if loaded.Status != original.Status {
		t.Errorf("Status: got %q, want %q", loaded.Status, original.Status)
	}
	if loaded.DefaultModel != original.DefaultModel {
		t.Errorf("DefaultModel: got %q, want %q", loaded.DefaultModel, original.DefaultModel)
	}
	if loaded.SyncInterval != original.SyncInterval {
		t.Errorf("SyncInterval: got %d, want %d", loaded.SyncInterval, original.SyncInterval)
	}
	if loaded.CollectionLevel != original.CollectionLevel {
		t.Errorf("CollectionLevel: got %q, want %q", loaded.CollectionLevel, original.CollectionLevel)
	}
	if loaded.CollectResponses != original.CollectResponses {
		t.Errorf("CollectResponses: got %v, want %v", loaded.CollectResponses, original.CollectResponses)
	}
	if loaded.SecretScrub != original.SecretScrub {
		t.Errorf("SecretScrub: got %q, want %q", loaded.SecretScrub, original.SecretScrub)
	}
	if loaded.PromptMaxLength != original.PromptMaxLength {
		t.Errorf("PromptMaxLength: got %d, want %d", loaded.PromptMaxLength, original.PromptMaxLength)
	}
	if loaded.ClientVersion != original.ClientVersion {
		t.Errorf("ClientVersion: got %q, want %q", loaded.ClientVersion, original.ClientVersion)
	}
	if !loaded.LastSync.Equal(original.LastSync) {
		t.Errorf("LastSync: got %v, want %v", loaded.LastSync, original.LastSync)
	}
}

func TestLoadConfigFromMissing(t *testing.T) {
	_, err := LoadConfigFrom("/nonexistent/path/config.json")
	if err == nil {
		t.Error("expected error for missing file, got nil")
	}
}

func TestConfigDir(t *testing.T) {
	dir := ConfigDir()
	if dir == "" {
		t.Error("ConfigDir() returned empty string")
	}
}

func TestConfigPaths(t *testing.T) {
	cp := ConfigPath()
	if cp == "" {
		t.Error("ConfigPath() returned empty string")
	}

	qp := QueueDBPath()
	if qp == "" {
		t.Error("QueueDBPath() returned empty string")
	}

	mp := ManagedSettingsPath()
	if mp == "" {
		t.Error("ManagedSettingsPath() returned empty string")
	}
}
