package delivery

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	neturl "net/url"
	"os"
	"sokoapp/internal/models"
	"sokoapp/internal/ws"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// --- Vehicle-specific pricing (matches price&rate.tsx display) ---
type vehicleRate struct {
	BaseFee   float64
	PerKmRate float64
}

var vehicleRates = map[string]vehicleRate{
	"bicycle":    {BaseFee: 5.00, PerKmRate: 1.50},
	"motorbike":  {BaseFee: 10.00, PerKmRate: 2.50},
	"motorcycle": {BaseFee: 10.00, PerKmRate: 2.50}, // driver profile alias
	"car":        {BaseFee: 25.00, PerKmRate: 4.00},
	"van":        {BaseFee: 40.00, PerKmRate: 6.00},
	"truck":      {BaseFee: 80.00, PerKmRate: 10.00},
}

// geocodeAddress uses Nominatim to resolve a text address to GPS coords, biased to Ghana.
// Returns 0,0 on failure — caller should handle gracefully.
func geocodeAddress(address string) (lat, lng float64) {
	q := neturl.QueryEscape(address + ", Ghana")
	apiURL := "https://nominatim.openstreetmap.org/search?q=" + q + "&format=json&limit=1&countrycodes=gh"
	req, err := http.NewRequest("GET", apiURL, nil)
	if err != nil {
		return 0, 0
	}
	req.Header.Set("User-Agent", "SokoApp/1.0 (delivery@sokoapp.com)")
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return 0, 0
	}
	defer resp.Body.Close()

	var results []struct {
		Lat string `json:"lat"`
		Lon string `json:"lon"`
	}
	raw, _ := io.ReadAll(resp.Body)
	if err := json.Unmarshal(raw, &results); err != nil || len(results) == 0 {
		return 0, 0
	}
	lat, _ = strconv.ParseFloat(results[0].Lat, 64)
	lng, _ = strconv.ParseFloat(results[0].Lon, 64)
	return lat, lng
}

// getFullImageURL turns a relative media path into an absolute URL the app can load.
// Duplicated per-package (see shopper.getFullImageURL / auth.getFullImageURL) since it's unexported there.
func getFullImageURL(path string) string {
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

	apiBaseURL := strings.TrimRight(os.Getenv("API_BASE_URL"), "/")
	if apiBaseURL == "" {
		apiBaseURL = "http://127.0.0.1:8082"
	}

	if len(path) > 0 && path[0] != '/' {
		path = "/" + path
	}

	encodedPath := strings.ReplaceAll(path, " ", "%20")
	return apiBaseURL + mediaEndpoint + strings.TrimPrefix(encodedPath, "/")
}

func calculateDistance(lat1, lon1, lat2, lon2 float64) float64 {
	const R = 6371
	dLat := (lat2 - lat1) * (math.Pi / 180)
	dLon := (lon2 - lon1) * (math.Pi / 180)
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1*(math.Pi/180))*math.Cos(lat2*(math.Pi/180))*
			math.Sin(dLon/2)*math.Sin(dLon/2)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
	return R * c
}

func calculateDeliveryPrice(vehicleType string, lat1, lon1, lat2, lon2 float64) (float64, float64) {
	dist := calculateDistance(lat1, lon1, lat2, lon2)
	if dist < 1 {
		dist = 1
	}
	rate, ok := vehicleRates[vehicleType]
	if !ok {
		rate = vehicleRates["motorbike"] // fallback
	}
	return rate.BaseFee + (dist * rate.PerKmRate), dist
}

// DeliveryRequest is the payload for creating a new delivery order.
type DeliveryRequest struct {
	OrderID       string  `json:"order_id" binding:"omitempty,uuid"`
	ItemName      string  `json:"item_name" binding:"required"`
	PickupAddress string  `json:"pickup_address" binding:"required"`
	PickupLat     float64 `json:"pickup_lat"`
	PickupLng     float64 `json:"pickup_lng"`
	// From the phone's own OS-level geocoder (Google/Apple), captured alongside
	// PickupAddress on the client. Preferred over our own reverse-geocode of
	// PickupLat/PickupLng for trip-scope classification — it has much richer
	// real-world coverage of Ghanaian towns than OpenStreetMap/Nominatim, and
	// matches what the customer already sees in the pickup address field, so
	// the two never disagree (e.g. resolving to a small suburb instead of the
	// town the customer sees).
	PickupTown     string  `json:"pickup_town"`
	PickupRegion   string  `json:"pickup_region"`
	PickupCountry  string  `json:"pickup_country"`
	DropoffAddress string  `json:"dropoff_address" binding:"required"`
	DropoffLat     float64 `json:"dropoff_lat"`
	DropoffLng     float64 `json:"dropoff_lng"`
	// Structured dropoff (preferred over freeform geocoding of DropoffAddress):
	// town/municipality + region (Ghana only, for now) + country, plus an
	// optional, more specific landmark/suburb/street within that town. Lets
	// the backend run a scoped Nominatim lookup instead of guessing from
	// text, and falls back through town → region → country centroids if the
	// landmark (or even the town) can't be resolved — so two addresses in
	// the same municipality never end up wildly apart.
	DropoffLandmark     string `json:"dropoff_landmark"`
	DropoffTown         string `json:"dropoff_town"`
	DropoffRegion       string `json:"dropoff_region"`
	DropoffCountry      string `json:"dropoff_country"`
	PackageDescription  string `json:"package_description" binding:"required"`
	VehicleType         string `json:"vehicle_type" binding:"required,oneof=bicycle motorbike motorcycle car van truck"`
	ReceiverName        string `json:"receiver_name" binding:"required"`
	ReceiverPhone       string `json:"receiver_phone" binding:"required"`
	ReceiverSpecificLoc string `json:"receiver_specific_location"`
	// PayerType: "sender" (default) or "receiver".
	// When "receiver", the receiver must be a registered SokoApp user.
	PayerType string `json:"payer_type" binding:"required,oneof=sender receiver"`
}

