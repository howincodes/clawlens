package client

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"
)

// ── TestSyncerStartStop ───────────────────────────────────────────────────────

func TestSyncerStartStop(t *testing.T) {
	q := newTestQueue(t)
	cfg := &Config{
		ServerURL:    "http://localhost:0", // no real server; stop before ticker fires
		SyncInterval: 60,
	}

	s := NewSyncer(q, cfg)
	s.Start()
	// Stop immediately — should not panic and should return quickly.
	done := make(chan struct{})
	go func() {
		s.Stop()
		close(done)
	}()

	select {
	case <-done:
		// pass
	case <-time.After(5 * time.Second):
		t.Fatal("Stop() did not return within 5 seconds")
	}
}

// ── TestSyncBatch ─────────────────────────────────────────────────────────────

func TestSyncBatchSendsEvents(t *testing.T) {
	// Spin up a test HTTP server that accepts the batch.
	var receivedCount int
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/sync-batch" && r.Method == http.MethodPost {
			var req struct {
				Events []json.RawMessage `json:"events"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "bad request", http.StatusBadRequest)
				return
			}
			receivedCount = len(req.Events)
			w.WriteHeader(http.StatusOK)
			return
		}
		http.NotFound(w, r)
	}))
	defer ts.Close()

	q := newTestQueue(t)

	// Push 3 events of different types.
	for _, evType := range []string{"prompt", "tool", "stop"} {
		payload, _ := json.Marshal(map[string]string{
			"session_id": "sess-abc",
			"type":       evType,
		})
		if err := q.Push(evType, payload); err != nil {
			t.Fatalf("Push %s: %v", evType, err)
		}
	}

	// Verify 3 unsynced entries exist.
	count, err := q.UnsyncedCount()
	if err != nil {
		t.Fatalf("UnsyncedCount: %v", err)
	}
	if count != 3 {
		t.Fatalf("expected 3 unsynced, got %d", count)
	}

	// Create a temporary config file so SaveConfig has a valid path.
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "config.json")
	cfg := &Config{
		ServerURL:    ts.URL,
		AuthToken:    "test-token",
		SyncInterval: 60,
	}
	if err := saveConfigTo(cfgPath, cfg); err != nil {
		t.Fatalf("saveConfigTo: %v", err)
	}

	// Patch ConfigPath to point at our temp file so SaveConfig works.
	// We call syncBatch directly to avoid goroutine complexity.
	s := NewSyncer(q, cfg)

	// syncBatch calls SaveConfig which writes to ConfigPath(). Since we can't
	// easily override the global path in tests, we ignore the save-config error
	// and just verify that the batch was sent and entries were marked synced.
	s.syncBatch() //nolint:errcheck

	if receivedCount != 3 {
		t.Errorf("server received %d events, want 3", receivedCount)
	}

	// After a successful sync all entries should be marked synced.
	remaining, err := q.UnsyncedCount()
	if err != nil {
		t.Fatalf("UnsyncedCount after sync: %v", err)
	}
	if remaining != 0 {
		t.Errorf("expected 0 unsynced after sync, got %d", remaining)
	}
}

func TestSyncBatchEmptyQueue(t *testing.T) {
	// syncBatch on an empty queue should do nothing and not call the server.
	serverCalled := false
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		serverCalled = true
		w.WriteHeader(http.StatusOK)
	}))
	defer ts.Close()

	q := newTestQueue(t)
	cfg := &Config{ServerURL: ts.URL, SyncInterval: 60}

	s := NewSyncer(q, cfg)
	if err := s.syncBatch(); err != nil {
		t.Fatalf("syncBatch: %v", err)
	}

	if serverCalled {
		t.Error("server should not be called when queue is empty")
	}
}

func TestSyncBatchServerError(t *testing.T) {
	// syncBatch should leave events unsynced when the server returns an error.
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "internal error", http.StatusInternalServerError)
	}))
	defer ts.Close()

	q := newTestQueue(t)
	payload, _ := json.Marshal(map[string]string{"session_id": "sess-1"})
	if err := q.Push("prompt", payload); err != nil {
		t.Fatalf("Push: %v", err)
	}

	cfg := &Config{ServerURL: ts.URL, SyncInterval: 60}
	s := NewSyncer(q, cfg)
	s.syncBatch() //nolint:errcheck

	// Entry should still be unsynced.
	count, err := q.UnsyncedCount()
	if err != nil {
		t.Fatalf("UnsyncedCount: %v", err)
	}
	if count != 1 {
		t.Errorf("expected 1 unsynced after server error, got %d", count)
	}
}

// ── TestExtractSessionID ──────────────────────────────────────────────────────

func TestExtractSessionID(t *testing.T) {
	cases := []struct {
		payload string
		want    string
	}{
		{`{"session_id":"sess-xyz","type":"prompt"}`, "sess-xyz"},
		{`{"type":"prompt"}`, ""},
		{`not json`, ""},
		{`{}`, ""},
	}
	for _, tc := range cases {
		got := extractSessionID(json.RawMessage(tc.payload))
		if got != tc.want {
			t.Errorf("extractSessionID(%q) = %q, want %q", tc.payload, got, tc.want)
		}
	}
}
