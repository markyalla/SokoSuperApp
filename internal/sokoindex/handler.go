package sokoindex

import (
	"net/http"
	"os"
	"sokoapp/internal/models"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// getFeatureFlags reads the singleton feature-flag row (creating it with
// both flags off if it doesn't exist yet), so payments stay opt-in.
func getFeatureFlags(db *gorm.DB) models.SokoIndexFeatureFlag {
	var flag models.SokoIndexFeatureFlag
	db.FirstOrCreate(&flag, models.SokoIndexFeatureFlag{ID: 1})
	return flag
}

// GetFeatureFlags — GET /sokoindex/feature-flags (public)
func GetFeatureFlags(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		flag := getFeatureFlags(db)
		c.JSON(http.StatusOK, gin.H{
			"contact_unlock_enabled": flag.ContactUnlockEnabled,
			"joining_fee_enabled":    flag.JoiningFeeEnabled,
			"customer_unlock_fee_ghs": customerUnlockFeeGHS(),
			"artisan_unlock_fee_ghs":  artisanUnlockFeeGHS(),
			"joining_fee_ghs":         joiningFeeGHS(),
		})
	}
}

// customerUnlockStatus looks up whether a user has already paid the
// one-time customer contact-unlock fee. A missing row means not unlocked.
func customerUnlockStatus(db *gorm.DB, userUUID uuid.UUID) models.SokoIndexCustomerUnlock {
	var unlock models.SokoIndexCustomerUnlock
	db.Where("user_id = ?", userUUID).First(&unlock)
	return unlock
}

// liveArtisansQuery scopes to artisans that are approved, not suspended, AND
// have at least one admin-approved portfolio item. Only artisans matching
// all three are visible to customers in browse/detail or bookable —
// an approved account with zero approved portfolio items does not go live.
func liveArtisansQuery(db *gorm.DB) *gorm.DB {
	return db.Model(&models.ArtisanProfile{}).
		Where("is_published = ? AND is_suspended = ?", true, false).
		Where("EXISTS (SELECT 1 FROM portfolios WHERE portfolios.artisan_id = artisan_profiles.id AND portfolios.status = ?)", models.PortfolioApproved)
}

func storagePublicURL() string {
	base := strings.TrimRight(os.Getenv("API_BASE_URL"), "/")
	if base == "" {
		base = "http://127.0.0.1:8082"
	}
	return base
}

// accountImageURL looks up a user's single account photo (users.
// profile_image_url, set at registration or from the account screen) and
// returns its full display URL. There is only ever one profile photo per
// person — artisan-facing surfaces (browse list, detail, bookings) show this
// same photo rather than maintaining a separate one.
func accountImageURL(accountDB *gorm.DB, base string, userID uuid.UUID) string {
	var user models.User
	if accountDB.Select("profile_image_url").Where("id = ?", userID).First(&user).Error == nil {
		return getFullImageURL(base, user.ProfileImageURL)
	}
	return ""
}

// accountImagesByUserID batch-looks-up account photos for many users at
// once, so list endpoints don't issue one query per row.
func accountImagesByUserID(accountDB *gorm.DB, base string, userIDs []uuid.UUID) map[uuid.UUID]string {
	out := map[uuid.UUID]string{}
	if len(userIDs) == 0 {
		return out
	}
	var users []models.User
	accountDB.Select("id", "profile_image_url").Where("id IN ?", userIDs).Find(&users)
	for _, u := range users {
		out[u.ID] = getFullImageURL(base, u.ProfileImageURL)
	}
	return out
}

func getFullImageURL(base, path string) string {
	if path == "" {
		return ""
	}
	mediaEndpoint := "/api/v1/media/serve/"
	if strings.Contains(path, mediaEndpoint) {
		parts := strings.Split(path, mediaEndpoint)
		path = parts[len(parts)-1]
	} else if strings.HasPrefix(path, "http") {
		return path
	}
	path = strings.TrimPrefix(path, "/")
	return strings.TrimRight(base, "/") + mediaEndpoint + path
}

// ─────────────────────────────────────────────
// Apply — POST /sokoindex/apply
// ─────────────────────────────────────────────

