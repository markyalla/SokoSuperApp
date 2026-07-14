package auth

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"os"
	"sokoapp/internal/models"
	"sokoapp/internal/storage"
	"sokoapp/internal/utils"
	"sokoapp/internal/worker"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

// ─────────────────────────────────────────────
// Request types
// ─────────────────────────────────────────────

type RegisterRequest struct {
	FullName        string `form:"full_name"        binding:"required"`
	Email           string `form:"email"            binding:"required,email"`
	Password        string `form:"password"         binding:"required,min=8"`
	ConfirmPassword string `form:"confirm_password" binding:"required"`
	PhoneNumber     string `form:"phone_number"     binding:"required"`
	DateOfBirth     string `form:"date_of_birth"`
	Gender          string `form:"gender"`
}

type LoginRequest struct {
	Identifier string `json:"identifier" binding:"required"`
	Password   string `json:"password"   binding:"required"`
}

type DriverApplicationRequest struct {
	VehicleType   string `json:"vehicle_type"   binding:"required"`
	VehiclePlate  string `json:"vehicle_plate"  binding:"required"`
	VehicleModel  string `json:"vehicle_model"  binding:"required"`
	LicenseNumber string `json:"license_number" binding:"required"`
}

type SubmitKYCRequest struct {
	IDType     string `json:"id_type"      binding:"required"`
	IDNumber   string `json:"id_number"`
	IDImageURL string `json:"id_image_url"`
	Address    string `json:"address"      binding:"required"`
	City       string `json:"city"         binding:"required"`
	Country    string `json:"country"      binding:"required"`
}

// ─────────────────────────────────────────────
// Register
// ─────────────────────────────────────────────

func Register(db *gorm.DB, store *storage.Client, distributor worker.TaskDistributor) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req RegisterRequest
		if err := c.ShouldBind(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		if req.Password != req.ConfirmPassword {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Passwords do not match"})
			return
		}

		var profileURL string
		file, err := c.FormFile("profile_image")
		if err == nil {
			url, uploadErr := store.UploadFile(file, "profile-images")
			if uploadErr != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Profile image upload failed: " + uploadErr.Error()})
				return
			}
			profileURL = url
		}

		hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to process security credentials"})
			return
		}

		var user models.User
		var kyc models.KYCSubmission
		err = db.Transaction(func(tx *gorm.DB) error {
			var dob *time.Time
			if req.DateOfBirth != "" {
				if t, parseErr := time.Parse("2006-01-02", req.DateOfBirth); parseErr == nil {
					dob = &t
				}
			}

			var userGender models.Gender
			switch req.Gender {
			case string(models.Male):
				userGender = models.Male
			case string(models.Female):
				userGender = models.Female
			case string(models.Other):
				userGender = models.Other
			case string(models.PreferNotToSay):
				userGender = models.PreferNotToSay
			default:
				userGender = models.Other
			}

			user = models.User{
				FullName:        req.FullName,
				Email:           req.Email,
				PhoneNumber:     req.PhoneNumber,
				PasswordHash:    string(hashedPassword),
				ProfileImageURL: profileURL,
				Gender:          userGender,
				DateOfBirth:     dob,
			}
			if err := tx.Create(&user).Error; err != nil {
				return err
			}

			var userCount int64
			if err := tx.Model(&models.User{}).Count(&userCount).Error; err != nil {
				return err
			}

			roleName := models.RoleUser
			if userCount == 1 {
				roleName = models.RoleSuperAdmin
			}

			role := models.UserRole{UserID: user.ID, Role: roleName}
			if err := tx.Create(&role).Error; err != nil {
				return err
			}

			// IDType MUST be a valid enum value — never empty string.
			// User will update this via the KYC screen; national_id is the safe default.
			kyc = models.KYCSubmission{
				UserID:      user.ID,
				FullName:    user.FullName,
				Email:       user.Email,
				PhoneNumber: user.PhoneNumber,
				Gender:      userGender,
				DateOfBirth: dob,
				Status:      models.KYCPending,
				IDType:      models.DocNationalID,
			}
			return tx.Create(&kyc).Error
		})

		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Registration failed: " + err.Error()})
			return
		}

		accessToken, refreshToken, err := generateTokenPair(user)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Token generation failed"})
			return
		}

		persistRefreshToken(db, user.ID, refreshToken, c.ClientIP(), c.Request.UserAgent())

		distributor.DistributeTaskProcessKYC(c.Request.Context(), &worker.KYCProcessingPayload{
			UserID: user.ID.String(),
		})

		c.JSON(http.StatusCreated, gin.H{
			"message":    "User registered successfully, KYC pending",
			"kyc_status": models.KYCPending,
			"id":         user.ID,
			"tokens": gin.H{
				"access":  accessToken,
				"refresh": refreshToken,
			},
			"user": buildUserResponse(user, []string{string(models.RoleUser)}, &kyc, nil),
		})
	}
}

