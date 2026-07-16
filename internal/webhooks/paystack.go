package webhooks

import (
	"context"
	"crypto/hmac"
	"crypto/sha512"
	"encoding/hex"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"sokoapp/internal/db"
	"sokoapp/internal/models"
	"sokoapp/internal/worker"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

func HandlePaystack(dbs *db.Manager, distributor worker.TaskDistributor) gin.HandlerFunc {
	return func(c *gin.Context) {
		// 1. Verify HMAC-SHA512 signature
		hash := c.GetHeader("x-paystack-signature")
		payload, err := io.ReadAll(c.Request.Body)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "failed to read request body"})
			return
		}

		secret := os.Getenv("PAYSTACK_SECRET_KEY")
		h := hmac.New(sha512.New, []byte(secret))
		h.Write(payload)
		if hex.EncodeToString(h.Sum(nil)) != hash {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid signature"})
			return
		}

		var event models.PaystackEvent
		if err := json.Unmarshal(payload, &event); err != nil {
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
			dbs.Shopper.Model(&models.Order{}).
				Where("paystack_reference = ?", ref).
				Updates(map[string]any{
					"status":     models.OrderPaymentConfirmed,
					"updated_at": time.Now(),
				})

		case strings.HasPrefix(ref, "SK-DEL-"):
			// Delivery order payment confirmed
			var order models.DeliveryOrder
			if err := dbs.Delivery.Where("paystack_ref = ?", ref).First(&order).Error; err != nil {
				break
			}
			dbs.Delivery.Model(&order).Updates(map[string]any{
				"payment_status": "success",
				"updated_at":     time.Now(),
			})

			createAndAssignDelivery(dbs, distributor, order)

		case strings.HasPrefix(ref, "SK-BANK-"):
			// SokoBank top-up — handled separately

		case strings.HasPrefix(ref, "SK-IDX-CU-"):
			// SokoIndex customer contact-unlock payment confirmed (one-time,
			// unlocks every artisan's contact info + the ability to book)
			dbs.SokoIndex.Model(&models.SokoIndexCustomerUnlock{}).
				Where("payment_ref = ?", ref).
				Updates(map[string]any{
					"unlocked":       true,
					"payment_status": models.ContactPaymentPaid,
					"updated_at":     time.Now(),
				})

		case strings.HasPrefix(ref, "SK-IDX-AU-"):
			// SokoIndex artisan incoming-jobs unlock payment confirmed (one-time,
			// unlocks customer contact info + accept/reject on every booking)
			dbs.SokoIndex.Model(&models.ArtisanProfile{}).
				Where("contact_unlock_payment_ref = ?", ref).
				Updates(map[string]any{
					"contact_unlock_paid": true,
					"updated_at":          time.Now(),
				})

		case strings.HasPrefix(ref, "SK-IDX-JF-"):
			// SokoIndex artisan joining-fee payment confirmed
			dbs.SokoIndex.Model(&models.ArtisanProfile{}).
				Where("joining_payment_ref = ?", ref).
				Updates(map[string]any{
					"joining_fee_paid": true,
					"updated_at":       time.Now(),
				})
		}

		c.Status(http.StatusOK)
	}
}

// createAndAssignDelivery creates the DeliveryAssignment for a paid parcel
// delivery and enqueues the nearest-driver worker task — the automatic
// counterpart to SokoWeb's manual "Assign Driver" / "Assign Nearest Driver"
// admin actions. Paystack can redeliver the same webhook more than once, so
// this is guarded by checking for an existing assignment on the order first.
func createAndAssignDelivery(dbs *db.Manager, distributor worker.TaskDistributor, order models.DeliveryOrder) {
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
		return
	}

	err := distributor.DistributeTaskAssignDriver(context.Background(), &worker.AssignDriverPayload{
		AssignmentID: assignment.ID.String(),
		VehicleType:  order.VehicleType,
	})
	if err != nil {
		log.Printf("[webhook] failed to enqueue auto-assign for assignment %s: %v", assignment.ID, err)
	}
}