type ApplyRequest struct {
	Bio           string  `json:"bio" binding:"required"`
	TradeCategory string  `json:"trade_category" binding:"required"`
	LocationText  string  `json:"location_text"`
	LocationLat   float64 `json:"location_lat"`
	LocationLng   float64 `json:"location_lng"`
}

// Apply requires the caller to already have an approved sokoaccount KYC
// submission — identity is verified there, so this application only
// collects what's specific to being an artisan (trade + description).
func Apply(db, accountDB *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userUUID, err := uuid.Parse(c.GetString("user_id"))
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid user id"})
			return
		}

		var kyc models.KYCSubmission
		if err := accountDB.Where("user_id = ? AND status = ?", userUUID, models.KYCApproved).First(&kyc).Error; err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Please complete KYC verification before applying as an artisan"})
			return
		}

		var count int64
		db.Model(&models.ArtisanApplication{}).Where("user_id = ? AND status = ?", userUUID, models.ArtisanApplicationPending).Count(&count)
		if count > 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "You already have a pending artisan application"})
			return
		}
		db.Model(&models.ArtisanProfile{}).Where("user_id = ?", userUUID).Count(&count)
		if count > 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "You already have an artisan profile"})
			return
		}

		var req ApplyRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		application := models.ArtisanApplication{
			UserID:        userUUID,
			Bio:           req.Bio,
			TradeCategory: req.TradeCategory,
			LocationText:  req.LocationText,
			LocationLat:   req.LocationLat,
			LocationLng:   req.LocationLng,
			Status:        models.ArtisanApplicationPending,
			SubmittedAt:   time.Now(),
		}

		if err := db.Create(&application).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to submit artisan application"})
			return
		}

		c.JSON(http.StatusCreated, gin.H{
			"message": "Application submitted, awaiting admin approval",
			"status":  application.Status,
		})
	}
}

// ─────────────────────────────────────────────
// GetApplicationStatus — GET /sokoindex/application/status
// ─────────────────────────────────────────────

func GetApplicationStatus(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userUUID, err := uuid.Parse(c.GetString("user_id"))
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid user id"})
			return
		}

		var application models.ArtisanApplication
		if err := db.Where("user_id = ?", userUUID).Order("submitted_at desc").First(&application).Error; err != nil {
			c.JSON(http.StatusOK, gin.H{"has_applied": false})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"has_applied":      true,
			"status":           application.Status,
			"rejection_reason": application.RejectionReason,
		})
	}
}

// ─────────────────────────────────────────────
// Me — GET /sokoindex/me
// Tells the mobile app what to show: apply CTA, pending banner, or profile.
// ─────────────────────────────────────────────

func Me(db, accountDB *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		base := storagePublicURL()
		userUUID, err := uuid.Parse(c.GetString("user_id"))
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid user id"})
			return
		}

		flags := getFeatureFlags(db)
		unlockRequired := flags.ContactUnlockEnabled
		customerUnlocked := !unlockRequired || customerUnlockStatus(db, userUUID).Unlocked

		var profile models.ArtisanProfile
		if err := db.Where("user_id = ?", userUUID).First(&profile).Error; err == nil {
			profile.ProfileImagePath = accountImageURL(accountDB, base, profile.UserID)
			c.JSON(http.StatusOK, gin.H{
				"is_artisan":                true,
				"profile":                   profile,
				"customer_unlock_required":  unlockRequired,
				"customer_unlocked":         customerUnlocked,
				"artisan_unlock_required":   unlockRequired,
				"artisan_unlocked":          !unlockRequired || profile.ContactUnlockPaid,
			})
			return
		}

		var application models.ArtisanApplication
		if err := db.Where("user_id = ?", userUUID).Order("submitted_at desc").First(&application).Error; err == nil {
			c.JSON(http.StatusOK, gin.H{
				"is_artisan":                false,
				"has_applied":               true,
				"status":                    application.Status,
				"rejection_reason":          application.RejectionReason,
				"customer_unlock_required":  unlockRequired,
				"customer_unlocked":         customerUnlocked,
			})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"is_artisan":               false,
			"has_applied":              false,
			"customer_unlock_required": unlockRequired,
			"customer_unlocked":        customerUnlocked,
		})
	}
}

