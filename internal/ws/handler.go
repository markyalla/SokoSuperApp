package ws

import (
	"fmt"
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	HandshakeTimeout: 10 * time.Second,
	ReadBufferSize:   1024,
	WriteBufferSize:  4096,
	CheckOrigin:      func(r *http.Request) bool { return true },
}

// Handler upgrades an HTTP connection to WebSocket.
// The client must pass its JWT as a query param: /ws?token=<JWT>
func Handler(hub *Hub) gin.HandlerFunc {
	return func(c *gin.Context) {
		tokenStr := c.Query("token")
		if tokenStr == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "token query param required"})
			return
		}

		userID, roles, err := parseToken(tokenStr)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid or expired token"})
			return
		}

		conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
		if err != nil {
			return // upgrader already wrote the error response
		}
		defer conn.Close()

		hub.Register(userID, conn, roles)
		defer hub.Unregister(userID)

		// Read pump: keeps connection alive and detects client disconnect.
		// We don't expect clients to send messages, but we must read to get
		// control frames (pong/close) and to unblock on error.
		conn.SetReadLimit(512)
		conn.SetReadDeadline(time.Now().Add(90 * time.Second))
		conn.SetPongHandler(func(string) error {
			conn.SetReadDeadline(time.Now().Add(90 * time.Second))
			return nil
		})

		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				break
			}
		}
	}
}

func parseToken(tokenStr string) (string, []string, error) {
	secret := os.Getenv("JWT_SECRET")
	token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method")
		}
		return []byte(secret), nil
	})
	if err != nil || !token.Valid {
		return "", nil, fmt.Errorf("invalid token")
	}
	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return "", nil, fmt.Errorf("bad claims")
	}
	sub, ok := claims["sub"].(string)
	if !ok || sub == "" {
		return "", nil, fmt.Errorf("missing sub")
	}

	var roles []string
	if rawRoles, ok := claims["roles"].([]any); ok {
		for _, r := range rawRoles {
			if s, ok := r.(string); ok {
				roles = append(roles, s)
			}
		}
	}
	return sub, roles, nil
}
