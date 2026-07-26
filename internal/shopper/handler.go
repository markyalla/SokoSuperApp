package shopper

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"sokoapp/internal/models"
	"sokoapp/internal/pricing"
	"sokoapp/internal/storage"
	"sokoapp/internal/ws"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type ProductItemRequest struct {
	ProductID   string  `json:"product_id" binding:"required,uuid"`
	Name        string  `json:"name" binding:"required"`
	Quantity    int16   `json:"quantity" binding:"required,gt=0"`
	UnitPrice   float64 `json:"unit_price" binding:"required,gt=0"`
	SpecialNote string  `json:"special_note"`
}

type CreateOrderRequest struct {
	StoreID              string               `json:"store_id" binding:"required,uuid"`
	Items                []ProductItemRequest `json:"items" binding:"required"`
	DeliveryAddress      string               `json:"delivery_address" binding:"required"`
	DeliveryInstructions string               `json:"delivery_instructions"`
	DeliveryFee          float64              `json:"delivery_fee"`
	Lat                  float64              `json:"lat"`
	Lng                  float64              `json:"lng"`
}

// ─────────────────────────────────────────────
// CreateOrder
// ─────────────────────────────────────────────

func CreateOrder(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req CreateOrderRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		if len(req.Items) == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Order must contain at least one item"})
			return
		}

		userID := c.GetString("user_id")
		userUUID, err := uuid.Parse(userID)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid user id"})
			return
		}

		storeUUID, err := uuid.Parse(req.StoreID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid store id"})
			return
		}

		deliveryFee := req.DeliveryFee
		if deliveryFee <= 0 {
			deliveryFee = 3.5
		}

		subtotal := 0.0
		for _, item := range req.Items {
			subtotal += float64(item.Quantity) * item.UnitPrice
		}

		total := subtotal + deliveryFee
		order := models.Order{
			UserID:                userUUID,
			StoreID:               storeUUID,
			Status:                models.OrderPaymentPending,
			Subtotal:              subtotal,
			DeliveryFee:           deliveryFee,
			TotalAmount:           total,
			DeliveryAddress:       req.DeliveryAddress,
			DeliveryInstructions:  req.DeliveryInstructions,
			DeliveryLat:           req.Lat,
			DeliveryLng:           req.Lng,
			EstimatedPrepMins:     20,
			EstimatedDeliveryMins: 30,
			CreatedAt:             time.Now(),
			UpdatedAt:             time.Now(),
		}

		err = db.Transaction(func(tx *gorm.DB) error {
			if err := tx.Create(&order).Error; err != nil {
				return err
			}
			for _, item := range req.Items {
				productUUID, err := uuid.Parse(item.ProductID)
				if err != nil {
					return err
				}
				// Fetch product to get ImageURL
				var product models.Product
				if err := tx.Where("id = ?", productUUID).First(&product).Error; err != nil {
					// If product not found, or error, log it and proceed without image URL
					return err // Or handle this error more gracefully, e.g., assign a default image URL
				}

				orderItem := models.OrderItem{
					OrderID:     order.ID,
					ProductID:   productUUID,
					Name:        item.Name,
					Quantity:    item.Quantity,
					UnitPrice:   item.UnitPrice,
					SpecialNote: item.SpecialNote,
					ImageURL:    product.ImageURL, // Assign ImageURL from product
				}
				if err := tx.Create(&orderItem).Error; err != nil {
					return err
				}
			}
			return nil
		})

		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to complete order creation"})
			return
		}

		c.JSON(http.StatusCreated, gin.H{
			"order_id":     order.ID.String(),
			"status":       order.Status,
			"total_amount": order.TotalAmount,
			"delivery_fee": order.DeliveryFee,
		})
	}
}