// ─────────────────────────────────────────────
// Login
// ─────────────────────────────────────────────

func Login(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req LoginRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		var user models.User
		if err := db.Preload("Roles").Preload("KYC").Preload("DriverProfile").
			Where("email = ? OR phone_number = ?", req.Identifier, req.Identifier).
			First(&user).Error; err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid credentials"})
			return
		}

		if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid credentials"})
			return
		}

		// Create KYC row if missing (legacy accounts created before KYC flow).
		// IDType must be a valid enum value — use national_id as safe default.
		if user.KYC == nil {
			kyc := models.KYCSubmission{
				UserID:      user.ID,
				FullName:    user.FullName,
				Email:       user.Email,
				PhoneNumber: user.PhoneNumber,
				Gender:      user.Gender,
				DateOfBirth: user.DateOfBirth,
				Status:      models.KYCPending,
				IDType:      models.DocNationalID,
			}
			db.Create(&kyc)
			user.KYC = &kyc
		}

		accessToken, refreshToken, err := generateTokenPair(user)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Token generation failed"})
			return
		}

		persistRefreshToken(db, user.ID, refreshToken, c.ClientIP(), c.Request.UserAgent())

		// Use a clean model reference (not the preloaded struct) so GORM does not
		// attempt to cascade-save the KYC association that may have id_type = ""
		// for legacy accounts created via SokoWeb before the enum constraint existed.
		now := time.Now()
		db.Model(&models.User{}).Where("id = ?", user.ID).UpdateColumn("last_login_at", now)

		roles := extractRoles(user.Roles)

		c.JSON(http.StatusOK, gin.H{
			"tokens": gin.H{
				"access":  accessToken,
				"refresh": refreshToken,
			},
			"kyc_status": user.KYC.Status,
			"is_driver":  containsRole(roles, string(models.RoleDriver)),
			"user":       buildUserResponse(user, roles, user.KYC, user.DriverProfile),
		})
	}
}

// ─────────────────────────────────────────────
// Me
// ─────────────────────────────────────────────

func Me(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.GetString("user_id")
		var user models.User
		if err := db.Preload("KYC").Preload("Roles").Preload("DriverProfile").
			Where("id = ?", userID).First(&user).Error; err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "User not found"})
			return
		}

		roles := extractRoles(user.Roles)
		c.JSON(http.StatusOK, gin.H{
			"user":       buildUserResponse(user, roles, user.KYC, user.DriverProfile),
			"kyc_status": user.KYC.Status,
			"is_driver":  containsRole(roles, string(models.RoleDriver)),
		})
	}
}

// ─────────────────────────────────────────────
// UpdateMe
// ─────────────────────────────────────────────