// getUserCountry looks up the requesting user's registered country (empty
// string if unknown/unset) — mirrors shopper.getUserCountry so artisan
// browsing surfaces the caller's own country first, same as store browsing.
// Never fails the request; a lookup error just means no reordering happens.
func getUserCountry(accountDB *gorm.DB, userIDStr string) string {
	userUUID, err := uuid.Parse(userIDStr)
	if err != nil {
		return ""
	}
	var user models.User
	if err := accountDB.Select("country").Where("id = ?", userUUID).First(&user).Error; err != nil {
		return ""
	}
	return user.Country
}

// backfillArtisanCountries self-heals ArtisanProfile rows created before the
// Country column existed: for any artisan in the page missing a country, it
// looks up that artisan's own account country, fills it in for this
// request's sort, and persists it so the row never needs re-fetching again.
func backfillArtisanCountries(db, accountDB *gorm.DB, artisans []models.ArtisanProfile) {
	var missingUserIDs []uuid.UUID
	for _, a := range artisans {
		if a.Country == "" {
			missingUserIDs = append(missingUserIDs, a.UserID)
		}
	}
	if len(missingUserIDs) == 0 {
		return
	}

	var users []models.User
	if err := accountDB.Select("id, country").Where("id IN ?", missingUserIDs).Find(&users).Error; err != nil {
		return
	}
	countryByUserID := make(map[uuid.UUID]string, len(users))
	for _, u := range users {
		if u.Country != "" {
			countryByUserID[u.ID] = u.Country
		}
	}

	for i := range artisans {
		if artisans[i].Country != "" {
			continue
		}
		country, ok := countryByUserID[artisans[i].UserID]
		if !ok {
			continue
		}
		artisans[i].Country = country
		db.Model(&models.ArtisanProfile{}).Where("id = ?", artisans[i].ID).Update("country", country)
	}
}

// ─────────────────────────────────────────────
// ListArtisans — GET /sokoindex/artisans (public)
// ─────────────────────────────────────────────

func ListArtisans(db, accountDB *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		base := storagePublicURL()
		tradeCategory := c.Query("trade_category")
		location := c.Query("location")
		q := c.Query("q")

		page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
		if page < 1 {
			page = 1
		}
		perPage := 20
		offset := (page - 1) * perPage

		query := liveArtisansQuery(db)
		if tradeCategory != "" {
			query = query.Where("trade_category ILIKE ?", "%"+tradeCategory+"%")
		}
		if location != "" {
			query = query.Where("location_text ILIKE ?", "%"+location+"%")
		}
		if q != "" {
			query = query.Where("display_name ILIKE ? OR bio ILIKE ?", "%"+q+"%", "%"+q+"%")
		}

		// Country-based reordering (below) needs the full matching set in
		// memory before paginating — otherwise a same-country artisan sitting
		// on page 2 could never get bumped ahead of page 1's results, unlike
		// shopper.ListStores which fetches everything before sorting.
		var allArtisans []models.ArtisanProfile
		if err := query.Order("avg_rating desc, recommendation_count desc").Find(&allArtisans).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch artisans"})
			return
		}
		total := int64(len(allArtisans))

		backfillArtisanCountries(db, accountDB, allArtisans)

		// Move the requester's own country to the front — same "your country
		// first" pattern as shopper.ListStores. Every artisan is still
		// returned; other countries just end up further down the list.
		if userCountry := getUserCountry(accountDB, c.GetString("user_id")); userCountry != "" {
			sort.SliceStable(allArtisans, func(i, j int) bool {
				return allArtisans[i].Country == userCountry && allArtisans[j].Country != userCountry
			})
		}

		end := offset + perPage
		if offset > len(allArtisans) {
			offset = len(allArtisans)
		}
		if end > len(allArtisans) {
			end = len(allArtisans)
		}
		artisans := allArtisans[offset:end]

		userIDs := make([]uuid.UUID, len(artisans))
		for i, a := range artisans {
			userIDs[i] = a.UserID
		}
		images := accountImagesByUserID(accountDB, base, userIDs)
		for i := range artisans {
			artisans[i].ProfileImagePath = images[artisans[i].UserID]
		}

		c.JSON(http.StatusOK, gin.H{
			"artisans": artisans,
			"page":     page,
			"total":    total,
		})
	}
}

