package server

import (
	"log"
	"net/http"
	"strconv"

	"github.com/howincodes/clawlens/internal/shared"
)

// ── Route registration ────────────────────────────────────────────────────────

// RegisterAdminRoutes registers all admin API routes on the given mux.
func RegisterAdminRoutes(mux *http.ServeMux, store *Store, hub *WSHub, jwtMgr *JWTManager, analytics *Analytics) {
	adminMW := AdminAuth(jwtMgr, store)

	// Public
	mux.HandleFunc("POST /api/admin/login", handleLogin(store, jwtMgr))

	// Protected — wrap each handler with adminMW
	mux.Handle("GET /api/admin/team", adminMW(http.HandlerFunc(handleGetTeam(store))))
	mux.Handle("PUT /api/admin/team", adminMW(http.HandlerFunc(handleUpdateTeam(store))))
	mux.Handle("GET /api/admin/subscriptions", adminMW(http.HandlerFunc(handleGetSubscriptions(store))))
	mux.Handle("GET /api/admin/users", adminMW(http.HandlerFunc(handleGetUsers(store))))
	mux.Handle("POST /api/admin/users", adminMW(http.HandlerFunc(handleCreateUser(store, hub))))
	mux.Handle("GET /api/admin/users/{id}", adminMW(http.HandlerFunc(handleGetUser(store, analytics))))
	mux.Handle("PUT /api/admin/users/{id}", adminMW(http.HandlerFunc(handleUpdateUser(store, hub))))
	mux.Handle("DELETE /api/admin/users/{id}", adminMW(http.HandlerFunc(handleDeleteUser(store, hub))))
	mux.Handle("GET /api/admin/users/{id}/prompts", adminMW(http.HandlerFunc(handleGetUserPrompts(store))))
	mux.Handle("GET /api/admin/users/{id}/sessions", adminMW(http.HandlerFunc(handleGetUserSessions(store))))
	mux.Handle("POST /api/admin/users/{id}/rotate-token", adminMW(http.HandlerFunc(handleRotateToken(store))))
	mux.Handle("GET /api/admin/analytics", adminMW(http.HandlerFunc(handleGetAnalytics(store, analytics))))
	mux.Handle("GET /api/admin/analytics/users", adminMW(http.HandlerFunc(handleGetUserLeaderboard(analytics))))
	mux.Handle("GET /api/admin/analytics/projects", adminMW(http.HandlerFunc(handleGetProjectAnalytics(analytics))))
	mux.Handle("GET /api/admin/analytics/costs", adminMW(http.HandlerFunc(handleGetCosts(analytics))))
	mux.Handle("GET /api/admin/summaries", adminMW(http.HandlerFunc(handleGetSummaries(store))))
	summaryEngine := NewSummaryEngine(store)
	mux.Handle("POST /api/admin/summaries/generate", adminMW(http.HandlerFunc(handleGenerateSummary(store, summaryEngine))))
	mux.Handle("GET /api/admin/audit-log", adminMW(http.HandlerFunc(handleGetAuditLog(store))))
	mux.Handle("GET /api/admin/export/{type}", adminMW(http.HandlerFunc(handleExport(store))))
	mux.Handle("GET /api/admin/prompts", adminMW(http.HandlerFunc(handleGetAllPrompts(store))))
	mux.Handle("PUT /api/admin/team/password", adminMW(http.HandlerFunc(handleChangePassword(store))))
}

// ── Handlers ──────────────────────────────────────────────────────────────────

func handleLogin(store *Store, jwtMgr *JWTManager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req shared.LoginRequest
		if err := readJSON(r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request"})
			return
		}

		team, err := store.GetTeam()
		if err != nil || team == nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "team not found"})
			return
		}

		if !shared.VerifyPassword(team.AdminPassword, req.Password) {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid password"})
			return
		}

		token, err := jwtMgr.Create(team.ID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to create token"})
			return
		}

		writeJSON(w, http.StatusOK, shared.LoginResponse{
			Token: token,
			Team:  *team,
		})
	}
}

func handleGetTeam(store *Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		team := TeamFromContext(r.Context())
		writeJSON(w, http.StatusOK, team)
	}
}

