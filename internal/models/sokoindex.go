package models

import (
	"time"

	"github.com/google/uuid"
)

// --- ENUM TYPES ---

type ArtisanApplicationStatus string

const (
	ArtisanApplicationPending  ArtisanApplicationStatus = "pending"
	ArtisanApplicationApproved ArtisanApplicationStatus = "approved"
	ArtisanApplicationRejected ArtisanApplicationStatus = "rejected"
)

type PortfolioStatus string

const (
	PortfolioPending  PortfolioStatus = "pending"
	PortfolioApproved PortfolioStatus = "approved"
	PortfolioRejected PortfolioStatus = "rejected"
)

type SokoIndexBookingStatus string

const (
	SokoIndexBookingPending             SokoIndexBookingStatus = "pending"
	SokoIndexBookingAccepted            SokoIndexBookingStatus = "accepted"
	SokoIndexBookingRejected            SokoIndexBookingStatus = "rejected"
	SokoIndexBookingAwaitingConfirmation SokoIndexBookingStatus = "awaiting_confirmation"
	SokoIndexBookingCompleted           SokoIndexBookingStatus = "completed"
	SokoIndexBookingCancelled           SokoIndexBookingStatus = "cancelled"
)

type ContactPaymentStatus string

const (
	ContactPaymentPending  ContactPaymentStatus = "pending"
	ContactPaymentPaid     ContactPaymentStatus = "paid"
	ContactPaymentBypassed ContactPaymentStatus = "bypassed"
)

type ComplaintStatus string

const (
	ComplaintOpen       ComplaintStatus = "open"
	ComplaintInReview   ComplaintStatus = "in_review"
	ComplaintResolved   ComplaintStatus = "resolved"
	ComplaintDismissed  ComplaintStatus = "dismissed"
)

// --- ARTISAN APPLICATIONS ---
// Mirrors the DriverProfile application flow: a user applies, an admin
// approves/rejects in SokoWeb, and approval grants the `artisan` role
// plus creates the ArtisanProfile. Identity verification (name, ID
// number/photo) is NOT collected here — it's already covered by the
// user's sokoaccount KYC submission, which Apply() requires to be
// approved before an application can even be submitted.
type ArtisanApplication struct {
	ID              uuid.UUID                `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()" json:"id"`
	UserID          uuid.UUID                `gorm:"type:uuid;not null;index"                        json:"user_id"`
	Bio             string                   `gorm:"type:text;not null"                              json:"bio"`
	TradeCategory   string                   `gorm:"size:100;not null"                               json:"trade_category"`
	LocationText    string                   `gorm:"size:255"                                        json:"location_text"`
	LocationLat     float64                  `gorm:"type:decimal(10,7)"                              json:"location_lat"`
	LocationLng     float64                  `gorm:"type:decimal(10,7)"                              json:"location_lng"`
	Status          ArtisanApplicationStatus `gorm:"type:artisan_application_status_enum;default:'pending'" json:"status"`
	RejectionReason string                   `gorm:"type:text"                                       json:"rejection_reason,omitempty"`
	ReviewedBy      *uuid.UUID               `gorm:"type:uuid"                                       json:"reviewed_by,omitempty"`
	SubmittedAt     time.Time                `gorm:"default:now()"                                   json:"submitted_at"`
	ReviewedAt      *time.Time               `                                                       json:"reviewed_at,omitempty"`
}

// --- ARTISAN PROFILES ---
type ArtisanProfile struct {
	ID                   uuid.UUID `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()" json:"id"`
	UserID               uuid.UUID `gorm:"type:uuid;not null;uniqueIndex"                  json:"user_id"`
	DisplayName          string    `gorm:"size:150;not null"                               json:"display_name"`
	Bio                  string    `gorm:"type:text"                                       json:"bio"`
	TradeCategory        string    `gorm:"size:100;not null;index"                         json:"trade_category"`
	LocationText         string    `gorm:"size:255"                                        json:"location_text"`
	LocationLat          float64   `gorm:"type:decimal(10,7)"                              json:"location_lat"`
	LocationLng          float64   `gorm:"type:decimal(10,7)"                              json:"location_lng"`
	ProfileImagePath     string    `gorm:"column:profile_image_path"                       json:"profile_image_path"`
	AvgRating            float64   `gorm:"type:decimal(3,2);default:0.00"                  json:"avg_rating"`
	RatingCount          int       `gorm:"default:0"                                       json:"rating_count"`
	RecommendationCount  int       `gorm:"default:0"                                       json:"recommendation_count"`
	IsPublished          bool      `gorm:"default:false"                                   json:"is_published"`
	IsSuspended          bool      `gorm:"default:false"                                   json:"is_suspended"`
	SuspensionReason     string    `gorm:"type:text"                                       json:"suspension_reason,omitempty"`
	JoiningFeePaid       bool      `gorm:"default:false"                                   json:"joining_fee_paid"`
	JoiningPaymentRef    string    `gorm:"size:255"                                        json:"joining_payment_ref,omitempty"`
	ContactUnlockPaid    bool      `gorm:"default:false"                                   json:"contact_unlock_paid"`
	ContactUnlockPaymentRef string `gorm:"size:255"                                        json:"contact_unlock_payment_ref,omitempty"`
	CreatedAt            time.Time `                                                       json:"created_at"`
	UpdatedAt            time.Time `                                                       json:"updated_at"`
}

