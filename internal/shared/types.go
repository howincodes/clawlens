package shared

import (
	"encoding/json"
	"time"
)

// ── Database Models ──────────────────────────────────────────────────────────

// Team represents a tenant/organisation in ClawLens.
type Team struct {
	ID              string     `json:"id"`
	Name            string     `json:"name"`
	AdminPassword   string     `json:"-"`
	Settings        string     `json:"settings"`
	PlanID          *string    `json:"plan_id,omitempty"`
	AdminEmail      *string    `json:"admin_email,omitempty"`
	EmailVerified   bool       `json:"email_verified"`
	Subdomain       *string    `json:"subdomain,omitempty"`
	Suspended       bool       `json:"suspended"`
	SuspendedReason *string    `json:"suspended_reason,omitempty"`
	CreatedByIP     *string    `json:"created_by_ip,omitempty"`
	CreatedAt       time.Time  `json:"created_at"`
}

// CreditWeights holds per-model credit multipliers.
type CreditWeights struct {
	Opus   int `json:"opus"`
	Sonnet int `json:"sonnet"`
	Haiku  int `json:"haiku"`
}

// TeamSettings is the parsed form of Team.Settings (stored as JSON in the DB).
type TeamSettings struct {
	CollectionLevel      string        `json:"collection_level"`
	CollectResponses     bool          `json:"collect_responses"`
	SecretScrub          string        `json:"secret_scrub"`
	SummaryIntervalHours int           `json:"summary_interval_hours"`
	SummaryProvider      string        `json:"summary_provider"`
	SummaryAPIKey        *string       `json:"summary_api_key,omitempty"`
	SummaryAPIURL        *string       `json:"summary_api_url,omitempty"`
	CreditWeights        CreditWeights `json:"credit_weights"`
	PromptRetentionDays  int           `json:"prompt_retention_days"`
	PromptMaxLength      int           `json:"prompt_max_length"`
	SlackWebhook         *string       `json:"slack_webhook,omitempty"`
	DiscordWebhook       *string       `json:"discord_webhook,omitempty"`
	AlertOnBlock         bool          `json:"alert_on_block"`
	AlertOnKill          bool          `json:"alert_on_kill"`
	AlertOnStuck         bool          `json:"alert_on_stuck"`
	AlertOnSecret        bool          `json:"alert_on_secret"`
	AlertOnAnomaly       bool          `json:"alert_on_anomaly"`
	DailyDigest          bool          `json:"daily_digest"`
	WeeklyDigest         bool          `json:"weekly_digest"`
	SyncIntervalSeconds  int           `json:"sync_interval_seconds"`
	ExportEnabled        bool          `json:"export_enabled"`
	AutoUpdate           bool          `json:"auto_update"`
	TargetVersion        *string       `json:"target_version,omitempty"`
	ForceUpdate          bool          `json:"force_update"`
}

// Plan describes a billing/feature tier.
type Plan struct {
	ID              string    `json:"id"`
	Name            string    `json:"name"`
	MaxUsers        int       `json:"max_users"`
	MaxPromptsPerDay int      `json:"max_prompts_per_day"`
	MaxStorageMB    int       `json:"max_storage_mb"`
	AISummaries     bool      `json:"ai_summaries"`
	Webhooks        bool      `json:"webhooks"`
	Export          bool      `json:"export"`
	RateLimiting    bool      `json:"rate_limiting"`
	CustomBranding  bool      `json:"custom_branding"`
	CreatedAt       time.Time `json:"created_at"`
}

// Subscription links external billing data to a team.
type Subscription struct {
	ID                   string     `json:"id"`
	TeamID               string     `json:"team_id"`
	Email                string     `json:"email"`
	DisplayName          *string    `json:"display_name,omitempty"`
	OrgName              *string    `json:"org_name,omitempty"`
	SubscriptionType     *string    `json:"subscription_type,omitempty"`
	BillingType          *string    `json:"billing_type,omitempty"`
	AccountCreated       *time.Time `json:"account_created,omitempty"`
	SubscriptionCreated  *time.Time `json:"subscription_created,omitempty"`
}

