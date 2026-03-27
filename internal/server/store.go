package server

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	_ "modernc.org/sqlite"

	"github.com/howincodes/clawlens/internal/shared"
)

// Store wraps a SQLite database connection.
type Store struct {
	db *sql.DB
}

// NewStore opens the SQLite database at dbPath, enables WAL mode and foreign
// keys, and limits to a single writer connection (required for SQLite).
func NewStore(dbPath string) (*Store, error) {
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}

	// SQLite only supports one concurrent writer.
	db.SetMaxOpenConns(1)

	if _, err := db.Exec(`PRAGMA journal_mode=WAL`); err != nil {
		db.Close()
		return nil, fmt.Errorf("set WAL mode: %w", err)
	}
	if _, err := db.Exec(`PRAGMA foreign_keys=ON`); err != nil {
		db.Close()
		return nil, fmt.Errorf("enable foreign keys: %w", err)
	}

	return &Store{db: db}, nil
}

// Close closes the underlying database connection.
func (s *Store) Close() error {
	return s.db.Close()
}

// Init executes the full schema (all tables and indexes).
func (s *Store) Init() error {
	_, err := s.db.Exec(schema)
	return err
}

const schema = `
CREATE TABLE IF NOT EXISTS plan (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  max_users INTEGER NOT NULL,
  max_prompts_per_day INTEGER NOT NULL,
  max_storage_mb INTEGER NOT NULL,
  ai_summaries BOOLEAN NOT NULL,
  webhooks BOOLEAN NOT NULL,
  export BOOLEAN NOT NULL,
  rate_limiting BOOLEAN NOT NULL,
  custom_branding BOOLEAN NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS team (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  admin_password TEXT NOT NULL,
  settings TEXT NOT NULL DEFAULT '{}',
  plan_id TEXT REFERENCES plan(id),
  admin_email TEXT,
  email_verified BOOLEAN DEFAULT FALSE,
  subdomain TEXT UNIQUE,
  suspended BOOLEAN DEFAULT FALSE,
  suspended_reason TEXT,
  created_by_ip TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS subscription (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES team(id),
  email TEXT NOT NULL,
  display_name TEXT,
  org_name TEXT,
  subscription_type TEXT,
  billing_type TEXT,
  account_created DATETIME,
  subscription_created DATETIME,
  UNIQUE(team_id, email)
);

CREATE TABLE IF NOT EXISTS user (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES team(id),
  subscription_id TEXT REFERENCES subscription(id),
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  auth_token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',
  default_model TEXT,
  killed_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(team_id, slug)
);

CREATE TABLE IF NOT EXISTS device (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  hostname TEXT,
  platform TEXT,
  arch TEXT,
  os_version TEXT,
  go_version TEXT,
  claude_version TEXT,
  subscription_type TEXT,
  first_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_ip TEXT,
  UNIQUE(user_id, hostname)
);

CREATE TABLE IF NOT EXISTS limit_rule (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  model TEXT,
  window TEXT,
  value INTEGER,
  schedule_start TEXT,
  schedule_end TEXT,
  schedule_tz TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  device_id TEXT REFERENCES device(id),
  model TEXT,
  project_dir TEXT,
  cwd TEXT,
  started_at DATETIME NOT NULL,
  ended_at DATETIME,
  end_reason TEXT,
  prompt_count INTEGER DEFAULT 0,
  tool_count INTEGER DEFAULT 0,
  total_input_tokens INTEGER DEFAULT 0,
  total_output_tokens INTEGER DEFAULT 0,
  total_cost_usd REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS prompt (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES session(id),
  model TEXT,
  prompt_text TEXT,
  prompt_length INTEGER NOT NULL,
  response_text TEXT,
  response_length INTEGER,
  project_dir TEXT,
  cwd TEXT,
  tool_calls INTEGER DEFAULT 0,
  tools_used TEXT,
  had_error BOOLEAN DEFAULT FALSE,
  was_blocked BOOLEAN DEFAULT FALSE,
  block_reason TEXT,
  turn_duration_ms INTEGER,
  credit_cost INTEGER DEFAULT 0,
  prompt_truncated BOOLEAN DEFAULT FALSE,
  timestamp DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS tool_event (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES session(id),
  prompt_id INTEGER REFERENCES prompt(id),
  tool_name TEXT NOT NULL,
  tool_input_summary TEXT,
  success BOOLEAN DEFAULT TRUE,
  error_message TEXT,
  timestamp DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_summary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT REFERENCES user(id) ON DELETE CASCADE,
  team_id TEXT REFERENCES team(id),
  type TEXT NOT NULL,
  period_start DATETIME NOT NULL,
  period_end DATETIME NOT NULL,
  summary_text TEXT NOT NULL,
  categories TEXT,
  topics TEXT,
  productivity_score REAL,
  prompt_quality_score REAL,
  model_efficiency_score REAL,
  generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  generated_by TEXT
);

CREATE TABLE IF NOT EXISTS project_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  project_path TEXT NOT NULL,
  project_name TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cache_read_tokens INTEGER DEFAULT 0,
  cache_create_tokens INTEGER DEFAULT 0,
  cost_usd REAL DEFAULT 0,
  lines_added INTEGER DEFAULT 0,
  lines_removed INTEGER DEFAULT 0,
  web_search_count INTEGER DEFAULT 0,
  synced_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, project_path, model)
);

CREATE TABLE IF NOT EXISTS daily_activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  message_count INTEGER DEFAULT 0,
  session_count INTEGER DEFAULT 0,
  tool_call_count INTEGER DEFAULT 0,
  synced_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, date)
);

CREATE TABLE IF NOT EXISTS install_code (
  code TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id),
  used BOOLEAN DEFAULT FALSE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  details TEXT,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS alert (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id TEXT NOT NULL,
  user_id TEXT REFERENCES user(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  details TEXT,
  resolved BOOLEAN DEFAULT FALSE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS email_verification (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES team(id),
  code TEXT NOT NULL,
  expires_at DATETIME NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_prompt_user_ts ON prompt(user_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_prompt_session ON prompt(session_id);
CREATE INDEX IF NOT EXISTS idx_prompt_user_ts_cost ON prompt(user_id, timestamp, credit_cost);
CREATE INDEX IF NOT EXISTS idx_tool_event_user_ts ON tool_event(user_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_tool_event_session ON tool_event(session_id);
CREATE INDEX IF NOT EXISTS idx_session_user ON session(user_id, started_at);
CREATE INDEX IF NOT EXISTS idx_project_stats_user ON project_stats(user_id);
CREATE INDEX IF NOT EXISTS idx_daily_activity_user ON daily_activity(user_id, date);
CREATE INDEX IF NOT EXISTS idx_ai_summary_user ON ai_summary(user_id, period_start);
CREATE INDEX IF NOT EXISTS idx_audit_team ON audit_log(team_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_subscription_team ON subscription(team_id);
CREATE INDEX IF NOT EXISTS idx_alert_team ON alert(team_id, created_at);
`