// RequestDelivery creates a delivery order and, when the sender is paying,
// immediately initialises a Paystack transaction and returns the checkout URL.
func RequestDelivery(deliveryDB, accountDB *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req DeliveryRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		userID := c.GetString("user_id")
		userUUID, err := uuid.Parse(userID)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid user id"})
			return
		}

		var sender models.User
		if err := accountDB.Where("id = ?", userUUID).First(&sender).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch sender profile"})
			return
		}

		pickupLat, pickupLng := req.PickupLat, req.PickupLng
		if pickupLat == 0 && pickupLng == 0 {
			pickupLat, pickupLng = geocodeAddress(req.PickupAddress)
		}
		dropoffLat, dropoffLng := req.DropoffLat, req.DropoffLng
		if dropoffLat == 0 && dropoffLng == 0 {
			if req.DropoffLandmark != "" || req.DropoffTown != "" || req.DropoffRegion != "" || req.DropoffCountry != "" {
				dropoffLat, dropoffLng = geocodeStructured(req.DropoffLandmark, req.DropoffTown, req.DropoffRegion, req.DropoffCountry)
			} else {
				dropoffLat, dropoffLng = geocodeAddress(req.DropoffAddress)
			}
		}
		totalAmount, distKm := calculateDeliveryPrice(req.VehicleType, pickupLat, pickupLng, dropoffLat, dropoffLng)
		paymentRef := "SK-DEL-" + uuid.New().String()

		// Best-effort: tell the customer whether this is a same-town, same-region,
		// or cross-region/country trip, so the fee is legible rather than a bare
		// number. Dropoff's region/town come straight from the structured form
		// fields the customer picked. Pickup prefers the phone's own OS-level
		// geocode (req.PickupTown/Region/Country) over our own reverse-geocode
		// of the raw GPS — Nominatim/OpenStreetMap has much sparser coverage of
		// Ghanaian towns and can resolve to the wrong nearby locality (e.g. a
		// small suburb) even though the phone's geocoder already got it right.
		pickupTown, pickupRegion, pickupCountry := req.PickupTown, req.PickupRegion, req.PickupCountry
		if pickupTown == "" && pickupRegion == "" {
			pickupRegion, pickupTown, pickupCountry, _ = reverseGeocode(pickupLat, pickupLng)
		}
		tripScope := classifyTripScope(pickupCountry, pickupRegion, pickupTown, req.DropoffCountry, req.DropoffRegion, req.DropoffTown)

		order := models.DeliveryOrder{
			UserID:                userUUID,
			Description:           req.ItemName + ": " + req.PackageDescription,
			PackageSize:           req.VehicleType,
			VehicleType:           req.VehicleType,
			PickupAddress:         req.PickupAddress,
			PickupLat:             pickupLat,
			PickupLng:             pickupLng,
			DropoffAddress:        req.DropoffAddress,
			DropoffLat:            dropoffLat,
			DropoffLng:            dropoffLng,
			TotalAmount:           totalAmount,
			DistanceKm:            distKm,
			PaymentStatus:         "pending",
			PaystackRef:           paymentRef,
			PayerType:             req.PayerType,
			ReceiverName:          req.ReceiverName,
			ReceiverPhone:         req.ReceiverPhone,
			ReceiverLocationNotes: req.ReceiverSpecificLoc,
			SenderName:            sender.FullName,
			SenderPhone:           sender.PhoneNumber,
			SenderImageURL:        sender.ProfileImageURL,
			PickupRegion:          pickupRegion,
			PickupTown:            pickupTown,
			DropoffRegion:         req.DropoffRegion,
			DropoffTown:           req.DropoffTown,
			TripScope:             tripScope,
		}

		// --- Receiver-pays validation ---
		if req.PayerType == "receiver" {
			var receiver models.User
			if err := accountDB.Where("phone_number = ?", req.ReceiverPhone).First(&receiver).Error; err != nil {
				c.JSON(http.StatusBadRequest, gin.H{
					"error": "Receiver phone number is not registered on SokoApp. The receiver must have an account to pay.",
				})
				return
			}
			order.ReceiverUserID = &receiver.ID
		}

		if err := deliveryDB.Create(&order).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create delivery order"})
			return
		}

		// --- Sender pays: initialise Paystack immediately ---
		if req.PayerType == "sender" {
			checkoutURL, psErr := initiatePaystack(sender.Email, paymentRef, totalAmount)
			if psErr != nil {
				// Order already created; return it without checkout URL so client can retry payment
				c.JSON(http.StatusOK, gin.H{
					"delivery_id":     order.ID.String(),
					"estimated_price": totalAmount,
					"distance_km":     distKm,
					"payer_type":      req.PayerType,
					"status":          order.PaymentStatus,
					"checkout_url":    nil,
					"pickup_region":   pickupRegion,
					"pickup_town":     pickupTown,
					"dropoff_region":  order.DropoffRegion,
					"dropoff_town":    order.DropoffTown,
					"trip_scope":      tripScope,
				})
				return
			}
			c.JSON(http.StatusOK, gin.H{
				"delivery_id":     order.ID.String(),
				"estimated_price": totalAmount,
				"distance_km":     distKm,
				"payer_type":      req.PayerType,
				"status":          order.PaymentStatus,
				"checkout_url":    checkoutURL,
				"reference":       paymentRef,
				"pickup_region":   pickupRegion,
				"pickup_town":     pickupTown,
				"dropoff_region":  order.DropoffRegion,
				"dropoff_town":    order.DropoffTown,
				"trip_scope":      tripScope,
			})
			return
		}

		// Receiver pays: return without checkout URL; receiver will pay from their own app
		c.JSON(http.StatusOK, gin.H{
			"delivery_id":       order.ID.String(),
			"estimated_price":   totalAmount,
			"distance_km":       distKm,
			"payer_type":        req.PayerType,
			"status":            order.PaymentStatus,
			"receiver_notified": true,
			"pickup_region":     pickupRegion,
			"pickup_town":       pickupTown,
			"dropoff_region":    order.DropoffRegion,
			"dropoff_town":      order.DropoffTown,
			"trip_scope":        tripScope,
		})
	}
}