// User represents a ClawLens user (developer) within a team.
type User struct {
	ID             string     `json:"id"`
	TeamID         string     `json:"team_id"`
	SubscriptionID *string    `json:"subscription_id,omitempty"`
	Slug           string     `json:"slug"`
	Name           string     `json:"name"`
	AuthToken      string     `json:"-"`
	Status         string     `json:"status"`
	DefaultModel   *string    `json:"default_model,omitempty"`
	KilledAt       *time.Time `json:"killed_at,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
}

// Device represents a machine a user has installed the client on.
type Device struct {
	ID               string    `json:"id"`
	UserID           string    `json:"user_id"`
	Hostname         *string   `json:"hostname,omitempty"`
	Platform         *string   `json:"platform,omitempty"`
	Arch             *string   `json:"arch,omitempty"`
	OSVersion        *string   `json:"os_version,omitempty"`
	GoVersion        *string   `json:"go_version,omitempty"`
	ClaudeVersion    *string   `json:"claude_version,omitempty"`
	SubscriptionType *string   `json:"subscription_type,omitempty"`
	FirstSeen        time.Time `json:"first_seen"`
	LastSeen         time.Time `json:"last_seen"`
	LastIP           *string   `json:"last_ip,omitempty"`
}

// LimitRule defines a usage restriction for a user.
type LimitRule struct {
	ID            string     `json:"id"`
	UserID        string     `json:"user_id"`
	Type          string     `json:"type"`
	Model         *string    `json:"model,omitempty"`
	Window        *string    `json:"window,omitempty"`
	Value         *int       `json:"value,omitempty"`
	ScheduleStart *string    `json:"schedule_start,omitempty"`
	ScheduleEnd   *string    `json:"schedule_end,omitempty"`
	ScheduleTZ    *string    `json:"schedule_tz,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
}

// Session represents a single Claude coding session.
type Session struct {
	ID                 string     `json:"id"`
	UserID             string     `json:"user_id"`
	DeviceID           *string    `json:"device_id,omitempty"`
	Model              *string    `json:"model,omitempty"`
	ProjectDir         *string    `json:"project_dir,omitempty"`
	CWD                *string    `json:"cwd,omitempty"`
	StartedAt          time.Time  `json:"started_at"`
	EndedAt            *time.Time `json:"ended_at,omitempty"`
	EndReason          *string    `json:"end_reason,omitempty"`
	PromptCount        int        `json:"prompt_count"`
	ToolCount          int        `json:"tool_count"`
	TotalInputTokens   int        `json:"total_input_tokens"`
	TotalOutputTokens  int        `json:"total_output_tokens"`
	TotalCostUSD       float64    `json:"total_cost_usd"`
}

// Prompt represents a single prompt/response turn.
type Prompt struct {
	ID               int        `json:"id"`
	UserID           string     `json:"user_id"`
	SessionID        *string    `json:"session_id,omitempty"`
	Model            *string    `json:"model,omitempty"`
	PromptText       *string    `json:"prompt_text,omitempty"`
	PromptLength     int        `json:"prompt_length"`
	ResponseText     *string    `json:"response_text,omitempty"`
	ResponseLength   *int       `json:"response_length,omitempty"`
	ProjectDir       *string    `json:"project_dir,omitempty"`
	CWD              *string    `json:"cwd,omitempty"`
	ToolCalls        int        `json:"tool_calls"`
	ToolsUsed        *string    `json:"tools_used,omitempty"` // JSON array
	HadError         bool       `json:"had_error"`
	WasBlocked       bool       `json:"was_blocked"`
	BlockReason      *string    `json:"block_reason,omitempty"`
	TurnDurationMS   *int       `json:"turn_duration_ms,omitempty"`
	CreditCost       int        `json:"credit_cost"`
	PromptTruncated  bool       `json:"prompt_truncated"`
	Timestamp        time.Time  `json:"timestamp"`
}