// CreateCategory handles adding a new category from the admin panel
func CreateCategory(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			Name      string `json:"name" binding:"required"`
			Slug      string `json:"slug" binding:"required"`
			ImageURL  string `json:"image_url"`
			SortOrder int16  `json:"sort_order"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		category := models.Category{
			Name:      req.Name,
			Slug:      req.Slug,
			ImageURL:  req.ImageURL,
			SortOrder: req.SortOrder,
			IsActive:  true,
		}

		if err := db.Create(&category).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create category"})
			return
		}
		c.JSON(http.StatusCreated, category)
	}
}

// ─────────────────────────────────────────────
// ListCategories
// ─────────────────────────────────────────────

func ListCategories(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var categories []models.Category
		if err := db.Where("is_active = ?", true).Order("sort_order asc").Find(&categories).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch categories"})
			return
		}

		for i := range categories {
			categories[i].ImageURL = getFullImageURL(categories[i].ImageURL)
		}
		c.JSON(http.StatusOK, categories)
	}
}

// ─────────────────────────────────────────────
// ListStores
// ─────────────────────────────────────────────

func ListStores(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		categoryID := c.Query("category_id")
		stores := []models.Store{}

		query := db.Model(&models.Store{}).Preload("Category").Where("status = ?", models.StoreActive)
		if categoryID != "" {
			query = query.Where("category_id = ?", categoryID)
		}

		if err := query.Order("name asc").Find(&stores).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch stores"})
			return
		}

		for i := range stores {
			stores[i].LogoURL = getFullImageURL(stores[i].LogoURL)
			stores[i].CoverImageURL = getFullImageURL(stores[i].CoverImageURL)
		}
		c.JSON(http.StatusOK, stores)
	}
}

// ─────────────────────────────────────────────
// GetStore
// ─────────────────────────────────────────────

func GetStore(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		storeUUID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid store id"})
			return
		}

		var store models.Store
		if err := db.Preload("Category").Where("id = ?", storeUUID).First(&store).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				c.JSON(http.StatusNotFound, gin.H{"error": "Store not found"})
			} else {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Database error"})
			}
			return
		}

		holiday := pricing.ForStore(db, store.Country, time.Now())

		c.JSON(http.StatusOK, gin.H{
			"id":                    store.ID,
			"owner_user_id":         store.OwnerUserID,
			"name":                  store.Name,
			"description":           store.Description,
			"address":               store.Address,
			"city":                  store.City,
			"country":               store.Country,
			"phone_number":          store.PhoneNumber,
			"email":                 store.Email,
			"logo_url":              getFullImageURL(store.LogoURL),
			"cover_image_url":       getFullImageURL(store.CoverImageURL),
			"rating":                store.Rating,
			"total_reviews":         store.TotalReviews,
			"is_open":               store.IsOpen,
			"delivery_fee":          store.DeliveryFee,
			"min_order_amount":      store.MinOrderAmount,
			"avg_processing_time":   store.AvgProcessingTime,
			"category":              store.Category,
			"category_id":           store.CategoryID,
			"holiday_pricing":       holiday.Active,
			"holiday_name":          holiday.HolidayName,
			"holiday_surcharge_pct": holiday.SurchargePct,
		})
	}
}

// ─────────────────────────────────────────────
// GetProducts
// ─────────────────────────────────────────────

func GetProducts(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		storeUUID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid store id"})
			return
		}

		var store models.Store
		db.Select("id, country").Where("id = ?", storeUUID).First(&store)
		holiday := pricing.ForStore(db, store.Country, time.Now())

		products := []models.Product{}
		if err := db.Where("store_id = ? AND is_available = ?", storeUUID, true).
			Order("sort_order asc").Find(&products).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch products"})
			return
		}

		response := make([]gin.H, 0, len(products))
		for _, p := range products {
			price := p.BasePrice
			if holiday.Active {
				price = pricing.Round2(p.BasePrice * holiday.Multiplier)
			}
			response = append(response, gin.H{
				"id":                    p.ID.String(),
				"store_id":              p.StoreID.String(),
				"name":                  p.Name,
				"description":           p.Description,
				"base_price":            price,
				"original_price":        p.BasePrice,
				"holiday_pricing":       holiday.Active,
				"holiday_name":          holiday.HolidayName,
				"holiday_surcharge_pct": holiday.SurchargePct,
				"image_url":             getFullImageURL(p.ImageURL),
				"is_available":          p.IsAvailable,
				"category_id":           p.CategoryID,
				"sort_order":            p.SortOrder,
				"created_at":            p.CreatedAt,
				"updated_at":            p.UpdatedAt,
			})
		}

		c.JSON(http.StatusOK, response)
	}
}

// GetProductsByCategory returns all available products belonging to stores in a given category.
// Uses two model-based queries instead of a raw JOIN to avoid pgx UUID/enum type binding issues.
func GetProductsByCategory(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		categoryUUID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid category id"})
			return
		}

		// Step 1: get all active store IDs in this category
		var storeIDs []uuid.UUID
		if err := db.Model(&models.Store{}).
			Where("category_id = ? AND status = ?", categoryUUID, models.StoreActive).
			Pluck("id", &storeIDs).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch stores"})
			return
		}

		if len(storeIDs) == 0 {
			c.JSON(http.StatusOK, []gin.H{})
			return
		}

		// Step 2: get available products from those stores
		var products []models.Product
		if err := db.Where("store_id IN ? AND is_available = ?", storeIDs, true).
			Order("sort_order asc, created_at desc").
			Find(&products).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch products"})
			return
		}

		// Build store name/logo lookup
		var stores []models.Store
		db.Select("id, name, logo_url, country").Where("id IN ?", storeIDs).Find(&stores)
		storeMap := make(map[uuid.UUID]models.Store)
		for _, s := range stores {
			storeMap[s.ID] = s
		}

		// One holiday lookup per distinct country, not per product.
		holidayByCountry := make(map[string]pricing.Status)
		now := time.Now()

		response := make([]gin.H, 0, len(products))
		for _, p := range products {
			s := storeMap[p.StoreID]
			holiday, ok := holidayByCountry[s.Country]
			if !ok {
				holiday = pricing.ForStore(db, s.Country, now)
				holidayByCountry[s.Country] = holiday
			}

			price := p.BasePrice
			if holiday.Active {
				price = pricing.Round2(p.BasePrice * holiday.Multiplier)
			}

			response = append(response, gin.H{
				"id":                    p.ID.String(),
				"name":                  p.Name,
				"description":           p.Description,
				"base_price":            price,
				"original_price":        p.BasePrice,
				"holiday_pricing":       holiday.Active,
				"holiday_name":          holiday.HolidayName,
				"holiday_surcharge_pct": holiday.SurchargePct,
				"image_url":             getFullImageURL(p.ImageURL),
				"store_id":              p.StoreID.String(),
				"store_name":            s.Name,
				"store_logo":            getFullImageURL(s.LogoURL),
			})
		}

		c.JSON(http.StatusOK, response)
	}
}

// ─────────────────────────────────────────────
// ListOrders
// ─────────────────────────────────────────────

func ListOrders(db, accountDB *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userUUID, err := uuid.Parse(c.GetString("user_id"))
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid user id"})
			return
		}

		var orders []models.Order
		if err := db.Preload("Items").
			Where("user_id = ? AND customer_hidden_at IS NULL", userUUID).
			Order("created_at desc").Find(&orders).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch orders"})
			return
		}

		// Collect IDs for batch fetching
		driverIDs := make([]uuid.UUID, 0)
		orderIDs := make([]uuid.UUID, 0)
		for _, o := range orders {
			orderIDs = append(orderIDs, o.ID)
			if o.DriverUserID != nil {
				driverIDs = append(driverIDs, *o.DriverUserID)
			}
		}

		// Fetch delivery tracking records for these orders
		deliveryMap := make(map[uuid.UUID]uuid.UUID)
		if len(orderIDs) > 0 {
			var deliveries []models.OrderDelivery
			db.Select("id, order_id").Where("order_id IN ?", orderIDs).Find(&deliveries)
			for _, d := range deliveries {
				deliveryMap[d.OrderID] = d.ID
			}
		}

		// Hydrate Driver Names/Phones from Account DB
		driverMap := make(map[uuid.UUID]models.User)
		if len(driverIDs) > 0 {
			var drivers []models.User
			accountDB.Select("id, full_name, phone_number, profile_image_url").Where("id IN ?", driverIDs).Find(&drivers)
			for _, d := range drivers {
				driverMap[d.ID] = d
			}
		}

		response := make([]gin.H, 0, len(orders))
		for _, order := range orders {
			var store models.Store
			db.Select("name", "logo_url").Where("id = ?", order.StoreID).First(&store)

			dName, dPhone, dProfileImage := "", "", ""
			if order.DriverUserID != nil {
				dr := driverMap[*order.DriverUserID]
				dName, dPhone = dr.FullName, dr.PhoneNumber
				dProfileImage = getFullImageURL(dr.ProfileImageURL)
			}

			items := make([]gin.H, 0, len(order.Items))
			for _, item := range order.Items {
				items = append(items, gin.H{
					"id":           item.ID.String(),
					"product_id":   item.ProductID.String(),
					"name":         item.Name,
					"quantity":     item.Quantity,
					"unit_price":   item.UnitPrice,
					"special_note": item.SpecialNote,
					"options":      item.Options,
					"image_url":    getFullImageURL(item.ImageURL),
				})
			}

			deliveryInfo := gin.H{}
			if dID, ok := deliveryMap[order.ID]; ok {
				deliveryInfo = gin.H{"id": dID.String()}
			}

			response = append(response, gin.H{
				"order_id":             order.ID.String(),
				"status":               order.Status,
				"total_amount":         order.TotalAmount,
				"delivery_fee":         order.DeliveryFee,
				"created_at":           order.CreatedAt,
				"delivery_address":     order.DeliveryAddress,
				"driver_name":          dName,
				"driver_phone":         dPhone,
				"driver_profile_image": dProfileImage,
				"estimated_prep_mins":  order.EstimatedPrepMins,
				"accepted_at":          order.AcceptedAt,
				"ready_at":             order.ReadyAt,
				"store": gin.H{
					"name":     store.Name,
					"logo_url": getFullImageURL(store.LogoURL),
				},
				"items":    items,
				"delivery": deliveryInfo,
			})
		}

		c.JSON(http.StatusOK, response)
	}
}

// ─────────────────────────────────────────────
// GetOrder
// ─────────────────────────────────────────────

func GetOrder(db, accountDB *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		orderUUID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid order id"})
			return
		}

		userUUID, err := uuid.Parse(c.GetString("user_id"))
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid user id"})
			return
		}

		var order models.Order
		if err := db.Preload("Items").
			Where("id = ? AND user_id = ?", orderUUID, userUUID).
			First(&order).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Order not found"})
			return
		}

		var store models.Store
		db.Select("name", "logo_url").Where("id = ?", order.StoreID).First(&store)

		// Hydrate Driver Info
		var driver models.User
		if order.DriverUserID != nil {
			accountDB.Select("full_name, phone_number, profile_image_url").Where("id = ?", order.DriverUserID).First(&driver)
		}

		// Fetch Shopper-specific delivery info
		deliveryResponse := gin.H{}
		var delivery models.OrderDelivery
		if err := db.Where("order_id = ?", order.ID).First(&delivery).Error; err == nil {
			deliveryResponse = gin.H{
				"id":                   delivery.ID,
				"delivery_status":      delivery.Status,
				"vehicle_latitude":     delivery.CurrentLat,
				"vehicle_longitude":    delivery.CurrentLng,
				"driver_name":          driver.FullName,
				"driver_phone":         driver.PhoneNumber,
				"driver_profile_image": getFullImageURL(driver.ProfileImageURL),
				"customer_rating":      delivery.CustomerRating,
			}
		}

		items := make([]gin.H, 0, len(order.Items))
		for _, item := range order.Items {
			items = append(items, gin.H{
				"id":           item.ID.String(),
				"product_id":   item.ProductID.String(),
				"name":         item.Name,
				"quantity":     item.Quantity,
				"unit_price":   item.UnitPrice,
				"special_note": item.SpecialNote,
				"options":      item.Options,
				"image_url":    getFullImageURL(item.ImageURL),
			})
		}

		c.JSON(http.StatusOK, gin.H{
			"order_id":              order.ID.String(),
			"status":                order.Status,
			"subtotal":              order.Subtotal,
			"delivery_fee":          order.DeliveryFee,
			"total_amount":          order.TotalAmount,
			"delivery_address":      order.DeliveryAddress,
			"delivery_instructions": order.DeliveryInstructions,
			"delivery_lat":          order.DeliveryLat,
			"delivery_lng":          order.DeliveryLng,
			"created_at":            order.CreatedAt,
			"paystack_reference":    order.PaystackReference,
			"estimated_prep_mins":   order.EstimatedPrepMins,
			"accepted_at":           order.AcceptedAt,
			"ready_at":              order.ReadyAt,
			"store": gin.H{
				"name":     store.Name,
				"logo_url": getFullImageURL(store.LogoURL),
			},
			"items":    items,
			"delivery": deliveryResponse,
		})
	}
}

// ─────────────────────────────────────────────
// GetDeliveryFee
// Base: GHS 15 (first 3 km free)
// Distance: GHS 2 per km beyond 3 km
// Late evening 18:00–21:59 UTC: +GHS 3
// Night 22:00–05:59 UTC: +GHS 7
// ─────────────────────────────────────────────

func GetDeliveryFee(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		const (
			baseFee          = 15.0
			freeKm           = 3.0
			ratePerKm        = 2.0
			eveningSurcharge = 3.0
			nightSurcharge   = 7.0
		)

		hour := time.Now().UTC().Hour()

		var timeFee float64
		var timeLabel string
		switch {
		case hour >= 22 || hour < 6:
			timeFee = nightSurcharge
			timeLabel = "Night surcharge (10PM–6AM)"
		case hour >= 18:
			timeFee = eveningSurcharge
			timeLabel = "Late evening surcharge (6PM–10PM)"
		}

		customerLat, _ := strconv.ParseFloat(c.Query("lat"), 64)
		customerLng, _ := strconv.ParseFloat(c.Query("lng"), 64)
		storeIDStr := c.Query("store_id")

		var distanceFee, distanceKm float64
		hasDistance := false
		var storeCountry string

		if storeIDStr != "" {
			if storeUUID, err := uuid.Parse(storeIDStr); err == nil {
				var store models.Store
				if err := db.Select("lat, lng, country").First(&store, "id = ?", storeUUID).Error; err == nil {
					storeCountry = store.Country
					if (store.Lat != 0 || store.Lng != 0) && (customerLat != 0 || customerLng != 0) {
						distanceKm = haversineKm(customerLat, customerLng, store.Lat, store.Lng)
						hasDistance = true
						if distanceKm > freeKm {
							distanceFee = (distanceKm - freeKm) * ratePerKm
						}
					}
				}
			}
		}

		subtotal := baseFee + timeFee + distanceFee

		holiday := pricing.ForStore(db, storeCountry, time.Now())
		var holidayFee float64
		if holiday.Active {
			holidayFee = pricing.Round2(subtotal * (holiday.Multiplier - 1))
		}

		totalFee := pricing.Round2(subtotal + holidayFee)

		parts := []string{fmt.Sprintf("Base: GHS %.2f", baseFee)}
		if hasDistance {
			parts = append(parts, fmt.Sprintf("Distance (%.1f km): GHS %.2f", distanceKm, distanceFee))
		}
		if timeFee > 0 {
			parts = append(parts, fmt.Sprintf("%s: GHS %.2f", timeLabel, timeFee))
		}
		if holiday.Active {
			parts = append(parts, fmt.Sprintf("Holiday surcharge +%.0f%% (%s): GHS %.2f", holiday.SurchargePct, holiday.HolidayName, holidayFee))
		}

		reason := "Standard delivery"
		switch {
		case timeFee > 0 && distanceFee > 0:
			reason = fmt.Sprintf("%.1f km away + %s", math.Round(distanceKm*10)/10, strings.ToLower(timeLabel))
		case timeFee > 0:
			reason = timeLabel
		case distanceFee > 0:
			reason = fmt.Sprintf("Distance-based (%.1f km)", math.Round(distanceKm*10)/10)
		}
		if holiday.Active {
			if reason == "Standard delivery" {
				reason = fmt.Sprintf("Holiday pricing (%s)", holiday.HolidayName)
			} else {
				reason = fmt.Sprintf("%s + holiday pricing (%s)", reason, holiday.HolidayName)
			}
		}

		resp := gin.H{
			"fee":                   totalFee,
			"reason":                reason,
			"breakdown":             strings.Join(parts, " | "),
			"holiday_pricing":       holiday.Active,
			"holiday_name":          holiday.HolidayName,
			"holiday_surcharge_pct": holiday.SurchargePct,
		}
		if hasDistance {
			resp["distance_km"] = math.Round(distanceKm*10) / 10
		}
		c.JSON(http.StatusOK, resp)
	}
}

func haversineKm(lat1, lng1, lat2, lng2 float64) float64 {
	const R = 6371.0
	dLat := (lat2 - lat1) * math.Pi / 180.0
	dLng := (lng2 - lng1) * math.Pi / 180.0
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1*math.Pi/180.0)*math.Cos(lat2*math.Pi/180.0)*
			math.Sin(dLng/2)*math.Sin(dLng/2)
	return R * 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
}

// ─────────────────────────────────────────────
// RefundOrder
// Allowed only when status == payment_confirmed (before store starts preparing).
// Calls Paystack refund API then marks order + payment as refunded.
// ─────────────────────────────────────────────

func RefundOrder(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		orderUUID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid order id"})
			return
		}

		userUUID, _ := uuid.Parse(c.GetString("user_id"))

		var order models.Order
		if err := db.Where("id = ? AND user_id = ?", orderUUID, userUUID).First(&order).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Order not found"})
			return
		}

		if order.Status != models.OrderPaymentConfirmed {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Refund is only available for paid orders that have not yet started being prepared"})
			return
		}

		if order.PaystackReference == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "No payment reference found for this order"})
			return
		}

		paystackSecret := os.Getenv("PAYSTACK_SECRET_KEY")
		if paystackSecret == "" {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Payment provider not configured"})
			return
		}

		payload, _ := json.Marshal(map[string]interface{}{
			"transaction": order.PaystackReference,
		})

		psReq, _ := http.NewRequest("POST", "https://api.paystack.co/refund", bytes.NewBuffer(payload))
		psReq.Header.Set("Authorization", "Bearer "+paystackSecret)
		psReq.Header.Set("Content-Type", "application/json")

		client := &http.Client{Timeout: 15 * time.Second}
		psResp, err := client.Do(psReq)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not reach payment provider"})
			return
		}
		defer psResp.Body.Close()

		var psResult struct {
			Status  bool   `json:"status"`
			Message string `json:"message"`
			Data    struct {
				Status string `json:"status"` // "pending", "processed", "failed"
			} `json:"data"`
		}
		body, _ := io.ReadAll(psResp.Body)
		if err := json.Unmarshal(body, &psResult); err != nil || !psResult.Status {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Refund request failed: " + psResult.Message})
			return
		}

		now := time.Now()
		if err := db.Model(&order).Updates(map[string]interface{}{
			"status":        models.OrderRefunded,
			"cancelled_at":  &now,
			"cancel_reason": "Customer requested refund",
			"updated_at":    now,
		}).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Refund initiated but failed to update order status"})
			return
		}

		db.Model(&models.Payment{}).Where("order_id = ?", order.ID).Updates(map[string]interface{}{
			"status":     models.PaymentRefunded,
			"updated_at": now,
		})

		c.JSON(http.StatusOK, gin.H{
			"message":       "Refund initiated successfully",
			"refund_status": psResult.Data.Status,
			"amount":        order.TotalAmount,
		})
	}
}

// ─────────────────────────────────────────────
// CancelOrder
// ─────────────────────────────────────────────

func CancelOrder(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		orderUUID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid order id"})
			return
		}

		userUUID, _ := uuid.Parse(c.GetString("user_id"))

		var order models.Order
		if err := db.Where("id = ? AND user_id = ?", orderUUID, userUUID).First(&order).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Order not found"})
			return
		}

		if order.Status != models.OrderPending && order.Status != models.OrderPaymentPending {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Order cannot be cancelled at this stage"})
			return
		}

		now := time.Now()
		order.Status = models.OrderCancelled
		order.CancelledAt = &now
		if err := db.Save(&order).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to cancel order"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"message": "Order cancelled successfully", "status": order.Status})
	}
}

// ─────────────────────────────────────────────
// DeleteOrder — customer hides a history order from their list
// Only terminal statuses (cancelled, refunded, failed) can be hidden.
// ─────────────────────────────────────────────

func DeleteOrder(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		orderUUID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid order id"})
			return
		}

		userUUID, _ := uuid.Parse(c.GetString("user_id"))

		var order models.Order
		if err := db.Where("id = ? AND user_id = ?", orderUUID, userUUID).First(&order).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Order not found"})
			return
		}

		if order.Status != models.OrderCancelled && order.Status != models.OrderRefunded {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Only cancelled or refunded orders can be deleted"})
			return
		}

		now := time.Now()
		if err := db.Model(&order).UpdateColumn("customer_hidden_at", &now).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete order"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"message": "Order removed from your history"})
	}
}

// ─────────────────────────────────────────────
// PayOrder
// accountDB is the accounts database — needed to look up the user's email
// for Paystack since the shopper DB doesn't store emails.
// In main.go update the route to: shopper.PayOrder(dbs.Shopper, dbs.Account)
// ─────────────────────────────────────────────

func PayOrder(db, accountDB *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		orderUUID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid order id"})
			return
		}

		userUUID, err := uuid.Parse(c.GetString("user_id"))
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid user id"})
			return
		}

		var order models.Order
		if err := db.Where("id = ? AND user_id = ?", orderUUID, userUUID).First(&order).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Order not found"})
			return
		}

		if order.Status != models.OrderPaymentPending && order.Status != models.OrderPending {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Order is not awaiting payment"})
			return
		}

		var req struct {
			PaymentMethod string `json:"payment_method" binding:"required,oneof=paystack sokopay"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		// Look up user email from the account DB
		var user models.User
		if err := accountDB.Select("email").Where("id = ?", order.UserID).First(&user).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve user information"})
			return
		}

		paystackSecret := os.Getenv("PAYSTACK_SECRET_KEY")
		if paystackSecret == "" {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Payment provider not configured"})
			return
		}

		reference := "SK-SHOP-" + uuid.New().String()
		amountPesewas := int(order.TotalAmount * 100) // GHS -> pesewas

		payload, _ := json.Marshal(map[string]interface{}{
			"email":     user.Email,
			"amount":    amountPesewas,
			"reference": reference,
			"currency":  "GHS",
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

		// Save reference before returning
		order.PaystackReference = reference
		if err := db.Save(&order).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save payment reference"})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"order_id":       order.ID.String(),
			"reference":      reference,
			"checkout_url":   psResult.Data.AuthorizationURL, // real Paystack checkout URL
			"payment_method": req.PaymentMethod,
		})
	}
}

