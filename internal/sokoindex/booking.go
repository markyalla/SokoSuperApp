package sokoindex

import (
	"net/http"
	"sokoapp/internal/models"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// ─────────────────────────────────────────────
// CreateBooking — POST /sokoindex/bookings (customer)
// ─────────────────────────────────────────────

type CreateBookingRequest struct {
	ArtisanID    string  `json:"artisan_id" binding:"required,uuid"`
	Description  string  `json:"description" binding:"required"`
	LocationText string  `json:"location_text"`
	LocationLat  float64 `json:"location_lat"`
	LocationLng  float64 `json:"location_lng"`
}

func CreateBooking(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		customerUUID, err := uuid.Parse(c.GetString("user_id"))
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid user id"})
			return
		}

		var req CreateBookingRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		artisanUUID, _ := uuid.Parse(req.ArtisanID)

		var artisan models.ArtisanProfile
		if err := liveArtisansQuery(db).Where("id = ?", artisanUUID).First(&artisan).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Artisan not found or not available for booking"})
			return
		}

		booking := models.SokoIndexBooking{
			CustomerID:           customerUUID,
			ArtisanID:            artisanUUID,
			Description:          req.Description,
			CustomerLocationText: req.LocationText,
			CustomerLocationLat:  req.LocationLat,
			CustomerLocationLng:  req.LocationLng,
			Status:               models.SokoIndexBookingPending,
			ContactPaymentStatus: models.ContactPaymentPending,
			CreatedAt:            time.Now(),
			UpdatedAt:            time.Now(),
		}

		if err := db.Create(&booking).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create booking"})
			return
		}

		c.JSON(http.StatusCreated, booking)
	}
}

// ─────────────────────────────────────────────
// ListMyBookings — GET /sokoindex/bookings (customer)
// ─────────────────────────────────────────────

func ListMyBookings(db, accountDB *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		customerUUID, err := uuid.Parse(c.GetString("user_id"))
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid user id"})
			return
		}

		var bookings []models.SokoIndexBooking
		if status := c.Query("status"); status != "" {
			db.Where("customer_id = ? AND status = ?", customerUUID, status).Order("created_at desc").Find(&bookings)
		} else {
			db.Where("customer_id = ?", customerUUID).Order("created_at desc").Find(&bookings)
		}

		c.JSON(http.StatusOK, enrichBookings(db, accountDB, bookings))
	}
}

// ─────────────────────────────────────────────
// ListIncomingBookings — GET /sokoindex/artisan/bookings (artisan)
// ─────────────────────────────────────────────

func ListIncomingBookings(db, accountDB *gorm.DB) gin.HandlerFunc {
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

		var bookings []models.SokoIndexBooking
		if status := c.Query("status"); status != "" {
			db.Where("artisan_id = ? AND status = ?", artisanID, status).Order("created_at desc").Find(&bookings)
		} else {
			db.Where("artisan_id = ?", artisanID).Order("created_at desc").Find(&bookings)
		}

		c.JSON(http.StatusOK, enrichBookings(db, accountDB, bookings))
	}
}