func UpdateMe(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.GetString("user_id")
		var req struct {
			FullName        string `json:"full_name"`
			PhoneNumber     string `json:"phone_number"`
			Email           string `json:"email"`
			ProfileImageURL string `json:"profile_image_url"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		var user models.User
		if err := db.Preload("KYC").Preload("Roles").Preload("DriverProfile").
			Where("id = ?", userID).First(&user).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
			return
		}

		updates := make(map[string]interface{})
		if req.FullName != "" {
			updates["full_name"] = req.FullName
		}
		if req.PhoneNumber != "" {
			updates["phone_number"] = req.PhoneNumber
		}
		if req.Email != "" {
			updates["email"] = req.Email
		}
		if req.ProfileImageURL != "" {
			updates["profile_image_url"] = req.ProfileImageURL
		}

		if err := db.Model(&user).Updates(updates).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update profile"})
			return
		}

		roles := extractRoles(user.Roles)
		c.JSON(http.StatusOK, gin.H{
			"user":       buildUserResponse(user, roles, user.KYC, user.DriverProfile),
			"kyc_status": user.KYC.Status,
			"is_driver":  containsRole(roles, string(models.RoleDriver)),
		})
	}
}

// ─────────────────────────────────────────────
// SubmitKYC — POST /api/v1/auth/kyc
// ─────────────────────────────────────────────

// validDocTypes is the server-side whitelist that mirrors document_type_enum in Postgres.
// Validated here so we return a clear 400 before the DB ever sees a bad value.
var validDocTypes = map[string]bool{
	string(models.DocNationalID):     true,
	string(models.DocNHIA):           true,
	string(models.DocVoterID):        true,
	string(models.DocTIN):            true,
	string(models.DocPassport):       true,
	string(models.DocDriversLicense): true,
}

// idNumberRequired returns true for document types that must have a document number.
func idNumberRequired(idType string) bool {
	return idType == string(models.DocNationalID) ||
		idType == string(models.DocPassport) ||
		idType == string(models.DocDriversLicense)
}

func SubmitKYC(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req SubmitKYCRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		// Guard 1: enum whitelist check
		if !validDocTypes[req.IDType] {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": fmt.Sprintf(
					"invalid id_type %q — allowed values: national_id, nhia_id, voter_id, tin, passport, drivers_license",
					req.IDType,
				),
			})
			return
		}

		// Guard 2: id_number required for identity documents
		if idNumberRequired(req.IDType) && req.IDNumber == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "id_number is required for this document type"})
			return
		}

		userID := c.GetString("user_id")
		now := time.Now()

		// UPDATE the existing KYC row (created at registration).
		// user_id has a unique index so there is always exactly one row per user.
		result := db.Model(&models.KYCSubmission{}).
			Where("user_id = ?", userID).
			Updates(map[string]interface{}{
				"id_type":       models.DocumentType(req.IDType),
				"id_number":     req.IDNumber,
				"id_image_url":  req.IDImageURL,
				"address":       req.Address,
				"city":          req.City,
				"country":       req.Country,
				"status":        models.KYCSubmitted,
				"submitted_at":  &now,
				"updated_at":    now,
			})

		if result.Error != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save KYC details: " + result.Error.Error()})
			return
		}

		// Edge-case: row didn't exist yet (account predates the KYC auto-create logic).
		if result.RowsAffected == 0 {
			var user models.User
			if err := db.Where("id = ?", userID).First(&user).Error; err != nil {
				c.JSON(http.StatusUnauthorized, gin.H{"error": "User not found"})
				return
			}
			newKYC := models.KYCSubmission{
				UserID:      user.ID,
				FullName:    user.FullName,
				Email:       user.Email,
				PhoneNumber: user.PhoneNumber,
				Gender:      user.Gender,
				DateOfBirth: user.DateOfBirth,
				IDType:      models.DocumentType(req.IDType),
				IDNumber:    req.IDNumber,
				IDImageURL:  req.IDImageURL,
				Address:     req.Address,
				City:        req.City,
				Country:     req.Country,
				Status:      models.KYCSubmitted,
				SubmittedAt: &now,
			}
			if err := db.Create(&newKYC).Error; err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create KYC record: " + err.Error()})
				return
			}
		}

		c.JSON(http.StatusOK, gin.H{
			"message":    "KYC submitted successfully",
			"kyc_status": models.KYCSubmitted,
		})
	}
}

// ─────────────────────────────────────────────
// GetKYCStatus — GET /api/v1/auth/kyc/status
// ─────────────────────────────────────────────

func GetKYCStatus(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.GetString("user_id")
		var kyc models.KYCSubmission
		if err := db.Where("user_id = ?", userID).First(&kyc).Error; err != nil {
			c.JSON(http.StatusOK, gin.H{"kyc_status": models.KYCPending, "kyc": nil})
			return
		}
		c.JSON(http.StatusOK, gin.H{"kyc_status": kyc.Status, "kyc": kyc})
	}
}

// ─────────────────────────────────────────────
// ApplyDriver
// ─────────────────────────────────────────────

func ApplyDriver(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req DriverApplicationRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		userID := c.GetString("user_id")
		userUUID, _ := uuid.Parse(userID)

		var count int64
		db.Model(&models.DriverProfile{}).Where("user_id = ?", userUUID).Count(&count)
		if count > 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "A driver profile already exists for this account"})
			return
		}

		profile := models.DriverProfile{
			UserID:        userUUID,
			Status:        models.DriverPending,
			VehicleType:   models.VehicleType(req.VehicleType),
			VehiclePlate:  req.VehiclePlate,
			VehicleModel:  req.VehicleModel,
			LicenseNumber: req.LicenseNumber,
			CreatedAt:     time.Now(),
			UpdatedAt:     time.Now(),
		}

		if err := db.Create(&profile).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to submit driver application"})
			return
		}

		c.JSON(http.StatusCreated, gin.H{
			"message": "Application submitted, awaiting admin approval",
			"status":  models.DriverPending,
		})
	}
}

// ─────────────────────────────────────────────
// Refresh / Logout
// ─────────────────────────────────────────────

type RefreshRequest struct {
	RefreshToken string `json:"refresh_token" binding:"required"`
}

func Refresh(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req RefreshRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		token, err := jwt.Parse(req.RefreshToken, func(token *jwt.Token) (interface{}, error) {
			if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
			}
			return []byte(os.Getenv("JWT_SECRET")), nil
		})
		if err != nil || !token.Valid {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid or expired refresh token"})
			return
		}

		claims, ok := token.Claims.(jwt.MapClaims)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid token claims"})
			return
		}

		sub, ok := claims["sub"].(string)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "User ID not found in token"})
			return
		}

		var stored models.RefreshToken
		if err := db.Where("token_hash = ?", req.RefreshToken).First(&stored).Error; err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Refresh token not recognized"})
			return
		}
		if stored.RevokedAt != nil || stored.ExpiresAt.Before(time.Now()) {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Refresh token has been revoked or expired"})
			return
		}

		var user models.User
		if err := db.Preload("Roles").Preload("KYC").Where("id = ?", sub).First(&user).Error; err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "User not found"})
			return
		}

		accessToken, refreshToken, err := generateTokenPair(user)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to renew token pair"})
			return
		}

		if err := db.Model(&stored).Update("revoked_at", time.Now()).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to revoke old refresh token"})
			return
		}

		persistRefreshToken(db, user.ID, refreshToken, c.ClientIP(), c.Request.UserAgent())
		c.JSON(http.StatusOK, gin.H{"tokens": gin.H{"access": accessToken, "refresh": refreshToken}})
	}
}

func Logout(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req RefreshRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		if err := db.Model(&models.RefreshToken{}).
			Where("token_hash = ?", req.RefreshToken).
			Updates(map[string]interface{}{"revoked_at": time.Now()}).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Logout failed"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"message": "Logged out successfully"})
	}
}

// ─────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────

func generateTokenPair(user models.User) (string, string, error) {
	roles := make([]string, len(user.Roles))
	for i, r := range user.Roles {
		roles[i] = string(r.Role)
	}

	claims := jwt.MapClaims{
		"sub":   user.ID,
		"roles": roles,
		"exp":   time.Now().Add(time.Hour * 72).Unix(),
	}
	accessToken, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).
		SignedString([]byte(os.Getenv("JWT_SECRET")))
	if err != nil {
		return "", "", err
	}

	refreshClaims := jwt.MapClaims{
		"sub": user.ID,
		"exp": time.Now().Add(time.Hour * 24 * 7).Unix(),
	}
	refreshToken, err := jwt.NewWithClaims(jwt.SigningMethodHS256, refreshClaims).
		SignedString([]byte(os.Getenv("JWT_SECRET")))
	if err != nil {
		return "", "", err
	}

	return accessToken, refreshToken, nil
}

func persistRefreshToken(db *gorm.DB, userID uuid.UUID, token, ip, ua string) {
	deviceInfo, _ := json.Marshal(map[string]string{"user_agent": ua})
	rt := models.RefreshToken{
		UserID:     userID,
		TokenHash:  token,
		IPAddress:  ip,
		DeviceInfo: string(deviceInfo),
		ExpiresAt:  time.Now().Add(time.Hour * 24 * 7),
	}
	db.Create(&rt)
}

func extractRoles(userRoles []models.UserRole) []string {
	roles := make([]string, len(userRoles))
	for i, r := range userRoles {
		roles[i] = string(r.Role)
	}
	return roles
}

func containsRole(roles []string, target string) bool {
	for _, r := range roles {
		if r == target {
			return true
		}
	}
	return false
}

// getFullImageURL converts a relative storage path (e.g., /bucket/file) into a full absolute URL
// reachable by the frontend. It uses the API_BASE_URL environment variable.
func getFullImageURL(path string) string {
	if path == "" {
		return ""
	}

	// Strip old server prefixes if they exist in the DB
	mediaEndpoint := "/api/v1/media/serve/"
	if strings.Contains(path, mediaEndpoint) {
		parts := strings.Split(path, mediaEndpoint)
		path = parts[len(parts)-1]
	} else if strings.HasPrefix(path, "http") {
		// If the path is an external absolute URL (e.g., a placeholder), return it as is.
		return path
	}

	apiBaseURL := os.Getenv("API_BASE_URL")
	if apiBaseURL == "" {
		return path
	}
	// Ensure there is exactly one slash between the endpoint and the path
	if len(path) > 0 && path[0] != '/' {
		path = "/" + path
	}

	// Ensure spaces are encoded for mobile compatibility
	encodedPath := strings.ReplaceAll(path, " ", "%20")

	return apiBaseURL + "/api/v1/media/serve" + encodedPath
}

// ─────────────────────────────────────────────
// Forgot Password  →  send OTP
// ─────────────────────────────────────────────

func ForgotPassword(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			Email string `json:"email" binding:"required,email"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Valid email required"})
			return
		}

		var user models.User
		if err := db.Where("email = ?", req.Email).First(&user).Error; err != nil {
			// Don't reveal whether the email exists
			c.JSON(http.StatusOK, gin.H{"message": "If that email is registered you will receive an OTP"})
			return
		}

		// Generate 6-digit OTP
		n, err := rand.Int(rand.Reader, big.NewInt(900000))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate OTP"})
			return
		}
		otp := fmt.Sprintf("%06d", n.Int64()+100000)

		hash, err := bcrypt.GenerateFromPassword([]byte(otp), bcrypt.MinCost)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to hash OTP"})
			return
		}

		// Delete any existing password-reset OTPs for this email
		db.Where("identifier = ? AND purpose = ?", req.Email, "password_reset").Delete(&models.OTPVerification{})

		record := models.OTPVerification{
			UserID:     &user.ID,
			Identifier: req.Email,
			OTPHash:    string(hash),
			Purpose:    "password_reset",
			IsUsed:     false,
			ExpiresAt:  time.Now().Add(10 * time.Minute),
		}
		if err := db.Create(&record).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create OTP"})
			return
		}

		// Send email (best-effort — don't fail the request if email is misconfigured)
		go utils.SendEmail(
			req.Email,
			"Your SokoApp password reset code",
			utils.OTPEmailBody(otp, user.FullName),
		)

		c.JSON(http.StatusOK, gin.H{"message": "If that email is registered you will receive an OTP"})
	}
}