// ─────────────────────────────────────────────
// VerifyOrderPayment
// Calls Paystack's verify API, updates order status to payment_confirmed,
// and returns the result to the frontend which auto-redirects to MyOrders.
// ─────────────────────────────────────────────

func VerifyOrderPayment(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		reference := c.Query("reference")
		orderID := c.Query("order_id")

		if reference == "" || orderID == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Missing reference or order_id"})
			return
		}

		orderUUID, err := uuid.Parse(orderID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid order id"})
			return
		}

		var order models.Order
		if err := db.Where("id = ? AND paystack_reference = ?", orderUUID, reference).First(&order).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Order reference not found"})
			return
		}

		// Call Paystack verify API
		paystackSecret := os.Getenv("PAYSTACK_SECRET_KEY")
		psReq, _ := http.NewRequest("GET",
			"https://api.paystack.co/transaction/verify/"+reference, nil)
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
				ID      int64   `json:"id"`      // Paystack Transaction ID
				Status  string  `json:"status"`  // "success", "failed", "abandoned"
				Amount  float64 `json:"amount"`  // in pesewas
				Channel string  `json:"channel"` // "mobile_money", "card", etc.
			} `json:"data"`
		}
		body, _ := io.ReadAll(psResp.Body)
		if err := json.Unmarshal(body, &psResult); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to parse payment provider response"})
			return
		}

		if psResult.Data.Status == "success" {
			// Update order status explicitly using Model.Updates.
			// This ensures the Postgres enum type 'order_status_enum' is updated correctly.
			now := time.Now()
			if err := db.Model(&order).Updates(map[string]interface{}{
				"status":      models.OrderPaymentConfirmed,
				"accepted_at": &now,
				"updated_at":  now,
			}).Error; err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{
					"error": "Payment verified but failed to update order status: " + err.Error(),
				})
				return
			}

			// Create/Update Payment record for the Store Dashboard to pull
			var existingPayment models.Payment
			if err := db.Where("paystack_reference = ?", reference).First(&existingPayment).Error; err == gorm.ErrRecordNotFound {
				payment := models.Payment{
					ID:                    uuid.New(),
					OrderID:               order.ID,
					Amount:                order.TotalAmount,
					Currency:              "GHS",
					Status:                models.PaymentSuccess,
					PaymentMethod:         psResult.Data.Channel,
					PaystackReference:     reference,
					PaystackTransactionID: fmt.Sprintf("%d", psResult.Data.ID),
					CreatedAt:             now,
					UpdatedAt:             now,
				}
				if err := db.Create(&payment).Error; err != nil {
					log.Printf("Warning: Failed to create payment record: %v", err)
				}
			}

			c.JSON(http.StatusOK, gin.H{
				"status":  "success",
				"amount":  psResult.Data.Amount / 100, // pesewas -> GHS
				"channel": psResult.Data.Channel,
			})
		} else {
			// Payment failed or was abandoned — do not update order status
			c.JSON(http.StatusOK, gin.H{
				"status":  psResult.Data.Status,
				"amount":  psResult.Data.Amount / 100,
				"channel": psResult.Data.Channel,
			})
		}
	}
}