// ─────────────────────────────────────────────
// GetArtisanDetail — GET /sokoindex/artisans/:id (authed)
// Requires login (moved off the public group) so contact info + the
// ability to book can be gated per customer's one-time unlock payment.
// ─────────────────────────────────────────────

func GetArtisanDetail(db, accountDB *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		base := storagePublicURL()
		artisanUUID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid artisan id"})
			return
		}
		userUUID, err := uuid.Parse(c.GetString("user_id"))
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid user id"})
			return
		}

		var profile models.ArtisanProfile
		if err := liveArtisansQuery(db).Where("id = ?", artisanUUID).First(&profile).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Artisan not found"})
			return
		}
		profile.ProfileImagePath = accountImageURL(accountDB, base, profile.UserID)

		var portfolio []models.Portfolio
		db.Where("artisan_id = ? AND status = ?", artisanUUID, models.PortfolioApproved).Order("created_at desc").Find(&portfolio)
		for i := range portfolio {
			portfolio[i].ImagePath1 = getFullImageURL(base, portfolio[i].ImagePath1)
			portfolio[i].ImagePath2 = getFullImageURL(base, portfolio[i].ImagePath2)
			portfolio[i].ImagePath3 = getFullImageURL(base, portfolio[i].ImagePath3)
			portfolio[i].ImagePath4 = getFullImageURL(base, portfolio[i].ImagePath4)
		}

		flags := getFeatureFlags(db)
		unlockRequired := flags.ContactUnlockEnabled
		customerUnlocked := !unlockRequired || customerUnlockStatus(db, userUUID).Unlocked

		result := gin.H{
			"artisan":                 profile,
			"portfolio":               portfolio,
			"contact_unlock_required": unlockRequired,
			"customer_unlocked":       customerUnlocked,
			"can_book":                customerUnlocked,
			"unlock_fee_ghs":          customerUnlockFeeGHS(),
		}

		// Full functionality (contact info + booking) once free, or once this
		// customer has paid the one-time unlock fee.
		if customerUnlocked {
			var artisanUser models.User
			if accountDB.Select("phone_number", "email").Where("id = ?", profile.UserID).First(&artisanUser).Error == nil {
				result["artisan_phone"] = artisanUser.PhoneNumber
				result["artisan_email"] = artisanUser.Email
			}
		}

		c.JSON(http.StatusOK, result)
	}
}

// ─────────────────────────────────────────────
// GetProfile / UpdateProfile — artisan-only
// ─────────────────────────────────────────────

func GetMyProfile(db, accountDB *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		base := storagePublicURL()
		userUUID, err := uuid.Parse(c.GetString("user_id"))
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid user id"})
			return
		}

		var profile models.ArtisanProfile
		if err := db.Where("user_id = ?", userUUID).First(&profile).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Artisan profile not found"})
			return
		}
		profile.ProfileImagePath = accountImageURL(accountDB, base, profile.UserID)
		c.JSON(http.StatusOK, profile)
	}
}

// There's a single profile photo per person (set at registration or from the
// account screen) — artisans don't get a separate one, so this request has
// no image field.
type UpdateProfileRequest struct {
	DisplayName   *string  `json:"display_name"`
	Bio           *string  `json:"bio"`
	TradeCategory *string  `json:"trade_category"`
	LocationText  *string  `json:"location_text"`
	LocationLat   *float64 `json:"location_lat"`
	LocationLng   *float64 `json:"location_lng"`
}

func UpdateMyProfile(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userUUID, err := uuid.Parse(c.GetString("user_id"))
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid user id"})
			return
		}

		var profile models.ArtisanProfile
		if err := db.Where("user_id = ?", userUUID).First(&profile).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Artisan profile not found"})
			return
		}

		var req UpdateProfileRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		updates := map[string]interface{}{"updated_at": time.Now()}
		if req.DisplayName != nil {
			updates["display_name"] = *req.DisplayName
		}
		if req.Bio != nil {
			updates["bio"] = *req.Bio
		}
		if req.TradeCategory != nil {
			updates["trade_category"] = *req.TradeCategory
		}
		if req.LocationText != nil {
			updates["location_text"] = *req.LocationText
		}
		if req.LocationLat != nil {
			updates["location_lat"] = *req.LocationLat
		}
		if req.LocationLng != nil {
			updates["location_lng"] = *req.LocationLng
		}

		if err := db.Model(&profile).Updates(updates).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update profile"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"message": "Profile updated"})
	}
}

