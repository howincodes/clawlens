package client

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/howincodes/clawlens/internal/shared"
)

// stdinData is a permissive struct that covers all hook stdin payloads.
// Field names match what Claude Code actually sends on stdin.
type stdinData struct {
	SessionID           string          `json:"session_id"`
	Prompt              string          `json:"prompt"`                // UserPromptSubmit (Claude Code uses "prompt")
	Input               string          `json:"input"`                // UserPromptSubmit (fallback field name)
	ToolName            string          `json:"tool_name"`            // PreToolUse
	ToolInput           json.RawMessage `json:"tool_input"`           // PreToolUse
	LastAssistantMessage string         `json:"last_assistant_message"` // Stop (Claude Code uses this)
	Response            string          `json:"response"`             // Stop (fallback)
	StopReason          string          `json:"stop_reason"`          // Stop
	StopHookActive      bool            `json:"stop_hook_active"`
	Error               string          `json:"error"`                // StopFailure
	CWD                 string          `json:"cwd"`
	Model               string          `json:"model"`
	Source              string          `json:"source"`               // SessionStart
	Reason              string          `json:"reason"`               // SessionEnd
	HookEventName       string          `json:"hook_event_name"`
	PermissionMode      string          `json:"permission_mode"`
	TranscriptPath      string          `json:"transcript_path"`
}

// readStdin reads all of stdin and returns it as a raw JSON message.
func readStdin() (json.RawMessage, error) {
	data, err := io.ReadAll(os.Stdin)
	if err != nil {
		return nil, err
	}
	return json.RawMessage(data), nil
}

// debugLog writes a debug line to stderr when CLAWLENS_DEBUG is set.
func debugLog(format string, args ...any) {
	if os.Getenv("CLAWLENS_DEBUG") != "" {
		fmt.Fprintf(os.Stderr, "[clawlens] "+format+"\n", args...)
	}
}

// serverRequest performs an HTTP request with an optional JSON body and auth token.
func serverRequest(method, url string, body any, authToken string, timeout time.Duration) (*http.Response, error) {
	var bodyReader io.Reader
	if body != nil {
		data, _ := json.Marshal(body)
		bodyReader = bytes.NewReader(data)
	}
	req, err := http.NewRequest(method, url, bodyReader)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if authToken != "" {
		req.Header.Set("Authorization", "Bearer "+authToken)
	}
	client := &http.Client{Timeout: timeout}
	return client.Do(req)
}

// creditCost returns the credit weight for the given model using the config's
// stored weights. Mirrors server.CreditCost without importing the server package.
func creditCost(model string, cfg *Config) int {
	lower := strings.ToLower(model)
	switch {
	case strings.Contains(lower, "opus"):
		// Fallback to a sensible default when weights are zero-valued.
		if cfg != nil && cfg.CreditWeights.Opus > 0 {
			return cfg.CreditWeights.Opus
		}
		return 10
	case strings.Contains(lower, "haiku"):
		if cfg != nil && cfg.CreditWeights.Haiku > 0 {
			return cfg.CreditWeights.Haiku
		}
		return 1
	default:
		if cfg != nil && cfg.CreditWeights.Sonnet > 0 {
			return cfg.CreditWeights.Sonnet
		}
		return 3
	}
}

// detectErrorType classifies an error string into a canonical category.
func detectErrorType(errText string) string {
	lower := strings.ToLower(errText)
	switch {
	case strings.Contains(lower, "rate limit"):
		return "rate_limit"
	case strings.Contains(lower, "billing"):
		return "billing_error"
	default:
		return "server_error"
	}
}

// blockDecision writes a Claude Code block decision JSON to stdout.
func blockDecision(reason string) error {
	type decision struct {
		Decision string `json:"decision"`
		Reason   string `json:"reason"`
	}
	return json.NewEncoder(os.Stdout).Encode(decision{Decision: "block", Reason: reason})
}