// defaultTeamSettings returns the default TeamSettings JSON blob.
func defaultTeamSettings() string {
	settings := shared.TeamSettings{
		CollectionLevel:      "full",
		CollectResponses:     true,
		SecretScrub:          "redact",
		SummaryIntervalHours: 8,
		SummaryProvider:      "claude-code",
		CreditWeights: shared.CreditWeights{
			Opus:   10,
			Sonnet: 3,
			Haiku:  1,
		},
		PromptRetentionDays:  90,
		PromptMaxLength:      10000,
		AlertOnBlock:         true,
		AlertOnKill:          true,
		AlertOnStuck:         true,
		AlertOnSecret:        true,
		AlertOnAnomaly:       true,
		DailyDigest:          true,
		WeeklyDigest:         true,
		SyncIntervalSeconds:  30,
		ExportEnabled:        true,
		AutoUpdate:           true,
		ForceUpdate:          false,
	}
	b, _ := json.Marshal(settings)
	return string(b)
}

// Seed creates the default team (selfhost). If mode=="saas", it also inserts a
// demo plan.
func (s *Store) Seed(adminPassword, mode string) error {
	hash, err := shared.HashPassword(adminPassword)
	if err != nil {
		return fmt.Errorf("hash password: %w", err)
	}

	settingsJSON := defaultTeamSettings()
	teamID := "default"

	_, err = s.db.Exec(
		`INSERT OR IGNORE INTO team (id, name, admin_password, settings) VALUES (?, ?, ?, ?)`,
		teamID, "Default Team", hash, settingsJSON,
	)
	if err != nil {
		return fmt.Errorf("seed team: %w", err)
	}

	if mode == "saas" {
		_, err = s.db.Exec(
			`INSERT OR IGNORE INTO plan (id, name, max_users, max_prompts_per_day, max_storage_mb,
			 ai_summaries, webhooks, export, rate_limiting, custom_branding)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			"demo", "Demo", 5, 100, 500, true, false, true, true, false,
		)
		if err != nil {
			return fmt.Errorf("seed demo plan: %w", err)
		}
	}

	return nil
}

// ── Team ──────────────────────────────────────────────────────────────────────

const teamColumns = `id, name, admin_password, settings, plan_id, admin_email,
	email_verified, subdomain, suspended, suspended_reason, created_by_ip, created_at`

func scanTeam(row interface {
	Scan(...any) error
}) (*shared.Team, error) {
	var t shared.Team
	err := row.Scan(
		&t.ID, &t.Name, &t.AdminPassword, &t.Settings,
		&t.PlanID, &t.AdminEmail, &t.EmailVerified, &t.Subdomain,
		&t.Suspended, &t.SuspendedReason, &t.CreatedByIP, &t.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &t, nil
}

// GetTeam returns the first (and typically only) team — used in selfhost mode.
func (s *Store) GetTeam() (*shared.Team, error) {
	row := s.db.QueryRow(
		`SELECT ` + teamColumns + ` FROM team LIMIT 1`,
	)
	t, err := scanTeam(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return t, err
}

// GetTeamByID returns the team with the given ID.
func (s *Store) GetTeamByID(id string) (*shared.Team, error) {
	row := s.db.QueryRow(
		`SELECT `+teamColumns+` FROM team WHERE id = ?`, id,
	)
	t, err := scanTeam(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return t, err
}

// GetTeamBySubdomain returns the team with the given subdomain.
func (s *Store) GetTeamBySubdomain(subdomain string) (*shared.Team, error) {
	row := s.db.QueryRow(
		`SELECT `+teamColumns+` FROM team WHERE subdomain = ?`, subdomain,
	)
	t, err := scanTeam(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return t, err
}

// GetTeamSettings parses the JSON settings field for the given team.
func (s *Store) GetTeamSettings(teamID string) (*shared.TeamSettings, error) {
	var settingsJSON string
	err := s.db.QueryRow(
		`SELECT settings FROM team WHERE id = ?`, teamID,
	).Scan(&settingsJSON)
	if err != nil {
		return nil, err
	}
	var ts shared.TeamSettings
	if err := json.Unmarshal([]byte(settingsJSON), &ts); err != nil {
		return nil, fmt.Errorf("parse settings: %w", err)
	}
	return &ts, nil
}

// UpdateTeamSettings serialises settings to JSON and persists it.
func (s *Store) UpdateTeamSettings(teamID string, settings shared.TeamSettings) error {
	b, err := json.Marshal(settings)
	if err != nil {
		return fmt.Errorf("marshal settings: %w", err)
	}
	_, err = s.db.Exec(
		`UPDATE team SET settings = ? WHERE id = ?`, string(b), teamID,
	)
	return err
}

// UpdateTeamName updates the display name of the team.
func (s *Store) UpdateTeamName(teamID, name string) error {
	_, err := s.db.Exec(`UPDATE team SET name = ? WHERE id = ?`, name, teamID)
	return err
}

// UpdateAdminPassword stores a bcrypt hash as the admin password.
func (s *Store) UpdateAdminPassword(teamID, hash string) error {
	_, err := s.db.Exec(`UPDATE team SET admin_password = ? WHERE id = ?`, hash, teamID)
	return err
}

// ── User ──────────────────────────────────────────────────────────────────────

const userColumns = `id, team_id, subscription_id, slug, name, auth_token,
	status, default_model, killed_at, created_at`

func scanUser(row interface {
	Scan(...any) error
}) (*shared.User, error) {
	var u shared.User
	err := row.Scan(
		&u.ID, &u.TeamID, &u.SubscriptionID, &u.Slug, &u.Name, &u.AuthToken,
		&u.Status, &u.DefaultModel, &u.KilledAt, &u.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &u, nil
}

// CreateUser inserts a new user record.
func (s *Store) CreateUser(u *shared.User) error {
	_, err := s.db.Exec(
		`INSERT INTO user (id, team_id, subscription_id, slug, name, auth_token, status, default_model)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		u.ID, u.TeamID, u.SubscriptionID, u.Slug, u.Name, u.AuthToken,
		u.Status, u.DefaultModel,
	)
	return err
}

// GetUser returns the user with the given ID.
func (s *Store) GetUser(id string) (*shared.User, error) {
	row := s.db.QueryRow(
		`SELECT `+userColumns+` FROM user WHERE id = ?`, id,
	)
	u, err := scanUser(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return u, err
}

// GetUserByToken returns the user with the given auth token.
func (s *Store) GetUserByToken(token string) (*shared.User, error) {
	row := s.db.QueryRow(
		`SELECT `+userColumns+` FROM user WHERE auth_token = ?`, token,
	)
	u, err := scanUser(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return u, err
}

// GetUsers returns all users in the team, ordered by name.
func (s *Store) GetUsers(teamID string) ([]shared.User, error) {
	rows, err := s.db.Query(
		`SELECT `+userColumns+` FROM user WHERE team_id = ? ORDER BY name`, teamID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var users []shared.User
	for rows.Next() {
		u, err := scanUser(rows)
		if err != nil {
			return nil, err
		}
		users = append(users, *u)
	}
	return users, rows.Err()
}

// UpdateUserStatus updates the status field; if status=="killed" it also sets killed_at.
func (s *Store) UpdateUserStatus(id, status string) error {
	if status == "killed" {
		_, err := s.db.Exec(
			`UPDATE user SET status = ?, killed_at = ? WHERE id = ?`,
			status, time.Now().UTC(), id,
		)
		return err
	}
	_, err := s.db.Exec(`UPDATE user SET status = ? WHERE id = ?`, status, id)
	return err
}

// UpdateUser performs a partial update on name, subscription_id, and default_model.
// A nil pointer means "do not update that field".
func (s *Store) UpdateUser(id string, name, subscriptionID, defaultModel *string) error {
	if name != nil {
		if _, err := s.db.Exec(`UPDATE user SET name = ? WHERE id = ?`, *name, id); err != nil {
			return err
		}
	}
	if subscriptionID != nil {
		if _, err := s.db.Exec(`UPDATE user SET subscription_id = ? WHERE id = ?`, *subscriptionID, id); err != nil {
			return err
		}
	}
	if defaultModel != nil {
		if _, err := s.db.Exec(`UPDATE user SET default_model = ? WHERE id = ?`, *defaultModel, id); err != nil {
			return err
		}
	}
	return nil
}

// DeleteUser removes a user from the database.
func (s *Store) DeleteUser(id string) error {
	_, err := s.db.Exec(`DELETE FROM user WHERE id = ?`, id)
	return err
}

// RotateUserToken generates a fresh auth token for the user and returns it.
func (s *Store) RotateUserToken(id string) (string, error) {
	newToken := shared.GenerateToken()
	_, err := s.db.Exec(`UPDATE user SET auth_token = ? WHERE id = ?`, newToken, id)
	if err != nil {
		return "", err
	}
	return newToken, nil
}

// GetUserStats returns aggregate prompt/session/cost stats for a single user.
func (s *Store) GetUserStats(userID string) (map[string]any, error) {
	var totalPrompts, promptsToday, totalSessions, sessionsToday, totalCost int

	s.db.QueryRow(`SELECT COUNT(*) FROM prompt WHERE user_id = ?`, userID).Scan(&totalPrompts)                                              //nolint:errcheck
	s.db.QueryRow(`SELECT COUNT(*) FROM prompt WHERE user_id = ? AND date(timestamp) = date('now')`, userID).Scan(&promptsToday)            //nolint:errcheck
	s.db.QueryRow(`SELECT COUNT(*) FROM session WHERE user_id = ?`, userID).Scan(&totalSessions)                                            //nolint:errcheck
	s.db.QueryRow(`SELECT COUNT(*) FROM session WHERE user_id = ? AND date(started_at) = date('now')`, userID).Scan(&sessionsToday)         //nolint:errcheck
	s.db.QueryRow(`SELECT COALESCE(SUM(credit_cost), 0) FROM prompt WHERE user_id = ? AND was_blocked = FALSE`, userID).Scan(&totalCost) //nolint:errcheck

	return map[string]any{
		"total_prompts":  totalPrompts,
		"prompts_today":  promptsToday,
		"total_sessions": totalSessions,
		"sessions_today": sessionsToday,
		"total_cost":     totalCost,
	}, nil
}

// CountUsers returns the number of users in the team.
func (s *Store) CountUsers(teamID string) (int, error) {
	var count int
	err := s.db.QueryRow(
		`SELECT COUNT(*) FROM user WHERE team_id = ?`, teamID,
	).Scan(&count)
	return count, err
}

// ── Subscription ──────────────────────────────────────────────────────────────

const subColumns = `id, team_id, email, display_name, org_name,
	subscription_type, billing_type, account_created, subscription_created`

func scanSubscription(row interface {
	Scan(...any) error
}) (*shared.Subscription, error) {
	var sub shared.Subscription
	err := row.Scan(
		&sub.ID, &sub.TeamID, &sub.Email,
		&sub.DisplayName, &sub.OrgName,
		&sub.SubscriptionType, &sub.BillingType,
		&sub.AccountCreated, &sub.SubscriptionCreated,
	)
	if err != nil {
		return nil, err
	}
	return &sub, nil
}

// UpsertSubscription inserts or updates a subscription record.
func (s *Store) UpsertSubscription(sub *shared.Subscription) error {
	_, err := s.db.Exec(
		`INSERT INTO subscription (id, team_id, email, display_name, org_name,
		  subscription_type, billing_type, account_created, subscription_created)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(team_id, email) DO UPDATE SET
		   display_name        = excluded.display_name,
		   org_name            = excluded.org_name,
		   subscription_type   = excluded.subscription_type,
		   billing_type        = excluded.billing_type,
		   account_created     = excluded.account_created,
		   subscription_created = excluded.subscription_created`,
		sub.ID, sub.TeamID, sub.Email,
		sub.DisplayName, sub.OrgName,
		sub.SubscriptionType, sub.BillingType,
		sub.AccountCreated, sub.SubscriptionCreated,
	)
	return err
}

// GetSubscriptions returns all subscriptions for the given team.
func (s *Store) GetSubscriptions(teamID string) ([]shared.Subscription, error) {
	rows, err := s.db.Query(
		`SELECT `+subColumns+` FROM subscription WHERE team_id = ?`, teamID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var subs []shared.Subscription
	for rows.Next() {
		sub, err := scanSubscription(rows)
		if err != nil {
			return nil, err
		}
		subs = append(subs, *sub)
	}
	return subs, rows.Err()
}

// GetSubscriptionByEmail returns the subscription for the given team + email pair.
func (s *Store) GetSubscriptionByEmail(teamID, email string) (*shared.Subscription, error) {
	row := s.db.QueryRow(
		`SELECT `+subColumns+` FROM subscription WHERE team_id = ? AND email = ?`,
		teamID, email,
	)
	sub, err := scanSubscription(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return sub, err
}

// ── Device ────────────────────────────────────────────────────────────────────

const deviceColumns = `id, user_id, hostname, platform, arch, os_version,
	go_version, claude_version, subscription_type, first_seen, last_seen, last_ip`

func scanDevice(row interface {
	Scan(...any) error
}) (*shared.Device, error) {
	var d shared.Device
	err := row.Scan(
		&d.ID, &d.UserID, &d.Hostname, &d.Platform, &d.Arch, &d.OSVersion,
		&d.GoVersion, &d.ClaudeVersion, &d.SubscriptionType,
		&d.FirstSeen, &d.LastSeen, &d.LastIP,
	)
	if err != nil {
		return nil, err
	}
	return &d, nil
}

// UpsertDevice inserts a device or updates its metadata on conflict.
func (s *Store) UpsertDevice(d *shared.Device) error {
	_, err := s.db.Exec(
		`INSERT INTO device (id, user_id, hostname, platform, arch, os_version,
		  go_version, claude_version, subscription_type, last_seen, last_ip)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(user_id, hostname) DO UPDATE SET
		   platform          = excluded.platform,
		   arch              = excluded.arch,
		   os_version        = excluded.os_version,
		   go_version        = excluded.go_version,
		   claude_version    = excluded.claude_version,
		   subscription_type = excluded.subscription_type,
		   last_seen         = excluded.last_seen,
		   last_ip           = excluded.last_ip`,
		d.ID, d.UserID, d.Hostname, d.Platform, d.Arch, d.OSVersion,
		d.GoVersion, d.ClaudeVersion, d.SubscriptionType,
		d.LastSeen, d.LastIP,
	)
	return err
}

// GetDevices returns all devices for the given user.
func (s *Store) GetDevices(userID string) ([]shared.Device, error) {
	rows, err := s.db.Query(
		`SELECT `+deviceColumns+` FROM device WHERE user_id = ?`, userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var devices []shared.Device
	for rows.Next() {
		d, err := scanDevice(rows)
		if err != nil {
			return nil, err
		}
		devices = append(devices, *d)
	}
	return devices, rows.Err()
}

// ── InstallCode ───────────────────────────────────────────────────────────────

// CreateInstallCode inserts a new (unused) install code for the given user.
func (s *Store) CreateInstallCode(code, userID string) error {
	_, err := s.db.Exec(
		`INSERT INTO install_code (code, user_id) VALUES (?, ?)`, code, userID,
	)
	return err
}

// UseInstallCode marks the code as used and returns the associated user.
// Returns an error if the code is not found, already used, or the user doesn't exist.
func (s *Store) UseInstallCode(code string) (*shared.User, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback() //nolint:errcheck

	var userID string
	var used bool
	err = tx.QueryRow(
		`SELECT user_id, used FROM install_code WHERE code = ?`, code,
	).Scan(&userID, &used)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("install code not found")
	}
	if err != nil {
		return nil, err
	}
	if used {
		return nil, fmt.Errorf("install code already used")
	}

	if _, err := tx.Exec(
		`UPDATE install_code SET used = TRUE WHERE code = ?`, code,
	); err != nil {
		return nil, err
	}

	row := tx.QueryRow(
		`SELECT `+userColumns+` FROM user WHERE id = ?`, userID,
	)
	u, err := scanUser(row)
	if err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return u, nil
}

// ── LimitRule ─────────────────────────────────────────────────────────────────

const limitRuleColumns = `id, user_id, type, model, window, value,
	schedule_start, schedule_end, schedule_tz, created_at`

func scanLimitRule(row interface {
	Scan(...any) error
}) (*shared.LimitRule, error) {
	var r shared.LimitRule
	err := row.Scan(
		&r.ID, &r.UserID, &r.Type, &r.Model, &r.Window, &r.Value,
		&r.ScheduleStart, &r.ScheduleEnd, &r.ScheduleTZ, &r.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &r, nil
}

// GetLimitRules returns all limit rules for the given user.
func (s *Store) GetLimitRules(userID string) ([]shared.LimitRule, error) {
	rows, err := s.db.Query(
		`SELECT `+limitRuleColumns+` FROM limit_rule WHERE user_id = ?`, userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var rules []shared.LimitRule
	for rows.Next() {
		r, err := scanLimitRule(rows)
		if err != nil {
			return nil, err
		}
		rules = append(rules, *r)
	}
	return rules, rows.Err()
}

// ReplaceLimitRules atomically replaces all limit rules for the user.
func (s *Store) ReplaceLimitRules(userID string, rules []shared.LimitRule) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback() //nolint:errcheck

	if _, err := tx.Exec(`DELETE FROM limit_rule WHERE user_id = ?`, userID); err != nil {
		return err
	}

	for _, r := range rules {
		if _, err := tx.Exec(
			`INSERT INTO limit_rule (id, user_id, type, model, window, value,
			  schedule_start, schedule_end, schedule_tz)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			r.ID, userID, r.Type, r.Model, r.Window, r.Value,
			r.ScheduleStart, r.ScheduleEnd, r.ScheduleTZ,
		); err != nil {
			return err
		}
	}

	return tx.Commit()
}

// ── Plan ──────────────────────────────────────────────────────────────────────

const planColumns = `id, name, max_users, max_prompts_per_day, max_storage_mb,
	ai_summaries, webhooks, export, rate_limiting, custom_branding, created_at`

func scanPlan(row interface {
	Scan(...any) error
}) (*shared.Plan, error) {
	var p shared.Plan
	err := row.Scan(
		&p.ID, &p.Name, &p.MaxUsers, &p.MaxPromptsPerDay, &p.MaxStorageMB,
		&p.AISummaries, &p.Webhooks, &p.Export, &p.RateLimiting, &p.CustomBranding,
		&p.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &p, nil
}

// GetPlan returns the plan with the given ID.
func (s *Store) GetPlan(id string) (*shared.Plan, error) {
	row := s.db.QueryRow(
		`SELECT `+planColumns+` FROM plan WHERE id = ?`, id,
	)
	p, err := scanPlan(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return p, err
}
