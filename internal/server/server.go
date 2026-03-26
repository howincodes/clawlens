package server

import (
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
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
	DashboardDir  string // path to dashboard dist/ (empty = placeholder)
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

	// Dashboard — serve from dist/ directory if configured, otherwise placeholder.
	if cfg.DashboardDir != "" {
		if info, err := os.Stat(cfg.DashboardDir); err == nil && info.IsDir() {
			log.Printf("Serving dashboard from %s", cfg.DashboardDir)
			dashFS := os.DirFS(cfg.DashboardDir)
			fileServer := http.FileServerFS(dashFS)
			mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
				// Try to serve the file directly
				path := r.URL.Path
				if path == "/" {
					path = "/index.html"
				}
				// Check if file exists in dist/
				if f, err := fs.Stat(dashFS, strings.TrimPrefix(path, "/")); err == nil && !f.IsDir() {
					fileServer.ServeHTTP(w, r)
					return
				}
				// SPA fallback — serve index.html for all unknown paths
				// (React Router handles client-side routing)
				r.URL.Path = "/"
				fileServer.ServeHTTP(w, r)
			})
		} else {
			log.Printf("WARNING: dashboard dir %q not found, serving placeholder", cfg.DashboardDir)
		}
	} else {
		mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/" {
				http.NotFound(w, r)
				return
			}
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			fmt.Fprint(w, `<!DOCTYPE html><html><head><title>ClawLens</title></head>
<body style="font-family:system-ui;max-width:640px;margin:80px auto;padding:0 1rem">
<h1>ClawLens</h1><p>Server is running. Dashboard not configured.</p>
<p>Set <code>--dashboard</code> flag or <code>DASHBOARD_DIR</code> env var to the dashboard dist/ path.</p>
<ul><li><a href="/api/v1/health">/api/v1/health</a></li></ul>
</body></html>`)
		})
	}

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