func handleUpdateTeam(store *Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Name     *string              `json:"name"`
			Settings *shared.TeamSettings `json:"settings"`
		}
		if err := readJSON(r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request"})
			return
		}

		team := TeamFromContext(r.Context())

		if req.Name != nil {
			if err := store.UpdateTeamName(team.ID, *req.Name); err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to update name"})
				return
			}
		}

		if req.Settings != nil {
			if err := store.UpdateTeamSettings(team.ID, *req.Settings); err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to update settings"})
				return
			}
		}

		_ = store.RecordAudit(team.ID, "admin", "team_updated", nil, nil)

		updated, err := store.GetTeamByID(team.ID)
		if err != nil || updated == nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to fetch team"})
			return
		}

		writeJSON(w, http.StatusOK, updated)
	}
}

func handleGetSubscriptions(store *Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		team := TeamFromContext(r.Context())
		subs, err := store.GetSubscriptions(team.ID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to fetch subscriptions"})
			return
		}
		if subs == nil {
			subs = []shared.Subscription{}
		}

		// Enrich each subscription with linked users, prompt count, credit total
		users, _ := store.GetUsers(team.ID)

		type enrichedSub struct {
			shared.Subscription
			Users       []map[string]any `json:"users"`
			UserCount   int              `json:"user_count"`
			TotalPrompts int             `json:"total_prompts"`
			TotalCredits int             `json:"total_credits"`
		}

		result := make([]enrichedSub, len(subs))
		for i, sub := range subs {
			es := enrichedSub{Subscription: sub}
			for _, u := range users {
				if u.SubscriptionID != nil && *u.SubscriptionID == sub.ID {
					stats, _ := store.GetUserStats(u.ID)
					prompts, _ := stats["total_prompts"].(int)
					credits, _ := stats["total_cost"].(int)
					es.Users = append(es.Users, map[string]any{
						"id": u.ID, "name": u.Name, "slug": u.Slug, "status": u.Status,
						"prompts": prompts, "credits": credits,
					})
					es.TotalPrompts += prompts
					es.TotalCredits += credits
				}
			}
			if es.Users == nil {
				es.Users = []map[string]any{}
			}
			es.UserCount = len(es.Users)
			result[i] = es
		}

		writeJSON(w, http.StatusOK, map[string]any{"subscriptions": result})
	}
}

func handleGetUsers(store *Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		team := TeamFromContext(r.Context())
		users, err := store.GetUsers(team.ID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to fetch users"})
			return
		}
		if users == nil {
			users = []shared.User{}
		}

		// Build subscription lookup
		subs, _ := store.GetSubscriptions(team.ID)
		subMap := make(map[string]string)
		for _, s := range subs {
			subMap[s.ID] = s.Email
		}

		// Enrich with subscription email
		type userWithEmail struct {
			shared.User
			SubscriptionEmail string `json:"subscription_email,omitempty"`
		}
		result := make([]userWithEmail, len(users))
		for i, u := range users {
			result[i] = userWithEmail{User: u}
			if u.SubscriptionID != nil {
				result[i].SubscriptionEmail = subMap[*u.SubscriptionID]
			}
		}
		writeJSON(w, http.StatusOK, map[string]any{"users": result})
	}
}

func handleCreateUser(store *Store, hub *WSHub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Name   string             `json:"name"`
			Slug   string             `json:"slug"`
			Limits []shared.LimitRule `json:"limits"`
		}
		if err := readJSON(r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request"})
			return
		}

		team := TeamFromContext(r.Context())

		user := &shared.User{
			ID:        shared.GenerateID(),
			TeamID:    team.ID,
			Slug:      req.Slug,
			Name:      req.Name,
			AuthToken: shared.GenerateToken(),
			Status:    "active",
		}

		if err := store.CreateUser(user); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to create user"})
			return
		}

		if len(req.Limits) > 0 {
			for i := range req.Limits {
				if req.Limits[i].ID == "" {
					req.Limits[i].ID = shared.GenerateID()
				}
			}
			_ = store.ReplaceLimitRules(user.ID, req.Limits)
		}

		installCode := shared.GenerateInstallCode(user.Slug)
		if err := store.CreateInstallCode(installCode, user.ID); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to create install code"})
			return
		}

		_ = store.RecordAudit(team.ID, "admin", "user_created", &user.ID, nil)

		writeJSON(w, http.StatusCreated, map[string]any{
			"user":         user,
			"install_code": installCode,
		})
	}
}

