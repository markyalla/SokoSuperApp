package ws

import (
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// Event is the JSON payload sent to mobile clients.
type Event struct {
	Type string `json:"type"`
	Data any    `json:"data"`
}

// client wraps a WebSocket connection with its own write lock.
type client struct {
	conn  *websocket.Conn
	roles []string
	mu    sync.Mutex
}

// Hub maintains all active WebSocket connections, keyed by user ID.
type Hub struct {
	mu      sync.RWMutex
	clients map[string]*client
}

func NewHub() *Hub {
	return &Hub{clients: make(map[string]*client)}
}

// Register adds (or replaces) a connection for a user. roles comes straight
// off the JWT's "roles" claim (same claim both SokoWeb and the mobile app's
// own login mint) — it's what BroadcastToRoles filters on.
func (h *Hub) Register(userID string, conn *websocket.Conn, roles []string) {
	h.mu.Lock()
	if old, ok := h.clients[userID]; ok {
		old.conn.Close()
	}
	h.clients[userID] = &client{conn: conn, roles: roles}
	total := len(h.clients)
	h.mu.Unlock()
	log.Printf("[WS] user %s connected (%d online)", userID, total)
}

// Unregister removes a user's connection from the hub.
func (h *Hub) Unregister(userID string) {
	h.mu.Lock()
	delete(h.clients, userID)
	total := len(h.clients)
	h.mu.Unlock()
	log.Printf("[WS] user %s disconnected (%d online)", userID, total)
}

// Send delivers a typed event to a specific user. Safe to call from any goroutine.
// Silently drops the message if the user is not connected.
func (h *Hub) Send(userID string, eventType string, data any) {
	payload, err := json.Marshal(Event{Type: eventType, Data: data})
	if err != nil {
		return
	}

	h.mu.RLock()
	c, ok := h.clients[userID]
	h.mu.RUnlock()
	if !ok {
		return
	}

	c.mu.Lock()
	err = c.conn.WriteMessage(websocket.TextMessage, payload)
	c.mu.Unlock()

	if err != nil {
		h.mu.Lock()
		delete(h.clients, userID)
		h.mu.Unlock()
	}
}

// BroadcastToRoles sends an event to every connected client holding at least
// one of the given roles — for staff-facing updates (SokoWeb dashboards)
// where any number of admins may be watching at once, unlike Send which
// targets exactly one recipient (a customer's own order, a driver's own
// assignment).
func (h *Hub) BroadcastToRoles(allowedRoles []string, eventType string, data any) {
	payload, err := json.Marshal(Event{Type: eventType, Data: data})
	if err != nil {
		return
	}

	type target struct {
		id string
		c  *client
	}

	h.mu.RLock()
	var targets []target
	for id, c := range h.clients {
		if hasAnyRole(c.roles, allowedRoles) {
			targets = append(targets, target{id, c})
		}
	}
	h.mu.RUnlock()

	for _, t := range targets {
		t.c.mu.Lock()
		writeErr := t.c.conn.WriteMessage(websocket.TextMessage, payload)
		t.c.mu.Unlock()

		if writeErr != nil {
			h.mu.Lock()
			delete(h.clients, t.id)
			h.mu.Unlock()
		}
	}
}

func hasAnyRole(have, want []string) bool {
	for _, w := range want {
		for _, h := range have {
			if h == w {
				return true
			}
		}
	}
	return false
}

// StartPingWorker sends periodic pings to detect stale connections.
func (h *Hub) StartPingWorker() {
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			h.mu.RLock()
			ids := make([]string, 0, len(h.clients))
			for id := range h.clients {
				ids = append(ids, id)
			}
			h.mu.RUnlock()

			for _, id := range ids {
				h.mu.RLock()
				c, ok := h.clients[id]
				h.mu.RUnlock()
				if !ok {
					continue
				}
				c.mu.Lock()
				err := c.conn.WriteMessage(websocket.PingMessage, nil)
				c.mu.Unlock()
				if err != nil {
					h.mu.Lock()
					delete(h.clients, id)
					h.mu.Unlock()
				}
			}
		}
	}()
}
