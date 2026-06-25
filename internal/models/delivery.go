package models

import (
	"time"

	"github.com/google/uuid"
)

// --- ENUM TYPES ---
type DeliveryStatus string

const (
	DelPending         DeliveryStatus = "pending"
	DelBroadcast       DeliveryStatus = "broadcast"
	DelAssigned        DeliveryStatus = "assigned"   // admin assigned, driver not yet accepted
	DelAccepted        DeliveryStatus = "accepted"   // driver confirmed the job
	DelArrivedAtVendor DeliveryStatus = "arrived_at_vendor"
	DelPickedUp        DeliveryStatus = "picked_up"
	DelInTransit       DeliveryStatus = "in_transit"
	DelArrivedCustomer DeliveryStatus = "arrived_at_customer"
	DelDelivered       DeliveryStatus = "delivered"
	DelFailed          DeliveryStatus = "failed"
	DelCancelled       DeliveryStatus = "cancelled"
)

type DeliverySource string

const (
	SourceShopper  DeliverySource = "sokoshopper"
	SourceDelivery DeliverySource = "sokodelivery"
)

type EarningStatus string

const (
	EarningPending EarningStatus = "pending"
	EarningSettled EarningStatus = "settled"
	EarningOnHold  EarningStatus = "on_hold"
)

// --- DELIVERY ZONES ---
type DeliveryZone struct {
	ID        uuid.UUID `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()"`
	Name      string    `gorm:"size:100;not null"`
	City      string    `gorm:"size:100"`
	Country   string    `gorm:"size:100;default:'Ghana'"`
	Boundary  string    `gorm:"type:geometry(Polygon, 4326)"` // Handled via PostGIS
	BaseFee   float64   `gorm:"type:decimal(10,2);not null;default:5.00"`
	PerKmRate float64   `gorm:"type:decimal(10,2);not null;default:2.00"`
	IsActive  bool      `gorm:"default:true"`
	CreatedAt time.Time
}