func handleGetUser(store *Store, analytics *Analytics) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")

		user, err := store.GetUser(id)
		if err != nil || user == nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "user not found"})
			return
		}

		devices, err := store.GetDevices(id)
		if err != nil {
			devices = []shared.Device{}
		}
		if devices == nil {
			devices = []shared.Device{}
		}

		limits, err := store.GetLimitRules(id)
		if err != nil {
			limits = []shared.LimitRule{}
		}
		if limits == nil {
			limits = []shared.LimitRule{}
		}

		team := TeamFromContext(r.Context())
		summaries, _ := store.GetSummaries(team.ID, &id, nil, 1)
		var latestSummary *shared.AISummary
		if len(summaries) > 0 {
			latestSummary = &summaries[0]
		}

		stats, _ := store.GetUserStats(id)

		writeJSON(w, http.StatusOK, map[string]any{
			"user":           user,
			"devices":        devices,
			"limits":         limits,
			"latest_summary": latestSummary,
			"stats":          stats,
		})
	}
}

func handleUpdateUser(store *Store, hub *WSHub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")

		var req struct {
			Name   *string            `json:"name"`
			Status *string            `json:"status"`
			Limits []shared.LimitRule `json:"limits"`
		}
		if err := readJSON(r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request"})
			return
		}

		team := TeamFromContext(r.Context())

		if req.Name != nil {
			if err := store.UpdateUser(id, req.Name, nil, nil); err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to update user"})
				return
			}
		}

		if req.Status != nil {
			if err := store.UpdateUserStatus(id, *req.Status); err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to update status"})
				return
			}

			action := "user_status_changed"
			switch *req.Status {
			case "killed":
				action = "user_killed"
				hub.Broadcast(shared.WSEvent{Type: "user_killed", Data: map[string]any{"user_id": id}})
			case "paused":
				action = "user_paused"
				hub.Broadcast(shared.WSEvent{Type: "user_paused", Data: map[string]any{"user_id": id}})
			case "active":
				action = "user_active"
				hub.Broadcast(shared.WSEvent{Type: "user_active", Data: map[string]any{"user_id": id}})
			}
			_ = store.RecordAudit(team.ID, "admin", action, &id, nil)
		}

		if req.Limits != nil {
			for i := range req.Limits {
				if req.Limits[i].ID == "" {
					req.Limits[i].ID = shared.GenerateID()
				}
			}
			if err := store.ReplaceLimitRules(id, req.Limits); err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to update limits"})
				return
			}
			_ = store.RecordAudit(team.ID, "admin", "limits_updated", &id, nil)
		}

		user, err := store.GetUser(id)
		if err != nil || user == nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "user not found"})
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{"user": user})
	}
}

func handleDeleteUser(store *Store, hub *WSHub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		team := TeamFromContext(r.Context())

		if err := store.DeleteUser(id); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to delete user"})
			return
		}

		_ = store.RecordAudit(team.ID, "admin", "user_deleted", &id, nil)

		writeJSON(w, http.StatusOK, map[string]any{"deleted": true})
	}
}

func handleGetUserPrompts(store *Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		page := queryInt(r, "page", 1)
		limit := queryInt(r, "limit", 50)
		offset := (page - 1) * limit

		var search, model, project *string
		if s := r.URL.Query().Get("search"); s != "" {
			search = &s
		}
		if m := r.URL.Query().Get("model"); m != "" {
			model = &m
		}
		if p := r.URL.Query().Get("project"); p != "" {
			project = &p
		}

		prompts, total, err := store.GetPrompts(id, limit, offset, search, model, project)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to fetch prompts"})
			return
		}
		if prompts == nil {
			prompts = []shared.Prompt{}
		}

		writeJSON(w, http.StatusOK, shared.PaginatedResponse{
			Data:  prompts,
			Total: total,
			Page:  page,
			Limit: limit,
		})
	}
}