// ─────────────────────────────────────────────
// ListStoreOrders
// Fetches orders for a specific store, including item and payment details.
// This handler is intended for store owners/admins.
// ─────────────────────────────────────────────

func ListStoreOrders(db, accountDB *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		storeUUID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid store ID"})
			return
		}

		// Authenticate and authorize the user as a store owner/admin
		// This part is crucial for security. Assuming user_id is set by JWTAuthMiddleware.
		userID := c.GetString("user_id")
		userUUID, err := uuid.Parse(userID)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid user ID"})
			return
		}

		// Verify that the authenticated user owns this store
		var store models.Store
		if err := db.Where("id = ? AND owner_user_id = ?", storeUUID, userUUID).First(&store).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				c.JSON(http.StatusForbidden, gin.H{"error": "You do not have permission to view orders for this store"})
			} else {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Database error"})
			}
			return
		}

		var orders []models.Order
		if err := db.Preload("Items").Where("store_id = ?", storeUUID).Order("created_at desc").Find(&orders).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch orders"})
			return
		}

		// Fetch payments for these orders
		orderIDs := make([]uuid.UUID, len(orders))
		for i, order := range orders {
			orderIDs[i] = order.ID
		}

		paymentsMapStr := make(map[string]models.Payment)
		if len(orderIDs) > 0 {
			var payments []models.Payment
			if err := db.Where("order_id IN ?", orderIDs).Find(&payments).Error; err != nil {
				log.Printf("Warning: Failed to fetch payments for orders: %v", err)
				// Continue without payment data if there's an error
			}
			for _, p := range payments {
				paymentsMapStr[p.OrderID.String()] = p
			}
		}

		// Fetch driver details (names)
		driverIDs := make([]uuid.UUID, 0)
		for _, order := range orders {
			if order.DriverUserID != nil {
				driverIDs = append(driverIDs, *order.DriverUserID)
			}
		}
		driversMapStr := make(map[string]string)
		if len(driverIDs) > 0 {
			var drivers []models.User
			if err := accountDB.Select("id, full_name").Where("id IN ?", driverIDs).Find(&drivers).Error; err != nil {
				log.Printf("Warning: Failed to fetch driver details: %v", err)
			}
			for _, d := range drivers {
				driversMapStr[d.ID.String()] = d.FullName
			}
		}

		responseOrders := make([]gin.H, 0, len(orders))
		for _, order := range orders {
			items := make([]gin.H, 0, len(order.Items))
			for _, item := range order.Items {
				items = append(items, gin.H{
					"id":           item.ID.String(),
					"product_id":   item.ProductID.String(),
					"name":         item.Name,
					"quantity":     item.Quantity,
					"unit_price":   item.UnitPrice,
					"special_note": item.SpecialNote,
					"options":      item.Options,
					"image_url":    getFullImageURL(item.ImageURL),
				})
			}

			dID := ""
			if order.DriverUserID != nil {
				dID = order.DriverUserID.String()
			}

			responseOrders = append(responseOrders, orderToMap(order, paymentsMapStr[order.ID.String()], driversMapStr[dID], items))
		}

		c.JSON(http.StatusOK, gin.H{"orders": responseOrders, "payments_map": paymentsMapStr, "drivers_map": driversMapStr})
	}
}