// --- DELIVERY ASSIGNMENTS ---
type DeliveryAssignment struct {
	ID               uuid.UUID      `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()"`
	OrderID          uuid.UUID      `gorm:"not null"`
	Source           DeliverySource `gorm:"type:delivery_source_enum;default:'sokoshopper'"`
	DriverUserID     *uuid.UUID     `gorm:"type:uuid;column:driver_id"`
	Status           DeliveryStatus `gorm:"type:delivery_status_enum;default:'pending'"`
	PickupAddress    string         `gorm:"not null"`
	PickupLat        float64        `gorm:"type:decimal(10,8);not null"`
	PickupLng        float64        `gorm:"type:decimal(11,8);not null"`
	DropoffAddress   string         `gorm:"not null"`
	DropoffLat       float64        `gorm:"type:decimal(10,8);not null"`
	DropoffLng       float64        `gorm:"type:decimal(11,8);not null"`
	DistanceKm       *float64       `gorm:"type:decimal(8,3)"`
	BroadcastAt      *time.Time
	AcceptedAt       *time.Time
	ArrivedVendorAt  *time.Time
	PickedUpAt       *time.Time
	DeliveredAt      *time.Time
	FailedAt         *time.Time
	FailReason       string
	DeliveryFee      float64 `gorm:"type:decimal(10,2);not null;default:0.00"`
	DriverEarnings   float64 `gorm:"type:decimal(10,2);not null;default:0.00"`
	PlatformCut      float64 `gorm:"type:decimal(10,2);not null;default:0.00"`
	DeliveryPin      string     `gorm:"size:6"`
	DeliveryPhotoURL string     `gorm:"column:delivery_photo_url"`
	IsExpress        bool       `gorm:"default:false"`
	IsFragile        bool       `gorm:"default:false"`
	CustomerRating   int16      `gorm:"default:0"`
	CustomerReview   string     `gorm:"type:text"`
	RatedAt          *time.Time
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

// --- DRIVER EARNINGS ---
type DriverEarning struct {
	ID           uuid.UUID     `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()"`
	DriverUserID uuid.UUID     `gorm:"not null"`
	AssignmentID *uuid.UUID    `gorm:"type:uuid"`
	Amount       float64       `gorm:"type:decimal(10,2);not null"`
	Bonus        float64       `gorm:"type:decimal(10,2);default:0.00"`
	Status       EarningStatus `gorm:"type:earning_status_enum;default:'pending'"`
	PeriodStart  *time.Time    `gorm:"type:date"`
	PeriodEnd    *time.Time    `gorm:"type:date"`
	SettledAt    *time.Time
	PaymentRef   string `gorm:"size:100"`
	CreatedAt    time.Time
}

// --- DELIVERY ORDERS ---
type DeliveryOrder struct {
	ID                    uuid.UUID `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()" json:"id"`
	UserID                uuid.UUID `gorm:"not null" json:"user_id"`
	Description           string    `gorm:"not null" json:"description"`
	PackageSize           string    `gorm:"size:20" json:"package_size"`
	PickupAddress         string    `gorm:"not null" json:"pickup_address"`
	PickupLat             float64   `gorm:"type:decimal(10,8)" json:"pickup_lat"`
	PickupLng             float64   `gorm:"type:decimal(11,8)" json:"pickup_lng"`
	DropoffAddress        string    `gorm:"not null" json:"dropoff_address"`
	DropoffLat            float64   `gorm:"type:decimal(10,8)" json:"dropoff_lat"`
	DropoffLng            float64   `gorm:"type:decimal(11,8)" json:"dropoff_lng"`
	ReceiverName          string    `gorm:"size:150" json:"receiver_name"`
	ReceiverPhone         string    `gorm:"size:20" json:"receiver_phone"`
	ReceiverLocationNotes string    `gorm:"type:text" json:"receiver_location_notes"`
	SenderName            string    `gorm:"size:150" json:"sender_name"`
	SenderPhone           string    `gorm:"size:20" json:"sender_phone"`
	SenderImageURL        string    `gorm:"type:text" json:"sender_image_url"`
	TotalAmount           float64    `gorm:"type:decimal(10,2);not null" json:"total_amount"`
	PaymentStatus         string     `gorm:"size:20;default:'pending'" json:"payment_status"`
	PaystackRef           string     `gorm:"size:100;unique" json:"paystack_ref"`
	PayerType             string     `gorm:"size:20;default:'sender'" json:"payer_type"` // sender | receiver
	ReceiverUserID        *uuid.UUID `gorm:"type:uuid" json:"receiver_user_id"`
	VehicleType           string     `gorm:"size:30" json:"vehicle_type"`
	DistanceKm            float64    `gorm:"type:decimal(8,3)" json:"distance_km"`
	CreatedAt             time.Time
	UpdatedAt             time.Time
}

// DriverCashoutRequest tracks cashout requests made by drivers against their
// earned balance. Status: pending → paid (admin confirms) | rejected.
type DriverCashoutRequest struct {
	ID           uuid.UUID `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()" json:"id"`
	DriverUserID uuid.UUID `gorm:"not null" json:"driver_user_id"`
	Amount       float64   `gorm:"type:decimal(10,2);not null" json:"amount"`
	Method       string    `gorm:"size:20" json:"method"` // momo | bank
	Status       string    `gorm:"size:20;default:'pending'" json:"status"` // pending | paid | rejected
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

func (DeliveryZone) TableName() string            { return "delivery_zones" }
func (DeliveryAssignment) TableName() string      { return "delivery_assignments" }
func (DriverEarning) TableName() string           { return "driver_earnings" }
func (DeliveryOrder) TableName() string           { return "delivery_orders" }
func (DriverCashoutRequest) TableName() string    { return "driver_cashout_requests" }