// ToolEvent records a single tool invocation within a session turn.
type ToolEvent struct {
	ID               int        `json:"id"`
	UserID           string     `json:"user_id"`
	SessionID        *string    `json:"session_id,omitempty"`
	PromptID         *int       `json:"prompt_id,omitempty"`
	ToolName         string     `json:"tool_name"`
	ToolInputSummary *string    `json:"tool_input_summary,omitempty"`
	Success          bool       `json:"success"`
	ErrorMessage     *string    `json:"error_message,omitempty"`
	Timestamp        time.Time  `json:"timestamp"`
}

// AISummary stores a generated AI summary for a user or team.
type AISummary struct {
	ID                    int        `json:"id"`
	UserID                *string    `json:"user_id,omitempty"`
	TeamID                *string    `json:"team_id,omitempty"`
	Type                  string     `json:"type"`
	PeriodStart           time.Time  `json:"period_start"`
	PeriodEnd             time.Time  `json:"period_end"`
	SummaryText           string     `json:"summary_text"`
	Categories            *string    `json:"categories,omitempty"` // JSON
	Topics                *string    `json:"topics,omitempty"`     // JSON
	ProductivityScore     *float64   `json:"productivity_score,omitempty"`
	PromptQualityScore    *float64   `json:"prompt_quality_score,omitempty"`
	ModelEfficiencyScore  *float64   `json:"model_efficiency_score,omitempty"`
	GeneratedAt           time.Time  `json:"generated_at"`
	GeneratedBy           *string    `json:"generated_by,omitempty"`
}

// ProjectStats holds aggregated metrics per project directory.
type ProjectStats struct {
	ID                int       `json:"id"`
	UserID            string    `json:"user_id"`
	ProjectPath       string    `json:"project_path"`
	ProjectName       string    `json:"project_name"`
	Model             string    `json:"model"`
	InputTokens       int       `json:"input_tokens"`
	OutputTokens      int       `json:"output_tokens"`
	CacheReadTokens   int       `json:"cache_read_tokens"`
	CacheCreateTokens int       `json:"cache_create_tokens"`
	CostUSD           float64   `json:"cost_usd"`
	LinesAdded        int       `json:"lines_added"`
	LinesRemoved      int       `json:"lines_removed"`
	WebSearchCount    int       `json:"web_search_count"`
	SyncedAt          time.Time `json:"synced_at"`
}

// DailyActivity aggregates per-user activity for a single calendar day.
type DailyActivity struct {
	ID           int       `json:"id"`
	UserID       string    `json:"user_id"`
	Date         string    `json:"date"` // YYYY-MM-DD
	MessageCount int       `json:"message_count"`
	SessionCount int       `json:"session_count"`
	ToolCallCount int      `json:"tool_call_count"`
	SyncedAt     time.Time `json:"synced_at"`
}

// InstallCode is a one-time code used to register a new device.
type InstallCode struct {
	Code      string    `json:"code"`
	UserID    string    `json:"user_id"`
	Used      bool      `json:"used"`
	CreatedAt time.Time `json:"created_at"`
}

// AuditEntry records an admin action for compliance purposes.
type AuditEntry struct {
	ID        int        `json:"id"`
	TeamID    string     `json:"team_id"`
	Actor     string     `json:"actor"`
	Action    string     `json:"action"`
	Target    *string    `json:"target,omitempty"`
	Details   *string    `json:"details,omitempty"` // JSON
	Timestamp time.Time  `json:"timestamp"`
}

// Alert represents a triggered monitoring alert.
type Alert struct {
	ID        int       `json:"id"`
	TeamID    string    `json:"team_id"`
	UserID    *string   `json:"user_id,omitempty"`
	Type      string    `json:"type"`
	Severity  string    `json:"severity"`
	Title     string    `json:"title"`
	Details   *string   `json:"details,omitempty"` // JSON
	Resolved  bool      `json:"resolved"`
	CreatedAt time.Time `json:"created_at"`
}

// ── API Request / Response Types ─────────────────────────────────────────────

