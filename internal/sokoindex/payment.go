package sokoindex

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"os"
	"sokoapp/internal/models"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// customerUnlockFeeGHS is the one-time fee a customer pays to unlock full
// MySokoIndex access (every artisan's contact info + the ability to book).
func customerUnlockFeeGHS() float64 {
	if v := os.Getenv("SOKOINDEX_CONTACT_UNLOCK_FEE"); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil {
			return f
		}
	}
	return 30.00
}

// artisanUnlockFeeGHS is the one-time fee an artisan pays to unlock full
// visibility into incoming jobs (customer contact info + accept/reject).
func artisanUnlockFeeGHS() float64 {
	if v := os.Getenv("SOKOINDEX_ARTISAN_UNLOCK_FEE"); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil {
			return f
		}
	}
	return 30.00
}

func joiningFeeGHS() float64 {
	if v := os.Getenv("SOKOINDEX_JOINING_FEE"); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil {
			return f
		}
	}
	return 20.00
}

// ─────────────────────────────────────────────
// InitializePayment — POST /sokoindex/payments/initialize
// body: { "type": "contact_unlock" | "artisan_unlock" | "joining_fee", "entity_id": "<profile id, only for joining_fee>" }
// contact_unlock (customer) and artisan_unlock (artisan) are one-time,
// self-referential to the authenticated user — no entity_id needed.
// ─────────────────────────────────────────────

type InitializePaymentRequest struct {
	Type     string `json:"type" binding:"required,oneof=contact_unlock artisan_unlock joining_fee"`
	EntityID string `json:"entity_id" binding:"omitempty,uuid"`
}

func InitializePayment(db, accountDB *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userUUID, err := uuid.Parse(c.GetString("user_id"))
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid user id"})
			return
		}

		var req InitializePaymentRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		entityUUID, _ := uuid.Parse(req.EntityID)

		flags := getFeatureFlags(db)
		if (req.Type == "contact_unlock" || req.Type == "artisan_unlock") && !flags.ContactUnlockEnabled {
			c.JSON(http.StatusBadRequest, gin.H{"error": "MySokoIndex is currently free — no payment needed"})
			return
		}
		if req.Type == "joining_fee" && !flags.JoiningFeeEnabled {
			c.JSON(http.StatusBadRequest, gin.H{"error": "The joining fee is not currently enabled"})
			return
		}

		var amountGHS float64
		var refPrefix string
		var unlockID uuid.UUID

		switch req.Type {
		case "contact_unlock":
			var unlock models.SokoIndexCustomerUnlock
			if err := db.Where("user_id = ?", userUUID).First(&unlock).Error; err != nil {
				unlock = models.SokoIndexCustomerUnlock{UserID: userUUID, PaymentStatus: models.ContactPaymentPending}
				if err := db.Create(&unlock).Error; err != nil {
					c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to start unlock"})
					return
				}
			}
			if unlock.Unlocked {
				c.JSON(http.StatusBadRequest, gin.H{"error": "You have already unlocked MySokoIndex"})
				return
			}
			amountGHS = customerUnlockFeeGHS()
			refPrefix = "SK-IDX-CU-"
			unlockID = unlock.ID

		case "artisan_unlock":
			var profile models.ArtisanProfile
			if err := db.Where("user_id = ?", userUUID).First(&profile).Error; err != nil {
				c.JSON(http.StatusNotFound, gin.H{"error": "Artisan profile not found"})
				return
			}
			if profile.ContactUnlockPaid {
				c.JSON(http.StatusBadRequest, gin.H{"error": "You have already unlocked incoming jobs"})
				return
			}
			amountGHS = artisanUnlockFeeGHS()
			refPrefix = "SK-IDX-AU-"
			unlockID = profile.ID

		case "joining_fee":
			var profile models.ArtisanProfile
			if err := db.Where("id = ? AND user_id = ?", entityUUID, userUUID).First(&profile).Error; err != nil {
				c.JSON(http.StatusNotFound, gin.H{"error": "Artisan profile not found"})
				return
			}
			if profile.JoiningFeePaid {
				c.JSON(http.StatusBadRequest, gin.H{"error": "Joining fee already paid"})
				return
			}
			amountGHS = joiningFeeGHS()
			refPrefix = "SK-IDX-JF-"
			unlockID = profile.ID
		}

		var user models.User
		if err := accountDB.Select("email").Where("id = ?", userUUID).First(&user).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve user information"})
			return
		}

		paystackSecret := os.Getenv("PAYSTACK_SECRET_KEY")
		if paystackSecret == "" {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Payment provider not configured"})
			return
		}

		reference := refPrefix + uuid.New().String()
		amountPesewas := int(amountGHS * 100)

		payload, _ := json.Marshal(map[string]interface{}{
			"email":     user.Email,
			"amount":    amountPesewas,
			"reference": reference,
			"currency":  "GHS",
			// Offer both — Paystack only shows channels that are also enabled on the account.
			"channels":  []string{"card", "mobile_money"},
		})

		psReq, _ := http.NewRequest("POST", "https://api.paystack.co/transaction/initialize", bytes.NewBuffer(payload))
		psReq.Header.Set("Authorization", "Bearer "+paystackSecret)
		psReq.Header.Set("Content-Type", "application/json")

		client := &http.Client{Timeout: 10 * time.Second}
		psResp, err := client.Do(psReq)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Payment provider unreachable"})
			return
		}
		defer psResp.Body.Close()

		var psResult struct {
			Status  bool   `json:"status"`
			Message string `json:"message"`
			Data    struct {
				AuthorizationURL string `json:"authorization_url"`
			} `json:"data"`
		}
		body, _ := io.ReadAll(psResp.Body)
		if err := json.Unmarshal(body, &psResult); err != nil || !psResult.Status {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Paystack error: " + psResult.Message})
			return
		}

		switch req.Type {
		case "contact_unlock":
			db.Model(&models.SokoIndexCustomerUnlock{}).Where("id = ?", unlockID).Updates(map[string]interface{}{
				"payment_ref": reference,
			})
		case "artisan_unlock":
			db.Model(&models.ArtisanProfile{}).Where("id = ?", unlockID).Updates(map[string]interface{}{
				"contact_unlock_payment_ref": reference,
			})
		case "joining_fee":
			db.Model(&models.ArtisanProfile{}).Where("id = ?", unlockID).Updates(map[string]interface{}{
				"joining_payment_ref": reference,
			})
		}

		c.JSON(http.StatusOK, gin.H{
			"reference":    reference,
			"checkout_url": psResult.Data.AuthorizationURL,
			"amount":       amountGHS,
			"type":         req.Type,
		})
	}
}

