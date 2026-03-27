package client

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/howincodes/clawlens/internal/shared"
)

// claudeJSON mirrors the structure of ~/.claude.json for subscription detection.
type claudeJSON struct {
	OauthAccount struct {
		PlanType     string `json:"planType"`
		EmailAddress string `json:"emailAddress"`
	} `json:"oauthAccount"`
}

// managedSettings is the structure written to managed-settings.json.
type managedSettings struct {
	AllowManagedHooksOnly bool                          `json:"allowManagedHooksOnly"`
	Hooks                 map[string][]managedHookEntry `json:"hooks"`
}

type managedHookEntry struct {
	Matcher string        `json:"matcher,omitempty"`
	Hooks   []hookCommand `json:"hooks"`
}

type hookCommand struct {
	Type    string `json:"type"`
	Command string `json:"command"`
	Timeout int    `json:"timeout"`
}

// Setup installs ClawLens by registering with the server and writing all
// necessary configuration and hook files to disk.
func Setup(code, serverURL string) error {
	// 1. Check running as root.
	if os.Geteuid() != 0 {
		fmt.Fprintln(os.Stderr, "Warning: not running as root — some write operations may fail")
	}

	// 2. Check Claude Code is installed.
	if _, err := exec.Command("claude", "--version").Output(); err != nil {
		fmt.Fprintln(os.Stderr, "Warning: 'claude' not found in PATH — is Claude Code installed?")
	}

	// 3. Detect subscription from ~/.claude.json.
	var subscriptionType, subscriptionEmail string
	claudeHome := actualHomeDir()
	if claudeHome != "" {
		claudeJSONPath := claudeHome + "/.claude.json"
		if data, err := os.ReadFile(claudeJSONPath); err == nil {
			var cj claudeJSON
			if json.Unmarshal(data, &cj) == nil {
				subscriptionType = cj.OauthAccount.PlanType
				subscriptionEmail = cj.OauthAccount.EmailAddress
			}
		}
	}

	_ = subscriptionType
	_ = subscriptionEmail

	// 4. POST /api/v1/register with the install code.
	regReq := shared.RegisterRequest{Code: code}
	url := serverURL + "/api/v1/register"
	resp, err := serverRequest("POST", url, regReq, "", 10*time.Second)
	if err != nil {
		return fmt.Errorf("register: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("register: server returned %d", resp.StatusCode)
	}

	var regResp shared.RegisterResponse
	if err := json.NewDecoder(resp.Body).Decode(&regResp); err != nil {
		return fmt.Errorf("register: decode response: %w", err)
	}

	// 5. Build Config from response.
	s := regResp.Settings
	cfg := &Config{
		ServerURL:        serverURL,
		AuthToken:        regResp.AuthToken,
		UserID:           regResp.UserID,
		Status:           "active",
		CollectionLevel:  s.CollectionLevel,
		CollectResponses: s.CollectResponses,
		SecretScrub:      s.SecretScrub,
		PromptMaxLength:  s.PromptMaxLength,
		SyncInterval:     s.SyncIntervalSeconds,
		CreditWeights:    s.CreditWeights,
	}

	// 6. Create config directory.
	if err := os.MkdirAll(ConfigDir(), 0755); err != nil {
		return fmt.Errorf("create config dir: %w", err)
	}

	// 7. Save config.json.
	if err := SaveConfig(cfg); err != nil {
		return fmt.Errorf("save config: %w", err)
	}

	// 8. Initialize local queue DB.
	q, err := NewQueue(QueueDBPath())
	if err != nil {
		return fmt.Errorf("init queue db: %w", err)
	}
	q.Close()

	// 9. Write managed-settings.json.
	// Detect the actual binary path (works on macOS, Linux, Windows)
	binaryPath, err := os.Executable()
	if err != nil {
		binaryPath = "clawlens" // fallback to PATH lookup
	}
	// Claude Code runs hooks via bash — backslashes get eaten.
	// Convert to forward slashes and quote the path for spaces.
	binaryPath = strings.ReplaceAll(binaryPath, "\\", "/")
	if strings.Contains(binaryPath, " ") {
		binaryPath = "\"" + binaryPath + "\""
	}

	hook := func(action string, timeout int) managedHookEntry {
		return managedHookEntry{
			Hooks: []hookCommand{
				{Type: "command", Command: fmt.Sprintf("%s hook %s", binaryPath, action), Timeout: timeout},
			},
		}
	}
	hookWithMatcher := func(action string, timeout int) managedHookEntry {
		e := hook(action, timeout)
		e.Matcher = ""
		return e
	}

	ms := managedSettings{
		AllowManagedHooksOnly: true,
		Hooks: map[string][]managedHookEntry{
			"SessionStart":    {hookWithMatcher("session-start", 10)},
			"UserPromptSubmit": {hook("prompt", 5)},
			"PreToolUse":      {hook("pre-tool", 2)},
			"Stop":            {hook("stop", 5)},
			"StopFailure":     {hookWithMatcher("stop-error", 2)},
			"SessionEnd":      {hookWithMatcher("session-end", 3)},
		},
	}

	msData, err := json.MarshalIndent(ms, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal managed-settings: %w", err)
	}

	// Ensure the parent directory exists.
	msPath := ManagedSettingsPath()
	if err := os.MkdirAll(dirOf(msPath), 0755); err != nil {
		return fmt.Errorf("create managed-settings dir: %w", err)
	}

	if err := os.WriteFile(msPath, msData, 0644); err != nil {
		return fmt.Errorf("write managed-settings: %w", err)
	}

	// 10. Print success message.
	fmt.Printf("ClawLens installed successfully!\n")
	fmt.Printf("  User ID:    %s\n", cfg.UserID)
	fmt.Printf("  Server URL: %s\n", cfg.ServerURL)
	fmt.Printf("  Config dir: %s\n", ConfigDir())
	return nil
}

// Uninstall removes the managed-settings file and config directory.
func Uninstall() error {
	// 1. Remove managed-settings.json (ignore if not exists).
	if err := os.Remove(ManagedSettingsPath()); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("remove managed-settings: %w", err)
	}

	// 2. Remove config directory.
	if err := os.RemoveAll(ConfigDir()); err != nil {
		return fmt.Errorf("remove config dir: %w", err)
	}

	// 3. Print success.
	fmt.Println("ClawLens uninstalled successfully.")
	return nil
}

