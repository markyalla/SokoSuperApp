package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"sokoapp/internal/account"
	"sokoapp/internal/auth"
	"sokoapp/internal/db"
	"sokoapp/internal/delivery"
	"sokoapp/internal/middleware"
	"sokoapp/internal/models" // Import models to access RoleName constants
	"sokoapp/internal/pgnotify"
	"sokoapp/internal/shopper"
	"sokoapp/internal/sokoindex"
	"sokoapp/internal/sokosusu"
	"sokoapp/internal/storage"
	"sokoapp/internal/utils"
	"sokoapp/internal/webhooks"
	"sokoapp/internal/worker"
	"sokoapp/internal/ws"
	"strings"
	"time"

	"github.com/minio/minio-go/v7"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/hibiken/asynq"
	"github.com/joho/godotenv"
	"github.com/redis/go-redis/v9"
)

// allowedOrigins builds the CORS allowlist from CORS_ALLOWED_ORIGINS (a comma-
// separated list of full origins, e.g. "https://admin.sokoapp.com,https://sokoapp.com").
// Mobile isn't affected either way — native app requests don't carry an Origin
// header — this only gates browser clients like SokoWeb. Falls back to
// localhost dev origins if unset; never wildcards to "allow everything".
func allowedOrigins() map[string]bool {
	raw := os.Getenv("CORS_ALLOWED_ORIGINS")
	origins := map[string]bool{}
	if raw == "" {
		log.Println("Warning: CORS_ALLOWED_ORIGINS not set — allowing only localhost dev origins. Set it to your SokoWeb domain(s) in production, e.g. CORS_ALLOWED_ORIGINS=https://admin.sokoapp.com")
		for _, o := range []string{"http://localhost:5000", "http://127.0.0.1:5000"} {
			origins[o] = true
		}
		return origins
	}
	for _, o := range strings.Split(raw, ",") {
		if o = strings.TrimSpace(o); o != "" {
			origins[o] = true
		}
	}
	return origins
}