// ─────────────────────────────────────────────
// Portfolio — artisan-only create/update/list
// ─────────────────────────────────────────────

type PortfolioRequest struct {
	Title       string `json:"title" binding:"required"`
	Description string `json:"description"`
	ImagePath1  string `json:"image_path_1" binding:"required"`
	ImagePath2  string `json:"image_path_2"`
	ImagePath3  string `json:"image_path_3"`
	ImagePath4  string `json:"image_path_4"`
}

func artisanIDForUser(db *gorm.DB, userUUID uuid.UUID) (uuid.UUID, error) {
	var profile models.ArtisanProfile
	if err := db.Select("id").Where("user_id = ?", userUUID).First(&profile).Error; err != nil {
		return uuid.Nil, err
	}
	return profile.ID, nil
}

func CreatePortfolio(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userUUID, err := uuid.Parse(c.GetString("user_id"))
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid user id"})
			return
		}
		artisanID, err := artisanIDForUser(db, userUUID)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Artisan profile not found"})
			return
		}

		var req PortfolioRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		portfolio := models.Portfolio{
			ArtisanID:   artisanID,
			Title:       req.Title,
			Description: req.Description,
			ImagePath1:  req.ImagePath1,
			ImagePath2:  req.ImagePath2,
			ImagePath3:  req.ImagePath3,
			ImagePath4:  req.ImagePath4,
			Status:      models.PortfolioPending,
			CreatedAt:   time.Now(),
		}

		if err := db.Create(&portfolio).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create portfolio item"})
			return
		}

		c.JSON(http.StatusCreated, gin.H{
			"message": "Portfolio item submitted, awaiting admin approval",
			"item":    portfolio,
		})
	}
}

func UpdatePortfolio(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userUUID, err := uuid.Parse(c.GetString("user_id"))
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid user id"})
			return
		}
		artisanID, err := artisanIDForUser(db, userUUID)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Artisan profile not found"})
			return
		}

		portfolioUUID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid portfolio id"})
			return
		}

		var portfolio models.Portfolio
		if err := db.Where("id = ? AND artisan_id = ?", portfolioUUID, artisanID).First(&portfolio).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Portfolio item not found"})
			return
		}

		var req PortfolioRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		// Editing resets moderation status — an edited item must be re-approved.
		if err := db.Model(&portfolio).Updates(map[string]interface{}{
			"title":            req.Title,
			"description":      req.Description,
			"image_path_1":     req.ImagePath1,
			"image_path_2":     req.ImagePath2,
			"image_path_3":     req.ImagePath3,
			"image_path_4":     req.ImagePath4,
			"status":           models.PortfolioPending,
			"rejection_reason": "",
		}).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update portfolio item"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"message": "Portfolio item updated, awaiting admin re-approval"})
	}
}

func ListMyPortfolio(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		base := storagePublicURL()
		userUUID, err := uuid.Parse(c.GetString("user_id"))
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid user id"})
			return
		}
		artisanID, err := artisanIDForUser(db, userUUID)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Artisan profile not found"})
			return
		}

		var portfolio []models.Portfolio
		db.Where("artisan_id = ?", artisanID).Order("created_at desc").Find(&portfolio)
		for i := range portfolio {
			portfolio[i].ImagePath1 = getFullImageURL(base, portfolio[i].ImagePath1)
			portfolio[i].ImagePath2 = getFullImageURL(base, portfolio[i].ImagePath2)
			portfolio[i].ImagePath3 = getFullImageURL(base, portfolio[i].ImagePath3)
			portfolio[i].ImagePath4 = getFullImageURL(base, portfolio[i].ImagePath4)
		}
		c.JSON(http.StatusOK, portfolio)
	}
}
