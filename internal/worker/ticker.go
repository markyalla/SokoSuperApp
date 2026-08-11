package worker

import (
	"log"
	"sokoapp/internal/audit"
	"sokoapp/internal/models"
	"time"

	"gorm.io/gorm"
)

const pickupWindow = 5 * time.Minute
const tickInterval = 30 * time.Second
const driverStaleWindow = 3 * time.Minute

// paymentPendingWindow / stuckOrderDebounce: see StartStuckOrderWatcher below.
const paymentPendingWindow = 20 * time.Minute
const stuckOrderDebounce = 6 * time.Hour

// StartPickupTimeoutWatcher runs a background goroutine that resets any
// shopper order or delivery assignment where the driver was assigned but
// did not mark pickup within 5 minutes.  Cleared orders revert to
// ready_for_pickup so the admin can reassign immediately.
//
// It also sweeps for drivers stuck "online" because their app was killed,
// crashed, or lost connectivity before it could tell the backend they went
// offline (a clean logout/toggle-off already clears this immediately —
// this catches everything that doesn't go through that path).
//
// accountDB is where every audit entry is written (audit_logs lives in
// sokoaccount regardless of which service's tables triggered the event).
func StartPickupTimeoutWatcher(shopperDB, deliveryDB, accountDB *gorm.DB) {
	go func() {
		ticker := time.NewTicker(tickInterval)
		defer ticker.Stop()
		for range ticker.C {
			resetExpiredShopperOrders(shopperDB, accountDB)
			resetExpiredDeliveryAssignments(deliveryDB, accountDB)
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

func resetExpiredShopperOrders(db, accountDB *gorm.DB) {
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
		audit.Log(accountDB, audit.Entry{
			Category: audit.CategoryOrderStuck,
			Severity: audit.SeverityWarning,
			Action:   "shopper_order_pickup_timeout_reset",
			Message:  "Driver did not mark pickup within 5 minutes of assignment — order(s) auto-reverted to ready_for_pickup for reassignment",
			Metadata: map[string]any{"orders_reset": result.RowsAffected},
		})
	}
}

func resetExpiredDeliveryAssignments(db, accountDB *gorm.DB) {
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
		audit.Log(accountDB, audit.Entry{
			Category: audit.CategoryOrderStuck,
			Severity: audit.SeverityWarning,
			Action:   "delivery_assignment_pickup_timeout_reset",
			Message:  "Driver did not mark pickup within 5 minutes of accepting — assignment(s) auto-reverted to pending for reassignment",
			Metadata: map[string]any{"assignments_reset": result.RowsAffected},
		})
	}
}

// StartStuckOrderWatcher sweeps for shopper orders sitting in
// payment_pending far longer than a real payment ever should — Paystack
// webhooks are near-instant, so anything still pending after 20 minutes
// means the webhook never arrived, failed, or the customer abandoned
// checkout. Unlike the pickup-timeout watcher, this never auto-changes the
// order — a payment might still legitimately land — it only surfaces the
// order for a human to check, debounced so the same stuck order doesn't
// re-log every 5 minutes for as long as it stays stuck.
func StartStuckOrderWatcher(shopperDB, accountDB *gorm.DB) {
	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			flagStuckPendingPayments(shopperDB, accountDB)
		}
	}()
	log.Println("StuckOrderWatcher: started (payment_pending window=20m, tick=5m, debounce=6h)")
}

func flagStuckPendingPayments(shopperDB, accountDB *gorm.DB) {
	cutoff := time.Now().Add(-paymentPendingWindow)

	var stuck []models.Order
	if err := shopperDB.
		Where("status = ? AND created_at < ?", models.OrderPaymentPending, cutoff).
		Find(&stuck).Error; err != nil {
		log.Printf("StuckOrderWatcher: query error: %v", err)
		return
	}

	debounceCutoff := time.Now().Add(-stuckOrderDebounce)
	for i := range stuck {
		orderID := stuck[i].ID

		var alreadyLogged int64
		accountDB.Model(&models.AuditLog{}).
			Where("category = ? AND action = ? AND entity_id = ? AND created_at > ?",
				audit.CategoryOrderStuck, "order_payment_pending_timeout", orderID, debounceCutoff).
			Count(&alreadyLogged)
		if alreadyLogged > 0 {
			continue
		}

		audit.Log(accountDB, audit.Entry{
			Category:   audit.CategoryOrderStuck,
			Severity:   audit.SeverityError,
			Action:     "order_payment_pending_timeout",
			EntityType: "order",
			EntityID:   &orderID,
			Message:    "Order has been in payment_pending for over 20 minutes — the Paystack webhook likely never arrived, failed, or the customer abandoned checkout. Check whether the customer was actually charged before assuming this order is simply abandoned.",
		})
	}
}
