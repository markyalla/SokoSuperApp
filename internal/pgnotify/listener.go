// Package pgnotify bridges Postgres LISTEN/NOTIFY to the WebSocket hub so a
// driver is notified the instant they're assigned a delivery — regardless of
// which process wrote the assignment (SokoWeb's admin dashboard writes
// directly to Postgres and never calls this API, so this listens at the DB
// layer instead of relying on every writer to remember to push a message).
package pgnotify

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"gorm.io/gorm"

	"sokoapp/internal/models"
	"sokoapp/internal/ws"
)

const channel = "driver_assignment_events"

type assignmentPayload struct {
	Source       string `json:"source"`
	DriverID     string `json:"driver_id"`
	AssignmentID string `json:"assignment_id"`
	OrderID      string `json:"order_id"`
	Status       string `json:"status"`
}

// Listen opens a dedicated LISTEN connection to dbname and relays driver
// assignment notifications to hub in real time. Blocks until ctx is
// cancelled, reconnecting with backoff whenever the connection drops.
// accountDB is used to also fire an Expo push notification, so the driver is
// woken up even if the app is backgrounded or killed (the WS hub alone can
// only reach an app that's currently connected).
func Listen(ctx context.Context, dbname string, hub *ws.Hub, accountDB *gorm.DB) {
	dsn := fmt.Sprintf("host=%s user=%s password=%s dbname=%s port=%s sslmode=disable TimeZone=UTC",
		os.Getenv("DB_HOST"),
		os.Getenv("DB_USER"),
		os.Getenv("DB_PASSWORD"),
		dbname,
		os.Getenv("DB_PORT"),
	)

	backoff := 2 * time.Second
	const maxBackoff = 30 * time.Second

	for {
		if ctx.Err() != nil {
			return
		}

		conn, err := pgx.Connect(ctx, dsn)
		if err != nil {
			log.Printf("[pgnotify] %s: connect failed: %v (retrying in %s)", dbname, err, backoff)
			time.Sleep(backoff)
			backoff = min(backoff*2, maxBackoff)
			continue
		}

		if _, err := conn.Exec(ctx, "LISTEN "+channel); err != nil {
			log.Printf("[pgnotify] %s: LISTEN failed: %v", dbname, err)
			conn.Close(ctx)
			time.Sleep(backoff)
			backoff = min(backoff*2, maxBackoff)
			continue
		}

		log.Printf("[pgnotify] %s: listening on %q", dbname, channel)
		backoff = 2 * time.Second

		for {
			notification, err := conn.WaitForNotification(ctx)
			if err != nil {
				log.Printf("[pgnotify] %s: connection lost: %v", dbname, err)
				break
			}

			var payload assignmentPayload
			if err := json.Unmarshal([]byte(notification.Payload), &payload); err != nil {
				log.Printf("[pgnotify] %s: bad payload %q: %v", dbname, notification.Payload, err)
				continue
			}
			if payload.DriverID == "" {
				continue
			}

			hub.Send(payload.DriverID, "driver_assignment", map[string]any{
				"source":        payload.Source,
				"assignment_id": payload.AssignmentID,
				"order_id":      payload.OrderID,
				"status":        payload.Status,
			})
			sendAssignmentPush(accountDB, payload)
		}

		conn.Close(ctx)
		time.Sleep(backoff)
	}
}

type expoPushMessage struct {
	To    string         `json:"to"`
	Title string         `json:"title"`
	Body  string         `json:"body"`
	Data  map[string]any `json:"data"`
}

// sendAssignmentPush looks up the driver's registered Expo push token and
// fires a system notification carrying the same assignment data the WS event
// carries, so the mobile app's countdown popup can be shown even from a
// notification tap (app was backgrounded or killed when it arrived).
func sendAssignmentPush(accountDB *gorm.DB, payload assignmentPayload) {
	driverUUID, err := uuid.Parse(payload.DriverID)
	if err != nil {
		return
	}

	var driver models.User
	if err := accountDB.Select("expo_push_token").Where("id = ?", driverUUID).First(&driver).Error; err != nil {
		return
	}
	if driver.ExpoPushToken == "" {
		return
	}

	msg := expoPushMessage{
		To:    driver.ExpoPushToken,
		Title: "New Delivery Assigned",
		Body:  "You have a new delivery — tap to view and respond before it expires.",
		Data: map[string]any{
			"assignment_id": payload.AssignmentID,
			"order_id":      payload.OrderID,
			"status":        payload.Status,
		},
	}
	body, err := json.Marshal(msg)
	if err != nil {
		return
	}

	req, err := http.NewRequest(http.MethodPost, "https://exp.host/--/api/v2/push/send", bytes.NewReader(body))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		log.Printf("[pgnotify] expo push failed: %v", err)
		return
	}
	defer resp.Body.Close()
}