// InitiatePayment lets the authorised payer (sender or receiver) open a
// Paystack checkout for an existing delivery order.
func InitiatePayment(deliveryDB, accountDB *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		deliveryID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid delivery id"})
			return
		}

		callerUUID, err := uuid.Parse(c.GetString("user_id"))
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid user id"})
			return
		}

		var order models.DeliveryOrder
		if err := deliveryDB.First(&order, "id = ?", deliveryID).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "delivery order not found"})
			return
		}

		if order.PaymentStatus == "success" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "delivery already paid"})
			return
		}

		isSender := order.UserID == callerUUID
		isReceiver := order.ReceiverUserID != nil && *order.ReceiverUserID == callerUUID
		if !isSender && !isReceiver {
			c.JSON(http.StatusForbidden, gin.H{"error": "you are not authorised to pay for this delivery"})
			return
		}
		if order.PayerType == "sender" && !isSender {
			c.JSON(http.StatusForbidden, gin.H{"error": "the sender is responsible for this delivery payment"})
			return
		}
		if order.PayerType == "receiver" && !isReceiver {
			c.JSON(http.StatusForbidden, gin.H{"error": "the receiver is responsible for this delivery payment"})
			return
		}

		var caller models.User
		if err := accountDB.Select("email").Where("id = ?", callerUUID).First(&caller).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch user profile"})
			return
		}

		// ✅ Generate a fresh reference — Paystack rejects reused references
		newRef := "SK-DEL-" + uuid.New().String()
		if err := deliveryDB.Model(&order).Update("paystack_ref", newRef).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update payment reference"})
			return
		}

		checkoutURL, psErr := initiatePaystack(caller.Email, newRef, order.TotalAmount)
		if psErr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "payment provider error: " + psErr.Error()})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"delivery_id":  order.ID.String(),
			"checkout_url": checkoutURL,
			"reference":    newRef,
			"amount":       order.TotalAmount,
		})
	}
}

// ListReceiverDeliveries returns pending-payment deliveries where the
// authenticated user is the designated receiver.
func ListReceiverDeliveries(deliveryDB *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userUUID, err := uuid.Parse(c.GetString("user_id"))
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid user id"})
			return
		}

		var orders []models.DeliveryOrder
		if err := deliveryDB.
			Where("receiver_user_id = ? AND payer_type = 'receiver' AND payment_status != 'success'", userUUID).
			Order("created_at desc").
			Find(&orders).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch deliveries"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"data": orders})
	}
}

// VerifyDeliveryPayment calls Paystack's verify API and immediately updates
// payment_status to "success" in the DB if confirmed. Called by the mobile app
// right after the WebView closes, so the user sees "Paid" without waiting for
// the async webhook.
func VerifyDeliveryPayment(deliveryDB *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		ref := c.Query("reference")
		if ref == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "reference is required"})
			return
		}

		secret := os.Getenv("PAYSTACK_SECRET_KEY")
		req, _ := http.NewRequest("GET", "https://api.paystack.co/transaction/verify/"+ref, nil)
		req.Header.Set("Authorization", "Bearer "+secret)

		client := &http.Client{Timeout: 10 * time.Second}
		resp, err := client.Do(req)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "payment provider unreachable"})
			return
		}
		defer resp.Body.Close()

		var result struct {
			Status bool `json:"status"`
			Data   struct {
				Status string `json:"status"`
			} `json:"data"`
		}
		raw, _ := io.ReadAll(resp.Body)
		json.Unmarshal(raw, &result)

		if result.Status && result.Data.Status == "success" {
			deliveryDB.Model(&models.DeliveryOrder{}).
				Where("paystack_ref = ?", ref).
				Updates(map[string]any{
					"payment_status": "success",
					"updated_at":     time.Now(),
				})
			c.JSON(http.StatusOK, gin.H{"payment_status": "success"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"payment_status": "pending"})
	}
}

