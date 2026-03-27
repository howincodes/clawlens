package server

import (
	"encoding/json"
	"log"
	"net/http"
	"path/filepath"
	"time"

	"github.com/howincodes/clawlens/internal/shared"
)

// ── JSON helpers ──────────────────────────────────────────────────────────────

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v) //nolint:errcheck
}

func readJSON(r *http.Request, v any) error {
	defer r.Body.Close()
	return json.NewDecoder(r.Body).Decode(v)
}

func strPtr(s string) *string { return &s }

// ── Route registration ────────────────────────────────────────────────────────

// RegisterHookRoutes registers all hook/client API routes on the given mux.
func RegisterHookRoutes(mux *http.ServeMux, store *Store, hub *WSHub) {
	hookMW := HookAuth(store)
	mux.HandleFunc("GET /api/v1/health", handleHealth)
	mux.HandleFunc("POST /api/v1/register", handleRegister(store))
	mux.Handle("POST /api/v1/session-start", hookMW(http.HandlerFunc(handleSessionStart(store, hub))))
	mux.Handle("POST /api/v1/prompt", hookMW(http.HandlerFunc(handlePrompt(store, hub))))
	mux.Handle("POST /api/v1/sync-batch", hookMW(http.HandlerFunc(handleSyncBatch(store, hub))))
}

// ── Handlers ──────────────────────────────────────────────────────────────────

func handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func handleRegister(store *Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req shared.RegisterRequest
		if err := readJSON(r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request"})
			return
		}

		user, err := store.UseInstallCode(req.Code)
		if err != nil || user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid install code"})
			return
		}

		settings, err := store.GetTeamSettings(user.TeamID)
		if err != nil {
			settings = &shared.TeamSettings{}
		}

		writeJSON(w, http.StatusOK, shared.RegisterResponse{
			AuthToken: user.AuthToken,
			UserID:    user.ID,
			Settings:  *settings,
			ServerURL: "",
		})
	}
}

func handleSessionStart(store *Store, hub *WSHub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req shared.SessionStartRequest
		if err := readJSON(r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request"})
			return
		}

		user := UserFromContext(r.Context())

		// Upsert device.
		device := &shared.Device{
			ID:               shared.GenerateID(),
			UserID:           user.ID,
			Hostname:         strPtr(req.Hostname),
			Platform:         strPtr(req.Platform),
			Arch:             strPtr(req.Arch),
			OSVersion:        strPtr(req.OSVersion),
			GoVersion:        strPtr(req.GoVersion),
			ClaudeVersion:    strPtr(req.ClaudeVersion),
			SubscriptionType: req.SubscriptionType,
			LastSeen:         time.Now().UTC(),
		}
		remoteAddr := r.RemoteAddr
		if remoteAddr != "" {
			device.LastIP = strPtr(remoteAddr)
		}
		_ = store.UpsertDevice(device)

		// If subscription email provided, upsert subscription and link to user.
		if req.SubscriptionEmail != nil && *req.SubscriptionEmail != "" {
			team := TeamFromContext(r.Context())
			sub := &shared.Subscription{
				ID:               shared.GenerateID(),
				TeamID:           team.ID,
				Email:            *req.SubscriptionEmail,
				SubscriptionType: req.SubscriptionType,
			}
			_ = store.UpsertSubscription(sub)
			// Link user to subscription
			if linked, err := store.GetSubscriptionByEmail(team.ID, *req.SubscriptionEmail); err == nil && linked != nil {
				_ = store.UpdateUser(user.ID, nil, &linked.ID, nil)
			}
		}

		// Create session record.
		projectDir := filepath.Base(req.CWD)
		sess := &shared.Session{
			ID:         req.SessionID,
			UserID:     user.ID,
			Model:      strPtr(req.Model),
			ProjectDir: strPtr(projectDir),
			CWD:        strPtr(req.CWD),
			StartedAt:  time.Now().UTC(),
		}
		_ = store.CreateSession(sess)

		// Get team settings for response.
		settings, err := store.GetTeamSettings(user.TeamID)
		if err != nil {
			settings = &shared.TeamSettings{}
		}

		hub.Broadcast(shared.WSEvent{
			Type: "session_started",
			Data: map[string]any{
				"session_id": req.SessionID,
				"user_id":    user.ID,
			},
		})

		writeJSON(w, http.StatusOK, shared.SessionStartResponse{
			Status:       user.Status,
			Settings:     *settings,
			SyncInterval: settings.SyncIntervalSeconds,
		})
	}
}

