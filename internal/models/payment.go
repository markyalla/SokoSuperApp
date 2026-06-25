package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// PaymentStatusEnum defines the possible statuses for a payment.
type PaymentStatusEnum string

const (
	PaymentPending  PaymentStatusEnum = "pending"
	PaymentSuccess  PaymentStatusEnum = "success"
	PaymentFailed   PaymentStatusEnum = "failed"
	PaymentRefunded PaymentStatusEnum = "refunded"
)

// Payment represents a payment transaction in the system.
type Payment struct {
	gorm.Model
	ID                    uuid.UUID         `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()" json:"id"`
	OrderID               uuid.UUID         `gorm:"type:uuid;not null" json:"order_id"`
	Amount                float64           `gorm:"type:numeric(10,2);not null" json:"amount"`
	Currency              string            `gorm:"type:varchar(3);not null" json:"currency"` // e.g., GHS, USD
	Status                PaymentStatusEnum `gorm:"type:payment_status_enum;default:'pending';not null" json:"status"`
	PaymentMethod         string            `gorm:"type:varchar(50)" json:"payment_method"` // e.g., "paystack", "sokopay"
	PaystackReference     string            `gorm:"type:varchar(255);uniqueIndex" json:"paystack_reference"`
	PaystackTransactionID string            `gorm:"type:varchar(255)" json:"paystack_transaction_id"`
	CreatedAt             time.Time         `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt             time.Time         `gorm:"autoUpdateTime" json:"updated_at"`
}