// GetPriceEstimate returns the fee breakdown for a given vehicle type and distance.
func GetPriceEstimate(c *gin.Context) {
	var req struct {
		VehicleType string  `form:"vehicle_type" binding:"required,oneof=bicycle motorbike motorcycle car van truck"`
		PickupLat   float64 `form:"pickup_lat"`
		PickupLng   float64 `form:"pickup_lng"`
		DropoffLat  float64 `form:"dropoff_lat"`
		DropoffLng  float64 `form:"dropoff_lng"`
	}
	if err := c.ShouldBindQuery(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	rate := vehicleRates[req.VehicleType]
	dist := calculateDistance(req.PickupLat, req.PickupLng, req.DropoffLat, req.DropoffLng)
	if dist < 1 {
		dist = 1
	}
	total := rate.BaseFee + dist*rate.PerKmRate

	c.JSON(http.StatusOK, gin.H{
		"vehicle_type": req.VehicleType,
		"base_fee":     rate.BaseFee,
		"per_km_rate":  rate.PerKmRate,
		"distance_km":  math.Round(dist*100) / 100,
		"total":        math.Round(total*100) / 100,
	})
}

// GetDriverEarnings returns the driver's combined earnings from parcel deliveries
// (sokodelivery DB) and shopper order deliveries (sokoshopper DB), plus cashout state.
func GetDriverEarnings(deliveryDB, shopperDB *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		driverID, err := uuid.Parse(c.GetString("user_id"))
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid user id"})
			return
		}

		// Parcel delivery earnings (DriverEarning records created on OTP verification)
		var parcelEarnings float64
		deliveryDB.Model(&models.DriverEarning{}).
			Where("driver_user_id = ?", driverID).
			Select("COALESCE(SUM(amount), 0)").Scan(&parcelEarnings)

		// Shopper order delivery earnings: 60% of Order.delivery_fee per completed delivery
		type sumResult struct{ Total float64 }
		var shopperResult sumResult
		shopperDB.Table("order_deliveries od").
			Select("COALESCE(SUM(o.delivery_fee * 0.6), 0) as total").
			Joins("JOIN orders o ON od.order_id::text = o.id::text").
			Where("od.driver_id = ? AND od.status = ?", driverID, "delivered").
			Scan(&shopperResult)

		totalEarnings := parcelEarnings + shopperResult.Total

		// Weekly earnings (last 7 days) — parcel only via DriverEarning timestamps
		weekAgo := time.Now().AddDate(0, 0, -7)
		var weeklyParcel float64
		deliveryDB.Model(&models.DriverEarning{}).
			Where("driver_user_id = ? AND created_at >= ?", driverID, weekAgo).
			Select("COALESCE(SUM(amount), 0)").Scan(&weeklyParcel)

		var weeklyShopperResult sumResult
		shopperDB.Table("order_deliveries od").
			Select("COALESCE(SUM(o.delivery_fee * 0.6), 0) as total").
			Joins("JOIN orders o ON od.order_id::text = o.id::text").
			Where("od.driver_id = ? AND od.status = ? AND od.updated_at >= ?", driverID, "delivered", weekAgo).
			Scan(&weeklyShopperResult)

		weeklyEarnings := weeklyParcel + weeklyShopperResult.Total

		// Cashout requests
		var pendingCashout float64
		deliveryDB.Model(&models.DriverCashoutRequest{}).
			Where("driver_user_id = ? AND status = ?", driverID, "pending").
			Select("COALESCE(SUM(amount), 0)").Scan(&pendingCashout)

		var paidCashout float64
		deliveryDB.Model(&models.DriverCashoutRequest{}).
			Where("driver_user_id = ? AND status = ?", driverID, "paid").
			Select("COALESCE(SUM(amount), 0)").Scan(&paidCashout)

		availableBalance := totalEarnings - pendingCashout - paidCashout

		// Completed delivery count (both sources)
		var parcelCount int64
		deliveryDB.Model(&models.DeliveryAssignment{}).
			Where("driver_id = ? AND status = ?", driverID, "delivered").
			Count(&parcelCount)

		var shopperCount int64
		shopperDB.Table("order_deliveries").
			Where("driver_id = ? AND status = ?", driverID, "delivered").
			Count(&shopperCount)

		c.JSON(http.StatusOK, gin.H{
			"total_earnings":    totalEarnings,
			"weekly_earnings":   weeklyEarnings,
			"pending_cashout":   pendingCashout,
			"available_balance": availableBalance,
			"completed_count":   parcelCount + shopperCount,
		})
	}
}

