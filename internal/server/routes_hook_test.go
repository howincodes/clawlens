package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/howincodes/clawlens/internal/shared"
)

// newTestServer sets up a full test server with store, hub, mux, and a test user.
func newTestServer(t *testing.T) (*Store, *WSHub, *http.ServeMux, *shared.User, string) {
	t.Helper()
	store := newTestStore(t)
	hub := NewWSHub()
	mux := http.NewServeMux()
	RegisterHookRoutes(mux, store, hub)

	// Create a test user.
	team, _ := store.GetTeam()
	user := &shared.User{
		ID:        shared.GenerateID(),
		TeamID:    team.ID,
		Slug:      "test",
		Name:      "Test User",
		AuthToken: shared.GenerateToken(),
		Status:    "active",
	}
	store.CreateUser(user) //nolint:errcheck

	return store, hub, mux, user, user.AuthToken
}

func TestHealthEndpoint(t *testing.T) {
	_, _, mux, _, _ := newTestServer(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/health", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}

	var body map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body["status"] != "ok" {
		t.Errorf("expected status=ok, got %q", body["status"])
	}
}

func TestRegisterEndpoint(t *testing.T) {
	store, _, mux, user, _ := newTestServer(t)

	code := shared.GenerateInstallCode(user.Slug)
	if err := store.CreateInstallCode(code, user.ID); err != nil {
		t.Fatalf("CreateInstallCode: %v", err)
	}

	body, _ := json.Marshal(shared.RegisterRequest{Code: code})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/register", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body: %s", rec.Code, rec.Body.String())
	}

	var resp shared.RegisterResponse
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.AuthToken == "" {
		t.Error("expected non-empty auth_token")
	}
	if resp.UserID != user.ID {
		t.Errorf("expected user_id %q, got %q", user.ID, resp.UserID)
	}
}

func TestRegisterInvalidCode(t *testing.T) {
	_, _, mux, _, _ := newTestServer(t)

	body, _ := json.Marshal(shared.RegisterRequest{Code: "INVALID-CODE"})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/register", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rec.Code)
	}
}

func TestSessionStartEndpoint(t *testing.T) {
	store, _, mux, user, token := newTestServer(t)

	reqBody := shared.SessionStartRequest{
		SessionID:     shared.GenerateID(),
		Model:         "claude-3-5-sonnet",
		CWD:           "/home/user/myproject",
		Hostname:      "myhost",
		Platform:      "linux",
		Arch:          "amd64",
		OSVersion:     "5.15",
		GoVersion:     "go1.22",
		ClaudeVersion: "1.0.0",
		ClientVersion: "0.1.0",
	}

	body, _ := json.Marshal(reqBody)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/session-start", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body: %s", rec.Code, rec.Body.String())
	}

	var resp shared.SessionStartResponse
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Status != user.Status {
		t.Errorf("expected status %q, got %q", user.Status, resp.Status)
	}

	// Verify session was created in DB.
	sess, err := store.GetSession(reqBody.SessionID)
	if err != nil {
		t.Fatalf("GetSession: %v", err)
	}
	if sess == nil {
		t.Fatal("expected session in DB, got nil")
	}
	if sess.UserID != user.ID {
		t.Errorf("expected session user_id %q, got %q", user.ID, sess.UserID)
	}
}

func TestPromptEndpoint_Allowed(t *testing.T) {
	_, _, mux, user, token := newTestServer(t)

	// Start session first.
	sessionID := shared.GenerateID()
	sessBody, _ := json.Marshal(shared.SessionStartRequest{
		SessionID:     sessionID,
		Model:         "claude-3-5-sonnet",
		CWD:           "/home/user/project",
		Hostname:      "host",
		Platform:      "linux",
		Arch:          "amd64",
		OSVersion:     "5.15",
		GoVersion:     "go1.22",
		ClaudeVersion: "1.0.0",
		ClientVersion: "0.1.0",
	})
	sessReq := httptest.NewRequest(http.MethodPost, "/api/v1/session-start", bytes.NewReader(sessBody))
	sessReq.Header.Set("Content-Type", "application/json")
	sessReq.Header.Set("Authorization", "Bearer "+token)
	mux.ServeHTTP(httptest.NewRecorder(), sessReq)

	promptText := "What does this function do?"
	reqBody := shared.PromptRequest{
		SessionID:    sessionID,
		Model:        "claude-3-5-sonnet",
		PromptText:   &promptText,
		PromptLength: len(promptText),
		CWD:          "/home/user/project",
		ProjectDir:   "project",
	}
	_ = user // used via token auth

	body, _ := json.Marshal(reqBody)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/prompt", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body: %s", rec.Code, rec.Body.String())
	}

	var resp shared.PromptResponse
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !resp.Allowed {
		t.Errorf("expected allowed=true, got false; reason: %v", resp.Reason)
	}
}