// AssignOrder (Admin) links a driver to an order and creates the tracking record.
func AssignOrder(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		orderUUID, _ := uuid.Parse(c.Param("id"))
		var req struct {
			DriverID string `json:"driver_id" binding:"required,uuid"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid driver ID"})
			return
		}
		driverUUID, _ := uuid.Parse(req.DriverID)

		err := db.Transaction(func(tx *gorm.DB) error {
			// 1. Update main Order record
			if err := tx.Model(&models.Order{}).Where("id = ?", orderUUID).Updates(map[string]interface{}{
				"driver_user_id": &driverUUID,
				"status":         models.OrderAssignedToDriver,
			}).Error; err != nil {
				return err
			}

			// 2. Create the OrderDelivery tracking record used by ListDriverOrderDeliveries
			delivery := models.OrderDelivery{
				ID:        uuid.New(),
				OrderID:   orderUUID,
				DriverID:  &driverUUID,
				Status:    "assigned",
				CreatedAt: time.Now(),
				UpdatedAt: time.Now(),
			}
			return tx.Create(&delivery).Error
		})

		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to assign driver: " + err.Error()})
			return
		}

		c.JSON(http.StatusOK, gin.H{"message": "Driver assigned successfully"})
	}
}

// ─────────────────────────────────────────────
// GetOrderTracking
// ─────────────────────────────────────────────

func GetOrderTracking(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		orderUUID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid order id"})
			return
		}

		// Fetch the tracking record. This is the "standalone" source for the Shopper app.
		var delivery models.OrderDelivery
		if err := db.Where("order_id = ?", orderUUID).First(&delivery).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Tracking information not found"})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"order_id":          delivery.OrderID,
			"delivery_status":   delivery.Status,
			"vehicle_latitude":  delivery.CurrentLat,
			"vehicle_longitude": delivery.CurrentLng,
			"customer_rating":   delivery.CustomerRating,
			"updated_at":        delivery.UpdatedAt,
		})
	}
}

// ─────────────────────────────────────────────
// UpdateOrderTracking
// ─────────────────────────────────────────────

func UpdateOrderTracking(db *gorm.DB, hub *ws.Hub) gin.HandlerFunc {
	return func(c *gin.Context) {
		orderUUID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid order id"})
			return
		}

		var req struct {
			Status string  `json:"status"`
			Lat    float64 `json:"lat"`
			Lng    float64 `json:"lng"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		err = db.Transaction(func(tx *gorm.DB) error {
			now := time.Now()
			updates := map[string]interface{}{
				"updated_at": now,
			}
			if req.Status != "" {
				updates["status"] = req.Status
			}
			if req.Lat != 0 {
				updates["current_lat"] = req.Lat
			}
			if req.Lng != 0 {
				updates["current_lng"] = req.Lng
			}

			// 1. Update standalone OrderDelivery tracking record
			if err := tx.Model(&models.OrderDelivery{}).Where("order_id = ?", orderUUID).Updates(updates).Error; err != nil {
				return err
			}

			// 2. Synchronize main Order status and timestamps
			if req.Status != "" {
				orderStatus := models.OrderStatus(req.Status)

				// Map tracking statuses to main Order statuses
				switch req.Status {
				case "assigned":
					orderStatus = models.OrderAssignedToDriver
				case "picked_up":
					orderStatus = models.OrderPickedUp
					tx.Model(&models.Order{}).Where("id = ?", orderUUID).Updates(map[string]interface{}{
						"picked_up_at": &now,
					})
					tx.Model(&models.OrderDelivery{}).Where("order_id = ?", orderUUID).Update("picked_up_at", &now)
				case "in_transit":
					orderStatus = models.OrderInTransit
				}

				if err := tx.Model(&models.Order{}).Where("id = ?", orderUUID).Update("status", orderStatus).Error; err != nil {
					return err
				}
			}
			return nil
		})

		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update tracking and order status"})
			return
		}

		// Notify the customer via WebSocket
		if req.Status != "" {
			go func() {
				var order models.Order
				if err := db.Select("user_id").First(&order, "id = ?", orderUUID).Error; err != nil {
					return
				}
				hub.Send(order.UserID.String(), "order_status", map[string]any{
					"order_id": orderUUID.String(),
					"status":   req.Status,
					"lat":      req.Lat,
					"lng":      req.Lng,
				})
			}()
		}

		c.JSON(http.StatusOK, gin.H{"message": "Tracking and order status synced successfully"})
	}
}