// RequestCashout creates a cashout request, subtracting the amount from the
// driver's available balance. Admin confirms payout by marking status = "paid".
func RequestCashout(deliveryDB, shopperDB *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		driverID, err := uuid.Parse(c.GetString("user_id"))
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid user id"})
			return
		}

		var req struct {
			Amount float64 `json:"amount" binding:"required"`
			Method string  `json:"method" binding:"required,oneof=momo bank"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if req.Amount < 10 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "minimum cashout is GHS 10.00"})
			return
		}

		// Calculate available balance (same logic as GetDriverEarnings)
		var parcelEarnings float64
		deliveryDB.Model(&models.DriverEarning{}).
			Where("driver_user_id = ?", driverID).
			Select("COALESCE(SUM(amount), 0)").Scan(&parcelEarnings)

		type sumResult struct{ Total float64 }
		var shopperResult sumResult
		shopperDB.Table("order_deliveries od").
			Select("COALESCE(SUM(o.delivery_fee * 0.6), 0) as total").
			Joins("JOIN orders o ON od.order_id::text = o.id::text").
			Where("od.driver_id = ? AND od.status = ?", driverID, "delivered").
			Scan(&shopperResult)

		var pendingCashout float64
		deliveryDB.Model(&models.DriverCashoutRequest{}).
			Where("driver_user_id = ? AND status = ?", driverID, "pending").
			Select("COALESCE(SUM(amount), 0)").Scan(&pendingCashout)

		var paidCashout float64
		deliveryDB.Model(&models.DriverCashoutRequest{}).
			Where("driver_user_id = ? AND status = ?", driverID, "paid").
			Select("COALESCE(SUM(amount), 0)").Scan(&paidCashout)

		available := parcelEarnings + shopperResult.Total - pendingCashout - paidCashout
		if req.Amount > available {
			c.JSON(http.StatusBadRequest, gin.H{
				"error":             "amount exceeds available balance",
				"available_balance": available,
			})
			return
		}

		cashout := models.DriverCashoutRequest{
			DriverUserID: driverID,
			Amount:       req.Amount,
			Method:       req.Method,
			Status:       "pending",
		}
		if err := deliveryDB.Create(&cashout).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create cashout request"})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"message":           "cashout request submitted",
			"requested_amount":  req.Amount,
			"available_balance": available - req.Amount,
			"pending_cashout":   pendingCashout + req.Amount,
		})
	}
}

// initiatePaystack calls Paystack's transaction/initialize endpoint and returns
// the authorization_url.
func initiatePaystack(email, reference string, amountGHS float64) (string, error) {
	secret := os.Getenv("PAYSTACK_SECRET_KEY")
	if secret == "" {
		return "", fmt.Errorf("payment provider not configured")
	}

	body, _ := json.Marshal(map[string]any{
		"email":     email,
		"amount":    int(amountGHS * 100), // GHS → pesewas
		"reference": reference,
		"currency":  "GHS",
	})

	req, _ := http.NewRequest("POST", "https://api.paystack.co/transaction/initialize", bytes.NewBuffer(body))
	req.Header.Set("Authorization", "Bearer "+secret)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("paystack unreachable")
	}
	defer resp.Body.Close()

	var result struct {
		Status bool   `json:"status"`
		Msg    string `json:"message"`
		Data   struct {
			AuthorizationURL string `json:"authorization_url"`
		} `json:"data"`
	}
	raw, _ := io.ReadAll(resp.Body)
	if err := json.Unmarshal(raw, &result); err != nil || !result.Status {
		return "", fmt.Errorf("paystack: %s", result.Msg)
	}
	return result.Data.AuthorizationURL, nil
}

// ────────────────────────────────────────────────────────────────────────────
// Existing handlers below — unchanged logic, minor formatting only
// ────────────────────────────────────────────────────────────────────────────

func GetParcelDetail(db, accountDB *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		deliveryID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid delivery ID"})
			return
		}

		var parcel models.DeliveryOrder
		if err := db.Where("id = ?", deliveryID).First(&parcel).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "parcel not found"})
			return
		}

		var assignment models.DeliveryAssignment
		db.Where("order_id = ?", parcel.ID).Order("created_at desc").First(&assignment)

		status := "pending"
		riderName := "Assigning driver..."
		riderPhone := ""
		riderProfileImage := ""
		if assignment.ID != uuid.Nil {
			status = string(assignment.Status)
			if assignment.DriverUserID != nil {
				var driver models.User
				if err := accountDB.Select("full_name, phone_number, profile_image_url").
					Where("id = ?", assignment.DriverUserID).First(&driver).Error; err == nil {
					riderName = driver.FullName
					riderPhone = driver.PhoneNumber
					riderProfileImage = getFullImageURL(driver.ProfileImageURL)
				}
			}
		}

		c.JSON(http.StatusOK, gin.H{
			"data": gin.H{
				"id":                  parcel.ID,
				"status":              status,
				"payment_status":      parcel.PaymentStatus,
				"payer_type":          parcel.PayerType,
				"total_amount":        parcel.TotalAmount,
				"distance_km":         parcel.DistanceKm,
				"vehicle_type":        parcel.VehicleType,
				"description":         parcel.Description,
				"pickup_address":      parcel.PickupAddress,
				"dropoff_address":     parcel.DropoffAddress,
				"receiver_name":       parcel.ReceiverName,
				"receiver_phone":      parcel.ReceiverPhone,
				"rider_name":          riderName,
				"rider_phone":         riderPhone,
				"rider_profile_image": riderProfileImage,
				"receiver_user_id":    parcel.ReceiverUserID,
				"customer_rating":     assignment.CustomerRating,
				"pickup_region":       parcel.PickupRegion,
				"pickup_town":         parcel.PickupTown,
				"dropoff_region":      parcel.DropoffRegion,
				"dropoff_town":        parcel.DropoffTown,
				"trip_scope":          parcel.TripScope,
			},
		})
	}
}

// GetParcelOTP lets the sender/receiver poll for the delivery PIN once the driver
// has generated it — mirrors shopper.GetOrderOTP for marketplace orders.
func GetParcelOTP(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		parcelID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid delivery ID"})
			return
		}

		var assignment models.DeliveryAssignment
		if err := db.Where("order_id = ?", parcelID).Order("created_at desc").First(&assignment).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "delivery not found"})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"otp":      assignment.DeliveryPin,
			"verified": assignment.Status == models.DelDelivered,
		})
	}
}

func ListUserDeliveries(db, accountDB *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, _ := uuid.Parse(c.GetString("user_id"))
		var deliveries []models.DeliveryOrder
		if err := db.Where("user_id = ?", userID).Order("created_at desc").Find(&deliveries).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch deliveries"})
			return
		}

		response := make([]gin.H, 0, len(deliveries))
		for _, d := range deliveries {
			var assignment models.DeliveryAssignment
			db.Where("order_id = ?", d.ID).Order("created_at desc").First(&assignment)

			status := "pending"
			riderName := "Assigning driver..."
			if assignment.ID != uuid.Nil {
				status = string(assignment.Status)
				if assignment.DriverUserID != nil {
					var driver models.User
					if err := accountDB.Select("full_name").Where("id = ?", assignment.DriverUserID).First(&driver).Error; err == nil {
						riderName = driver.FullName
					}
				}
			}

			response = append(response, gin.H{
				"id":               d.ID,
				"status":           status,
				"payment_status":   d.PaymentStatus,
				"payer_type":       d.PayerType,
				"total_amount":     d.TotalAmount,
				"distance_km":      d.DistanceKm,
				"vehicle_type":     d.VehicleType,
				"description":      d.Description,
				"pickup_address":   d.PickupAddress,
				"dropoff_address":  d.DropoffAddress,
				"receiver_name":    d.ReceiverName,
				"rider_name":       riderName,
				"created_at":       d.CreatedAt,
				"receiver_user_id": d.ReceiverUserID,
				"customer_rating":  assignment.CustomerRating,
			})
		}

		c.JSON(http.StatusOK, gin.H{"data": response})
	}
}

func ListDriverDeliveries(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		driverID, _ := uuid.Parse(c.GetString("user_id"))

		var assignments []models.DeliveryAssignment
		if err := db.Where("driver_id = ?", driverID).
			Order("created_at desc").Find(&assignments).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch deliveries"})
			return
		}

		response := make([]gin.H, 0, len(assignments))
		for _, a := range assignments {
			var order models.DeliveryOrder
			db.Select("description, receiver_name, vehicle_type, total_amount, distance_km").
				Where("id = ?", a.OrderID).First(&order)

			response = append(response, gin.H{
				"id":               a.ID,
				"delivery_status":  a.Status,
				"delivery_address": a.DropoffAddress,
				"pickup_address":   a.PickupAddress,
				"source":           "delivery",
				"created_at":       a.CreatedAt,
				"delivery_fee":     a.DeliveryFee,
				"driver_earnings":  a.DriverEarnings,
				"description":      order.Description,
				"receiver_name":    order.ReceiverName,
				"vehicle_type":     order.VehicleType,
				"total_amount":     order.TotalAmount,
				"distance_km":      order.DistanceKm,
			})
		}

		c.JSON(http.StatusOK, gin.H{"data": response})
	}
}

func GetDeliveryDetail(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		deliveryID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid delivery ID format"})
			return
		}

		var a models.DeliveryAssignment
		if err := db.Where("id = ?", deliveryID).First(&a).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "delivery not found"})
			return
		}

		var order models.DeliveryOrder
		db.Where("id = ?", a.OrderID).First(&order)

		c.JSON(http.StatusOK, gin.H{
			"data": gin.H{
				// Assignment fields
				"id":              a.ID,
				"delivery_status": a.Status,
				"delivery_fee":    a.DeliveryFee,
				"driver_earnings": a.DriverEarnings,
				"picked_up_at":    a.PickedUpAt,
				"delivered_at":    a.DeliveredAt,
				"created_at":      a.CreatedAt,
				// Route
				"pickup_address":  a.PickupAddress,
				"pickup_lat":      a.PickupLat,
				"pickup_lng":      a.PickupLng,
				"dropoff_address": a.DropoffAddress,
				"dropoff_lat":     a.DropoffLat,
				"dropoff_lng":     a.DropoffLng,
				// Parcel details
				"description":  order.Description,
				"vehicle_type": order.VehicleType,
				"distance_km":  order.DistanceKm,
				"total_amount": order.TotalAmount,
				// Receiver details
				"receiver_name":           order.ReceiverName,
				"receiver_phone":          order.ReceiverPhone,
				"receiver_location_notes": order.ReceiverLocationNotes,
				// Sender details
				"sender_name":  order.SenderName,
				"sender_phone": order.SenderPhone,
			},
			"source": "delivery",
		})
	}
}

// AcceptDelivery lets a driver accept an assignment that was set to "assigned" by admin.
// Only the assigned driver can call this; only works when status is "assigned".
func AcceptDelivery(db, accountDB *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		assignmentID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid delivery UUID"})
			return
		}

		driverUUID, err := uuid.Parse(c.GetString("user_id"))
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid driver session"})
			return
		}

		var a models.DeliveryAssignment
		if err := db.Where("id = ?", assignmentID).First(&a).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "delivery not found"})
			return
		}

		if a.DriverUserID == nil || *a.DriverUserID != driverUUID {
			c.JSON(http.StatusForbidden, gin.H{"error": "this delivery is not assigned to you"})
			return
		}

		if a.Status != models.DelAssigned {
			c.JSON(http.StatusBadRequest, gin.H{"error": "delivery is not in assigned state"})
			return
		}

		now := time.Now()
		if err := db.Model(&a).Updates(map[string]any{
			"status":      models.DelAccepted,
			"accepted_at": &now,
			"updated_at":  now,
		}).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to accept delivery"})
			return
		}

		// Mark driver unavailable while they handle this delivery
		accountDB.Model(&models.DriverProfile{}).
			Where("user_id = ?", driverUUID).
			Update("is_available", false)

		c.JSON(http.StatusOK, gin.H{"message": "delivery accepted", "status": string(models.DelAccepted)})
	}
}

func UpdateStatus(db *gorm.DB, hub *ws.Hub) gin.HandlerFunc {
	return func(c *gin.Context) {
		deliveryID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid delivery UUID format"})
			return
		}

		var req struct {
			Status string `json:"status" binding:"required"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "status is required"})
			return
		}

		updates := map[string]any{
			"status":     models.DeliveryStatus(req.Status),
			"updated_at": time.Now(),
		}

		if req.Status == string(models.DelPickedUp) {
			now := time.Now()
			updates["picked_up_at"] = &now
		} else if req.Status == string(models.DelDelivered) {
			now := time.Now()
			updates["delivered_at"] = &now
		}

		if err := db.Model(&models.DeliveryAssignment{}).Where("id = ?", deliveryID).Updates(updates).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update delivery status"})
			return
		}

		// Notify the customer via WebSocket
		go func() {
			var assignment models.DeliveryAssignment
			if err := db.Select("order_id").First(&assignment, "id = ?", deliveryID).Error; err != nil {
				return
			}
			var order models.DeliveryOrder
			if err := db.Select("user_id").First(&order, "id = ?", assignment.OrderID).Error; err != nil {
				return
			}
			hub.Send(order.UserID.String(), "delivery_status", map[string]string{
				"delivery_id": deliveryID.String(),
				"status":      req.Status,
			})
		}()

		c.JSON(http.StatusOK, gin.H{"message": "status updated successfully", "status": req.Status})
	}
}

