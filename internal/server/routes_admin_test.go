package server

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/howincodes/clawlens/internal/shared"
)

// newAdminTestServer creates a test store, registers admin routes, and returns
// the store, mux, and a valid admin JWT.
func newAdminTestServer(t *testing.T) (*Store, *http.ServeMux, string) {
	t.Helper()
	store := newTestStore(t)
	hub := NewWSHub()
	jwtMgr := NewJWTManager("test-secret")
	analytics := NewAnalytics(store)
	mux := http.NewServeMux()
	RegisterAdminRoutes(mux, store, hub, jwtMgr, analytics)

	// Get JWT for tests
	team, _ := store.GetTeam()
	token, _ := jwtMgr.Create(team.ID)
	return store, mux, token
}

// adminRequest builds an *http.Request for admin endpoint tests.
func adminRequest(method, path string, body any, token string) *http.Request {
	var bodyReader io.Reader
	if body != nil {
		data, _ := json.Marshal(body)
		bodyReader = bytes.NewReader(data)
	}
	req := httptest.NewRequest(method, path, bodyReader)
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	return req
}

// ── Tests ─────────────────────────────────────────────────────────────────────

func TestLoginSuccess(t *testing.T) {
	_, mux, _ := newAdminTestServer(t)

	req := adminRequest(http.MethodPost, "/api/admin/login", map[string]string{"password": "testpass"}, "")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body: %s", rec.Code, rec.Body.String())
	}

	var resp shared.LoginResponse
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Token == "" {
		t.Error("expected non-empty token")
	}
	if resp.Team.ID == "" {
		t.Error("expected non-empty team in response")
	}
}

func TestLoginWrongPassword(t *testing.T) {
	_, mux, _ := newAdminTestServer(t)

	req := adminRequest(http.MethodPost, "/api/admin/login", map[string]string{"password": "wrongpassword"}, "")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rec.Code)
	}
}

func TestGetTeam(t *testing.T) {
	_, mux, token := newAdminTestServer(t)

	req := adminRequest(http.MethodGet, "/api/admin/team", nil, token)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body: %s", rec.Code, rec.Body.String())
	}

	var team shared.Team
	if err := json.NewDecoder(rec.Body).Decode(&team); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if team.ID == "" {
		t.Error("expected non-empty team ID")
	}
	if team.Name == "" {
		t.Error("expected non-empty team name")
	}
}

func TestGetTeamUnauthorized(t *testing.T) {
	_, mux, _ := newAdminTestServer(t)

	req := adminRequest(http.MethodGet, "/api/admin/team", nil, "")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rec.Code)
	}
}

func TestCreateAndGetUser(t *testing.T) {
	_, mux, token := newAdminTestServer(t)

	// Create user
	createReq := adminRequest(http.MethodPost, "/api/admin/users", map[string]any{
		"name": "Alice",
		"slug": "alice",
	}, token)
	createRec := httptest.NewRecorder()
	mux.ServeHTTP(createRec, createReq)

	if createRec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d; body: %s", createRec.Code, createRec.Body.String())
	}

	var createResp map[string]any
	if err := json.NewDecoder(createRec.Body).Decode(&createResp); err != nil {
		t.Fatalf("decode create response: %v", err)
	}

	installCode, ok := createResp["install_code"].(string)
	if !ok || installCode == "" {
		t.Error("expected non-empty install_code in create response")
	}

	userMap, ok := createResp["user"].(map[string]any)
	if !ok {
		t.Fatal("expected user object in create response")
	}
	userID, ok := userMap["id"].(string)
	if !ok || userID == "" {
		t.Fatal("expected non-empty user ID in create response")
	}

	// GET user by ID
	getReq := adminRequest(http.MethodGet, "/api/admin/users/"+userID, nil, token)
	getRec := httptest.NewRecorder()
	mux.ServeHTTP(getRec, getReq)

	if getRec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body: %s", getRec.Code, getRec.Body.String())
	}

	var getResp map[string]any
	if err := json.NewDecoder(getRec.Body).Decode(&getResp); err != nil {
		t.Fatalf("decode get response: %v", err)
	}

	fetchedUser, ok := getResp["user"].(map[string]any)
	if !ok {
		t.Fatal("expected user in GET response")
	}
	if fetchedUser["id"] != userID {
		t.Errorf("expected user ID %q, got %q", userID, fetchedUser["id"])
	}
	if fetchedUser["name"] != "Alice" {
		t.Errorf("expected name Alice, got %q", fetchedUser["name"])
	}

	if _, ok := getResp["devices"]; !ok {
		t.Error("expected devices field in GET response")
	}
	if _, ok := getResp["limits"]; !ok {
		t.Error("expected limits field in GET response")
	}
}