func handleGetUserSessions(store *Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		page := queryInt(r, "page", 1)
		limit := queryInt(r, "limit", 50)
		offset := (page - 1) * limit

		sessions, total, err := store.GetSessions(id, limit, offset)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to fetch sessions"})
			return
		}
		if sessions == nil {
			sessions = []shared.Session{}
		}

		writeJSON(w, http.StatusOK, shared.PaginatedResponse{
			Data:  sessions,
			Total: total,
			Page:  page,
			Limit: limit,
		})
	}
}

func handleRotateToken(store *Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		team := TeamFromContext(r.Context())

		newToken, err := store.RotateUserToken(id)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to rotate token"})
			return
		}

		_ = store.RecordAudit(team.ID, "admin", "token_rotated", &id, nil)

		writeJSON(w, http.StatusOK, map[string]string{"auth_token": newToken})
	}
}

func handleGetAnalytics(store *Store, analytics *Analytics) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		team := TeamFromContext(r.Context())
		days := queryInt(r, "days", 7)

		overview, err := analytics.GetTeamOverview(team.ID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to get overview"})
			return
		}

		trends, err := analytics.GetDailyTrends(team.ID, days)
		if err != nil {
			trends = []DailyTrend{}
		}
		if trends == nil {
			trends = []DailyTrend{}
		}

		models, err := analytics.GetModelDistribution(team.ID, days)
		if err != nil {
			models = []ModelDistribution{}
		}
		if models == nil {
			models = []ModelDistribution{}
		}

		tools, err := analytics.GetToolDistribution(team.ID, days)
		if err != nil {
			tools = []ToolDistribution{}
		}
		if tools == nil {
			tools = []ToolDistribution{}
		}

		peakHours, err := analytics.GetPeakHours(team.ID, days)
		if err != nil {
			peakHours = []PeakHour{}
		}
		if peakHours == nil {
			peakHours = []PeakHour{}
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"overview":           overview,
			"trends":             trends,
			"model_distribution": models,
			"tool_distribution":  tools,
			"peak_hours":         peakHours,
		})
	}
}

func handleGetUserLeaderboard(analytics *Analytics) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		team := TeamFromContext(r.Context())
		days := queryInt(r, "days", 7)
		sortBy := r.URL.Query().Get("sort_by")

		leaderboard, err := analytics.GetUserLeaderboard(team.ID, days, sortBy)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to get leaderboard"})
			return
		}
		if leaderboard == nil {
			leaderboard = []UserLeaderboardEntry{}
		}

		writeJSON(w, http.StatusOK, map[string]any{"leaderboard": leaderboard})
	}
}

func handleGetProjectAnalytics(analytics *Analytics) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		team := TeamFromContext(r.Context())
		days := queryInt(r, "days", 7)

		projects, err := analytics.GetProjectAnalytics(team.ID, days)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to get project analytics"})
			return
		}
		if projects == nil {
			projects = []ProjectAnalytics{}
		}

		writeJSON(w, http.StatusOK, map[string]any{"projects": projects})
	}
}

func handleGetCosts(analytics *Analytics) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		team := TeamFromContext(r.Context())
		days := queryInt(r, "days", 7)

		costs, err := analytics.GetCostBreakdown(team.ID, days)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to get costs"})
			return
		}

		writeJSON(w, http.StatusOK, costs)
	}
}

func handleGetSummaries(store *Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		team := TeamFromContext(r.Context())

		var userID, summaryType *string
		if u := r.URL.Query().Get("user_id"); u != "" {
			userID = &u
		}
		if t := r.URL.Query().Get("type"); t != "" {
			summaryType = &t
		}
		limit := queryInt(r, "limit", 20)

		summaries, err := store.GetSummaries(team.ID, userID, summaryType, limit)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to fetch summaries"})
			return
		}
		if summaries == nil {
			summaries = []shared.AISummary{}
		}

		writeJSON(w, http.StatusOK, map[string]any{"summaries": summaries})
	}
}