// SessionStartRequest is sent by the client when a new Claude session begins.
type SessionStartRequest struct {
	SessionID         string  `json:"session_id"`
	Model             string  `json:"model"`
	CWD               string  `json:"cwd"`
	Hostname          string  `json:"hostname"`
	Platform          string  `json:"platform"`
	Arch              string  `json:"arch"`
	OSVersion         string  `json:"os_version"`
	GoVersion         string  `json:"go_version"`
	ClaudeVersion     string  `json:"claude_version"`
	SubscriptionType  *string `json:"subscription_type,omitempty"`
	SubscriptionEmail *string `json:"subscription_email,omitempty"`
	ClientVersion     string  `json:"client_version"`
}

// UpdateInfo describes an available client update.
type UpdateInfo struct {
	Available bool   `json:"available"`
	Version   string `json:"version"`
	SHA256    string `json:"sha256"`
	URL       string `json:"url"`
	Required  bool   `json:"required"`
}

// SessionStartResponse is returned by the server after a session is registered.
type SessionStartResponse struct {
	Status       string       `json:"status"`
	Settings     TeamSettings `json:"settings"`
	SyncInterval int          `json:"sync_interval"`
	Update       *UpdateInfo  `json:"update,omitempty"`
}

// PromptRequest is sent before a prompt is submitted to Claude.
type PromptRequest struct {
	SessionID  string  `json:"session_id"`
	Model      string  `json:"model"`
	PromptText *string `json:"prompt_text,omitempty"`
	PromptLength int   `json:"prompt_length"`
	CWD        string  `json:"cwd"`
	ProjectDir string  `json:"project_dir"`
}

// PromptResponse tells the client whether to allow or block the prompt.
type PromptResponse struct {
	Allowed bool    `json:"allowed"`
	Status  string  `json:"status"`
	Reason  *string `json:"reason,omitempty"`
}

// BatchSyncRequest carries a batch of telemetry events from client to server.
type BatchSyncRequest struct {
	Events []Event `json:"events"`
}

// Event is a generic telemetry event with a typed payload.
type Event struct {
	Type      string          `json:"type"`
	SessionID string          `json:"session_id"`
	Timestamp time.Time       `json:"timestamp"`
	Data      json.RawMessage `json:"data"`
}

// ToolEventData is the payload for tool-use events.
type ToolEventData struct {
	ToolName         string  `json:"tool_name"`
	ToolInputSummary *string `json:"tool_input_summary,omitempty"`
	Success          bool    `json:"success"`
	ErrorMessage     *string `json:"error_message,omitempty"`
}

// StopEventData is the payload for a successful turn-stop event.
type StopEventData struct {
	Model          string  `json:"model"`
	ResponseText   *string `json:"response_text,omitempty"`
	ResponseLength *int    `json:"response_length,omitempty"`
	ToolCalls      int     `json:"tool_calls"`
	ToolsUsed      *string `json:"tools_used,omitempty"`
	TurnDurationMS *int    `json:"turn_duration_ms,omitempty"`
	CreditCost     int     `json:"credit_cost"`
}

// StopErrorEventData is the payload for a turn that ended with an error.
type StopErrorEventData struct {
	ErrorType    string  `json:"error_type"`
	ErrorDetails *string `json:"error_details,omitempty"`
}

// SessionEndEventData is the payload for a session-end event.
type SessionEndEventData struct {
	Reason string `json:"reason"`
}

// RegisterRequest is sent by the client to exchange an install code for a token.
type RegisterRequest struct {
	Code string `json:"code"`
}

// RegisterResponse is returned after a successful registration.
type RegisterResponse struct {
	AuthToken string       `json:"auth_token"`
	UserID    string       `json:"user_id"`
	Settings  TeamSettings `json:"settings"`
	ServerURL string       `json:"server_url"`
}

// LoginRequest carries admin credentials.
type LoginRequest struct {
	Password string `json:"password"`
}

// LoginResponse is returned after a successful admin login.
type LoginResponse struct {
	Token string `json:"token"`
	Team  Team   `json:"team"`
}

// PaginatedResponse wraps any list endpoint result with pagination metadata.
type PaginatedResponse struct {
	Data  any `json:"data"`
	Total int `json:"total"`
	Page  int `json:"page"`
	Limit int `json:"limit"`
}

// WSEvent is the envelope for WebSocket push messages.
type WSEvent struct {
	Type string `json:"type"`
	Data any    `json:"data"`
}