// enrichBookings batches artisan-profile lookups onto each booking so the
// mobile app doesn't need N follow-up requests. Mirrors the shopper module's
// pattern of attaching nested summaries to list responses. While the
// contact-unlock paywall is disabled (default), it also attaches the
// customer's contact details so the artisan sees who booked them.
func enrichBookings(db, accountDB *gorm.DB, bookings []models.SokoIndexBooking) []gin.H {
	artisanIDs := make([]uuid.UUID, 0, len(bookings))
	seenArtisan := map[uuid.UUID]bool{}
	customerIDs := make([]uuid.UUID, 0, len(bookings))
	seenCustomer := map[uuid.UUID]bool{}
	for _, b := range bookings {
		if !seenArtisan[b.ArtisanID] {
			seenArtisan[b.ArtisanID] = true
			artisanIDs = append(artisanIDs, b.ArtisanID)
		}
		if !seenCustomer[b.CustomerID] {
			seenCustomer[b.CustomerID] = true
			customerIDs = append(customerIDs, b.CustomerID)
		}
	}

	var profiles []models.ArtisanProfile
	if len(artisanIDs) > 0 {
		db.Where("id IN ?", artisanIDs).Find(&profiles)
	}
	profileByID := map[uuid.UUID]models.ArtisanProfile{}
	for _, p := range profiles {
		profileByID[p.ID] = p
	}

	contactOpen := !getFeatureFlags(db).ContactUnlockEnabled
	customerByID := map[uuid.UUID]models.User{}
	if contactOpen && len(customerIDs) > 0 {
		var customers []models.User
		accountDB.Select("id", "full_name", "phone_number", "email", "profile_image_url").
			Where("id IN ?", customerIDs).Find(&customers)
		for _, cu := range customers {
			customerByID[cu.ID] = cu
		}
	}

	base := storagePublicURL()
	artisanUserIDs := make([]uuid.UUID, 0, len(profiles))
	for _, p := range profiles {
		artisanUserIDs = append(artisanUserIDs, p.UserID)
	}
	artisanImages := accountImagesByUserID(accountDB, base, artisanUserIDs)

	out := make([]gin.H, 0, len(bookings))
	for _, b := range bookings {
		artisan := profileByID[b.ArtisanID]
		artisan.ProfileImagePath = artisanImages[artisan.UserID]
		item := gin.H{
			"id":                     b.ID,
			"customer_id":            b.CustomerID,
			"artisan_id":             b.ArtisanID,
			"description":            b.Description,
			"status":                 b.Status,
			"rejection_reason":       b.RejectionReason,
			"contact_unlocked":       b.ContactUnlocked,
			"contact_payment_status": b.ContactPaymentStatus,
			"created_at":             b.CreatedAt,
			"updated_at":             b.UpdatedAt,
			"artisan": gin.H{
				"id":                 artisan.ID,
				"display_name":       artisan.DisplayName,
				"trade_category":     artisan.TradeCategory,
				"location_text":      artisan.LocationText,
				"profile_image_path": artisan.ProfileImagePath,
			},
		}
		if customer, ok := customerByID[b.CustomerID]; ok {
			item["customer"] = gin.H{
				"full_name":          customer.FullName,
				"phone_number":       customer.PhoneNumber,
				"email":              customer.Email,
				"profile_image_url":  customer.ProfileImageURL,
				"location_text":      b.CustomerLocationText,
			}
		}
		out = append(out, item)
	}
	return out
}

// ─────────────────────────────────────────────
// GetBooking — GET /sokoindex/bookings/:id (shared: customer or artisan)
// Reveals the artisan's phone number once contact is unlocked, mirroring
// artisan_hub's contact-unlock mechanic.
// ─────────────────────────────────────────────

func GetBooking(db, accountDB *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		bookingUUID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid booking id"})
			return
		}
		callerUUID, err := uuid.Parse(c.GetString("user_id"))
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid user id"})
			return
		}

		var booking models.SokoIndexBooking
		if err := db.Where("id = ?", bookingUUID).First(&booking).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Booking not found"})
			return
		}

		var artisan models.ArtisanProfile
		db.Where("id = ?", booking.ArtisanID).First(&artisan)

		isCustomer := booking.CustomerID == callerUUID
		isArtisan := artisan.UserID == callerUUID
		if !isCustomer && !isArtisan {
			c.JSON(http.StatusForbidden, gin.H{"error": "You do not have access to this booking"})
			return
		}

		base := storagePublicURL()
		result := gin.H{
			"id":                     booking.ID,
			"customer_id":            booking.CustomerID,
			"artisan_id":             booking.ArtisanID,
			"description":            booking.Description,
			"status":                 booking.Status,
			"rejection_reason":       booking.RejectionReason,
			"contact_unlocked":       booking.ContactUnlocked,
			"contact_payment_status": booking.ContactPaymentStatus,
			"created_at":             booking.CreatedAt,
			"updated_at":             booking.UpdatedAt,
			"artisan": gin.H{
				"id":                 artisan.ID,
				"display_name":       artisan.DisplayName,
				"trade_category":     artisan.TradeCategory,
				"location_text":      artisan.LocationText,
				"profile_image_path": accountImageURL(accountDB, base, artisan.UserID),
			},
		}

		if isCustomer && booking.ContactUnlocked {
			var artisanUser models.User
			if accountDB.Select("phone_number").Where("id = ?", artisan.UserID).First(&artisanUser).Error == nil {
				result["artisan_phone"] = artisanUser.PhoneNumber
			}
		}

		// While the contact-unlock paywall is disabled (default), the artisan
		// sees who booked them immediately, same as the incoming-bookings list.
		if isArtisan && !getFeatureFlags(db).ContactUnlockEnabled {
			var customerUser models.User
			if accountDB.Select("full_name", "phone_number", "email", "profile_image_url").
				Where("id = ?", booking.CustomerID).First(&customerUser).Error == nil {
				result["customer"] = gin.H{
					"full_name":         customerUser.FullName,
					"phone_number":      customerUser.PhoneNumber,
					"email":             customerUser.Email,
					"profile_image_url": customerUser.ProfileImageURL,
					"location_text":     booking.CustomerLocationText,
				}
			}
		}

		c.JSON(http.StatusOK, result)
	}
}