// ─────────────────────────────────────────────
// ListDriverOrderDeliveries (For Shopper DB)
// ─────────────────────────────────────────────

func ListDriverOrderDeliveries(db, accountDB *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		driverID, _ := uuid.Parse(c.GetString("user_id"))

		var deliveries []models.OrderDelivery
		// Ensure we are searching for assignments specifically for this driver
		if err := db.Preload("Order").Preload("Order.Items").
			Where("driver_id = ?", driverID).
			Order("created_at desc").Find(&deliveries).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch order deliveries"})
			return
		}

		response := make([]gin.H, 0, len(deliveries))
		for _, d := range deliveries {
			var store models.Store
			// Correctly fetch the store associated with the order
			db.Select("id, name, address, logo_url").Where("id = ?", d.Order.StoreID).First(&store)

			response = append(response, gin.H{
				"id":               d.ID.String(),
				"order_id":         d.OrderID.String(),
				"delivery_status":  d.Status,
				"delivery_address": d.Order.DeliveryAddress,
				"source":           "shopper",
				"created_at":       d.CreatedAt,
				"updated_at":       d.UpdatedAt,  // used by mobile timer as assignment reference
				"driver_assigned_at": d.Order.DriverAssignedAt, // set by admin at assignment
				// Raw delivery fee + the driver's 60% cut of it — the mobile app must never
				// show the driver the full delivery fee as their own earnings.
				"delivery_fee":    d.Order.DeliveryFee,
				"driver_earnings": d.Order.DeliveryFee * 0.6,
				"order": gin.H{
					"id":             d.Order.ID,
					"restaurant":     store.Name,
					"pickup_address": store.Address,
					"total_amount":   d.Order.TotalAmount,
					"items_count":    len(d.Order.Items),
				},
			})
		}

		c.JSON(http.StatusOK, gin.H{"data": response})
	}
}