func GenerateOTP(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		deliveryID, _ := uuid.Parse(c.Param("id"))
		otp := fmt.Sprintf("%04d", time.Now().UnixNano()%10000)
		if err := db.Model(&models.DeliveryAssignment{}).Where("id = ?", deliveryID).Update("delivery_pin", otp).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate OTP"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"otp": otp, "expires_in": 300})
	}
}

func VerifyOTP(db, accountDB *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		deliveryID, _ := uuid.Parse(c.Param("id"))
		var req struct {
			OTP string `json:"otp" binding:"required"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "OTP is required"})
			return
		}

		var a models.DeliveryAssignment
		if err := db.Where("id = ? AND delivery_pin = ?", deliveryID, req.OTP).First(&a).Error; err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid OTP code"})
			return
		}

		now := time.Now()
		driverEarnings := a.DeliveryFee * 0.6
		platformCut := a.DeliveryFee * 0.4

		db.Model(&models.DeliveryAssignment{}).Where("id = ?", deliveryID).Updates(map[string]any{
			"status":          models.DelDelivered,
			"delivered_at":    &now,
			"driver_earnings": driverEarnings,
			"platform_cut":    platformCut,
		})

		// Create DriverEarning record so earnings are reflected in the dashboard
		if a.DriverUserID != nil && driverEarnings > 0 {
			var existing models.DriverEarning
			if db.Where("assignment_id = ?", a.ID).First(&existing).Error != nil {
				db.Create(&models.DriverEarning{
					DriverUserID: *a.DriverUserID,
					AssignmentID: &a.ID,
					Amount:       driverEarnings,
					Status:       models.EarningPending,
				})
			}
			// Driver is free again — mark available (stays online if location sharing is on)
			accountDB.Model(&models.DriverProfile{}).Where("user_id = ?", *a.DriverUserID).
				Update("is_available", true)
		}

		c.JSON(http.StatusOK, gin.H{"verified": true, "driver_earnings": driverEarnings})
	}
}

func ToggleOnlineStatus(accountDB *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		driverID := c.GetString("user_id")
		driverUUID, err := uuid.Parse(driverID)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid driver session"})
			return
		}

		var req struct {
			IsOnline bool `json:"is_online"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "is_online is required"})
			return
		}

		now := time.Now()
		updates := map[string]any{
			"is_online":    req.IsOnline,
			"is_available": req.IsOnline,
			"updated_at":   now,
		}
		if req.IsOnline {
			// Baseline timestamp so the stale-driver sweep has something to
			// check even in the few seconds before the first GPS ping lands.
			updates["last_location_at"] = &now
		} else {
			// Going offline also clears coordinates so stale location isn't used
			updates["current_lat"] = nil
			updates["current_lng"] = nil
		}

		if err := accountDB.Model(&models.DriverProfile{}).Where("user_id = ?", driverUUID).Updates(updates).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update online status"})
			return
		}

		status := "offline"
		if req.IsOnline {
			status = "online"
		}
		c.JSON(http.StatusOK, gin.H{"message": "status updated", "status": status})
	}
}

