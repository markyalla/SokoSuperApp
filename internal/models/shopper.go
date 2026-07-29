package models

import (
	"time"

	"github.com/google/uuid"
)

// --- ENUM TYPES ---
type OrderStatus string

const (
	OrderPending          OrderStatus = "pending"
	OrderPaymentPending   OrderStatus = "payment_pending"
	OrderPaymentConfirmed OrderStatus = "payment_confirmed"
	OrderPreparing        OrderStatus = "preparing"
	OrderReadyForPickup   OrderStatus = "ready_for_pickup"
	OrderAssignedToDriver OrderStatus = "assigned_to_driver"
	OrderPickedUp         OrderStatus = "picked_up"
	OrderInTransit        OrderStatus = "in_transit"
	OrderDelivered        OrderStatus = "delivered"
	OrderCancelled        OrderStatus = "cancelled"
	OrderRefunded         OrderStatus = "refunded"
)

type PaymentStatus string

const (
	PayPending   PaymentStatus = "pending"
	PayInitiated PaymentStatus = "initiated"
	PaySuccess   PaymentStatus = "success"
	PayFailed    PaymentStatus = "failed"
	PayRefunded  PaymentStatus = "refunded"
)

type StoreStatus string

const (
	StoreActive    StoreStatus = "active"
	StoreInactive  StoreStatus = "inactive"
	StoreSuspended StoreStatus = "suspended"
)

// --- CATEGORIES ---
type Category struct {
	ID        uuid.UUID `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()" json:"id"`
	Name      string    `gorm:"size:100;not null;unique" json:"name"`
	Slug      string    `gorm:"size:120;not null;unique" json:"slug"`
	ImageURL  string    `gorm:"column:image_url" json:"image_url"`
	SortOrder int16     `gorm:"default:0" json:"sort_order"`
	IsActive  bool      `gorm:"default:true" json:"is_active"`
	CreatedAt time.Time
}

