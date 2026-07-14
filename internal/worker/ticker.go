package worker

import (
	"log"
	"sokoapp/internal/models"
	"time"

	"gorm.io/gorm"
)

const pickupWindow = 5 * time.Minute
const tickInterval = 30 * time.Second
const driverStaleWindow = 3 * time.Minute

// StartPickupTimeoutWatcher runs a background goroutine that resets any
// shopper order or delivery assignment where the driver was assigned but
// did not mark pickup within 5 minutes.  Cleared orders revert to
// ready_for_pickup so the admin can reassign immediately.
//
// It also sweeps for drivers stuck "online" because their app was killed,
// crashed, or lost connectivity before it could tell the backend they went
// offline (a clean logout/toggle-off already clears this immediately —
// this catches everything that doesn't go through that path).
func StartPickupTimeoutWatcher(shopperDB, deliveryDB, accountDB *gorm.DB) {
	go func() {
		ticker := time.NewTicker(tickInterval)
		defer ticker.Stop()
		for range ticker.C {
			resetExpiredShopperOrders(shopperDB)
			resetExpiredDeliveryAssignments(deliveryDB)
			resetStaleOnlineDrivers(accountDB)
		}
	}()
	log.Println("PickupTimeoutWatcher: started (window=5m, tick=30s, driver-stale=3m)")
}

func resetStaleOnlineDrivers(db *gorm.DB) {
	cutoff := time.Now().Add(-driverStaleWindow)

	result := db.Model(&models.DriverProfile{}).
		Where("is_online = ? AND (last_location_at IS NULL OR last_location_at < ?)", true, cutoff).
		Updates(map[string]any{
			"is_online":    false,
			"is_available": false,
			"current_lat":  nil,
			"current_lng":  nil,
			"updated_at":   time.Now(),
		})

	if result.Error != nil {
		log.Printf("PickupTimeoutWatcher: stale driver reset error: %v", result.Error)
		return
	}
	if result.RowsAffected > 0 {
		log.Printf("PickupTimeoutWatcher: marked %d stale driver(s) offline (no location ping in %s)", result.RowsAffected, driverStaleWindow)
	}
}

func resetExpiredShopperOrders(db *gorm.DB) {
	cutoff := time.Now().Add(-pickupWindow)

	result := db.Model(&models.Order{}).
		Where("status = ? AND driver_assigned_at IS NOT NULL AND driver_assigned_at < ?",
			models.OrderAssignedToDriver, cutoff).
		Updates(map[string]any{
			"status":             models.OrderReadyForPickup,
			"driver_user_id":     nil,
			"driver_assigned_at": nil,
			"updated_at":         time.Now(),
		})

	if result.Error != nil {
		log.Printf("PickupTimeoutWatcher: shopper reset error: %v", result.Error)
		return
	}
	if result.RowsAffected > 0 {
		log.Printf("PickupTimeoutWatcher: reset %d expired shopper order(s) → ready_for_pickup", result.RowsAffected)
	}
}

func resetExpiredDeliveryAssignments(db *gorm.DB) {
	cutoff := time.Now().Add(-pickupWindow)

	result := db.Model(&models.DeliveryAssignment{}).
		Where("status = ? AND accepted_at IS NOT NULL AND accepted_at < ?",
			models.DelAccepted, cutoff).
		Updates(map[string]any{
			"status":      models.DelPending,
			"driver_id":   nil,
			"accepted_at": nil,
			"updated_at":  time.Now(),
		})

	if result.Error != nil {
		log.Printf("PickupTimeoutWatcher: delivery reset error: %v", result.Error)
		return
	}
	if result.RowsAffected > 0 {
		log.Printf("PickupTimeoutWatcher: reset %d expired delivery assignment(s) → pending", result.RowsAffected)
	}
}