func TestUpdateUserStatus(t *testing.T) {
	store, mux, token := newAdminTestServer(t)

	// Create a user first
	team, _ := store.GetTeam()
	user := &shared.User{
		ID:        shared.GenerateID(),
		TeamID:    team.ID,
		Slug:      "bob",
		Name:      "Bob",
		AuthToken: shared.GenerateToken(),
		Status:    "active",
	}
	if err := store.CreateUser(user); err != nil {
		t.Fatalf("CreateUser: %v", err)
	}

	// Update status to killed
	updateReq := adminRequest(http.MethodPut, "/api/admin/users/"+user.ID, map[string]any{
		"status": "killed",
	}, token)
	updateRec := httptest.NewRecorder()
	mux.ServeHTTP(updateRec, updateReq)

	if updateRec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body: %s", updateRec.Code, updateRec.Body.String())
	}

	// Verify user status changed
	updated, err := store.GetUser(user.ID)
	if err != nil || updated == nil {
		t.Fatal("expected user after update")
	}
	if updated.Status != "killed" {
		t.Errorf("expected status=killed, got %q", updated.Status)
	}

	// Verify audit log entry was created
	entries, total, err := store.GetAuditLog(team.ID, 10, 0, nil)
	if err != nil {
		t.Fatalf("GetAuditLog: %v", err)
	}
	if total == 0 {
		t.Error("expected at least one audit log entry")
	}

	found := false
	for _, e := range entries {
		if e.Action == "user_killed" {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("expected user_killed audit entry, got entries: %v", entries)
	}
}

func TestDeleteUser(t *testing.T) {
	store, mux, token := newAdminTestServer(t)

	// Create a user
	team, _ := store.GetTeam()
	user := &shared.User{
		ID:        shared.GenerateID(),
		TeamID:    team.ID,
		Slug:      "charlie",
		Name:      "Charlie",
		AuthToken: shared.GenerateToken(),
		Status:    "active",
	}
	if err := store.CreateUser(user); err != nil {
		t.Fatalf("CreateUser: %v", err)
	}

	// Delete the user
	deleteReq := adminRequest(http.MethodDelete, "/api/admin/users/"+user.ID, nil, token)
	deleteRec := httptest.NewRecorder()
	mux.ServeHTTP(deleteRec, deleteReq)

	if deleteRec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body: %s", deleteRec.Code, deleteRec.Body.String())
	}

	var resp map[string]any
	if err := json.NewDecoder(deleteRec.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp["deleted"] != true {
		t.Errorf("expected deleted=true, got %v", resp["deleted"])
	}

	// Verify user is gone
	gone, err := store.GetUser(user.ID)
	if err != nil {
		t.Fatalf("GetUser: %v", err)
	}
	if gone != nil {
		t.Error("expected user to be deleted, but still found in DB")
	}
}

func TestGetAnalytics(t *testing.T) {
	_, mux, token := newAdminTestServer(t)

	req := adminRequest(http.MethodGet, "/api/admin/analytics?days=7", nil, token)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body: %s", rec.Code, rec.Body.String())
	}

	var resp map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if _, ok := resp["overview"]; !ok {
		t.Error("expected overview field in analytics response")
	}
	if _, ok := resp["trends"]; !ok {
		t.Error("expected trends field in analytics response")
	}
	if _, ok := resp["model_distribution"]; !ok {
		t.Error("expected model_distribution field in analytics response")
	}
	if _, ok := resp["tool_distribution"]; !ok {
		t.Error("expected tool_distribution field in analytics response")
	}
	if _, ok := resp["peak_hours"]; !ok {
		t.Error("expected peak_hours field in analytics response")
	}
}

func TestGetAuditLog(t *testing.T) {
	store, mux, token := newAdminTestServer(t)

	team, _ := store.GetTeam()

	// Create some audit entries
	action1 := "user_created"
	action2 := "user_deleted"
	target := "some-user-id"
	_ = store.RecordAudit(team.ID, "admin", action1, &target, nil)
	_ = store.RecordAudit(team.ID, "admin", action2, &target, nil)

	// GET audit log (paginated)
	req := adminRequest(http.MethodGet, "/api/admin/audit-log?page=1&limit=10", nil, token)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body: %s", rec.Code, rec.Body.String())
	}

	var resp shared.PaginatedResponse
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if resp.Total < 2 {
		t.Errorf("expected at least 2 audit entries, got %d", resp.Total)
	}
	if resp.Page != 1 {
		t.Errorf("expected page=1, got %d", resp.Page)
	}
	if resp.Limit != 10 {
		t.Errorf("expected limit=10, got %d", resp.Limit)
	}

	// Test filtering by action
	filterReq := adminRequest(http.MethodGet, "/api/admin/audit-log?action=user_created", nil, token)
	filterRec := httptest.NewRecorder()
	mux.ServeHTTP(filterRec, filterReq)

	if filterRec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body: %s", filterRec.Code, filterRec.Body.String())
	}

	var filterResp shared.PaginatedResponse
	if err := json.NewDecoder(filterRec.Body).Decode(&filterResp); err != nil {
		t.Fatalf("decode filter response: %v", err)
	}
	if filterResp.Total != 1 {
		t.Errorf("expected 1 user_created audit entry, got %d", filterResp.Total)
	}
}