// --- STORES (Retailers, Restaurants, etc.) ---
type Store struct {
	ID                uuid.UUID   `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()" json:"id"`
	OwnerUserID       uuid.UUID   `gorm:"not null" json:"owner_user_id"`
	CategoryID        *uuid.UUID  `gorm:"type:uuid" json:"category_id"`
	Category          Category    `gorm:"foreignKey:CategoryID" json:"category"`
	Name              string      `gorm:"size:200;not null" json:"name"`
	Slug              string      `gorm:"size:220;not null;unique" json:"slug"`
	Description       string      `json:"description"`
	LogoURL           string      `gorm:"column:logo_url" json:"logo_url"`
	CoverImageURL     string      `gorm:"column:cover_image_url" json:"cover_image_url"`
	PhoneNumber       string      `gorm:"size:20" json:"phone_number"`
	Email             string      `gorm:"size:255" json:"email"`
	Address           string      `gorm:"not null" json:"address"`
	City              string      `gorm:"size:100" json:"city"`
	Country           string      `gorm:"size:100;default:'Ghana'" json:"country"`
	Lat               float64     `gorm:"type:decimal(10,8)" json:"lat"`
	Lng               float64     `gorm:"type:decimal(11,8)" json:"lng"`
	Status            StoreStatus `gorm:"type:store_status_enum;default:'active'" json:"status"`
	Rating            float64     `gorm:"type:decimal(3,2);default:0.00" json:"rating"`
	TotalReviews      int         `gorm:"default:0" json:"total_reviews"`
	DeliveryFee       float64     `gorm:"type:decimal(10,2);default:0.00" json:"delivery_fee"`
	MinOrderAmount    float64     `gorm:"type:decimal(10,2);default:0.00" json:"min_order_amount"`
	AvgProcessingTime int16       `gorm:"default:30" json:"avg_processing_time"`
	IsOpen            bool        `gorm:"default:true" json:"is_open"`
	OpensAt           *string     `gorm:"type:time"`
	ClosesAt          *string     `gorm:"type:time"`
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

// --- STORE SECTIONS ---
type StoreSection struct {
	ID        uuid.UUID `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()"`
	StoreID   uuid.UUID `gorm:"not null"`
	Name      string    `gorm:"size:100;not null"`
	SortOrder int16     `gorm:"default:0"`
	IsActive  bool      `gorm:"default:true"`
	CreatedAt time.Time
}

// --- PRODUCTS ---
type Product struct {
	ID             uuid.UUID  `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()" json:"id"`
	StoreID        uuid.UUID  `gorm:"not null" json:"store_id"`
	CategoryID     *uuid.UUID `gorm:"type:uuid" json:"category_id"`
	SectionID      *uuid.UUID `gorm:"type:uuid" json:"section_id"`
	Name           string     `gorm:"size:200;not null" json:"name"`
	Description    string     `json:"description"`
	ImageURL       string     `gorm:"column:image_url" json:"image_url"`
	BasePrice      float64    `gorm:"type:decimal(10,2);not null" json:"base_price"`
	DiscountPrice  *float64   `gorm:"type:decimal(10,2)" json:"discount_price"`
	IsAvailable    bool       `gorm:"default:true" json:"is_available"`
	IsFeatured     bool       `gorm:"default:false" json:"is_featured"`
	ProcessingTime int16      `json:"processing_time"` // Time to prepare/pack
	WeightKg       float64    `gorm:"type:decimal(10,2)" json:"weight_kg"`
	Metadata       string     `gorm:"type:jsonb" json:"metadata"` // For size, color, calories, etc.
	Tags           []string   `gorm:"type:text[]" json:"tags"`
	SortOrder      int16      `gorm:"default:0" json:"sort_order"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
}

// --- PRODUCT ADD-ONS / VARIANTS ---
type ProductAddon struct {
	ID         uuid.UUID `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()"`
	ProductID  uuid.UUID `gorm:"not null"`
	Name       string    `gorm:"size:100;not null"`
	ExtraPrice float64   `gorm:"type:decimal(10,2);not null;default:0.00"`
	IsRequired bool      `gorm:"default:false"`
	MaxSelect  int16     `gorm:"default:1"`
}

// --- CARTS ---
type Cart struct {
	ID        uuid.UUID `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()"`
	UserID    uuid.UUID `gorm:"not null;uniqueIndex:idx_user_store"`
	StoreID   uuid.UUID `gorm:"not null"`
	CreatedAt time.Time
	UpdatedAt time.Time
	Items     []CartItem `gorm:"foreignKey:CartID"`
}

type CartItem struct {
	ID          uuid.UUID `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()"`
	CartID      uuid.UUID `gorm:"not null"`
	ProductID   uuid.UUID `gorm:"not null"`
	Quantity    int16     `gorm:"default:1"`
	UnitPrice   float64   `gorm:"type:decimal(10,2);not null"`
	Options     *string   `gorm:"type:jsonb"` // Selected color, size, or food addons
	SpecialNote string
	CreatedAt   time.Time
}

// --- ORDERS ---
type Order struct {
	ID                    uuid.UUID   `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()"`
	UserID                uuid.UUID   `gorm:"not null"`
	StoreID               uuid.UUID   `gorm:"not null"`
	DriverUserID          *uuid.UUID  `gorm:"type:uuid"`
	Status                OrderStatus `gorm:"type:order_status_enum;default:'pending'"`
	Subtotal              float64     `gorm:"type:decimal(10,2);not null"`
	DeliveryFee           float64     `gorm:"type:decimal(10,2);default:0.00"`
	DiscountAmount        float64     `gorm:"type:decimal(10,2);default:0.00"`
	TotalAmount           float64     `gorm:"type:decimal(10,2);not null"`
	DeliveryAddress       string      `gorm:"not null"`
	DeliveryLat           float64     `gorm:"type:decimal(10,8)"`
	DeliveryLng           float64     `gorm:"type:decimal(11,8)"`
	DeliveryInstructions  string
	EstimatedPrepMins     int16
	EstimatedDeliveryMins int16
	AcceptedAt            *time.Time
	ReadyAt               *time.Time
	DriverAssignedAt      *time.Time // set when admin assigns a driver; cleared on timeout/pickup
	PickedUpAt            *time.Time
	DeliveredAt           *time.Time
	CancelledAt           *time.Time
	CancelReason          string
	PaystackReference     string `gorm:"size:100;unique"`
	PromoCode             string `gorm:"size:50"`
	CustomerHiddenAt      *time.Time
	CreatedAt             time.Time
	UpdatedAt             time.Time
	Items                 []OrderItem `gorm:"foreignKey:OrderID"`
}

type OrderItem struct {
	ID          uuid.UUID `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()" json:"id"`
	OrderID     uuid.UUID `gorm:"not null" json:"order_id"`
	ProductID   uuid.UUID `gorm:"not null" json:"product_id"`
	Name        string    `gorm:"size:200;not null" json:"name"`
	Quantity    int16     `gorm:"not null" json:"quantity"`
	UnitPrice   float64   `gorm:"type:decimal(10,2);not null" json:"unit_price"`
	Options     *string   `gorm:"type:jsonb" json:"options"`
	SpecialNote string    `json:"special_note"`
	ImageURL    string    `gorm:"column:image_url" json:"image_url"`
}
type OrderDelivery struct {
	ID          uuid.UUID  `gorm:"type:uuid;primaryKey;default:gen_random_uuid()"`
	OrderID     uuid.UUID  `gorm:"type:uuid;not null;uniqueIndex"`
	Order       Order      `gorm:"foreignKey:OrderID" json:"order"`
	DriverID    *uuid.UUID `gorm:"type:uuid"`
	Status      string     `gorm:"type:varchar(50);default:'pending'"`
	OTP            string     `gorm:"size:6"`
	CurrentLat     float64    `gorm:"type:decimal(10,8)"`
	CurrentLng     float64    `gorm:"type:decimal(11,8)"`
	CustomerRating int16      `gorm:"default:0"`
	CustomerReview string     `gorm:"type:text"`
	RatedAt        *time.Time
	PickedUpAt     *time.Time
	DeliveredAt    *time.Time
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

// HolidayPricingSetting is a per-country toggle + percentage for holiday
// surge pricing, editable from the superadmin panel. One row per country —
// only "Ghana" exists today, but the country_name/country_code columns let
// other African markets get their own row (and holiday calendar) later
// without a schema change.
type HolidayPricingSetting struct {
	ID           uuid.UUID `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()" json:"id"`
	CountryCode  string    `gorm:"size:2;uniqueIndex;not null" json:"country_code"`
	CountryName  string    `gorm:"size:100;not null" json:"country_name"`
	SurchargePct float64   `gorm:"type:decimal(5,2);not null;default:0" json:"surcharge_pct"`
	Enabled      bool      `gorm:"default:false" json:"enabled"`
	UpdatedAt    time.Time `json:"updated_at"`
}

func (HolidayPricingSetting) TableName() string { return "holiday_pricing_settings" }

// ShopCashoutRequest tracks store-owner-initiated payout requests for their
// 80% share of completed product sales.
type ShopCashoutRequest struct {
	ID                uuid.UUID  `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()" json:"id"`
	StoreID           uuid.UUID  `gorm:"not null" json:"store_id"`
	OwnerUserID       *uuid.UUID `gorm:"type:uuid" json:"owner_user_id"` // snapshot of Store.OwnerUserID at request time; cross-DB, no FK
	Amount            float64    `gorm:"type:decimal(10,2);not null" json:"amount"`
	Method            string     `gorm:"size:20" json:"method"` // momo | bank | cash
	MomoNumber        string     `gorm:"size:20" json:"momo_number"`
	BankAccountHolder string     `gorm:"size:150" json:"bank_account_holder"`
	BankAccountNumber string     `gorm:"size:50" json:"bank_account_number"`
	BankName          string     `gorm:"size:150" json:"bank_name"`
	BankBranch        string     `gorm:"size:150" json:"bank_branch"`
	Status            string     `gorm:"size:20;default:'pending'" json:"status"` // pending | paid | rejected (unused) | needs_correction
	CorrectionMessage string     `gorm:"type:text" json:"correction_message"`
	Note              string     `gorm:"type:text" json:"note"` // owner's optional free-text comment only
	CreatedAt         time.Time  `json:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at"`
}

func (Category) TableName() string           { return "categories" }
func (Store) TableName() string              { return "stores" }
func (StoreSection) TableName() string       { return "store_sections" }
func (Product) TableName() string            { return "products" }
func (ProductAddon) TableName() string       { return "product_addons" }
func (Cart) TableName() string               { return "carts" }
func (CartItem) TableName() string           { return "cart_items" }
func (Order) TableName() string              { return "orders" }
func (OrderItem) TableName() string          { return "order_items" }
func (OrderDelivery) TableName() string      { return "order_deliveries" }
func (ShopCashoutRequest) TableName() string { return "shop_cashout_requests" }
