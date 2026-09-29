package auth

import (
	"crypto/rand"
	"fmt"
	"math/big"
	"net/http"
	"sokoapp/internal/models"
	"sokoapp/internal/utils"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

// purposeEmailVerification tags the OTP emailed at sign-up. A user who still
// has one of these rows has registered but not yet proved they own the email,
// which is what Login uses to tell them apart from legacy accounts created
// before verification existed (those have no row and are let straight in).
const purposeEmailVerification = "email_verification"

// issueEmailVerificationOTP replaces any earlier sign-up code for the user
// with a fresh 6-digit one and emails it.
func issueEmailVerificationOTP(db *gorm.DB, user models.User) error {
	n, err := rand.Int(rand.Reader, big.NewInt(900000))
	if err != nil {
		return err
	}
	otp := fmt.Sprintf("%06d", n.Int64()+100000)

	hash, err := bcrypt.GenerateFromPassword([]byte(otp), bcrypt.MinCost)
	if err != nil {
		return err
	}

	db.Where("user_id = ? AND purpose = ?", user.ID, purposeEmailVerification).Delete(&models.OTPVerification{})

	record := models.OTPVerification{
		UserID:     &user.ID,
		Identifier: user.Email,
		OTPHash:    string(hash),
		Purpose:    purposeEmailVerification,
		ExpiresAt:  time.Now().Add(10 * time.Minute),
	}
	if err := db.Create(&record).Error; err != nil {
		return err
	}

	// Best-effort, like forgot-password — the user can always tap Resend.
	go utils.SendEmail(
		user.Email,
		"Your SokoApp verification code",
		utils.VerificationEmailBody(otp, user.FullName),
	)
	return nil
}

// hasPendingEmailVerification reports whether the user signed up under the
// OTP flow and has not entered their code yet.
func hasPendingEmailVerification(db *gorm.DB, user models.User) bool {
	if user.IsEmailVerified {
		return false
	}
	var count int64
	db.Model(&models.OTPVerification{}).
		Where("user_id = ? AND purpose = ?", user.ID, purposeEmailVerification).
		Count(&count)
	return count > 0
}

// ─────────────────────────────────────────────
// VerifyEmail — POST /api/v1/auth/verify-email
// Checks the sign-up OTP and, when it matches, logs the user in.
// ─────────────────────────────────────────────

func VerifyEmail(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			Email string `json:"email" binding:"required,email"`
			OTP   string `json:"otp"   binding:"required"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		var record models.OTPVerification
		if err := db.Where("identifier = ? AND purpose = ?", req.Email, purposeEmailVerification).
			Order("created_at DESC").First(&record).Error; err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid or expired code. Tap Resend to get a new one."})
			return
		}

		if time.Now().After(record.ExpiresAt) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "This code has expired. Tap Resend to get a new one."})
			return
		}

		if record.Attempts >= maxOTPAttempts {
			c.JSON(http.StatusTooManyRequests, gin.H{"error": "Too many incorrect codes. Tap Resend to get a new one."})
			return
		}

		if err := bcrypt.CompareHashAndPassword([]byte(record.OTPHash), []byte(req.OTP)); err != nil {
			db.Model(&record).Update("attempts", gorm.Expr("attempts + 1"))
			remaining := maxOTPAttempts - record.Attempts - 1
			if remaining <= 0 {
				c.JSON(http.StatusTooManyRequests, gin.H{"error": "Too many incorrect codes. Tap Resend to get a new one."})
				return
			}
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("Incorrect code. %d attempt(s) left.", remaining)})
			return
		}

		// Expired/exhausted rows are kept (not deleted) so Login still knows
		// the account is unverified and can send a new code.
		var user models.User
		if record.UserID == nil || db.Preload("Roles").Preload("KYC").Preload("DriverProfile").
			Where("id = ?", *record.UserID).First(&user).Error != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Account not found. Please register again."})
			return
		}

		db.Model(&models.User{}).Where("id = ?", user.ID).UpdateColumn("is_email_verified", true)
		user.IsEmailVerified = true
		db.Where("user_id = ? AND purpose = ?", user.ID, purposeEmailVerification).Delete(&models.OTPVerification{})

		accessToken, refreshToken, err := generateTokenPair(user)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Token generation failed"})
			return
		}
		persistRefreshToken(db, user.ID, refreshToken, c.ClientIP(), c.Request.UserAgent())
		db.Model(&models.User{}).Where("id = ?", user.ID).UpdateColumn("last_login_at", time.Now())

		roles := extractRoles(user.Roles)
		kycStatus := models.KYCPending
		if user.KYC != nil {
			kycStatus = user.KYC.Status
		}

		c.JSON(http.StatusOK, gin.H{
			"message": "Email verified",
			"tokens": gin.H{
				"access":  accessToken,
				"refresh": refreshToken,
			},
			"kyc_status": kycStatus,
			"is_driver":  containsRole(roles, string(models.RoleDriver)),
			"user":       buildUserResponse(user, roles, user.KYC, user.DriverProfile),
		})
	}
}

// ─────────────────────────────────────────────
// ResendVerification — POST /api/v1/auth/resend-verification
// ─────────────────────────────────────────────

func ResendVerification(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			Email string `json:"email" binding:"required,email"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Valid email required"})
			return
		}

		// Same reply either way so this can't be used to probe which emails exist.
		reply := gin.H{"message": "If that account is awaiting verification, a new code has been sent"}

		var user models.User
		if err := db.Where("email = ?", req.Email).First(&user).Error; err != nil {
			c.JSON(http.StatusOK, reply)
			return
		}
		if hasPendingEmailVerification(db, user) {
			if err := issueEmailVerificationOTP(db, user); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to send a new code"})
				return
			}
		}
		c.JSON(http.StatusOK, reply)
	}
}