// updateBookingStatus enforces the booking state machine, mirroring
// artisan_hub's requiredCurrent -> newStatus helper.
func updateBookingStatus(db *gorm.DB, bookingID uuid.UUID, requiredCurrent, newStatus models.SokoIndexBookingStatus, extra map[string]interface{}) error {
	updates := map[string]interface{}{"status": newStatus, "updated_at": time.Now()}
	for k, v := range extra {
		updates[k] = v
	}
	res := db.Model(&models.SokoIndexBooking{}).
		Where("id = ? AND status = ?", bookingID, requiredCurrent).
		Updates(updates)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

// ─────────────────────────────────────────────
// AcceptBooking — PUT /sokoindex/artisan/bookings/:id/accept (artisan)
// ─────────────────────────────────────────────

func AcceptBooking(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		booking, artisanID, ok := loadOwnedBooking(c, db)
		if !ok {
			return
		}
		if booking.ArtisanID != artisanID {
			c.JSON(http.StatusForbidden, gin.H{"error": "Not your booking"})
			return
		}

		// While the contact-unlock paywall is disabled (default), accepting a
		// booking bypasses payment and unlocks contact immediately for free.
		extra := map[string]interface{}{}
		if !getFeatureFlags(db).ContactUnlockEnabled {
			extra["contact_unlocked"] = true
			extra["contact_payment_status"] = models.ContactPaymentBypassed
		}

		if err := updateBookingStatus(db, booking.ID, models.SokoIndexBookingPending, models.SokoIndexBookingAccepted, extra); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Booking is not pending"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"message": "Booking accepted"})
	}
}

// ─────────────────────────────────────────────
// RejectBooking — PUT /sokoindex/artisan/bookings/:id/reject (artisan)
// ─────────────────────────────────────────────