// ── Hook handlers ─────────────────────────────────────────────────────────────

// HandleSessionStart handles the SessionStart hook. It registers the session
// with the server and caches the returned settings locally.
func HandleSessionStart(cfg *Config, queue *Queue) error {
	raw, err := readStdin()
	if err != nil {
		return fmt.Errorf("read stdin: %w", err)
	}

	var sd stdinData
	if err := json.Unmarshal(raw, &sd); err != nil {
		debugLog("session_start: unmarshal stdin: %v", err)
	}

	hostname, _ := os.Hostname()
	model := DetectModel(sd.Model, cfg)

	req := shared.SessionStartRequest{
		SessionID:     sd.SessionID,
		Model:         model,
		CWD:           sd.CWD,
		Hostname:      hostname,
		Platform:      runtime.GOOS,
		Arch:          runtime.GOARCH,
		OSVersion:     runtime.GOOS, // best effort; full version requires syscall
		GoVersion:     runtime.Version(),
		ClientVersion: cfg.ClientVersion,
	}

	debugLog("session_start: session=%s model=%s", req.SessionID, req.Model)

	url := cfg.ServerURL + "/api/v1/session-start"
	resp, err := serverRequest("POST", url, req, cfg.AuthToken, 3*time.Second)
	if err != nil {
		debugLog("session_start: server error: %v", err)
		return nil // fail-open
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		debugLog("session_start: non-2xx status %d", resp.StatusCode)
		return nil // fail-open
	}

	var ssResp shared.SessionStartResponse
	if err := json.NewDecoder(resp.Body).Decode(&ssResp); err != nil {
		debugLog("session_start: decode response: %v", err)
		return nil
	}

	// Cache settings from server into config.
	cfg.Status = ssResp.Status
	if ssResp.SyncInterval > 0 {
		cfg.SyncInterval = ssResp.SyncInterval
	}
	s := ssResp.Settings
	cfg.CollectionLevel = s.CollectionLevel
	cfg.CollectResponses = s.CollectResponses
	cfg.SecretScrub = s.SecretScrub
	if s.PromptMaxLength > 0 {
		cfg.PromptMaxLength = s.PromptMaxLength
	}
	cfg.CreditWeights = s.CreditWeights

	if err := SaveConfig(cfg); err != nil {
		debugLog("session_start: save config: %v", err)
	}

	debugLog("session_start: status=%s sync_interval=%d", cfg.Status, cfg.SyncInterval)
	return nil
}