// RegisterPushToken — POST /delivery/driver/push-token (driver)
// Stores the driver's Expo push token so a new assignment can wake their
// app with a system notification even while backgrounded or killed.
func RegisterPushToken(accountDB *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		driverUUID, err := uuid.Parse(c.GetString("user_id"))
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid driver session"})
			return
		}

		var req struct {
			ExpoPushToken string `json:"expo_push_token" binding:"required"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "expo_push_token is required"})
			return
		}

		if err := accountDB.Model(&models.User{}).Where("id = ?", driverUUID).
			Update("expo_push_token", req.ExpoPushToken).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save push token"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"message": "push token registered"})
	}
}

func GetDeliveryOTP(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		deliveryID, _ := uuid.Parse(c.Param("id"))
		var a models.DeliveryAssignment
		db.Select("delivery_pin, status").Where("id = ?", deliveryID).First(&a)
		c.JSON(http.StatusOK, gin.H{"otp": a.DeliveryPin, "verified": a.Status == models.DelDelivered})
	}
}

func UpdateLocation(deliveryDB, shopperDB, accountDB *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		driverID := c.GetString("user_id")
		driverUUID, err := uuid.Parse(driverID)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid driver session"})
			return
		}

		var req struct {
			Lat float64 `json:"lat" binding:"required"`
			Lng float64 `json:"lng" binding:"required"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "latitude and longitude are required"})
			return
		}

		now := time.Now()

		accountDB.Model(&models.DriverProfile{}).Where("user_id = ?", driverUUID).Updates(map[string]any{
			"current_lat":      req.Lat,
			"current_lng":      req.Lng,
			"last_location_at": &now,
			"updated_at":       now,
		})

		deliveryDB.Model(&models.DeliveryAssignment{}).
			Where("driver_id = ? AND status IN ?", driverUUID, []string{"assigned", "accepted", "arrived_at_vendor", "picked_up", "in_transit"}).
			Updates(map[string]any{
				"current_lat": req.Lat,
				"current_lng": req.Lng,
				"updated_at":  now,
			})

		shopperDB.Model(&models.OrderDelivery{}).
			Where("driver_id = ? AND status NOT IN ?", driverUUID, []string{"delivered", "cancelled"}).
			Updates(map[string]any{
				"current_lat": req.Lat,
				"current_lng": req.Lng,
				"updated_at":  now,
			})

		c.JSON(http.StatusOK, gin.H{"message": "location updated"})
	}
}