func RejectBooking(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		booking, artisanID, ok := loadOwnedBooking(c, db)
		if !ok {
			return
		}
		if booking.ArtisanID != artisanID {
			c.JSON(http.StatusForbidden, gin.H{"error": "Not your booking"})
			return
		}

		var req struct {
			Reason string `json:"reason" binding:"required"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "A rejection reason is required"})
			return
		}

		if err := updateBookingStatus(db, booking.ID, models.SokoIndexBookingPending, models.SokoIndexBookingRejected, map[string]interface{}{
			"rejection_reason": req.Reason,
		}); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Booking is not pending"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"message": "Booking rejected"})
	}
}

// ─────────────────────────────────────────────
// CompleteBooking — PUT /sokoindex/artisan/bookings/:id/complete (artisan)
// Marks work done; customer must still confirm before it's fully completed.
// ─────────────────────────────────────────────

func CompleteBooking(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		booking, artisanID, ok := loadOwnedBooking(c, db)
		if !ok {
			return
		}
		if booking.ArtisanID != artisanID {
			c.JSON(http.StatusForbidden, gin.H{"error": "Not your booking"})
			return
		}

		if err := updateBookingStatus(db, booking.ID, models.SokoIndexBookingAccepted, models.SokoIndexBookingAwaitingConfirmation, nil); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Booking must be accepted before it can be marked complete"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"message": "Marked complete, awaiting customer confirmation"})
	}
}

func loadOwnedBooking(c *gin.Context, db *gorm.DB) (models.SokoIndexBooking, uuid.UUID, bool) {
	bookingUUID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid booking id"})
		return models.SokoIndexBooking{}, uuid.Nil, false
	}
	userUUID, err := uuid.Parse(c.GetString("user_id"))
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid user id"})
		return models.SokoIndexBooking{}, uuid.Nil, false
	}
	artisanID, err := artisanIDForUser(db, userUUID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Artisan profile not found"})
		return models.SokoIndexBooking{}, uuid.Nil, false
	}
	var booking models.SokoIndexBooking
	if err := db.Where("id = ?", bookingUUID).First(&booking).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Booking not found"})
		return models.SokoIndexBooking{}, uuid.Nil, false
	}
	return booking, artisanID, true
}

// ─────────────────────────────────────────────
// CancelBooking — PUT /sokoindex/bookings/:id/cancel (customer, only while pending)
// ─────────────────────────────────────────────

func CancelBooking(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		bookingUUID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid booking id"})
			return
		}
		customerUUID, err := uuid.Parse(c.GetString("user_id"))
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid user id"})
			return
		}

		res := db.Model(&models.SokoIndexBooking{}).
			Where("id = ? AND customer_id = ? AND status = ?", bookingUUID, customerUUID, models.SokoIndexBookingPending).
			Updates(map[string]interface{}{"status": models.SokoIndexBookingCancelled, "updated_at": time.Now()})
		if res.Error != nil || res.RowsAffected == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Booking not found or not cancellable"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"message": "Booking cancelled"})
	}
}

// ─────────────────────────────────────────────
// ConfirmBookingCompletion — PUT /sokoindex/bookings/:id/confirm-completion (customer)
// ─────────────────────────────────────────────

func ConfirmBookingCompletion(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		bookingUUID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid booking id"})
			return
		}
		customerUUID, err := uuid.Parse(c.GetString("user_id"))
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid user id"})
			return
		}

		res := db.Model(&models.SokoIndexBooking{}).
			Where("id = ? AND customer_id = ? AND status = ?", bookingUUID, customerUUID, models.SokoIndexBookingAwaitingConfirmation).
			Updates(map[string]interface{}{"status": models.SokoIndexBookingCompleted, "updated_at": time.Now()})
		if res.Error != nil || res.RowsAffected == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Booking not found or not awaiting confirmation"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"message": "Booking marked completed"})
	}
}

// ─────────────────────────────────────────────
// RateBooking — POST /sokoindex/bookings/:id/rate (customer)
// ─────────────────────────────────────────────

func RateBooking(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		bookingUUID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid booking id"})
			return
		}
		customerUUID, err := uuid.Parse(c.GetString("user_id"))
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid user id"})
			return
		}

		var req struct {
			Score   int    `json:"score" binding:"required,min=1,max=5"`
			Comment string `json:"comment"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "score must be between 1 and 5"})
			return
		}

		var booking models.SokoIndexBooking
		if err := db.Where("id = ? AND customer_id = ? AND status = ?", bookingUUID, customerUUID, models.SokoIndexBookingCompleted).First(&booking).Error; err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Booking not found or not yet completed"})
			return
		}

		var count int64
		db.Model(&models.SokoIndexRating{}).Where("booking_id = ?", bookingUUID).Count(&count)
		if count > 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "You have already rated this booking"})
			return
		}

		rating := models.SokoIndexRating{
			BookingID:  bookingUUID,
			CustomerID: customerUUID,
			ArtisanID:  booking.ArtisanID,
			Score:      req.Score,
			Comment:    req.Comment,
			CreatedAt:  time.Now(),
		}
		if err := db.Create(&rating).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save rating"})
			return
		}

		recalculateAvgRating(db, booking.ArtisanID)
		c.JSON(http.StatusCreated, gin.H{"message": "Rating submitted"})
	}
}

func recalculateAvgRating(db *gorm.DB, artisanID uuid.UUID) {
	var result struct {
		Avg   float64
		Count int64
	}
	db.Model(&models.SokoIndexRating{}).
		Select("COALESCE(AVG(score), 0) as avg, COUNT(*) as count").
		Where("artisan_id = ?", artisanID).
		Scan(&result)

	db.Model(&models.ArtisanProfile{}).Where("id = ?", artisanID).Updates(map[string]interface{}{
		"avg_rating":   result.Avg,
		"rating_count": result.Count,
		"updated_at":   time.Now(),
	})
}

// ─────────────────────────────────────────────
// ListMyRatings — GET /sokoindex/artisan/ratings (artisan)
// Lets the artisan see who rated them, with the customer's name/email
// attached — mirrors enrichBookings' customer lookup pattern.
// ─────────────────────────────────────────────