// --- PORTFOLIO ITEMS (work samples) ---
type Portfolio struct {
	ID              uuid.UUID       `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()" json:"id"`
	ArtisanID       uuid.UUID       `gorm:"type:uuid;not null;index"                        json:"artisan_id"`
	Title           string          `gorm:"size:150;not null"                               json:"title"`
	Description     string          `gorm:"type:text"                                       json:"description"`
	ImagePath1      string          `gorm:"column:image_path_1;not null"                    json:"image_path_1"`
	ImagePath2      string          `gorm:"column:image_path_2"                             json:"image_path_2,omitempty"`
	ImagePath3      string          `gorm:"column:image_path_3"                             json:"image_path_3,omitempty"`
	ImagePath4      string          `gorm:"column:image_path_4"                             json:"image_path_4,omitempty"`
	Status          PortfolioStatus `gorm:"type:portfolio_status_enum;default:'pending'"    json:"status"`
	RejectionReason string          `gorm:"type:text"                                       json:"rejection_reason,omitempty"`
	ReviewedBy      *uuid.UUID      `gorm:"type:uuid"                                       json:"reviewed_by,omitempty"`
	CreatedAt       time.Time       `                                                       json:"created_at"`
	ReviewedAt      *time.Time      `                                                       json:"reviewed_at,omitempty"`
}

// --- BOOKINGS ---
type SokoIndexBooking struct {
	ID                   uuid.UUID               `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()" json:"id"`
	CustomerID           uuid.UUID               `gorm:"type:uuid;not null;index"                        json:"customer_id"`
	ArtisanID            uuid.UUID               `gorm:"type:uuid;not null;index"                        json:"artisan_id"`
	Description          string                  `gorm:"type:text;not null"                              json:"description"`
	CustomerLocationText string                  `gorm:"size:255"                                        json:"customer_location_text,omitempty"`
	CustomerLocationLat  float64                 `gorm:"type:decimal(10,7)"                              json:"customer_location_lat,omitempty"`
	CustomerLocationLng  float64                 `gorm:"type:decimal(10,7)"                              json:"customer_location_lng,omitempty"`
	Status               SokoIndexBookingStatus  `gorm:"type:sokoindex_booking_status_enum;default:'pending'" json:"status"`
	RejectionReason      string                  `gorm:"type:text"                                       json:"rejection_reason,omitempty"`
	ContactUnlocked      bool                    `gorm:"default:false"                                   json:"contact_unlocked"`
	ContactPaymentRef    string                  `gorm:"size:255"                                        json:"contact_payment_ref,omitempty"`
	ContactPaymentStatus ContactPaymentStatus    `gorm:"type:contact_payment_status_enum;default:'pending'" json:"contact_payment_status"`
	CreatedAt            time.Time               `                                                       json:"created_at"`
	UpdatedAt            time.Time               `                                                       json:"updated_at"`
}

// --- RATINGS ---
type SokoIndexRating struct {
	ID         uuid.UUID `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()" json:"id"`
	BookingID  uuid.UUID `gorm:"type:uuid;not null;uniqueIndex"                  json:"booking_id"`
	CustomerID uuid.UUID `gorm:"type:uuid;not null;index"                        json:"customer_id"`
	ArtisanID  uuid.UUID `gorm:"type:uuid;not null;index"                        json:"artisan_id"`
	Score      int       `gorm:"not null"                                       json:"score"`
	Comment    string    `gorm:"type:text"                                      json:"comment"`
	CreatedAt  time.Time `gorm:"default:now()"                                   json:"created_at"`
}

