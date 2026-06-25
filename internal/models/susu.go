package models

import (
	"time"

	"github.com/google/uuid"
)

type SusuGroup struct {
	ID                 uuid.UUID          `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()" json:"id"`
	Name               string             `gorm:"size:150;not null" json:"name"`
	ContributionAmount float64            `gorm:"type:decimal(18,2);not null" json:"contribution_amount"`
	CyclePeriod        string             `gorm:"default:'monthly'" json:"cycle_period"`
	MaxMembers         int                `json:"max_members"`
	Status             string             `gorm:"default:'forming'" json:"status"`
	CreatedAt          time.Time          `json:"created_at"`
	Contributions      []SusuContribution `gorm:"foreignKey:GroupID" json:"-"`
	Payouts            []SusuPayout       `gorm:"foreignKey:GroupID" json:"-"`
}

type SusuMember struct {
	GroupID  uuid.UUID `gorm:"type:uuid;primaryKey" json:"group_id"`
	UserID   uuid.UUID `gorm:"type:uuid;primaryKey" json:"user_id"`
	JoinedAt time.Time `json:"joined_at"`
	IsAdmin  bool      `gorm:"default:false" json:"is_admin"`
	Position int       `json:"position"`
}

type SusuContribution struct {
	ID            uuid.UUID `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()" json:"id"`
	GroupID       uuid.UUID `gorm:"type:uuid;not null" json:"group_id"`
	UserID        uuid.UUID `gorm:"type:uuid;not null" json:"user_id"`
	Amount        float64   `gorm:"type:decimal(18,2);not null" json:"amount"`
	TransactionID uuid.UUID `gorm:"type:uuid" json:"transaction_id,omitempty"`
	CycleNumber   int       `gorm:"not null" json:"cycle_number"`
	CreatedAt     time.Time `gorm:"default:now()" json:"created_at"`
}

type SusuPayout struct {
	ID            uuid.UUID `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()" json:"id"`
	GroupID       uuid.UUID `gorm:"type:uuid;not null" json:"group_id"`
	UserID        uuid.UUID `gorm:"type:uuid;not null" json:"user_id"`
	Amount        float64   `gorm:"type:decimal(18,2);not null" json:"amount"`
	TransactionID uuid.UUID `gorm:"type:uuid" json:"transaction_id,omitempty"`
	PayoutDate    time.Time `gorm:"default:now()" json:"payout_date"`
	CycleNumber   int       `gorm:"not null" json:"cycle_number"`
}

// SusuJoinRequest tracks a user's request to join a group pending admin approval.
type SusuJoinRequest struct {
	ID        uuid.UUID `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()" json:"id"`
	GroupID   uuid.UUID `gorm:"type:uuid;not null;index" json:"group_id"`
	UserID    uuid.UUID `gorm:"type:uuid;not null" json:"user_id"`
	Status    string    `gorm:"default:'pending'" json:"status"`
	CreatedAt time.Time `gorm:"default:now()" json:"created_at"`
}