func ListMyRatings(db, accountDB *gorm.DB) gin.HandlerFunc {
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

		var ratings []models.SokoIndexRating
		db.Where("artisan_id = ?", artisanID).Order("created_at desc").Find(&ratings)

		customerIDs := make([]uuid.UUID, 0, len(ratings))
		seen := map[uuid.UUID]bool{}
		for _, r := range ratings {
			if !seen[r.CustomerID] {
				seen[r.CustomerID] = true
				customerIDs = append(customerIDs, r.CustomerID)
			}
		}

		customerByID := map[uuid.UUID]models.User{}
		if len(customerIDs) > 0 {
			var customers []models.User
			accountDB.Select("id", "full_name", "email", "phone_number", "profile_image_url").
				Where("id IN ?", customerIDs).Find(&customers)
			for _, cu := range customers {
				customerByID[cu.ID] = cu
			}
		}

		out := make([]gin.H, 0, len(ratings))
		for _, r := range ratings {
			item := gin.H{
				"id":         r.ID,
				"booking_id": r.BookingID,
				"score":      r.Score,
				"comment":    r.Comment,
				"created_at": r.CreatedAt,
			}
			if customer, ok := customerByID[r.CustomerID]; ok {
				item["customer"] = gin.H{
					"full_name":          customer.FullName,
					"email":              customer.Email,
					"phone_number":       customer.PhoneNumber,
					"profile_image_url":  customer.ProfileImageURL,
				}
			}
			out = append(out, item)
		}

		c.JSON(http.StatusOK, out)
	}
}

// ─────────────────────────────────────────────
// RecommendArtisan — POST /sokoindex/bookings/:id/recommend (customer)
// ─────────────────────────────────────────────

func RecommendArtisan(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		bookingUUID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid booking id"})
			return
		}
		customerUUID, err := uuid.Parse(c.GetString("user_id"))
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid user id"})
			return
		}

		var req struct {
			Note string `json:"note"`
		}
		c.ShouldBindJSON(&req)

		var booking models.SokoIndexBooking
		if err := db.Where("id = ? AND customer_id = ? AND status = ?", bookingUUID, customerUUID, models.SokoIndexBookingCompleted).First(&booking).Error; err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Booking not found or not yet completed"})
			return
		}

		var count int64
		db.Model(&models.Recommendation{}).Where("artisan_id = ? AND recommended_by_user_id = ?", booking.ArtisanID, customerUUID).Count(&count)
		if count > 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "You have already recommended this artisan"})
			return
		}

		bookingIDCopy := bookingUUID
		recommendation := models.Recommendation{
			ArtisanID:            booking.ArtisanID,
			RecommendedByUserID:  customerUUID,
			BookingID:            &bookingIDCopy,
			Note:                 req.Note,
			CreatedAt:            time.Now(),
		}
		if err := db.Create(&recommendation).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save recommendation"})
			return
		}

		db.Model(&models.ArtisanProfile{}).Where("id = ?", booking.ArtisanID).
			UpdateColumn("recommendation_count", gorm.Expr("recommendation_count + 1"))

		c.JSON(http.StatusCreated, gin.H{"message": "Artisan recommended"})
	}
}

// ─────────────────────────────────────────────
// FileComplaint — POST /sokoindex/bookings/:id/complaints (customer)
// ─────────────────────────────────────────────

func FileComplaint(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		bookingUUID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid booking id"})
			return
		}
		customerUUID, err := uuid.Parse(c.GetString("user_id"))
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid user id"})
			return
		}

		var req struct {
			Category    string `json:"category"`
			Description string `json:"description" binding:"required"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		var booking models.SokoIndexBooking
		if err := db.Where("id = ? AND customer_id = ?", bookingUUID, customerUUID).First(&booking).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Booking not found"})
			return
		}

		complaint := models.Complaint{
			BookingID:         bookingUUID,
			ComplainantUserID: customerUUID,
			AgainstArtisanID:  booking.ArtisanID,
			Category:          req.Category,
			Description:       req.Description,
			Status:            models.ComplaintOpen,
			CreatedAt:         time.Now(),
		}
		if err := db.Create(&complaint).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to file complaint"})
			return
		}

		c.JSON(http.StatusCreated, gin.H{"message": "Complaint filed, our team will review it", "complaint": complaint})
	}
}