// RateParcelDelivery lets the customer rate their driver after a completed parcel delivery.
// The `:id` param is the DeliveryOrder.ID (what the customer sees in the app).
func RateParcelDelivery(deliveryDB, accountDB *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		orderID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid delivery order ID"})
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

		// Verify caller owns the delivery order
		var order models.DeliveryOrder
		if err := deliveryDB.Where("id = ? AND user_id = ?", orderID, callerUUID).First(&order).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "delivery order not found"})
			return
		}

		// Find the completed assignment for this order
		var assignment models.DeliveryAssignment
		if err := deliveryDB.Where("order_id = ? AND status = ?", orderID, models.DelDelivered).First(&assignment).Error; err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "delivery is not completed yet"})
			return
		}

		if assignment.CustomerRating > 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "you have already rated this delivery"})
			return
		}

		now := time.Now()
		if err := deliveryDB.Model(&models.DeliveryAssignment{}).Where("id = ?", assignment.ID).Updates(map[string]any{
			"customer_rating": req.Rating,
			"customer_review": req.Review,
			"rated_at":        &now,
		}).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save rating"})
			return
		}

		// Recalculate driver's average rating on DriverProfile
		if assignment.DriverUserID != nil {
			var profile models.DriverProfile
			if accountDB.Where("user_id = ?", *assignment.DriverUserID).First(&profile).Error == nil {
				total := profile.TotalRatings
				newAvg := (profile.Rating*float64(total) + float64(req.Rating)) / float64(total+1)
				accountDB.Model(&models.DriverProfile{}).Where("user_id = ?", *assignment.DriverUserID).Updates(map[string]any{
					"rating":        math.Round(newAvg*100) / 100,
					"total_ratings": total + 1,
				})
			}
		}

		c.JSON(http.StatusOK, gin.H{"message": "rating submitted", "rating": req.Rating})
	}
}