// ─────────────────────────────────────────────
// GetOrderDeliveryDetail (For Shopper DB)
// ─────────────────────────────────────────────

func GetOrderDeliveryDetail(db, accountDB *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		deliveryID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid delivery ID"})
			return
		}

		var d models.OrderDelivery
		if err := db.Preload("Order").Preload("Order.Items").Where("id = ?", deliveryID).First(&d).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Delivery assignment not found"})
			return
		}

		var store models.Store
		db.Where("id = ?", d.Order.StoreID).First(&store)

		var customer models.User
		accountDB.Select("full_name, phone_number").Where("id = ?", d.Order.UserID).First(&customer)

		items := make([]gin.H, 0, len(d.Order.Items))
		for _, item := range d.Order.Items {
			items = append(items, gin.H{
				"name":     item.Name,
				"quantity": item.Quantity,
				"price":    item.UnitPrice,
				"subtotal": float64(item.Quantity) * item.UnitPrice,
			})
		}

		c.JSON(http.StatusOK, gin.H{
			"data": gin.H{
				"id":               d.ID,
				"order_id":         d.OrderID.String(), // needed by mobile to call updateOrderTracking
				"delivery_status":  d.Status,
				"delivery_address": d.Order.DeliveryAddress,
				"source":           "shopper",
				// Customer's own GPS pin captured at checkout — lets the driver's
				// map show where to actually go, not just a text address.
				"user_latitude":  d.Order.DeliveryLat,
				"user_longitude": d.Order.DeliveryLng,
				// Raw delivery fee + the driver's 60% cut of it — the mobile app must never
				// show the driver the full delivery fee as their own earnings.
				"delivery_fee":    d.Order.DeliveryFee,
				"driver_earnings": d.Order.DeliveryFee * 0.6,
				"order": gin.H{
					"id":             d.Order.ID,
					"restaurant":     store.Name,
					"total_amount":   d.Order.TotalAmount,
					"customer_name":  customer.FullName,
					"customer_phone": customer.PhoneNumber,
					"items":          items,
				},
			},
		})
	}
}

// ─────────────────────────────────────────────
// OTP Handlers for Shopper Domain
// ─────────────────────────────────────────────

func GenerateOrderOTP(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		deliveryID, _ := uuid.Parse(c.Param("id"))
		otp := fmt.Sprintf("%04d", time.Now().UnixNano()%10000)

		if err := db.Model(&models.OrderDelivery{}).Where("id = ?", deliveryID).Update("otp", otp).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate OTP"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"otp": otp, "expires_in": 300})
	}
}

func VerifyOrderOTP(db, accountDB *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		deliveryID, _ := uuid.Parse(c.Param("id"))
		var req struct {
			OTP string `json:"otp" binding:"required"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "OTP is required"})
			return
		}

		var d models.OrderDelivery
		if err := db.Where("id = ? AND otp = ?", deliveryID, req.OTP).First(&d).Error; err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid OTP code"})
			return
		}

		// Update status to delivered in both tables
		now := time.Now()
		db.Transaction(func(tx *gorm.DB) error {
			tx.Model(&models.OrderDelivery{}).Where("id = ?", deliveryID).Updates(map[string]interface{}{
				"status": "delivered", "delivered_at": &now,
			})
			tx.Model(&models.Order{}).Where("id = ?", d.OrderID).Updates(map[string]interface{}{
				"status": models.OrderDelivered, "delivered_at": &now,
			})
			return nil
		})

		// Driver is free again — mark available (stays online if location sharing is on)
		if d.DriverID != nil {
			accountDB.Model(&models.DriverProfile{}).Where("user_id = ?", d.DriverID).
				Update("is_available", true)
		}

		c.JSON(http.StatusOK, gin.H{"verified": true, "message": "Delivery confirmed"})
	}
}

func GetOrderOTP(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		orderID, _ := uuid.Parse(c.Param("id"))
		var d models.OrderDelivery
		if err := db.Where("order_id = ?", orderID).First(&d).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Delivery not found"})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"otp":      d.OTP,
			"verified": d.Status == "delivered",
		})
	}
}

// RateOrderDelivery lets the customer rate their driver after a completed shopper order delivery.
func RateOrderDelivery(db, accountDB *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		orderID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid order ID"})
			return
		}
		callerUUID, err := uuid.Parse(c.GetString("user_id"))
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid user id"})
			return
		}

		var req struct {
			Rating int    `json:"rating" binding:"required,min=1,max=5"`
			Review string `json:"review"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "rating must be between 1 and 5"})
			return
		}

		// Caller must own the order and it must be delivered
		var order models.Order
		if err := db.Where("id = ? AND user_id = ? AND status = ?", orderID, callerUUID, models.OrderDelivered).First(&order).Error; err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "order not found or not yet delivered"})
			return
		}

		var orderDelivery models.OrderDelivery
		if err := db.Where("order_id = ?", orderID).First(&orderDelivery).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "delivery record not found"})
			return
		}

		if orderDelivery.CustomerRating > 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "you have already rated this delivery"})
			return
		}

		now := time.Now()
		if err := db.Model(&models.OrderDelivery{}).Where("id = ?", orderDelivery.ID).Updates(map[string]any{
			"customer_rating": req.Rating,
			"customer_review": req.Review,
			"rated_at":        &now,
		}).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save rating"})
			return
		}

		// Recalculate driver's average rating on DriverProfile
		if orderDelivery.DriverID != nil {
			var profile models.DriverProfile
			if accountDB.Where("user_id = ?", *orderDelivery.DriverID).First(&profile).Error == nil {
				total := profile.TotalRatings
				newAvg := (profile.Rating*float64(total) + float64(req.Rating)) / float64(total+1)
				accountDB.Model(&models.DriverProfile{}).Where("user_id = ?", *orderDelivery.DriverID).Updates(map[string]any{
					"rating":        math.Round(newAvg*100) / 100,
					"total_ratings": total + 1,
				})
			}
		}

		c.JSON(http.StatusOK, gin.H{"message": "rating submitted", "rating": req.Rating})
	}
}

