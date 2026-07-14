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
	conn *websocket.Conn
	mu   sync.Mutex
}

// Hub maintains all active WebSocket connections, keyed by user ID.
type Hub struct {
	mu      sync.RWMutex
	clients map[string]*client
}

func NewHub() *Hub {
	return &Hub{clients: make(map[string]*client)}
}

// Register adds (or replaces) a connection for a user.
func (h *Hub) Register(userID string, conn *websocket.Conn) {
	h.mu.Lock()
	if old, ok := h.clients[userID]; ok {
		old.conn.Close()
	}
	h.clients[userID] = &client{conn: conn}
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