func TestPromptEndpoint_Blocked(t *testing.T) {
	store, _, mux, user, token := newTestServer(t)

	// Set a credit limit of 3 credits with a daily window.
	limit := 3
	window := "daily"
	rule := shared.LimitRule{
		ID:     shared.GenerateID(),
		UserID: user.ID,
		Type:   "credits",
		Value:  &limit,
		Window: &window,
	}
	if err := store.ReplaceLimitRules(user.ID, []shared.LimitRule{rule}); err != nil {
		t.Fatalf("ReplaceLimitRules: %v", err)
	}

	// Start a session.
	sessionID := shared.GenerateID()
	sessBody, _ := json.Marshal(shared.SessionStartRequest{
		SessionID:     sessionID,
		Model:         "claude-3-5-sonnet",
		CWD:           "/project",
		Hostname:      "host",
		Platform:      "linux",
		Arch:          "amd64",
		OSVersion:     "5.15",
		GoVersion:     "go1.22",
		ClaudeVersion: "1.0.0",
		ClientVersion: "0.1.0",
	})
	sessReq := httptest.NewRequest(http.MethodPost, "/api/v1/session-start", bytes.NewReader(sessBody))
	sessReq.Header.Set("Content-Type", "application/json")
	sessReq.Header.Set("Authorization", "Bearer "+token)
	mux.ServeHTTP(httptest.NewRecorder(), sessReq)

	// Pre-insert prompts that exhaust the credit limit.
	// Default sonnet weight is 3; limit is 3 → one prompt of cost 3 should trigger the limit.
	existing := &shared.Prompt{
		UserID:       user.ID,
		SessionID:    &sessionID,
		Model:        strPtr("claude-3-5-sonnet"),
		PromptLength: 10,
		CreditCost:   3,
		Timestamp:    time.Now().UTC(),
	}
	_, err := store.RecordPrompt(existing)
	if err != nil {
		t.Fatalf("RecordPrompt: %v", err)
	}

	// Now attempt another prompt — should be blocked.
	promptText := "blocked prompt"
	reqBody := shared.PromptRequest{
		SessionID:    sessionID,
		Model:        "claude-3-5-sonnet",
		PromptText:   &promptText,
		PromptLength: len(promptText),
		CWD:          "/project",
		ProjectDir:   "project",
	}
	body, _ := json.Marshal(reqBody)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/prompt", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body: %s", rec.Code, rec.Body.String())
	}

	var resp shared.PromptResponse
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Allowed {
		t.Error("expected allowed=false (blocked), got true")
	}
}

func TestSyncBatchEndpoint(t *testing.T) {
	store, _, mux, user, token := newTestServer(t)

	// Start a session first.
	sessionID := shared.GenerateID()
	sessBody, _ := json.Marshal(shared.SessionStartRequest{
		SessionID:     sessionID,
		Model:         "claude-3-5-sonnet",
		CWD:           "/project",
		Hostname:      "host",
		Platform:      "linux",
		Arch:          "amd64",
		OSVersion:     "5.15",
		GoVersion:     "go1.22",
		ClaudeVersion: "1.0.0",
		ClientVersion: "0.1.0",
	})
	sessReq := httptest.NewRequest(http.MethodPost, "/api/v1/session-start", bytes.NewReader(sessBody))
	sessReq.Header.Set("Content-Type", "application/json")
	sessReq.Header.Set("Authorization", "Bearer "+token)
	mux.ServeHTTP(httptest.NewRecorder(), sessReq)

	// Also record a prompt so UpdatePromptWithResponse has something to update.
	p := &shared.Prompt{
		UserID:       user.ID,
		SessionID:    &sessionID,
		Model:        strPtr("claude-3-5-sonnet"),
		PromptLength: 10,
		Timestamp:    time.Now().UTC(),
	}
	_, err := store.RecordPrompt(p)
	if err != nil {
		t.Fatalf("RecordPrompt: %v", err)
	}

	toolData, _ := json.Marshal(shared.ToolEventData{
		ToolName: "read_file",
		Success:  true,
	})
	stopData, _ := json.Marshal(shared.StopEventData{
		Model:      "claude-3-5-sonnet",
		CreditCost: 3,
	})
	endData, _ := json.Marshal(shared.SessionEndEventData{Reason: "normal"})

	batchReq := shared.BatchSyncRequest{
		Events: []shared.Event{
			{Type: "tool", SessionID: sessionID, Timestamp: time.Now().UTC(), Data: toolData},
			{Type: "stop", SessionID: sessionID, Timestamp: time.Now().UTC(), Data: stopData},
			{Type: "session_end", SessionID: sessionID, Timestamp: time.Now().UTC(), Data: endData},
		},
	}

	body, _ := json.Marshal(batchReq)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/sync-batch", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body: %s", rec.Code, rec.Body.String())
	}

	var resp map[string]int
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp["processed"] != 3 {
		t.Errorf("expected processed=3, got %d", resp["processed"])
	}

	// Verify session was ended in DB.
	sess, err := store.GetSession(sessionID)
	if err != nil {
		t.Fatalf("GetSession: %v", err)
	}
	if sess == nil {
		t.Fatal("expected session, got nil")
	}
	if sess.EndedAt == nil {
		t.Error("expected session to be ended (ended_at set)")
	}
}
