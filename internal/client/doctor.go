package client

import (
	"fmt"
	"os"
	"time"
)

// Doctor prints a diagnostic report covering binary version, server
// connectivity, auth validity, managed-settings, queue state, and config.
func Doctor(version string) error {
	fmt.Println("ClawLens Diagnostics")

	// Load config (best-effort — continue even if missing).
	cfg, cfgErr := LoadConfig()

	// Binary version (always available).
	fmt.Printf("  Binary version:     %s\n", version)

	if cfgErr != nil {
		fmt.Printf("  Config:             ✗ not found (%v)\n", cfgErr)
		// Still check managed-settings below.
		printManagedSettings()
		return nil
	}

	fmt.Printf("  Server URL:         %s\n", cfg.ServerURL)

	// Server reachable: GET /api/v1/health with 3 s timeout.
	start := time.Now()
	healthResp, healthErr := serverRequest("GET", cfg.ServerURL+"/api/v1/health", nil, "", 3*time.Second)
	elapsed := time.Since(start)
	if healthErr != nil {
		fmt.Printf("  Server reachable:   ✗ (%v)\n", healthErr)
	} else {
		healthResp.Body.Close()
		if healthResp.StatusCode >= 200 && healthResp.StatusCode < 300 {
			fmt.Printf("  Server reachable:   ✓ (%dms)\n", elapsed.Milliseconds())
		} else {
			fmt.Printf("  Server reachable:   ✗ (HTTP %d)\n", healthResp.StatusCode)
		}
	}

	// Auth token valid: POST a simple request with auth token.
	authResp, authErr := serverRequest("GET", cfg.ServerURL+"/api/v1/health", nil, cfg.AuthToken, 3*time.Second)
	if authErr != nil {
		fmt.Printf("  Auth token valid:   ✗ (%v)\n", authErr)
	} else {
		authResp.Body.Close()
		if authResp.StatusCode == 401 {
			fmt.Printf("  Auth token valid:   ✗ (401 Unauthorized)\n")
		} else {
			fmt.Printf("  Auth token valid:   ✓\n")
		}
	}

	// Managed-settings file.
	printManagedSettings()

	// Queue stats.
	q, qErr := NewQueue(QueueDBPath())
	if qErr != nil {
		fmt.Printf("  Local DB size:      ✗ not found (%v)\n", qErr)
		fmt.Printf("  Unsynced events:    ✗\n")
	} else {
		defer q.Close()

		dbSize, sizeErr := q.DBSize()
		if sizeErr != nil {
			fmt.Printf("  Local DB size:      ✗ not found (%v)\n", sizeErr)
		} else {
			fmt.Printf("  Local DB size:      %s\n", formatBytes(dbSize))
		}

		unsynced, ucErr := q.UnsyncedCount()
		if ucErr != nil {
			fmt.Printf("  Unsynced events:    ✗ (%v)\n", ucErr)
		} else {
			fmt.Printf("  Unsynced events:    %d\n", unsynced)
		}
	}

	// Last sync.
	if cfg.LastSync.IsZero() {
		fmt.Printf("  Last sync:          never\n")
	} else {
		ago := time.Since(cfg.LastSync)
		fmt.Printf("  Last sync:          %s ago\n", formatDuration(ago))
	}

	fmt.Printf("  Collection level:   %s\n", cfg.CollectionLevel)
	fmt.Printf("  Secret scrubbing:   %s\n", cfg.SecretScrub)
	fmt.Printf("  Client version:     %s\n", version)

	return nil
}

// printManagedSettings checks whether the managed-settings file exists and
// prints a single diagnostic line.
func printManagedSettings() {
	msPath := ManagedSettingsPath()
	if _, err := os.Stat(msPath); err == nil {
		fmt.Printf("  managed-settings:   ✓ configured\n")
	} else {
		fmt.Printf("  managed-settings:   ✗ missing\n")
	}
}

// formatDuration formats a duration as a human-readable string.
func formatDuration(d time.Duration) string {
	switch {
	case d < time.Minute:
		return fmt.Sprintf("%ds", int(d.Seconds()))
	case d < time.Hour:
		return fmt.Sprintf("%dm", int(d.Minutes()))
	case d < 24*time.Hour:
		return fmt.Sprintf("%dh", int(d.Hours()))
	default:
		return fmt.Sprintf("%dd", int(d.Hours()/24))
	}
}
