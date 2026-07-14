package middleware

import (
	"net/http"

	"sokoapp/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// RequireApprovedKYC blocks transactional actions (placing orders, booking
// artisans, joining susu groups, booking parcel deliveries) for users whose
// KYC isn't approved yet. Looked up fresh from the DB on every request
// (not baked into the JWT) so an admin approving KYC takes effect
// immediately, without the user needing to log out/in.
func RequireApprovedKYC(accountDB *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.GetString("user_id")

		var kyc models.KYCSubmission
		err := accountDB.Select("status").Where("user_id = ?", userID).First(&kyc).Error

		status := models.KYCPending
		if err == nil {
			status = kyc.Status
		}

		if status != models.KYCApproved {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"error":      "Complete KYC verification and get approved to use this feature",
				"code":       "kyc_required",
				"kyc_status": status,
			})
			return
		}
		c.Next()
	}
}
