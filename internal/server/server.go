package server

import (
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"
)

// Config holds the runtime configuration for the ClawLens server.
type Config struct {
	Port          string
	AdminPassword string
	DBPath        string
	JWTSecret     string
	Mode          string // "saas" or "selfhost"
}

// Run initialises the store, wires all routes and middleware, starts background
// jobs, and begins serving HTTP requests. It only returns on error.
func Run(cfg Config) error {
	// ── Storage ───────────────────────────────────────────────────────────────

	store, err := NewStore(cfg.DBPath)
	if err != nil {
		return fmt.Errorf("open store: %w", err)
	}

	if err := store.Init(); err != nil {
		return fmt.Errorf("init schema: %w", err)
	}

	if err := store.Seed(cfg.AdminPassword, cfg.Mode); err != nil {
		return fmt.Errorf("seed store: %w", err)
	}

	// ── Core components ───────────────────────────────────────────────────────

	hub := NewWSHub()
	jwtMgr := NewJWTManager(cfg.JWTSecret)
	analytics := NewAnalytics(store)
	summaryEngine := NewSummaryEngine(store)

	// ── Router ────────────────────────────────────────────────────────────────

	mux := http.NewServeMux()

	RegisterHookRoutes(mux, store, hub)
	RegisterAdminRoutes(mux, store, hub, jwtMgr, analytics)

	// WebSocket endpoint — no method qualifier so the upgrade works for any
	// method (clients use GET with the Upgrade header).
	mux.HandleFunc("GET /ws", hub.HandleWS)

	// Dashboard placeholder — exact "/" only so it doesn't swallow other routes.
	// Registered without a method qualifier so that the more-specific patterns
	// registered above take priority; the path guard inside ensures we only
	// serve the placeholder for the root path.
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		fmt.Fprint(w, `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ClawLens</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 640px; margin: 80px auto; padding: 0 1rem; color: #1a1a1a; }
    h1   { font-size: 2rem; margin-bottom: 0.25rem; }
    p    { color: #555; }
    a    { color: #0066cc; }
    code { background: #f4f4f4; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }
  </style>
</head>
<body>
  <h1>ClawLens</h1>
  <p>Server is running. Use the API or connect the dashboard.</p>
  <ul>
    <li><a href="/api/v1/health"><code>GET /api/v1/health</code></a> — health check</li>
    <li><code>POST /api/admin/login</code> — admin login</li>
    <li><code>ws://&lt;host&gt;/ws</code> — WebSocket events</li>
  </ul>
</body>
</html>`)
	})

	// ── Middleware stack ───────────────────────────────────────────────────────

	handler := corsMiddleware(loggingMiddleware(mux))

	// ── Background jobs ───────────────────────────────────────────────────────

	team, err := store.GetTeam()
	if err != nil {
		return fmt.Errorf("get team: %w", err)
	}
	if team == nil {
		return fmt.Errorf("no team found after seed — this should not happen")
	}

	jobs := NewJobRunner(store, hub, summaryEngine, analytics, team.ID)
	jobs.Start()

	// ── HTTP server ───────────────────────────────────────────────────────────

	srv := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      handler,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	log.Printf("ClawLens server listening on port %s", cfg.Port)
	return srv.ListenAndServe()
}

// ── Middleware ────────────────────────────────────────────────────────────────

// loggingMiddleware logs the HTTP method, path, and duration for every request.
// WebSocket upgrade requests are passed through without logging so that the
// write to stderr cannot race with the upgraded connection.
func loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Skip logging for WebSocket upgrades to avoid interfering with the
		// upgrade handshake.
		if strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
			next.ServeHTTP(w, r)
			return
		}

		start := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(start))
	})
}

// corsMiddleware adds permissive CORS headers and handles pre-flight OPTIONS
// requests by returning a 204 No Content response immediately.
func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}