// FileOrderComplaint lets a customer report an issue with the driver on one
// of their shopper orders. Unlike RateOrderDelivery this doesn't require the
// order to be delivered yet — a customer may need to report a problem while
// the delivery is still in progress. Writes into deliveryDB (sokodelivery)
// despite living in the shopper package — same cross-DB-write precedent
// RateOrderDelivery already sets by writing into accountDB.
func FileOrderComplaint(db, deliveryDB *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		orderID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid order ID"})
			return
		}
		callerUUID, err := uuid.Parse(c.GetString("user_id"))
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid user id"})
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

		var order models.Order
		if err := db.Where("id = ? AND user_id = ?", orderID, callerUUID).First(&order).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "order not found"})
			return
		}

		var orderDelivery models.OrderDelivery
		if err := db.Where("order_id = ?", orderID).First(&orderDelivery).Error; err != nil || orderDelivery.DriverID == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "no driver has been assigned to this order yet"})
			return
		}

		complaint := models.DriverComplaint{
			OrderID:           orderID,
			OrderSource:       models.SourceShopper,
			ComplainantUserID: callerUUID,
			AgainstDriverID:   *orderDelivery.DriverID,
			Category:          req.Category,
			Description:       req.Description,
			Status:            models.DriverComplaintOpen,
			CreatedAt:         time.Now(),
		}
		if err := deliveryDB.Create(&complaint).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to file complaint"})
			return
		}

		c.JSON(http.StatusCreated, gin.H{"message": "Complaint filed, our team will review it", "complaint": complaint})
	}
}

// UploadMedia handles generic file uploads to MinIO/S3 buckets.
func UploadMedia(store *storage.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		file, err := c.FormFile("file")
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "No file uploaded (use form field 'file')"})
			return
		}

		// Validate extension
		ext := strings.ToLower(filepath.Ext(file.Filename))
		if ext != ".jpg" && ext != ".jpeg" && ext != ".png" && ext != ".webp" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid file type. Only JPG, JPEG, PNG, and WEBP are allowed."})
			return
		}

		bucket := c.DefaultPostForm("bucket", "general")
		url, err := store.UploadFile(file, bucket)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to upload image: " + err.Error()})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"url":    getFullImageURL(url), // Full URL for immediate UI preview
			"path":   url,                  // Relative path (e.g. "bucket/file.jpg") to be saved in DB
			"bucket": bucket,
		})
	}
}

func getFullImageURL(path string) string {
	if path == "" {
		return ""
	}

	// If the path already contains our media serve endpoint (likely an old absolute URL),
	// extract just the relative part so we can rebuild it with the current IP/Domain.
	mediaEndpoint := "/api/v1/media/serve/"
	if strings.Contains(path, mediaEndpoint) {
		parts := strings.Split(path, mediaEndpoint)
		path = parts[len(parts)-1]
	} else if strings.HasPrefix(path, "http") {
		// It's an external URL (like a placeholder or CDN), return as is.
		return path
	}

	// Get base URL from env, ensuring no trailing slash
	apiBaseURL := strings.TrimRight(os.Getenv("API_BASE_URL"), "/")
	if apiBaseURL == "" {
		apiBaseURL = "http://127.0.0.1:8082" // Safe fallback
	}

	// Ensure there is exactly one slash between the endpoint and the path
	if len(path) > 0 && path[0] != '/' {
		path = "/" + path
	}

	// Ensure spaces are encoded for mobile compatibility
	// We only encode spaces to avoid breaking the bucket/filename structure
	encodedPath := strings.ReplaceAll(path, " ", "%20")
	return apiBaseURL + mediaEndpoint + strings.TrimPrefix(encodedPath, "/")
}

// Helper function to convert an Order model to a map for JSON response,
// including associated payment and driver details.
func orderToMap(order models.Order, payment models.Payment, driverName string, items []gin.H) gin.H {
	orderPayment := gin.H{}
	if payment.ID != uuid.Nil { // Check if a payment record was found
		orderPayment = gin.H{
			"id":                      payment.ID.String(),
			"status":                  payment.Status,
			"paystack_reference":      payment.PaystackReference,
			"paystack_transaction_id": payment.PaystackTransactionID,
		}
	} else if order.PaystackReference != "" { // Fallback to order's own reference if no separate payment record
		orderPayment = gin.H{
			"status":             "unknown", // Or derive from order.Status if possible
			"paystack_reference": order.PaystackReference,
		}
	}

	driverUserID := ""
	if order.DriverUserID != nil {
		driverUserID = order.DriverUserID.String()
	}

	var driverAssignedAt any
	if order.DriverAssignedAt != nil {
		driverAssignedAt = order.DriverAssignedAt.UTC().Format(time.RFC3339)
	}

	return gin.H{
		"id":                  order.ID.String(),
		"status":              order.Status,
		"total_amount":        order.TotalAmount,
		"delivery_fee":        order.DeliveryFee,
		"created_at":          order.CreatedAt,
		"delivery_address":    order.DeliveryAddress,
		"paystack_reference":  order.PaystackReference,
		"driver_user_id":      driverUserID,
		"driver_name":         driverName,
		"driver_assigned_at":  driverAssignedAt,
		"items":               items,
		"payment":             orderPayment,
	}
}