// ─────────────────────────────────────────────
// VerifyPayment — GET /sokoindex/payments/verify?reference=...
// Client-triggered fallback verification alongside the Paystack webhook.
// ─────────────────────────────────────────────

func VerifyPayment(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		reference := c.Query("reference")
		if reference == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Missing reference"})
			return
		}

		paystackSecret := os.Getenv("PAYSTACK_SECRET_KEY")
		psReq, _ := http.NewRequest("GET", "https://api.paystack.co/transaction/verify/"+url.PathEscape(reference), nil)
		psReq.Header.Set("Authorization", "Bearer "+paystackSecret)

		client := &http.Client{Timeout: 10 * time.Second}
		psResp, err := client.Do(psReq)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not reach Paystack"})
			return
		}
		defer psResp.Body.Close()

		var psResult struct {
			Data struct {
				Status string `json:"status"`
			} `json:"data"`
		}
		body, _ := io.ReadAll(psResp.Body)
		if err := json.Unmarshal(body, &psResult); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to parse payment provider response"})
			return
		}

		if psResult.Data.Status != "success" {
			c.JSON(http.StatusOK, gin.H{"status": psResult.Data.Status})
			return
		}

		now := time.Now()
		switch {
		case len(reference) > 10 && reference[:10] == "SK-IDX-CU-":
			db.Model(&models.SokoIndexCustomerUnlock{}).Where("payment_ref = ?", reference).Updates(map[string]interface{}{
				"unlocked":       true,
				"payment_status": models.ContactPaymentPaid,
				"updated_at":     now,
			})
		case len(reference) > 10 && reference[:10] == "SK-IDX-AU-":
			db.Model(&models.ArtisanProfile{}).Where("contact_unlock_payment_ref = ?", reference).Updates(map[string]interface{}{
				"contact_unlock_paid": true,
				"updated_at":          now,
			})
		case len(reference) > 10 && reference[:10] == "SK-IDX-JF-":
			db.Model(&models.ArtisanProfile{}).Where("joining_payment_ref = ?", reference).Updates(map[string]interface{}{
				"joining_fee_paid": true,
				"updated_at":       now,
			})
		}

		c.JSON(http.StatusOK, gin.H{"status": "success"})
	}
}
