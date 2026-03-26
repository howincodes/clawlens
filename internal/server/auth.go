package server

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/howincodes/clawlens/internal/shared"
)

// ── Context keys ─────────────────────────────────────────────────────────────

type contextKey string

const (
	ctxUser contextKey = "user"
	ctxTeam contextKey = "team"
)

// UserFromContext retrieves the authenticated user from the request context.
func UserFromContext(ctx context.Context) *shared.User {
	u, _ := ctx.Value(ctxUser).(*shared.User)
	return u
}

// TeamFromContext retrieves the team from the request context.
func TeamFromContext(ctx context.Context) *shared.Team {
	t, _ := ctx.Value(ctxTeam).(*shared.Team)
	return t
}

// ── JWTManager ───────────────────────────────────────────────────────────────

// JWTManager handles creation and verification of HS256 admin JWTs.
type JWTManager struct {
	secret []byte
}

// NewJWTManager creates a JWTManager with the given secret. If secret is empty
// a cryptographically random token is auto-generated.
func NewJWTManager(secret string) *JWTManager {
	if secret == "" {
		secret = shared.GenerateToken()
	}
	return &JWTManager{secret: []byte(secret)}
}

// Create generates a signed HS256 JWT containing the team_id claim,
// expiring 24 hours from now.
func (m *JWTManager) Create(teamID string) (string, error) {
	now := time.Now()
	claims := jwt.MapClaims{
		"team_id": teamID,
		"exp":     now.Add(24 * time.Hour).Unix(),
		"iat":     now.Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(m.secret)
}

// Verify parses and validates a JWT, returning the team_id claim.
func (m *JWTManager) Verify(tokenStr string) (string, error) {
	token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, jwt.ErrSignatureInvalid
		}
		return m.secret, nil
	})
	if err != nil {
		return "", err
	}
	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok || !token.Valid {
		return "", jwt.ErrTokenInvalidClaims
	}
	teamID, ok := claims["team_id"].(string)
	if !ok {
		return "", jwt.ErrTokenInvalidClaims
	}
	return teamID, nil
}

// ── Middleware ────────────────────────────────────────────────────────────────

// HookAuth validates a user Bearer token (hook/client auth). It looks up the
// user by token, fetches the team, and attaches both to the request context.
func HookAuth(store *Store) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token := extractBearer(r)
			if token == "" {
				writeUnauthorized(w, "missing token")
				return
			}

			user, err := store.GetUserByToken(token)
			if err != nil || user == nil {
				writeUnauthorized(w, "invalid token")
				return
			}

			team, err := store.GetTeam()
			if err != nil || team == nil {
				writeUnauthorized(w, "team not found")
				return
			}

			ctx := context.WithValue(r.Context(), ctxUser, user)
			ctx = context.WithValue(ctx, ctxTeam, team)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// AdminAuth validates an admin JWT. It verifies the token, fetches the team by
// ID, and attaches the team to the request context.
func AdminAuth(jwtMgr *JWTManager, store *Store) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			tokenStr := extractBearer(r)
			if tokenStr == "" {
				writeUnauthorized(w, "missing token")
				return
			}

			teamID, err := jwtMgr.Verify(tokenStr)
			if err != nil {
				writeUnauthorized(w, "invalid token")
				return
			}

			team, err := store.GetTeamByID(teamID)
			if err != nil || team == nil {
				writeUnauthorized(w, "team not found")
				return
			}

			ctx := context.WithValue(r.Context(), ctxTeam, team)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// extractBearer pulls the token from an "Authorization: Bearer <token>" header.
func extractBearer(r *http.Request) string {
	auth := r.Header.Get("Authorization")
	if strings.HasPrefix(auth, "Bearer ") {
		return auth[7:]
	}
	return ""
}

// writeUnauthorized writes a 401 JSON error response.
func writeUnauthorized(w http.ResponseWriter, reason string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": reason})
}
