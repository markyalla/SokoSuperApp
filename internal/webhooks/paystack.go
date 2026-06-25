package webhooks

import (
	"crypto/hmac"
	"crypto/sha512"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"sokoapp/internal/db"
	"sokoapp/internal/models"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

func HandlePaystack(dbs *db.Manager) gin.HandlerFunc {
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
			dbs.Delivery.Model(&models.DeliveryOrder{}).
				Where("paystack_ref = ?", ref).
				Updates(map[string]any{
					"payment_status": "success",
					"updated_at":     time.Now(),
				})

		case strings.HasPrefix(ref, "SK-BANK-"):
			// SokoBank top-up — handled separately
		}

		c.Status(http.StatusOK)
	}
}