// HandlePrompt handles the UserPromptSubmit hook.
func HandlePrompt(cfg *Config, queue *Queue) error {
	raw, err := readStdin()
	if err != nil {
		return fmt.Errorf("read stdin: %w", err)
	}

	var sd stdinData
	if err := json.Unmarshal(raw, &sd); err != nil {
		debugLog("prompt: unmarshal stdin: %v", err)
	}

	model := DetectModel(sd.Model, cfg)
	// Claude Code sends the prompt as "prompt" field; fall back to "input"
	promptText := sd.Prompt
	if promptText == "" {
		promptText = sd.Input
	}
	promptLength := len(promptText)

	// Apply secret scrubbing.
	var scrubbedText *string
	switch cfg.SecretScrub {
	case "redact":
		scrubbed, found := ScrubSecrets(promptText)
		promptText = scrubbed
		if len(found) > 0 {
			debugLog("prompt: redacted secrets: %v", found)
		}
		scrubbedText = &promptText
	case "alert":
		found := DetectSecrets(promptText)
		if len(found) > 0 {
			debugLog("prompt: secrets detected (alert only): %v", found)
		}
		// Send original text — just alert.
		t := promptText
		scrubbedText = &t
	default:
		// "off" or unset — still send, but no scrubbing.
		t := promptText
		scrubbedText = &t
	}

	// Truncate to PromptMaxLength if set.
	if cfg.PromptMaxLength > 0 && len(*scrubbedText) > cfg.PromptMaxLength {
		truncated := (*scrubbedText)[:cfg.PromptMaxLength]
		scrubbedText = &truncated
	}

	projectDir := filepath.Base(sd.CWD)

	promptReq := shared.PromptRequest{
		SessionID:    sd.SessionID,
		Model:        model,
		PromptText:   scrubbedText,
		PromptLength: promptLength,
		CWD:          sd.CWD,
		ProjectDir:   projectDir,
	}

	debugLog("prompt: session=%s model=%s length=%d", sd.SessionID, model, promptLength)

	url := cfg.ServerURL + "/api/v1/prompt"
	resp, err := serverRequest("POST", url, promptReq, cfg.AuthToken, 3*time.Second)
	if err != nil {
		// Timeout or network error: evaluate locally.
		debugLog("prompt: server error: %v — evaluating locally", err)
		switch cfg.Status {
		case "killed":
			return blockDecision("User account is suspended")
		case "paused":
			return blockDecision("User account is paused")
		}
		// Fail-open.
		return nil
	}
	defer resp.Body.Close()

	var promptResp shared.PromptResponse
	if err := json.NewDecoder(resp.Body).Decode(&promptResp); err != nil {
		debugLog("prompt: decode response: %v", err)
		return nil // fail-open
	}

	if !promptResp.Allowed {
		reason := "prompt blocked by policy"
		if promptResp.Reason != nil {
			reason = *promptResp.Reason
		}
		debugLog("prompt: blocked — %s", reason)
		return blockDecision(reason)
	}

	// Push event to local queue for recording.
	type promptEventData struct {
		SessionID    string  `json:"session_id"`
		Model        string  `json:"model"`
		PromptLength int     `json:"prompt_length"`
		CWD          string  `json:"cwd"`
		ProjectDir   string  `json:"project_dir"`
	}
	evData := promptEventData{
		SessionID:    sd.SessionID,
		Model:        model,
		PromptLength: promptLength,
		CWD:          sd.CWD,
		ProjectDir:   projectDir,
	}
	if payload, err := json.Marshal(evData); err == nil {
		if err := queue.Push("prompt", payload); err != nil {
			debugLog("prompt: queue push: %v", err)
		}
	}

	return nil
}

// HandlePreToolUse handles the PreToolUse hook.
func HandlePreToolUse(cfg *Config, queue *Queue) error {
	raw, err := readStdin()
	if err != nil {
		return fmt.Errorf("read stdin: %w", err)
	}

	var sd stdinData
	if err := json.Unmarshal(raw, &sd); err != nil {
		debugLog("pre_tool_use: unmarshal stdin: %v", err)
	}

	// Enforce kill/pause locally.
	switch cfg.Status {
	case "killed":
		return blockDecision("User account is suspended")
	case "paused":
		return blockDecision("User account is paused")
	}

	// Build tool input summary (first 200 chars of JSON).
	toolInputJSON := string(sd.ToolInput)
	summary := toolInputJSON
	if len(summary) > 200 {
		summary = summary[:200]
	}
	summaryPtr := &summary
	if summary == "" {
		summaryPtr = nil
	}

	toolData := shared.ToolEventData{
		ToolName:         sd.ToolName,
		ToolInputSummary: summaryPtr,
		Success:          true, // success is unknown at pre-use time; default to true
	}

	type toolQueueEntry struct {
		SessionID string               `json:"session_id"`
		Tool      shared.ToolEventData `json:"tool"`
	}
	entry := toolQueueEntry{SessionID: sd.SessionID, Tool: toolData}
	if payload, err := json.Marshal(entry); err == nil {
		if err := queue.Push("tool", payload); err != nil {
			debugLog("pre_tool_use: queue push: %v", err)
		}
	}

	debugLog("pre_tool_use: tool=%s session=%s", sd.ToolName, sd.SessionID)
	return nil
}

