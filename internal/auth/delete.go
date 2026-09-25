package auth

import (
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"sokoapp/internal/middleware"
	"sokoapp/internal/models"
	"sokoapp/internal/storage"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

// DeleteAccount — DELETE /api/v1/auth/me
//
// Lets a user permanently delete their own account (required by Google Play).
// Personal data is erased or anonymised immediately: name, email, phone, date
// of birth, photos, KYC identity details and documents, driver vehicle/licence
// details, push tokens and all sessions. The users row itself is kept (as an
// anonymised, disabled shell) because orders, deliveries, payments and payouts
// reference it and must be retained for financial/legal record-keeping.
func DeleteAccount(db *gorm.DB, store *storage.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			Password string `json:"password" binding:"required"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Please enter your password to confirm"})
			return
		}

		userID := c.GetString("user_id")
		var user models.User
		if err := db.Preload("KYC").Where("id = ?", userID).First(&user).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
			return
		}
		if user.IsDeleted {
			c.JSON(http.StatusGone, gin.H{"error": "This account has already been deleted"})
			return
		}
		if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Incorrect password"})
			return
		}

		// Collect stored files before their references are wiped.
		files := []string{user.ProfileImageURL}
		var kycDocs []models.KYCDocument
		if user.KYC != nil {
			files = append(files, user.KYC.IDImageURL)
			db.Where("kyc_id = ?", user.KYC.ID).Find(&kycDocs)
			for _, d := range kycDocs {
				files = append(files, d.FileURL)
			}
		}

		randomPassword, err := randomToken()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete account"})
			return
		}
		lockedHash, _ := bcrypt.GenerateFromPassword([]byte(randomPassword), bcrypt.DefaultCost)

		compactID := strings.ReplaceAll(user.ID.String(), "-", "")
		anonEmail := fmt.Sprintf("deleted-%s@deleted.invalid", compactID)
		anonPhone := "del-" + compactID[:16] // phone_number is unique, size 20
		const anonName = "Deleted user"
		now := time.Now()

		err = db.Transaction(func(tx *gorm.DB) error {
			if err := tx.Model(&models.User{}).Where("id = ?", user.ID).Updates(map[string]interface{}{
				"full_name":             anonName,
				"email":                 anonEmail,
				"phone_number":          anonPhone,
				"password_hash":         string(lockedHash),
				"profile_image_url":     "",
				"date_of_birth":         nil,
				"fcm_token":             "",
				"expo_push_token":       "",
				"is_active":             false,
				"is_deleted":            true,
				"is_email_verified":     false,
				"is_phone_verified":     false,
				"failed_login_attempts": 0,
				"locked_until":          nil,
				"updated_at":            now,
			}).Error; err != nil {
				return err
			}

			if user.KYC != nil {
				if err := tx.Model(&models.KYCSubmission{}).Where("id = ?", user.KYC.ID).Updates(map[string]interface{}{
					"full_name":     anonName,
					"email":         anonEmail,
					"phone_number":  anonPhone,
					"date_of_birth": nil,
					"id_number":     "",
					"id_image_url":  "",
					"address":       "",
					"city":          "",
					"updated_at":    now,
				}).Error; err != nil {
					return err
				}
				if err := tx.Where("kyc_id = ?", user.KYC.ID).Delete(&models.KYCDocument{}).Error; err != nil {
					return err
				}
			}

			if err := tx.Model(&models.DriverProfile{}).Where("user_id = ?", user.ID).Updates(map[string]interface{}{
				"vehicle_plate":  "",
				"license_number": "",
				"is_online":      false,
				"is_available":   false,
				"status":         models.DriverSuspended,
			}).Error; err != nil {
				return err
			}

			if err := tx.Model(&models.RefreshToken{}).Where("user_id = ? AND revoked_at IS NULL", user.ID).
				Update("revoked_at", now).Error; err != nil {
				return err
			}
			return tx.Where("identifier = ?", user.Email).Delete(&models.OTPVerification{}).Error
		})
		if err != nil {
			log.Printf("[DeleteAccount] user %s: %v", user.ID, err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete account. Please try again or contact support."})
			return
		}

		// Existing access tokens stop working immediately.
		middleware.ForgetUser(user.ID.String())

		// Best-effort: remove photos and identity documents from storage.
		for _, f := range files {
			if err := store.RemoveByPath(f); err != nil {
				log.Printf("[DeleteAccount] user %s: could not remove %q: %v", user.ID, f, err)
			}
		}

		c.JSON(http.StatusOK, gin.H{"message": "Your account has been deleted"})
	}
}