func handlePrompt(store *Store, hub *WSHub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req shared.PromptRequest
		if err := readJSON(r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request"})
			return
		}

		user := UserFromContext(r.Context())
		team := TeamFromContext(r.Context())

		var settings shared.TeamSettings
		json.Unmarshal([]byte(team.Settings), &settings) //nolint:errcheck

		result := EvaluateLimits(store, user, req.Model, settings.CreditWeights)
		cost := CreditCost(req.Model, settings.CreditWeights)
		log.Printf("[prompt] user=%s model=%q weights=%+v cost=%d", user.Name, req.Model, settings.CreditWeights, cost)

		promptText := req.PromptText
		truncated := false
		if settings.PromptMaxLength > 0 && promptText != nil && len(*promptText) > settings.PromptMaxLength {
			trimmed := (*promptText)[:settings.PromptMaxLength]
			promptText = &trimmed
			truncated = true
		}

		wasBlocked := !result.Allowed
		prompt := &shared.Prompt{
			UserID:          user.ID,
			SessionID:       strPtr(req.SessionID),
			Model:           strPtr(req.Model),
			PromptText:      promptText,
			PromptLength:    req.PromptLength,
			ProjectDir:      strPtr(req.ProjectDir),
			CWD:             strPtr(req.CWD),
			WasBlocked:      wasBlocked,
			BlockReason:     result.Reason,
			CreditCost:      cost,
			PromptTruncated: truncated,
			Timestamp:       time.Now().UTC(),
		}
		log.Printf("[prompt] about to record: prompt.CreditCost=%d cost=%d model=%q", prompt.CreditCost, cost, req.Model)
		promptID, err := store.RecordPrompt(prompt)
		if err != nil {
			log.Printf("[prompt] RecordPrompt error: %v", err)
		} else {
			log.Printf("[prompt] recorded id=%d credit_cost=%d", promptID, prompt.CreditCost)
		}
		_ = store.UpdateSessionCounters(req.SessionID, 1, 0)

		eventType := "prompt_submitted"
		if wasBlocked {
			eventType = "prompt_blocked"
		}
		hub.Broadcast(shared.WSEvent{
			Type: eventType,
			Data: map[string]any{
				"session_id": req.SessionID,
				"user_id":    user.ID,
				"allowed":    result.Allowed,
			},
		})

		status := "allowed"
		if wasBlocked {
			status = "blocked"
		}
		writeJSON(w, http.StatusOK, shared.PromptResponse{
			Allowed: result.Allowed,
			Status:  status,
			Reason:  result.Reason,
		})
	}
}

func handleSyncBatch(store *Store, hub *WSHub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req shared.BatchSyncRequest
		if err := readJSON(r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request"})
			return
		}

		user := UserFromContext(r.Context())
		processed := 0

		for _, event := range req.Events {
			switch event.Type {
			case "tool":
				var data shared.ToolEventData
				if err := json.Unmarshal(event.Data, &data); err != nil {
					continue
				}
				te := &shared.ToolEvent{
					UserID:           user.ID,
					SessionID:        strPtr(event.SessionID),
					ToolName:         data.ToolName,
					ToolInputSummary: data.ToolInputSummary,
					Success:          data.Success,
					ErrorMessage:     data.ErrorMessage,
					Timestamp:        event.Timestamp,
				}
				_ = store.RecordToolEvent(te)
				_ = store.UpdateSessionCounters(event.SessionID, 0, 1)

				evtType := "tool_used"
				if !data.Success {
					evtType = "tool_failed"
				}
				hub.Broadcast(shared.WSEvent{
					Type: evtType,
					Data: map[string]any{
						"session_id": event.SessionID,
						"tool_name":  data.ToolName,
					},
				})

			case "stop":
				var data shared.StopEventData
				if err := json.Unmarshal(event.Data, &data); err != nil {
					continue
				}
				_ = store.UpdatePromptWithResponse(
					event.SessionID,
					data.ResponseText,
					data.ResponseLength,
					data.ToolCalls,
					data.ToolsUsed,
					data.TurnDurationMS,
					data.CreditCost,
				)
				hub.Broadcast(shared.WSEvent{
					Type: "turn_completed",
					Data: map[string]any{
						"session_id": event.SessionID,
					},
				})

			case "stop_error":
				var data shared.StopErrorEventData
				if err := json.Unmarshal(event.Data, &data); err != nil {
					continue
				}
				if data.ErrorType == "rate_limit" {
					hub.Broadcast(shared.WSEvent{
						Type: "rate_limit_hit",
						Data: map[string]any{
							"session_id": event.SessionID,
							"user_id":    user.ID,
						},
					})
				}

			case "session_end":
				var data shared.SessionEndEventData
				if err := json.Unmarshal(event.Data, &data); err != nil {
					continue
				}
				_ = store.EndSession(event.SessionID, data.Reason)
				hub.Broadcast(shared.WSEvent{
					Type: "session_ended",
					Data: map[string]any{
						"session_id": event.SessionID,
						"user_id":    user.ID,
					},
				})
			}

			processed++
		}

		writeJSON(w, http.StatusOK, map[string]int{"processed": processed})
	}
}
