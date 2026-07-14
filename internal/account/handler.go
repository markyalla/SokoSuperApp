package account

import (
    "net/http"
    "time"
    "sokoapp/internal/models"

    "github.com/gin-gonic/gin"
    "gorm.io/gorm"
)

type SubmitKYCRequest struct {
    IDType      models.DocumentType `json:"id_type"      binding:"required,oneof=national_id nhia_id voter_id tin passport drivers_license"`
    IDNumber    string              `json:"id_number"    binding:"required"`
    IDImageURL  string              `json:"id_image_url"`
    Address     string              `json:"address"`
    City        string              `json:"city"`
    Country     string              `json:"country"`
    IDMismatch  bool                `json:"id_mismatch"`
}

func SubmitKYC(db *gorm.DB) gin.HandlerFunc {
    return func(c *gin.Context) {
        var req SubmitKYCRequest
        if err := c.ShouldBindJSON(&req); err != nil {
            c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
            return
        }

        userID := c.GetString("user_id")
        var user models.User
        if err := db.Preload("Roles").Where("id = ?", userID).First(&user).Error; err != nil {
            c.JSON(http.StatusUnauthorized, gin.H{"error": "User not found"})
            return
        }

        var kyc models.KYCSubmission
        if err := db.Where("user_id = ?", user.ID).First(&kyc).Error; err != nil {
            if err == gorm.ErrRecordNotFound {
                kyc = models.KYCSubmission{
                    UserID:      user.ID,
                    FullName:    user.FullName,
                    Email:       user.Email,
                    PhoneNumber: user.PhoneNumber,
                    Gender:      user.Gender,
                    DateOfBirth: user.DateOfBirth,
                }
            } else {
                c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load KYC record"})
                return
            }
        }

        kyc.IDType      = req.IDType
        kyc.IDNumber    = req.IDNumber
        kyc.IDImageURL  = req.IDImageURL
        kyc.Address     = req.Address
        kyc.City        = req.City
        kyc.Country     = req.Country
        kyc.OCRMismatch = req.IDMismatch
        kyc.Status      = models.KYCSubmitted
        now := time.Now()
        kyc.SubmittedAt = &now

        if err := db.Save(&kyc).Error; err != nil {
            c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save KYC submission"})
            return
        }

        c.JSON(http.StatusOK, gin.H{
            "message":    "KYC submitted successfully",
            "kyc_status": kyc.Status,
        })
    }
}
