package server

import (
	"testing"

	"github.com/howincodes/clawlens/internal/shared"
)

func TestWSHubNewAndCount(t *testing.T) {
	hub := NewWSHub()
	if hub == nil {
		t.Fatal("expected non-nil hub")
	}
	if count := hub.ClientCount(); count != 0 {
		t.Errorf("expected 0 clients, got %d", count)
	}
}

func TestWSHubBroadcastNoClients(t *testing.T) {
	hub := NewWSHub()
	// Should not panic when there are no clients.
	hub.Broadcast(shared.WSEvent{Type: "test", Data: map[string]string{"msg": "hello"}})
}