func main() {
	if err := godotenv.Load(); err != nil {
		log.Println("Warning: .env file not found")
	}

	// 1. Initialize all 6 DB connections
	dbs := db.NewManager()

	// Initialize Task Distributor
	redisAddr := fmt.Sprintf("%s:%s", os.Getenv("REDIS_HOST"), os.Getenv("REDIS_PORT"))
	redisOpt := asynq.RedisClientOpt{Addr: redisAddr, Password: os.Getenv("REDIS_PASSWORD")}
	distributor := worker.NewRedisTaskDistributor(redisOpt)

	// Shared Redis client for lightweight per-IP rate limiting (separate from
	// the asynq task-queue client above).
	rateLimitRedis := redis.NewClient(&redis.Options{
		Addr:     redisAddr,
		Password: os.Getenv("REDIS_PASSWORD"),
	})

	// Initialize storage
	store := storage.NewClient()
	if store == nil {
		log.Fatal("Critical: Failed to initialize storage client. Check STORAGE_ environment variables.")
	}

	// 2. Auto-migrate all databases
	log.Println("Running database migrations...")

	// Ensure Enum types exist in PostgreSQL before AutoMigrate
	dbs.Shopper.Exec("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_status_enum') THEN CREATE TYPE payment_status_enum AS ENUM ('pending', 'success', 'failed', 'refunded'); END IF; END $$;")
	dbs.Shopper.Exec("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'store_status_enum') THEN CREATE TYPE store_status_enum AS ENUM ('active', 'inactive', 'suspended'); END IF; END $$;")
	dbs.Shopper.Exec("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_status_enum') THEN CREATE TYPE order_status_enum AS ENUM ('pending', 'payment_pending', 'payment_confirmed', 'preparing', 'ready_for_pickup', 'assigned_to_driver', 'picked_up', 'in_transit', 'delivered', 'cancelled', 'refunded'); END IF; END $$;")
	dbs.Shopper.Exec("ALTER TYPE order_status_enum ADD VALUE IF NOT EXISTS 'in_transit' AFTER 'picked_up';")
	// ─── Paste this block into main.go, replacing your existing Shopper migration Exec lines ───

	dbs.Account.Exec("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'gender_enum') THEN CREATE TYPE gender_enum AS ENUM ('male', 'female', 'other', 'prefer_not_to_say'); END IF; END $$;")
	dbs.Account.Exec("ALTER TYPE role_enum ADD VALUE IF NOT EXISTS 'artisan';")
	dbs.Account.Exec("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'driver_status_enum') THEN CREATE TYPE driver_status_enum AS ENUM ('pending', 'active', 'suspended', 'offline'); END IF; END $$;")
	dbs.Account.Exec("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vehicle_type_enum') THEN CREATE TYPE vehicle_type_enum AS ENUM ('bicycle', 'motorcycle', 'car', 'van', 'truck'); END IF; END $$;")
	dbs.Account.Exec("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'document_type_enum') THEN CREATE TYPE document_type_enum AS ENUM ('national_id', 'nhia_id', 'voter_id', 'tin', 'passport', 'drivers_license'); END IF; END $$;")
	dbs.Account.Exec("ALTER TYPE document_type_enum ADD VALUE IF NOT EXISTS 'nhia_id';")
	dbs.Account.Exec("ALTER TYPE document_type_enum ADD VALUE IF NOT EXISTS 'voter_id';")
	dbs.Account.Exec("ALTER TYPE document_type_enum ADD VALUE IF NOT EXISTS 'tin';")
	// Fix legacy kyc_submissions rows created by Flask that have id_type = '' (invalid enum).
	// Cast via text to avoid the enum constraint on the fallback UPDATE.
	dbs.Account.Exec(`
		UPDATE kyc_submissions
		SET id_type = 'national_id'::document_type_enum
		WHERE id_type::text = '' OR id_type IS NULL
	`)
	// delivery_status_enum: add 'assigned' between broadcast and accepted
	dbs.Delivery.Exec("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'delivery_status_enum') THEN CREATE TYPE delivery_status_enum AS ENUM ('pending','broadcast','assigned','accepted','arrived_at_vendor','picked_up','in_transit','arrived_at_customer','delivered','failed','cancelled'); END IF; END $$;")
	dbs.Delivery.Exec("ALTER TYPE delivery_status_enum ADD VALUE IF NOT EXISTS 'assigned' AFTER 'broadcast';")
	dbs.Delivery.Exec("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'driver_complaint_status_enum') THEN CREATE TYPE driver_complaint_status_enum AS ENUM ('open', 'in_review', 'resolved', 'dismissed'); END IF; END $$;")

	// sokoindex enums
	dbs.SokoIndex.Exec("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'artisan_application_status_enum') THEN CREATE TYPE artisan_application_status_enum AS ENUM ('pending', 'approved', 'rejected'); END IF; END $$;")
	dbs.SokoIndex.Exec("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'portfolio_status_enum') THEN CREATE TYPE portfolio_status_enum AS ENUM ('pending', 'approved', 'rejected'); END IF; END $$;")
	dbs.SokoIndex.Exec("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sokoindex_booking_status_enum') THEN CREATE TYPE sokoindex_booking_status_enum AS ENUM ('pending', 'accepted', 'rejected', 'awaiting_confirmation', 'completed', 'cancelled'); END IF; END $$;")
	dbs.SokoIndex.Exec("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'contact_payment_status_enum') THEN CREATE TYPE contact_payment_status_enum AS ENUM ('pending', 'paid', 'bypassed'); END IF; END $$;")
	dbs.SokoIndex.Exec("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'complaint_status_enum') THEN CREATE TYPE complaint_status_enum AS ENUM ('open', 'in_review', 'resolved', 'dismissed'); END IF; END $$;")

	// sokoaccount migration
	dbs.Account.AutoMigrate(
		&models.User{}, &models.UserRole{}, &models.KYCSubmission{},
		&models.KYCDocument{}, &models.DriverProfile{}, &models.OTPVerification{},
		&models.RefreshToken{}, &models.AuditLog{},
	)

	// sokoshopper migration
	dbs.Shopper.AutoMigrate(
		&models.Category{}, &models.Store{}, &models.StoreSection{},
		&models.Product{}, &models.ProductAddon{}, &models.Payment{},
		&models.Cart{}, &models.CartItem{}, &models.Order{}, &models.OrderItem{}, &models.OrderDelivery{},
		&models.ShopCashoutRequest{}, &models.HolidayPricingSetting{},
	)

	// Seed the Ghana holiday-pricing row if it doesn't exist yet. Disabled by
	// default with a suggested 15% — a revenue-affecting surcharge shouldn't
	// silently turn itself on; superadmin opts in from the panel.
	dbs.Shopper.Where("country_code = ?", "GH").
		FirstOrCreate(&models.HolidayPricingSetting{
			CountryCode:  "GH",
			CountryName:  "Ghana",
			SurchargePct: 15,
			Enabled:      false,
		})

	// sokodelivery migration
	dbs.Delivery.AutoMigrate(
		&models.DeliveryZone{}, &models.DeliveryAssignment{},
		&models.DriverEarning{}, &models.DeliveryOrder{},
		&models.DriverCashoutRequest{}, &models.DriverComplaint{},
	)

	// sokobank migration
	dbs.Bank.AutoMigrate(
		&models.BankAccount{}, &models.Transaction{},
		&models.Transfer{}, &models.AccountStatement{},
	)

	// sokosusu migration
	dbs.Susu.AutoMigrate(
		&models.SusuGroup{}, &models.SusuMember{},
		&models.SusuContribution{}, &models.SusuPayout{},
		&models.SusuJoinRequest{},
	)

	// sokoindex migration
	dbs.SokoIndex.AutoMigrate(
		&models.ArtisanApplication{}, &models.ArtisanProfile{},
		&models.Portfolio{}, &models.SokoIndexBooking{},
		&models.SokoIndexRating{}, &models.Recommendation{},
		&models.Complaint{}, &models.SokoIndexFeatureFlag{},
		&models.SokoIndexCustomerUnlock{},
	)
	dbs.SokoIndex.FirstOrCreate(&models.SokoIndexFeatureFlag{}, models.SokoIndexFeatureFlag{ID: 1})

	// Note: sokoloan migration to be added once models are defined
	log.Println("Migrations completed successfully.")

	// ─── Real-time driver assignment notifications (Postgres LISTEN/NOTIFY) ───
	// SokoWeb's admin dashboard assigns drivers by writing straight to these
	// tables — it never calls this API — so a DB trigger is the only place
	// that reliably sees every assignment (manual admin assign today, the Go
	// auto-assign worker, and any future writer) and can pg_notify about it.
	dbs.Delivery.Exec(`
		CREATE OR REPLACE FUNCTION notify_driver_assignment() RETURNS TRIGGER AS $$
		BEGIN
			-- Only push on a genuinely new assignment (driver_id going from
			-- unset/different to set). Without this guard, every later status
			-- write on the same row (accept, picked_up, in_transit, delivered)
			-- also matches "UPDATE OF driver_id, status" below and would
			-- re-fire the same "New Delivery Assigned" push.
			IF NEW.driver_id IS NOT NULL
			   AND (TG_OP = 'INSERT' OR NEW.driver_id IS DISTINCT FROM OLD.driver_id) THEN
				PERFORM pg_notify('driver_assignment_events', json_build_object(
					'source', 'delivery',
					'driver_id', NEW.driver_id::text,
					'assignment_id', NEW.id::text,
					'order_id', NEW.order_id::text,
					'status', NEW.status::text
				)::text);
			END IF;
			RETURN NEW;
		END;
		$$ LANGUAGE plpgsql;
	`)
	dbs.Delivery.Exec(`DROP TRIGGER IF EXISTS trg_notify_driver_assignment ON delivery_assignments;`)
	dbs.Delivery.Exec(`
		CREATE TRIGGER trg_notify_driver_assignment
		AFTER INSERT OR UPDATE OF driver_id, status ON delivery_assignments
		FOR EACH ROW EXECUTE FUNCTION notify_driver_assignment();
	`)

	dbs.Shopper.Exec(`
		CREATE OR REPLACE FUNCTION notify_order_driver_assignment() RETURNS TRIGGER AS $$
		BEGIN
			-- Only push on a genuinely new assignment (driver_id going from
			-- unset/different to set). Without this guard, every later status
			-- write on the same row (accept, picked_up, in_transit, delivered)
			-- also matches "UPDATE OF driver_id, status" below and would
			-- re-fire the same "New Delivery Assigned" push.
			IF NEW.driver_id IS NOT NULL
			   AND (TG_OP = 'INSERT' OR NEW.driver_id IS DISTINCT FROM OLD.driver_id) THEN
				PERFORM pg_notify('driver_assignment_events', json_build_object(
					'source', 'shopper',
					'driver_id', NEW.driver_id::text,
					'assignment_id', NEW.id::text,
					'order_id', NEW.order_id::text,
					'status', NEW.status::text
				)::text);
			END IF;
			RETURN NEW;
		END;
		$$ LANGUAGE plpgsql;
	`)
	dbs.Shopper.Exec(`DROP TRIGGER IF EXISTS trg_notify_order_driver_assignment ON order_deliveries;`)
	dbs.Shopper.Exec(`
		CREATE TRIGGER trg_notify_order_driver_assignment
		AFTER INSERT OR UPDATE OF driver_id, status ON order_deliveries
		FOR EACH ROW EXECUTE FUNCTION notify_order_driver_assignment();
	`)

	// Start background watcher: resets driver assignments not picked up within 5 min,
	// and marks drivers offline if their app went silent (crash/logout/no network)
	// without ever telling the backend they're no longer online.
	worker.StartPickupTimeoutWatcher(dbs.Shopper, dbs.Delivery, dbs.Account)

	// WebSocket hub — manages all live mobile connections
	hub := ws.NewHub()
	hub.StartPingWorker()

	// Relay driver-assignment DB notifications to the hub in real time.
	go pgnotify.Listen(context.Background(), "sokodelivery", hub, dbs.Account)
	go pgnotify.Listen(context.Background(), "sokoshopper", hub, dbs.Account)

	r := gin.Default()

	// Explicitly set trusted proxies to nil to clear the warning log.
	// This is generally safe for local development where you expect direct connections.
	_ = r.SetTrustedProxies(nil)

	// Debug Middleware: Log incoming request IPs for better visibility
	r.Use(func(c *gin.Context) {
		log.Printf("Incoming request from: %s %s %s", c.ClientIP(), c.Request.Method, c.Request.URL.Path)
		c.Next()
	})

	// Core Middleware: CORS for browser clients (SokoWeb). The API is pure
	// Bearer-JWT with no cookie auth, so AllowCredentials isn't needed — every
	// browser call already sets Authorization explicitly. Origins are checked
	// against an explicit allowlist (see allowedOrigins above) rather than
	// accepting every origin.
	originAllowlist := allowedOrigins()
	r.Use(cors.New(cors.Config{
		AllowOriginFunc: func(origin string) bool {
			return originAllowlist[origin]
		},
		AllowMethods:  []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:  []string{"Origin", "Content-Type", "Accept", "Authorization"},
		ExposeHeaders: []string{"Content-Length"},
		MaxAge:        12 * time.Hour,
	}))

	// Health check endpoint (as mentioned in README)
	r.GET("/health", func(c *gin.Context) {
		utils.SendSuccess(c, http.StatusOK, "Service is running", gin.H{"status": "UP"})
	})

	// WebSocket endpoint — no JWT middleware; token is validated inside the handler
	r.GET("/api/v1/ws", ws.Handler(hub))

	v1 := r.Group("/api/v1")
	{
		// Auth Routes
		// Login/register/forgot-password are throttled per-IP (10 req/min) as a
		// coarse defense-in-depth layer against scripted brute force, on top of
		// the per-account lockout enforced inside auth.Login itself.
		authRateLimit := middleware.RateLimit(rateLimitRedis, "auth", 10, time.Minute)
		v1.POST("/auth/register", authRateLimit, auth.Register(dbs.Account, store, distributor))
		v1.POST("/auth/login", authRateLimit, auth.Login(dbs.Account))
		v1.POST("/auth/refresh", auth.Refresh(dbs.Account))
		v1.POST("/auth/logout", auth.Logout(dbs.Account))
		v1.GET("/auth/me", middleware.JWTAuthMiddleware(), auth.Me(dbs.Account))
		v1.PATCH("/auth/me", middleware.JWTAuthMiddleware(), auth.UpdateMe(dbs.Account))
		v1.POST("/auth/forgot-password", authRateLimit, auth.ForgotPassword(dbs.Account))
		v1.POST("/auth/verify-otp", auth.VerifyOTP(dbs.Account))
		v1.POST("/auth/reset-password", auth.ResetPassword(dbs.Account))
		v1.GET("/health", func(c *gin.Context) {
			utils.SendSuccess(c, http.StatusOK, "Service is running", gin.H{"status": "UP"})
		})

		// Media Routes
		mediaGroup := v1.Group("/media")
		{
			mediaGroup.POST("/upload", middleware.JWTAuthMiddleware(), shopper.UploadMedia(store))
			mediaGroup.GET("/serve/:bucket/*filename", func(c *gin.Context) {
				bucket := c.Param("bucket")
				filename := c.Param("filename")
				// Strip leading slash from filename to prevent double slashes in the redirect URL
				if len(filename) > 0 && filename[0] == '/' {
					filename = filename[1:]
				}

				object, err := store.Minio.GetObject(c.Request.Context(), bucket, filename, minio.GetObjectOptions{})
				if err != nil {
					c.JSON(http.StatusNotFound, gin.H{"error": "Image not found"})
					return
				}
				defer object.Close()

				stat, err := object.Stat()
				if err != nil {
					c.JSON(http.StatusNotFound, gin.H{"error": "Image not found"})
					return
				}

				c.DataFromReader(http.StatusOK, stat.Size, stat.ContentType, object, nil)
			})
		}

		// Account / KYC Routes
		accountGroup := v1.Group("/account")
		accountGroup.Use(middleware.JWTAuthMiddleware())
		{
			accountGroup.POST("/kyc", account.SubmitKYC(dbs.Account))
			accountGroup.POST("/driver-application", auth.ApplyDriver(dbs.Account))
		}

		// Webhook Routes
		webhooksGroup := v1.Group("/webhooks")
		{
			// Paystack webhook for payment event notifications (POST method)
			webhooksGroup.POST("/paystack", webhooks.HandlePaystack(dbs, distributor, hub))
			// Paystack verification for mobile app redirects (GET method)
			webhooksGroup.GET("/paystack/verify", shopper.VerifyOrderPayment(dbs.Shopper))
		}

		// Customer Shopper Routes
		customerShopper := v1.Group("/shopper")
		customerShopper.Use(middleware.JWTAuthMiddleware())
		{
			customerShopper.GET("/categories", shopper.ListCategories(dbs.Shopper))
			customerShopper.GET("/delivery-fee", shopper.GetDeliveryFee(dbs.Shopper)) // Added for Cart/Checkout
			customerShopper.GET("/stores", shopper.ListStores(dbs.Shopper, dbs.Account))
			customerShopper.GET("/categories/:id/products", shopper.GetProductsByCategory(dbs.Shopper, dbs.Account))
			customerShopper.GET("/stores/:id", shopper.GetStore(dbs.Shopper))
			customerShopper.GET("/stores/:id/products", shopper.GetProducts(dbs.Shopper))
			customerShopper.GET("/orders/verify", shopper.VerifyOrderPayment(dbs.Shopper))
			customerShopper.GET("/orders", shopper.ListOrders(dbs.Shopper, dbs.Account))
			customerShopper.GET("/orders/:id", shopper.GetOrder(dbs.Shopper, dbs.Account))
			customerShopper.GET("/orders/:id/tracking", shopper.GetOrderTracking(dbs.Shopper))
			customerShopper.GET("/orders/:id/otp", shopper.GetOrderOTP(dbs.Shopper))
			customerShopper.POST("/orders", middleware.RequireApprovedKYC(dbs.Account), shopper.CreateOrder(dbs.Shopper, hub))
			customerShopper.PATCH("/orders/:id/cancel", shopper.CancelOrder(dbs.Shopper))
			customerShopper.DELETE("/orders/:id", shopper.DeleteOrder(dbs.Shopper))
			customerShopper.POST("/orders/:id/refund", shopper.RefundOrder(dbs.Shopper))
			customerShopper.POST("/orders/:id/pay", shopper.PayOrder(dbs.Shopper, dbs.Account))
			customerShopper.POST("/orders/:id/rate", shopper.RateOrderDelivery(dbs.Shopper, dbs.Account))
			customerShopper.POST("/orders/:id/complaints", shopper.FileOrderComplaint(dbs.Shopper, dbs.Delivery))
		}

		// Delivery Routes
		deliveryGroup := v1.Group("/delivery")
		deliveryGroup.Use(middleware.JWTAuthMiddleware())
		{
			deliveryGroup.POST("/request", middleware.RequireApprovedKYC(dbs.Account), delivery.RequestDelivery(dbs.Delivery, dbs.Account))
			deliveryGroup.GET("/user/deliveries", delivery.ListUserDeliveries(dbs.Delivery, dbs.Account))
			deliveryGroup.GET("/receiver/deliveries", delivery.ListReceiverDeliveries(dbs.Delivery))
			deliveryGroup.GET("/parcel/:id", delivery.GetParcelDetail(dbs.Delivery, dbs.Account))
			deliveryGroup.GET("/parcel/:id/otp", delivery.GetParcelOTP(dbs.Delivery))
			deliveryGroup.POST("/parcel/:id/pay", delivery.InitiatePayment(dbs.Delivery, dbs.Account))
			deliveryGroup.GET("/verify-payment", delivery.VerifyDeliveryPayment(dbs.Delivery))
			deliveryGroup.GET("/estimate", delivery.GetPriceEstimate)
			deliveryGroup.POST("/parcel/:id/rate", delivery.RateParcelDelivery(dbs.Delivery, dbs.Account))
			deliveryGroup.POST("/parcel/:id/complaints", delivery.FileParcelComplaint(dbs.Delivery))

			// Driver Specific Routes (matching DriverDashboardScreen.tsx)
			driver := deliveryGroup.Group("/driver")
			driver.Use(middleware.AuthorizeRoles(models.RoleDriver, models.RoleSuperAdmin))
			{
				driver.GET("/order-deliveries", shopper.ListDriverOrderDeliveries(dbs.Shopper, dbs.Account))
				driver.GET("/order-deliveries/:id", shopper.GetOrderDeliveryDetail(dbs.Shopper, dbs.Account))
				driver.POST("/order-deliveries/:id/otp/generate", shopper.GenerateOrderOTP(dbs.Shopper))
				driver.POST("/order-deliveries/:id/otp/verify", shopper.VerifyOrderOTP(dbs.Shopper, dbs.Account))

				driver.GET("/deliveries", delivery.ListDriverDeliveries(dbs.Delivery))
				driver.GET("/deliveries/:id", delivery.GetDeliveryDetail(dbs.Delivery))
				driver.POST("/deliveries/:id/accept", delivery.AcceptDelivery(dbs.Delivery, dbs.Account))
				driver.PATCH("/deliveries/:id/status", delivery.UpdateStatus(dbs.Delivery, hub))
				driver.POST("/deliveries/:id/otp/generate", delivery.GenerateOTP(dbs.Delivery))
				driver.POST("/deliveries/:id/otp/verify", delivery.VerifyOTP(dbs.Delivery, dbs.Account))
				driver.POST("/location", delivery.UpdateLocation(dbs.Delivery, dbs.Shopper, dbs.Account))
				driver.PUT("/online-status", delivery.ToggleOnlineStatus(dbs.Account, hub))
				driver.POST("/push-token", delivery.RegisterPushToken(dbs.Account))
				driver.PATCH("/orders/:id/tracking", shopper.UpdateOrderTracking(dbs.Shopper, hub))
				driver.GET("/earnings", delivery.GetDriverEarnings(dbs.Delivery, dbs.Shopper))
				driver.POST("/cashout", delivery.RequestCashout(dbs.Delivery, dbs.Shopper))
			}
		}

		// Protected Shopper Admin Routes
		shopperAdmin := v1.Group("/shopper/admin")
		shopperAdmin.Use(middleware.JWTAuthMiddleware())
		shopperAdmin.Use(middleware.AuthorizeRoles(models.RoleShopperAdmin, models.RoleSuperAdmin))
		{
			// Admin-only shopper routes can be added here
			shopperAdmin.GET("/stores/:id/orders", shopper.ListStoreOrders(dbs.Shopper, dbs.Account))
			shopperAdmin.POST("/categories", shopper.CreateCategory(dbs.Shopper))
		}

		// SokoSusu Routes
		susuGroup := v1.Group("/susu")
		susuGroup.Use(middleware.JWTAuthMiddleware())
		{
			susuGroup.GET("/groups", sokosusu.ListGroups(dbs.Susu))
			susuGroup.GET("/groups/discover", sokosusu.DiscoverGroups(dbs.Susu))
			susuGroup.POST("/groups", sokosusu.CreateGroup(dbs.Susu))
			susuGroup.GET("/groups/:id", sokosusu.GetGroup(dbs.Susu))
			susuGroup.POST("/groups/:id/join", middleware.RequireApprovedKYC(dbs.Account), sokosusu.RequestToJoin(dbs.Susu))
			susuGroup.GET("/groups/:id/join-requests", sokosusu.ListJoinRequests(dbs.Susu))
			susuGroup.POST("/groups/:id/join-requests/:requestId/approve", sokosusu.ApproveJoinRequest(dbs.Susu))
			susuGroup.POST("/groups/:id/join-requests/:requestId/reject", sokosusu.RejectJoinRequest(dbs.Susu))
			susuGroup.POST("/groups/:id/contribute", sokosusu.Contribute(dbs.Susu))
			susuGroup.GET("/groups/:id/contributions", sokosusu.ListContributions(dbs.Susu))
			susuGroup.GET("/groups/:id/payouts", sokosusu.ListPayouts(dbs.Susu))
		}

		// SokoIndex Routes (artisan marketplace)
		sokoIndexGroup := v1.Group("/sokoindex")
		{
			// Public browse (no auth required) — optional auth still lets a
			// logged-in caller's own country surface their local artisans first.
			sokoIndexGroup.GET("/artisans", middleware.OptionalJWTAuthMiddleware(), sokoindex.ListArtisans(dbs.SokoIndex, dbs.Account))
			sokoIndexGroup.GET("/feature-flags", sokoindex.GetFeatureFlags(dbs.SokoIndex))

			authed := sokoIndexGroup.Group("")
			authed.Use(middleware.JWTAuthMiddleware())
			{
				// Moved behind auth (was public) so the contact-unlock paywall can be
				// gated per logged-in customer instead of being all-or-nothing.
				authed.GET("/artisans/:id", sokoindex.GetArtisanDetail(dbs.SokoIndex, dbs.Account))
				authed.POST("/apply", sokoindex.Apply(dbs.SokoIndex, dbs.Account))
				authed.GET("/application/status", sokoindex.GetApplicationStatus(dbs.SokoIndex))
				authed.GET("/me", sokoindex.Me(dbs.SokoIndex, dbs.Account))
				authed.GET("/bookings/:id", sokoindex.GetBooking(dbs.SokoIndex, dbs.Account))
				authed.POST("/payments/initialize", sokoindex.InitializePayment(dbs.SokoIndex, dbs.Account))
				authed.GET("/payments/verify", sokoindex.VerifyPayment(dbs.SokoIndex))

				// Customer actions
				authed.POST("/bookings", middleware.RequireApprovedKYC(dbs.Account), sokoindex.CreateBooking(dbs.SokoIndex))
				authed.GET("/bookings", sokoindex.ListMyBookings(dbs.SokoIndex, dbs.Account))
				authed.PUT("/bookings/:id/cancel", sokoindex.CancelBooking(dbs.SokoIndex))
				authed.PUT("/bookings/:id/confirm-completion", sokoindex.ConfirmBookingCompletion(dbs.SokoIndex))
				authed.POST("/bookings/:id/rate", sokoindex.RateBooking(dbs.SokoIndex))
				authed.POST("/bookings/:id/recommend", sokoindex.RecommendArtisan(dbs.SokoIndex))
				authed.POST("/bookings/:id/complaints", sokoindex.FileComplaint(dbs.SokoIndex))

				// Artisan-only actions
				artisanOnly := authed.Group("")
				artisanOnly.Use(middleware.AuthorizeRoles(models.RoleArtisan, models.RoleSuperAdmin))
				{
					artisanOnly.GET("/profile", sokoindex.GetMyProfile(dbs.SokoIndex, dbs.Account))
					artisanOnly.PUT("/profile", sokoindex.UpdateMyProfile(dbs.SokoIndex))
					artisanOnly.POST("/portfolio", sokoindex.CreatePortfolio(dbs.SokoIndex))
					artisanOnly.PUT("/portfolio/:id", sokoindex.UpdatePortfolio(dbs.SokoIndex))
					artisanOnly.GET("/portfolio", sokoindex.ListMyPortfolio(dbs.SokoIndex))
					artisanOnly.GET("/artisan/bookings", sokoindex.ListIncomingBookings(dbs.SokoIndex, dbs.Account))
					artisanOnly.GET("/artisan/ratings", sokoindex.ListMyRatings(dbs.SokoIndex, dbs.Account))
					artisanOnly.PUT("/artisan/bookings/:id/accept", sokoindex.AcceptBooking(dbs.SokoIndex))
					artisanOnly.PUT("/artisan/bookings/:id/reject", sokoindex.RejectBooking(dbs.SokoIndex))
					artisanOnly.PUT("/artisan/bookings/:id/complete", sokoindex.CompleteBooking(dbs.SokoIndex))
				}
			}
		}

		// SokoLoan Routes
		loanGroup := v1.Group("/loan")
		loanGroup.Use(middleware.JWTAuthMiddleware())
		{
			// loanGroup.POST("/apply", loan.Apply(dbs.Loan))
		}

		// SokoBank Routes
		bankGroup := v1.Group("/bank")
		bankGroup.Use(middleware.JWTAuthMiddleware())
		{
			// bankGroup.GET("/balance", bank.GetBalance(dbs.Bank))
		}
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8082"
	}
	r.Run(":" + port)
}
