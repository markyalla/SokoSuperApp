package webhooks

import (
	"context"
	"crypto/hmac"
	"crypto/sha512"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"sokoapp/internal/audit"
	"sokoapp/internal/db"
	"sokoapp/internal/models"
	"sokoapp/internal/worker"
	"sokoapp/internal/ws"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

func HandlePaystack(dbs *db.Manager, distributor worker.TaskDistributor, hub *ws.Hub) gin.HandlerFunc {
	return func(c *gin.Context) {
		// 1. Verify HMAC-SHA512 signature
		hash := c.GetHeader("x-paystack-signature")
		payload, err := io.ReadAll(c.Request.Body)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "failed to read request body"})
			return
		}

		secret := os.Getenv("PAYSTACK_SECRET_KEY")
		if secret == "" {
			// An empty key would let anyone compute a "valid" signature.
			log.Println("[paystack webhook] PAYSTACK_SECRET_KEY is not set — rejecting webhook")
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "webhook not configured"})
			return
		}
		h := hmac.New(sha512.New, []byte(secret))
		h.Write(payload)
		if !hmac.Equal([]byte(hex.EncodeToString(h.Sum(nil))), []byte(hash)) {
			audit.Log(dbs.Account, audit.Entry{
				Category:  audit.CategoryPaymentFailure,
				Severity:  audit.SeverityCritical,
				Action:    "paystack_webhook_invalid_signature",
				Message:   "Paystack webhook received with an invalid HMAC signature — either a misconfigured secret or a spoofed request",
				IPAddress: c.ClientIP(),
			})
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid signature"})
			return
		}

		var event models.PaystackEvent
		if err := json.Unmarshal(payload, &event); err != nil {
			audit.Log(dbs.Account, audit.Entry{
				Category: audit.CategoryPaymentFailure,
				Severity: audit.SeverityError,
				Action:   "paystack_webhook_invalid_payload",
				Message:  fmt.Sprintf("failed to parse Paystack webhook payload: %v", err),
			})
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload"})
			return
		}

		if event.Event != "charge.success" {
			c.Status(http.StatusOK)
			return
		}

		ref := event.Data.Reference

		switch {
		case strings.HasPrefix(ref, "SK-SHOP-"):
			// Shopper order payment confirmed
			res := dbs.Shopper.Model(&models.Order{}).
				Where("paystack_reference = ?", ref).
				Updates(map[string]any{
					"status":     models.OrderPaymentConfirmed,
					"updated_at": time.Now(),
				})
			logPaymentUpdateOutcome(dbs, "shopper_order", ref, res.Error, res.RowsAffected)

		case strings.HasPrefix(ref, "SK-DEL-"):
			// Delivery order payment confirmed
			var order models.DeliveryOrder
			if err := dbs.Delivery.Where("paystack_ref = ?", ref).First(&order).Error; err != nil {
				audit.Log(dbs.Account, audit.Entry{
					Category: audit.CategoryPaymentFailure,
					Severity: audit.SeverityCritical,
					Action:   "paystack_delivery_order_lookup_failed",
					Message:  fmt.Sprintf("Paystack confirmed payment for reference %s but no matching delivery order was found: %v — customer was charged but the order will never progress", ref, err),
					Metadata: gin.H{"reference": ref},
				})
				break
			}
			res := dbs.Delivery.Model(&order).Updates(map[string]any{
				"payment_status": "success",
				"updated_at":     time.Now(),
			})
			logPaymentUpdateOutcome(dbs, "delivery_order", ref, res.Error, res.RowsAffected)

			createAndAssignDelivery(dbs, distributor, hub, order)

		case strings.HasPrefix(ref, "SK-BANK-"):
			// SokoBank top-up — handled separately

		case strings.HasPrefix(ref, "SK-IDX-CU-"):
			// SokoIndex customer contact-unlock payment confirmed (one-time,
			// unlocks every artisan's contact info + the ability to book)
			res := dbs.SokoIndex.Model(&models.SokoIndexCustomerUnlock{}).
				Where("payment_ref = ?", ref).
				Updates(map[string]any{
					"unlocked":       true,
					"payment_status": models.ContactPaymentPaid,
					"updated_at":     time.Now(),
				})
			logPaymentUpdateOutcome(dbs, "sokoindex_customer_unlock", ref, res.Error, res.RowsAffected)

		case strings.HasPrefix(ref, "SK-IDX-AU-"):
			// SokoIndex artisan incoming-jobs unlock payment confirmed (one-time,
			// unlocks customer contact info + accept/reject on every booking)
			res := dbs.SokoIndex.Model(&models.ArtisanProfile{}).
				Where("contact_unlock_payment_ref = ?", ref).
				Updates(map[string]any{
					"contact_unlock_paid": true,
					"updated_at":          time.Now(),
				})
			logPaymentUpdateOutcome(dbs, "sokoindex_artisan_unlock", ref, res.Error, res.RowsAffected)

		case strings.HasPrefix(ref, "SK-IDX-JF-"):
			// SokoIndex artisan joining-fee payment confirmed
			res := dbs.SokoIndex.Model(&models.ArtisanProfile{}).
				Where("joining_payment_ref = ?", ref).
				Updates(map[string]any{
					"joining_fee_paid": true,
					"updated_at":       time.Now(),
				})
			logPaymentUpdateOutcome(dbs, "sokoindex_joining_fee", ref, res.Error, res.RowsAffected)

		default:
			audit.Log(dbs.Account, audit.Entry{
				Category: audit.CategoryPaymentFailure,
				Severity: audit.SeverityWarning,
				Action:   "paystack_webhook_unrecognized_reference",
				Message:  fmt.Sprintf("Paystack confirmed a successful charge for reference %q, which matches none of this backend's known reference prefixes — payment was taken but nothing was updated", ref),
				Metadata: gin.H{"reference": ref},
			})
		}

		c.Status(http.StatusOK)
	}
}