// --- RECOMMENDATIONS ---
// A lightweight endorsement, distinct from the 1-5 star Rating. Unique per
// (artisan, recommender) to prevent duplicate/spam recommendations.
type Recommendation struct {
	ID                 uuid.UUID  `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()" json:"id"`
	ArtisanID          uuid.UUID  `gorm:"type:uuid;not null;uniqueIndex:idx_artisan_recommender" json:"artisan_id"`
	RecommendedByUserID uuid.UUID `gorm:"type:uuid;not null;uniqueIndex:idx_artisan_recommender" json:"recommended_by_user_id"`
	BookingID          *uuid.UUID `gorm:"type:uuid"                                       json:"booking_id,omitempty"`
	Note               string     `gorm:"type:text"                                       json:"note"`
	CreatedAt          time.Time  `gorm:"default:now()"                                   json:"created_at"`
}

// --- COMPLAINTS ---
type Complaint struct {
	ID                uuid.UUID       `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()" json:"id"`
	BookingID         uuid.UUID       `gorm:"type:uuid;not null;index"                        json:"booking_id"`
	ComplainantUserID uuid.UUID       `gorm:"type:uuid;not null;index"                        json:"complainant_user_id"`
	AgainstArtisanID  uuid.UUID       `gorm:"type:uuid;not null;index"                        json:"against_artisan_id"`
	Category          string          `gorm:"size:100"                                        json:"category"`
	Description       string          `gorm:"type:text;not null"                              json:"description"`
	Status            ComplaintStatus `gorm:"type:complaint_status_enum;default:'open'"       json:"status"`
	ArtisanAtFault     *bool          `                                                       json:"artisan_at_fault,omitempty"`
	ResolutionNotes    string          `gorm:"type:text"                                       json:"resolution_notes,omitempty"`
	ResolvedBy         *uuid.UUID      `gorm:"type:uuid"                                       json:"resolved_by,omitempty"`
	CreatedAt          time.Time       `gorm:"default:now()"                                   json:"created_at"`
	ResolvedAt         *time.Time      `                                                       json:"resolved_at,omitempty"`
}

// --- CUSTOMER UNLOCK ---
// One row per user who has ever paid the one-time customer contact-unlock
// fee. Once Unlocked is true, that user can see every artisan's phone/email
// and create bookings for the lifetime of their account — this is not
// per-artisan or per-booking, unlike the artisan-side unlock below.
type SokoIndexCustomerUnlock struct {
	ID            uuid.UUID            `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()" json:"id"`
	UserID        uuid.UUID            `gorm:"type:uuid;not null;uniqueIndex"                  json:"user_id"`
	Unlocked      bool                 `gorm:"default:false"                                   json:"unlocked"`
	PaymentRef    string               `gorm:"size:255"                                        json:"payment_ref,omitempty"`
	PaymentStatus ContactPaymentStatus `gorm:"type:contact_payment_status_enum;default:'pending'" json:"payment_status"`
	CreatedAt     time.Time            `                                                       json:"created_at"`
	UpdatedAt     time.Time            `                                                       json:"updated_at"`
}

// --- FEATURE FLAGS ---
// Singleton row (ID always 1) letting admins toggle SokoIndex payments on/off
// from SokoWeb. Both default to false so the marketplace is free to use
// until an admin explicitly flips a switch once the user base has grown.
type SokoIndexFeatureFlag struct {
	ID                   uint      `gorm:"primaryKey" json:"id"`
	ContactUnlockEnabled bool      `gorm:"default:false" json:"contact_unlock_enabled"`
	JoiningFeeEnabled    bool      `gorm:"default:false" json:"joining_fee_enabled"`
	UpdatedAt            time.Time `json:"updated_at"`
}

func (ArtisanApplication) TableName() string { return "artisan_applications" }
func (ArtisanProfile) TableName() string     { return "artisan_profiles" }
func (Portfolio) TableName() string          { return "portfolios" }
func (SokoIndexBooking) TableName() string   { return "sokoindex_bookings" }
func (SokoIndexRating) TableName() string    { return "sokoindex_ratings" }
func (Recommendation) TableName() string     { return "recommendations" }
func (Complaint) TableName() string          { return "complaints" }
func (SokoIndexFeatureFlag) TableName() string { return "sokoindex_feature_flags" }
func (SokoIndexCustomerUnlock) TableName() string { return "sokoindex_customer_unlocks" }