func TestGetUsers(t *testing.T) {
	store, mux, token := newAdminTestServer(t)

	// Create a couple of users
	team, _ := store.GetTeam()
	for _, name := range []string{"Dave", "Eve"} {
		u := &shared.User{
			ID:        shared.GenerateID(),
			TeamID:    team.ID,
			Slug:      name,
			Name:      name,
			AuthToken: shared.GenerateToken(),
			Status:    "active",
		}
		_ = store.CreateUser(u)
	}

	req := adminRequest(http.MethodGet, "/api/admin/users", nil, token)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body: %s", rec.Code, rec.Body.String())
	}

	var resp map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	users, ok := resp["users"].([]any)
	if !ok {
		t.Fatal("expected users array in response")
	}
	if len(users) < 2 {
		t.Errorf("expected at least 2 users, got %d", len(users))
	}
}

func TestRotateToken(t *testing.T) {
	store, mux, token := newAdminTestServer(t)

	team, _ := store.GetTeam()
	user := &shared.User{
		ID:        shared.GenerateID(),
		TeamID:    team.ID,
		Slug:      "frank",
		Name:      "Frank",
		AuthToken: shared.GenerateToken(),
		Status:    "active",
	}
	if err := store.CreateUser(user); err != nil {
		t.Fatalf("CreateUser: %v", err)
	}

	oldToken := user.AuthToken

	req := adminRequest(http.MethodPost, "/api/admin/users/"+user.ID+"/rotate-token", nil, token)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body: %s", rec.Code, rec.Body.String())
	}

	var resp map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	newToken := resp["auth_token"]
	if newToken == "" {
		t.Error("expected non-empty auth_token in response")
	}
	if newToken == oldToken {
		t.Error("expected new token to differ from old token")
	}
}

func TestGetSubscriptions(t *testing.T) {
	_, mux, token := newAdminTestServer(t)

	req := adminRequest(http.MethodGet, "/api/admin/subscriptions", nil, token)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body: %s", rec.Code, rec.Body.String())
	}

	var resp map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if _, ok := resp["subscriptions"]; !ok {
		t.Error("expected subscriptions field in response")
	}
}

func TestUpdateTeam(t *testing.T) {
	store, mux, token := newAdminTestServer(t)

	req := adminRequest(http.MethodPut, "/api/admin/team", map[string]any{
		"name": "Updated Team Name",
	}, token)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body: %s", rec.Code, rec.Body.String())
	}

	// Verify the name changed
	team, err := store.GetTeam()
	if err != nil || team == nil {
		t.Fatal("expected team")
	}
	if team.Name != "Updated Team Name" {
		t.Errorf("expected name 'Updated Team Name', got %q", team.Name)
	}
}

func TestGenerateSummary(t *testing.T) {
	_, mux, token := newAdminTestServer(t)

	req := adminRequest(http.MethodPost, "/api/admin/summaries/generate", nil, token)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body: %s", rec.Code, rec.Body.String())
	}

	var resp map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp["status"] != "started" {
		t.Errorf("expected status=started, got %q", resp["status"])
	}
}

func TestExport(t *testing.T) {
	_, mux, token := newAdminTestServer(t)

	// CSV export for prompts
	req := adminRequest(http.MethodGet, "/api/admin/export/prompts", nil, token)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body: %s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "text/csv" {
		t.Errorf("expected Content-Type text/csv, got %q", ct)
	}

	// JSON export for usage
	req2 := adminRequest(http.MethodGet, "/api/admin/export/usage", nil, token)
	rec2 := httptest.NewRecorder()
	mux.ServeHTTP(rec2, req2)

	if rec2.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body: %s", rec2.Code, rec2.Body.String())
	}
	if ct := rec2.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("expected Content-Type application/json, got %q", ct)
	}

	// Unknown export type returns 400
	req3 := adminRequest(http.MethodGet, "/api/admin/export/unknown", nil, token)
	rec3 := httptest.NewRecorder()
	mux.ServeHTTP(rec3, req3)

	if rec3.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for unknown export type, got %d", rec3.Code)
	}
}
