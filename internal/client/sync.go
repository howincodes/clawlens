package client

import (
	"encoding/json"
	"time"

	"github.com/howincodes/clawlens/internal/shared"
)

// Syncer periodically batches unsynced queue entries and ships them to the
// server. It runs in its own goroutine and performs a final flush on Stop.
type Syncer struct {
	queue  *Queue
	config *Config
	stopCh chan struct{}
	done   chan struct{}
}

// NewSyncer creates a new Syncer that is ready to be started.
func NewSyncer(queue *Queue, config *Config) *Syncer {
	return &Syncer{
		queue:  queue,
		config: config,
		stopCh: make(chan struct{}),
		done:   make(chan struct{}),
	}
}

// Start launches the background sync goroutine.
func (s *Syncer) Start() {
	go func() {
		defer close(s.done)
		interval := time.Duration(s.config.SyncInterval) * time.Second
		if interval <= 0 {
			interval = 30 * time.Second
		}
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				s.syncBatch()
			case <-s.stopCh:
				s.syncBatch() // final flush
				return
			}
		}
	}()
}

// Stop signals the syncer to stop and blocks until the final flush completes.
func (s *Syncer) Stop() {
	close(s.stopCh)
	<-s.done
}

// syncBatch fetches unsynced entries, posts them to the server, and marks them
// synced on success. It also garbage-collects old synced entries.
func (s *Syncer) syncBatch() error {
	entries, err := s.queue.PopUnsynced(100)
	if err != nil {
		debugLog("sync: pop unsynced: %v", err)
		return err
	}
	if len(entries) == 0 {
		return nil
	}

	events := make([]shared.Event, 0, len(entries))
	for _, e := range entries {
		// Extract session_id from the payload if present.
		sessionID := extractSessionID(e.Payload)

		events = append(events, shared.Event{
			Type:      e.EventType,
			SessionID: sessionID,
			Timestamp: e.CreatedAt,
			Data:      e.Payload,
		})
	}

	batchReq := shared.BatchSyncRequest{Events: events}
	url := s.config.ServerURL + "/api/v1/sync-batch"
	resp, err := serverRequest("POST", url, batchReq, s.config.AuthToken, 10*time.Second)
	if err != nil {
		debugLog("sync: POST error: %v", err)
		return err // leave unsynced for next attempt
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		debugLog("sync: non-2xx status %d", resp.StatusCode)
		return nil // non-fatal — leave unsynced
	}

	// Mark all successfully shipped entries as synced.
	ids := make([]int64, len(entries))
	for i, e := range entries {
		ids[i] = e.ID
	}
	if err := s.queue.MarkSynced(ids); err != nil {
		debugLog("sync: mark synced: %v", err)
	}

	// Update last-sync timestamp and clean up stale entries.
	s.config.LastSync = time.Now().UTC()
	if err := SaveConfig(s.config); err != nil {
		debugLog("sync: save config: %v", err)
	}

	if _, err := s.queue.CleanupSynced(24 * time.Hour); err != nil {
		debugLog("sync: cleanup synced: %v", err)
	}

	debugLog("sync: sent %d events", len(events))
	return nil
}

// extractSessionID attempts to parse a session_id field from a JSON payload.
// Returns an empty string if the field is absent or the payload is malformed.
func extractSessionID(payload json.RawMessage) string {
	var m struct {
		SessionID string `json:"session_id"`
	}
	if err := json.Unmarshal(payload, &m); err != nil {
		return ""
	}
	return m.SessionID
}