// Status loads the config and prints current ClawLens status information.
func Status() error {
	cfg, err := LoadConfig()
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}

	fmt.Printf("ClawLens Status\n")
	fmt.Printf("  Server URL:       %s\n", cfg.ServerURL)
	fmt.Printf("  User ID:          %s\n", cfg.UserID)
	fmt.Printf("  Status:           %s\n", cfg.Status)
	fmt.Printf("  Collection level: %s\n", cfg.CollectionLevel)
	fmt.Printf("  Secret scrub:     %s\n", cfg.SecretScrub)

	if cfg.LastSync.IsZero() {
		fmt.Printf("  Last sync:        never\n")
	} else {
		fmt.Printf("  Last sync:        %s\n", cfg.LastSync.Local().Format("2006-01-02 15:04:05"))
	}

	// Queue stats.
	q, err := NewQueue(QueueDBPath())
	if err != nil {
		fmt.Printf("  Queue:            ✗ unavailable (%v)\n", err)
		return nil
	}
	defer q.Close()

	unsynced, err := q.UnsyncedCount()
	if err != nil {
		fmt.Printf("  Unsynced events:  ✗ (%v)\n", err)
	} else {
		fmt.Printf("  Unsynced events:  %d\n", unsynced)
	}

	dbSize, err := q.DBSize()
	if err != nil {
		fmt.Printf("  DB size:          ✗ (%v)\n", err)
	} else {
		fmt.Printf("  DB size:          %s\n", formatBytes(dbSize))
	}

	return nil
}

// SyncNow forces an immediate sync cycle.
func SyncNow() error {
	cfg, err := LoadConfig()
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}

	q, err := NewQueue(QueueDBPath())
	if err != nil {
		return fmt.Errorf("open queue: %w", err)
	}
	defer q.Close()

	s := NewSyncer(q, cfg)
	if err := s.syncBatch(); err != nil {
		return fmt.Errorf("sync: %w", err)
	}

	fmt.Println("Sync complete.")
	return nil
}

// actualHomeDir returns the real user's home directory, accounting for sudo.
func actualHomeDir() string {
	if sudoUser := os.Getenv("SUDO_USER"); sudoUser != "" {
		// Best effort: try /Users/<user> on macOS and /home/<user> on Linux.
		if home := "/Users/" + sudoUser; dirExists(home) {
			return home
		}
		if home := "/home/" + sudoUser; dirExists(home) {
			return home
		}
	}
	home, _ := os.UserHomeDir()
	return home
}

func dirExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

// dirOf returns the directory portion of a file path.
func dirOf(path string) string {
	for i := len(path) - 1; i >= 0; i-- {
		if path[i] == '/' || path[i] == '\\' {
			return path[:i]
		}
	}
	return "."
}

// formatBytes formats a byte count as a human-readable string.
func formatBytes(b int64) string {
	switch {
	case b >= 1024*1024:
		return fmt.Sprintf("%.1f MB", float64(b)/1024/1024)
	case b >= 1024:
		return fmt.Sprintf("%.1f KB", float64(b)/1024)
	default:
		return fmt.Sprintf("%d B", b)
	}
}