// HandleStop handles the Stop hook.
func HandleStop(cfg *Config, queue *Queue) error {
	raw, err := readStdin()
	if err != nil {
		return fmt.Errorf("read stdin: %w", err)
	}

	var sd stdinData
	if err := json.Unmarshal(raw, &sd); err != nil {
		debugLog("stop: unmarshal stdin: %v", err)
	}

	model := DetectModel(sd.Model, cfg)
	// Claude Code sends response as "last_assistant_message"; fall back to "response"
	responseText := sd.LastAssistantMessage
	if responseText == "" {
		responseText = sd.Response
	}
	responseLength := len(responseText)
	cost := creditCost(model, cfg)

	var responseLengthPtr *int
	if responseLength > 0 {
		responseLengthPtr = &responseLength
	}

	var responseTextPtr *string
	if cfg.CollectResponses && responseText != "" {
		t := responseText
		responseTextPtr = &t
	}

	stopData := shared.StopEventData{
		Model:          model,
		ResponseText:   responseTextPtr,
		ResponseLength: responseLengthPtr,
		CreditCost:     cost,
	}

	type stopQueueEntry struct {
		SessionID string               `json:"session_id"`
		Stop      shared.StopEventData `json:"stop"`
	}
	entry := stopQueueEntry{SessionID: sd.SessionID, Stop: stopData}
	if payload, err := json.Marshal(entry); err == nil {
		if err := queue.Push("stop", payload); err != nil {
			debugLog("stop: queue push: %v", err)
		}
	}

	debugLog("stop: session=%s model=%s cost=%d", sd.SessionID, model, cost)
	return nil
}

// HandleStopFailure handles the StopFailure hook.
func HandleStopFailure(cfg *Config, queue *Queue) error {
	raw, err := readStdin()
	if err != nil {
		return fmt.Errorf("read stdin: %w", err)
	}

	var sd stdinData
	if err := json.Unmarshal(raw, &sd); err != nil {
		debugLog("stop_failure: unmarshal stdin: %v", err)
	}

	errType := detectErrorType(sd.Error)

	var errDetailsPtr *string
	if sd.Error != "" {
		errDetailsPtr = &sd.Error
	}

	errData := shared.StopErrorEventData{
		ErrorType:    errType,
		ErrorDetails: errDetailsPtr,
	}

	type stopErrQueueEntry struct {
		SessionID string                    `json:"session_id"`
		Error     shared.StopErrorEventData `json:"error"`
	}
	entry := stopErrQueueEntry{SessionID: sd.SessionID, Error: errData}
	if payload, err := json.Marshal(entry); err == nil {
		if err := queue.Push("stop_error", payload); err != nil {
			debugLog("stop_failure: queue push: %v", err)
		}
	}

	debugLog("stop_failure: session=%s error_type=%s", sd.SessionID, errType)
	return nil
}

// HandleSessionEnd handles the SessionEnd hook.
func HandleSessionEnd(cfg *Config, queue *Queue) error {
	raw, err := readStdin()
	if err != nil {
		return fmt.Errorf("read stdin: %w", err)
	}

	var sd stdinData
	if err := json.Unmarshal(raw, &sd); err != nil {
		debugLog("session_end: unmarshal stdin: %v", err)
	}

	reason := sd.Reason
	if reason == "" {
		reason = "exit"
	}

	endData := shared.SessionEndEventData{
		Reason: reason,
	}

	type sessionEndQueueEntry struct {
		SessionID string                    `json:"session_id"`
		End       shared.SessionEndEventData `json:"end"`
	}
	entry := sessionEndQueueEntry{SessionID: sd.SessionID, End: endData}
	if payload, err := json.Marshal(entry); err == nil {
		if err := queue.Push("session_end", payload); err != nil {
			debugLog("session_end: queue push: %v", err)
		}
	}

	debugLog("session_end: session=%s reason=%s", sd.SessionID, reason)
	return nil
}
