package server

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/howincodes/clawlens/internal/shared"
)

// ── JWTManager tests ──────────────────────────────────────────────────────────

func TestJWTCreateAndVerify(t *testing.T) {
	mgr := NewJWTManager("test-secret-key")

	token, err := mgr.Create("team-abc")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if token == "" {
		t.Fatal("expected non-empty token")
	}

	teamID, err := mgr.Verify(token)
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if teamID != "team-abc" {
		t.Errorf("expected teamID %q, got %q", "team-abc", teamID)
	}
}

func TestJWTInvalidToken(t *testing.T) {
	mgr := NewJWTManager("test-secret-key")

	_, err := mgr.Verify("this.is.garbage")
	if err == nil {
		t.Fatal("expected error for garbage token, got nil")
	}
}

func TestJWTWrongSecret(t *testing.T) {
	mgr1 := NewJWTManager("secret-one")
	mgr2 := NewJWTManager("secret-two")

	token, err := mgr1.Create("team-xyz")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	_, err = mgr2.Verify(token)
	if err == nil {
		t.Fatal("expected error when verifying with wrong secret")
	}
}

func TestJWTAutoGenerateSecret(t *testing.T) {
	// Empty string should auto-generate a secret.
	mgr := NewJWTManager("")
	token, err := mgr.Create("team-auto")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	teamID, err := mgr.Verify(token)
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if teamID != "team-auto" {
		t.Errorf("expected %q, got %q", "team-auto", teamID)
	}
}

// ── HookAuth middleware tests ─────────────────────────────────────────────────

func newOKHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
}

func TestHookAuthMiddleware_ValidToken(t *testing.T) {
	store := newTestStore(t)

	user := &shared.User{
		ID:        shared.GenerateID(),
		TeamID:    "default",
		Slug:      "hook-user",
		Name:      "Hook User",
		AuthToken: shared.GenerateToken(),
		Status:    "active",
	}
	if err := store.CreateUser(user); err != nil {
		t.Fatalf("CreateUser: %v", err)
	}

	handler := HookAuth(store)(newOKHandler())

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer "+user.AuthToken)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}
}

func TestHookAuthMiddleware_MissingToken(t *testing.T) {
	store := newTestStore(t)
	handler := HookAuth(store)(newOKHandler())

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rec.Code)
	}
}

func TestHookAuthMiddleware_InvalidToken(t *testing.T) {
	store := newTestStore(t)
	handler := HookAuth(store)(newOKHandler())

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer invalid-token-does-not-exist")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rec.Code)
	}
}

func TestHookAuthMiddleware_ContextValues(t *testing.T) {
	store := newTestStore(t)

	user := &shared.User{
		ID:        shared.GenerateID(),
		TeamID:    "default",
		Slug:      "ctx-user",
		Name:      "Ctx User",
		AuthToken: shared.GenerateToken(),
		Status:    "active",
	}
	if err := store.CreateUser(user); err != nil {
		t.Fatalf("CreateUser: %v", err)
	}

	var gotUser *shared.User
	var gotTeam *shared.Team
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotUser = UserFromContext(r.Context())
		gotTeam = TeamFromContext(r.Context())
		w.WriteHeader(http.StatusOK)
	})

	handler := HookAuth(store)(inner)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer "+user.AuthToken)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if gotUser == nil || gotUser.ID != user.ID {
		t.Errorf("expected user in context, got %v", gotUser)
	}
	if gotTeam == nil || gotTeam.ID != "default" {
		t.Errorf("expected team in context, got %v", gotTeam)
	}
}

// ── AdminAuth middleware tests ─────────────────────────────────────────────────

func TestAdminAuthMiddleware_ValidJWT(t *testing.T) {
	store := newTestStore(t)
	mgr := NewJWTManager("admin-secret")

	token, err := mgr.Create("default")
	if err != nil {
		t.Fatalf("Create JWT: %v", err)
	}

	handler := AdminAuth(mgr, store)(newOKHandler())

	req := httptest.NewRequest(http.MethodGet, "/admin", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}
}

func TestAdminAuthMiddleware_MissingToken(t *testing.T) {
	store := newTestStore(t)
	mgr := NewJWTManager("admin-secret")
	handler := AdminAuth(mgr, store)(newOKHandler())

	req := httptest.NewRequest(http.MethodGet, "/admin", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rec.Code)
	}
}

func TestAdminAuthMiddleware_InvalidJWT(t *testing.T) {
	store := newTestStore(t)
	mgr := NewJWTManager("admin-secret")
	handler := AdminAuth(mgr, store)(newOKHandler())

	req := httptest.NewRequest(http.MethodGet, "/admin", nil)
	req.Header.Set("Authorization", "Bearer not.a.valid.jwt")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rec.Code)
	}
}

func TestAdminAuthMiddleware_TeamInContext(t *testing.T) {
	store := newTestStore(t)
	mgr := NewJWTManager("admin-secret")

	token, err := mgr.Create("default")
	if err != nil {
		t.Fatalf("Create JWT: %v", err)
	}

	var gotTeam *shared.Team
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotTeam = TeamFromContext(r.Context())
		w.WriteHeader(http.StatusOK)
	})
	handler := AdminAuth(mgr, store)(inner)

	req := httptest.NewRequest(http.MethodGet, "/admin", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if gotTeam == nil || gotTeam.ID != "default" {
		t.Errorf("expected team in context with id 'default', got %v", gotTeam)
	}
}
