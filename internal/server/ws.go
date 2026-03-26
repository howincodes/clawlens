package server

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/howincodes/clawlens/internal/shared"
	"nhooyr.io/websocket"
)

// wsClient represents a connected WebSocket client.
type wsClient struct {
	conn *websocket.Conn
	ctx  context.Context
}

// WSHub manages all connected WebSocket clients.
type WSHub struct {
	mu      sync.RWMutex
	clients map[*wsClient]struct{}
}

// NewWSHub creates and returns a new WSHub with an empty client set.
func NewWSHub() *WSHub {
	return &WSHub{
		clients: make(map[*wsClient]struct{}),
	}
}

// HandleWS upgrades an HTTP connection to WebSocket, adds the client to the
// hub, blocks in a read loop until the client disconnects, then removes it.
func (h *WSHub) HandleWS(w http.ResponseWriter, r *http.Request) {
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		InsecureSkipVerify: true,
	})
	if err != nil {
		return
	}

	client := &wsClient{
		conn: conn,
		ctx:  r.Context(),
	}

	h.mu.Lock()
	h.clients[client] = struct{}{}
	h.mu.Unlock()

	defer func() {
		h.mu.Lock()
		delete(h.clients, client)
		h.mu.Unlock()
		conn.Close(websocket.StatusNormalClosure, "")
	}()

	// Read loop — block until client disconnects.
	for {
		_, _, err := conn.Read(r.Context())
		if err != nil {
			return
		}
	}
}

// Broadcast sends a WSEvent to all connected clients. Each write is performed
// in its own goroutine with a 5-second timeout.
func (h *WSHub) Broadcast(event shared.WSEvent) {
	data, err := json.Marshal(event)
	if err != nil {
		return
	}

	h.mu.RLock()
	clients := make([]*wsClient, 0, len(h.clients))
	for c := range h.clients {
		clients = append(clients, c)
	}
	h.mu.RUnlock()

	for _, c := range clients {
		c := c
		go func() {
			ctx, cancel := context.WithTimeout(c.ctx, 5*time.Second)
			defer cancel()
			_ = c.conn.Write(ctx, websocket.MessageText, data)
		}()
	}
}

// ClientCount returns the number of currently connected WebSocket clients.
func (h *WSHub) ClientCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}