// ─────────────────────────────────────────────
// Verify OTP
// ─────────────────────────────────────────────

func VerifyOTP(db *gorm.DB) gin.HandlerFunc {
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
		if err := db.Where("identifier = ? AND purpose = ? AND is_used = false", req.Email, "password_reset").
			Order("created_at DESC").First(&record).Error; err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid or expired OTP"})
			return
		}

		if time.Now().After(record.ExpiresAt) {
			db.Delete(&record)
			c.JSON(http.StatusBadRequest, gin.H{"error": "OTP has expired"})
			return
		}

		if err := bcrypt.CompareHashAndPassword([]byte(record.OTPHash), []byte(req.OTP)); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Incorrect OTP"})
			return
		}

		// Mark as verified so reset-password can proceed
		db.Model(&record).Update("is_used", true)

		c.JSON(http.StatusOK, gin.H{"message": "OTP verified"})
	}
}

// ─────────────────────────────────────────────
// Reset Password
// ─────────────────────────────────────────────

func ResetPassword(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			Email           string `json:"email"            binding:"required,email"`
			NewPassword     string `json:"new_password"     binding:"required,min=8"`
			ConfirmPassword string `json:"confirm_password" binding:"required"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		if req.NewPassword != req.ConfirmPassword {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Passwords do not match"})
			return
		}

		// Check a verified OTP exists for this email
		var record models.OTPVerification
		if err := db.Where("identifier = ? AND purpose = ? AND is_used = true", req.Email, "password_reset").
			Order("created_at DESC").First(&record).Error; err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "OTP not verified. Please start the reset flow again"})
			return
		}

		// Guard against stale verified OTPs (allow 15 min window after verification)
		if time.Now().After(record.ExpiresAt.Add(5 * time.Minute)) {
			db.Delete(&record)
			c.JSON(http.StatusBadRequest, gin.H{"error": "Session expired. Please start again"})
			return
		}

		hash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to hash password"})
			return
		}

		if err := db.Model(&models.User{}).Where("email = ?", req.Email).
			Update("password_hash", string(hash)).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update password"})
			return
		}

		// Clean up
		db.Delete(&record)

		c.JSON(http.StatusOK, gin.H{"message": "Password reset successful"})
	}
}

// buildUserResponse produces a consistent user payload across all auth endpoints.
func buildUserResponse(
	user models.User,
	roles []string,
	kyc *models.KYCSubmission,
	driverProfile *models.DriverProfile,
) gin.H {
	return gin.H{
		"id":                user.ID,
		"email":             user.Email,
		"full_name":         user.FullName,
		"phone_number":      user.PhoneNumber,
		"profile_image_url": getFullImageURL(user.ProfileImageURL),
		"roles":             roles,
		"is_driver":         containsRole(roles, string(models.RoleDriver)),
		"gender":            user.Gender,
		"date_of_birth":     user.DateOfBirth,
		"driver_profile":    driverProfile,
		"kyc":               kyc,
	}
}