// logPaymentUpdateOutcome audits the two ways a Paystack "payment confirmed"
// DB update can silently fail to actually mark anything paid: a real DB
// error, or a query that matched zero rows (the reference simply wasn't
// found — e.g. a duplicate/delayed webhook racing an already-cleaned-up
// row, or a reference that was never created correctly in the first place).
// Either way, the customer was charged and nothing here confirms it — that's
// the "stuck transaction" case this exists to surface.
func logPaymentUpdateOutcome(dbs *db.Manager, kind, ref string, err error, rowsAffected int64) {
	if err != nil {
		audit.Log(dbs.Account, audit.Entry{
			Category: audit.CategoryPaymentFailure,
			Severity: audit.SeverityCritical,
			Action:   fmt.Sprintf("paystack_%s_update_failed", kind),
			Message:  fmt.Sprintf("Paystack confirmed payment for reference %s but updating the %s record failed: %v — customer was charged but the record was not updated", ref, kind, err),
			Metadata: gin.H{"reference": ref},
		})
		return
	}
	if rowsAffected == 0 {
		audit.Log(dbs.Account, audit.Entry{
			Category: audit.CategoryPaymentFailure,
			Severity: audit.SeverityError,
			Action:   fmt.Sprintf("paystack_%s_reference_not_found", kind),
			Message:  fmt.Sprintf("Paystack confirmed payment for reference %s but no %s record matched it — customer was charged but nothing was marked paid", ref, kind),
			Metadata: gin.H{"reference": ref},
		})
	}
}

// createAndAssignDelivery creates the DeliveryAssignment for a paid parcel
// delivery and enqueues the nearest-driver worker task — the automatic
// counterpart to SokoWeb's manual "Assign Driver" / "Assign Nearest Driver"
// admin actions. Paystack can redeliver the same webhook more than once, so
// this is guarded by checking for an existing assignment on the order first.
func createAndAssignDelivery(dbs *db.Manager, distributor worker.TaskDistributor, hub *ws.Hub, order models.DeliveryOrder) {
	var existing models.DeliveryAssignment
	if err := dbs.Delivery.Where("order_id = ?", order.ID).First(&existing).Error; err == nil {
		return // already created (e.g. duplicate webhook delivery, or admin beat us to it)
	}

	assignment := models.DeliveryAssignment{
		OrderID:        order.ID,
		Source:         models.SourceDelivery,
		Status:         models.DelPending,
		PickupAddress:  order.PickupAddress,
		PickupLat:      order.PickupLat,
		PickupLng:      order.PickupLng,
		DropoffAddress: order.DropoffAddress,
		DropoffLat:     order.DropoffLat,
		DropoffLng:     order.DropoffLng,
		DistanceKm:     &order.DistanceKm,
		DeliveryFee:    order.TotalAmount,
	}
	if err := dbs.Delivery.Create(&assignment).Error; err != nil {
		log.Printf("[webhook] failed to create delivery assignment for order %s: %v", order.ID, err)
		orderID := order.ID
		audit.Log(dbs.Account, audit.Entry{
			Category:   audit.CategoryOrderStuck,
			Severity:   audit.SeverityCritical,
			Action:     "delivery_assignment_creation_failed",
			EntityType: "delivery_order",
			EntityID:   &orderID,
			Message:    fmt.Sprintf("Payment was confirmed for delivery order %s but creating its driver assignment failed: %v — this order will never get a driver assigned", order.ID, err),
		})
		return
	}

	// Real-time counterpart to SokoWeb's admin "new delivery" toast — same
	// trigger point (assignment row created, right after payment) it was
	// already polling for.
	hub.BroadcastToRoles([]string{"superadmin", "sokodelivery_admin"}, "new_delivery", gin.H{
		"id":  assignment.ID.String(),
		"ref": "PD-" + strings.ToUpper(assignment.ID.String()[:8]),
		"fee": assignment.DeliveryFee,
	})

	err := distributor.DistributeTaskAssignDriver(context.Background(), &worker.AssignDriverPayload{
		AssignmentID: assignment.ID.String(),
		VehicleType:  order.VehicleType,
	})
	if err != nil {
		log.Printf("[webhook] failed to enqueue auto-assign for assignment %s: %v", assignment.ID, err)
		assignmentID := assignment.ID
		audit.Log(dbs.Account, audit.Entry{
			Category:   audit.CategoryOrderStuck,
			Severity:   audit.SeverityError,
			Action:     "driver_auto_assign_enqueue_failed",
			EntityType: "delivery_assignment",
			EntityID:   &assignmentID,
			Message:    fmt.Sprintf("Delivery assignment %s was created but queuing the auto-assign job failed: %v — it will sit unassigned until a staff member assigns a driver manually", assignment.ID, err),
		})
	}
}