func handleGenerateSummary(store *Store, engine *SummaryEngine) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		team := TeamFromContext(r.Context())
		// Run summary generation asynchronously
		go func() {
			if err := engine.GenerateForAllUsers(team.ID, 24); err != nil {
				log.Printf("[summary] generation error: %v", err)
			} else {
				log.Printf("[summary] generation complete for team %s", team.ID)
			}
		}()
		writeJSON(w, http.StatusOK, map[string]string{"status": "started"})
	}
}

func handleGetAuditLog(store *Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		team := TeamFromContext(r.Context())
		page := queryInt(r, "page", 1)
		limit := queryInt(r, "limit", 50)
		offset := (page - 1) * limit

		var action *string
		if a := r.URL.Query().Get("action"); a != "" {
			action = &a
		}

		entries, total, err := store.GetAuditLog(team.ID, limit, offset, action)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to fetch audit log"})
			return
		}
		if entries == nil {
			entries = []shared.AuditEntry{}
		}

		writeJSON(w, http.StatusOK, shared.PaginatedResponse{
			Data:  entries,
			Total: total,
			Page:  page,
			Limit: limit,
		})
	}
}

func handleExport(store *Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		team := TeamFromContext(r.Context())
		exportType := r.PathValue("type")
		days := queryInt(r, "days", 30)
		format := r.URL.Query().Get("format")
		if format == "" {
			format = "csv"
		}

		switch exportType {
		case "prompts":
			if format == "csv" {
				w.Header().Set("Content-Type", "text/csv")
				w.Header().Set("Content-Disposition", "attachment; filename=prompts.csv")
				ExportPromptsCSV(store, team.ID, days, w) //nolint:errcheck
			}
		case "usage":
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Content-Disposition", "attachment; filename=usage.json")
			ExportUsageJSON(store, team.ID, days, w) //nolint:errcheck
		default:
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "unknown export type"})
		}
	}
}

func handleGetAllPrompts(store *Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		team := TeamFromContext(r.Context())
		page := queryInt(r, "page", 1)
		limit := queryInt(r, "limit", 50)

		search := r.URL.Query().Get("search")
		model := r.URL.Query().Get("model")
		project := r.URL.Query().Get("project")
		userID := r.URL.Query().Get("userId")
		blockedStr := r.URL.Query().Get("blocked")

		var searchPtr, modelPtr, projectPtr, userPtr *string
		var blockedPtr *bool
		if search != "" {
			searchPtr = &search
		}
		if model != "" {
			modelPtr = &model
		}
		if project != "" {
			projectPtr = &project
		}
		if userID != "" {
			userPtr = &userID
		}
		if blockedStr == "true" {
			b := true
			blockedPtr = &b
		} else if blockedStr == "false" {
			b := false
			blockedPtr = &b
		}

		prompts, total, err := store.GetAllPrompts(team.ID, limit, (page-1)*limit, searchPtr, modelPtr, projectPtr, userPtr, blockedPtr)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to get prompts"})
			return
		}
		if prompts == nil {
			prompts = []shared.Prompt{}
		}

		writeJSON(w, http.StatusOK, shared.PaginatedResponse{Data: prompts, Total: total, Page: page, Limit: limit})
	}
}

func handleChangePassword(store *Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		team := TeamFromContext(r.Context())
		var body struct {
			CurrentPassword string `json:"current_password"`
			NewPassword     string `json:"new_password"`
		}
		if err := readJSON(r, &body); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request"})
			return
		}
		// Verify current password
		if !shared.VerifyPassword(team.AdminPassword, body.CurrentPassword) {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "current password is incorrect"})
			return
		}
		// Hash and save new password
		hash, err := shared.HashPassword(body.NewPassword)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to hash password"})
			return
		}
		if err := store.UpdateAdminPassword(team.ID, hash); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to update password"})
			return
		}
		_ = store.RecordAudit(team.ID, "admin", "password_changed", nil, nil)
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	}
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// queryInt parses an integer query parameter, returning defaultVal on error or
// if the value is less than 1.
func queryInt(r *http.Request, key string, defaultVal int) int {
	v, err := strconv.Atoi(r.URL.Query().Get(key))
	if err != nil || v < 1 {
		return defaultVal
	}
	return v
}
