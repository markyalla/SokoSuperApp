package models

import (
	"time"

	"github.com/google/uuid"
)

type Gender string

const (
	Male           Gender = "male"
	Female         Gender = "female"
	Other          Gender = "other"
	PreferNotToSay Gender = "prefer_not_to_say"
)

type KYCStatus string

const (
	KYCPending     KYCStatus = "pending"
	KYCSubmitted   KYCStatus = "submitted"
	KYCUnderReview KYCStatus = "under_review"
	KYCApproved    KYCStatus = "approved"
	KYCRejected    KYCStatus = "rejected"
)

type RoleName string

const (
	RoleUser          RoleName = "user"
	RoleDriver        RoleName = "driver"
	RoleArtisan       RoleName = "artisan"
	RoleShopperAdmin  RoleName = "sokoshopper_admin"
	RoleDeliveryAdmin RoleName = "sokodelivery_admin"
	RoleLoanAdmin     RoleName = "sokoloan_admin"
	RoleSusuAdmin     RoleName = "sokosusu_admin"
	RoleBankAdmin     RoleName = "sokobank_admin"
	RoleSuperAdmin    RoleName = "superadmin"
)

type DriverStatus string

const (
	DriverPending   DriverStatus = "pending"
	DriverActive    DriverStatus = "active"
	DriverSuspended DriverStatus = "suspended"
	DriverOffline   DriverStatus = "offline"
)

type VehicleType string

const (
	VehicleBicycle    VehicleType = "bicycle"
	VehicleMotorcycle VehicleType = "motorcycle"
	VehicleCar        VehicleType = "car"
	VehicleVan        VehicleType = "van"
	VehicleTruck      VehicleType = "truck"
)

type DocumentType string

const (
	DocNationalID     DocumentType = "national_id"
	DocNHIA           DocumentType = "nhia_id"
	DocVoterID        DocumentType = "voter_id"
	DocTIN            DocumentType = "tin"
	DocPassport       DocumentType = "passport"
	DocDriversLicense DocumentType = "drivers_license"
)

// ─── USERS ───────────────────────────────────────────────────────────────────

type User struct {
	ID              uuid.UUID  `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()" json:"id"`
	FullName        string     `gorm:"size:150;not null"                               json:"full_name"`
	Gender          Gender     `gorm:"type:gender_enum"                                json:"gender"`
	DateOfBirth     *time.Time `gorm:"type:date"                                       json:"date_of_birth"`
	Age             int16      `gorm:"->;type:smallint"                                json:"age"`
	ProfileImageURL string     `gorm:"column:profile_image_url"                        json:"profile_image_url"`
	PhoneNumber     string     `gorm:"size:20;not null;uniqueIndex"                    json:"phone_number"`
	Email           string     `gorm:"size:255;not null;uniqueIndex"                   json:"email"`
	PasswordHash    string     `gorm:"not null"                                        json:"-"` // never serialise password
	IsEmailVerified bool       `gorm:"default:false"                                   json:"is_email_verified"`
	IsPhoneVerified bool       `gorm:"default:false"                                   json:"is_phone_verified"`
	IsActive        bool       `gorm:"default:true"                                    json:"is_active"`
	IsDeleted       bool       `gorm:"default:false"                                   json:"-"`
	FCMToken        string     `gorm:"column:fcm_token"                                json:"-"`
	ExpoPushToken   string     `gorm:"column:expo_push_token"                          json:"-"`
	LastLoginAt     *time.Time `                                                       json:"last_login_at"`
	CreatedAt       time.Time  `                                                       json:"created_at"`
	UpdatedAt       time.Time  `                                                       json:"updated_at"`

	// Relationships
	Roles         []UserRole     `gorm:"foreignKey:UserID" json:"roles,omitempty"`
	KYC           *KYCSubmission `gorm:"foreignKey:UserID" json:"kyc,omitempty"`
	DriverProfile *DriverProfile `gorm:"foreignKey:UserID" json:"driver_profile,omitempty"`
}

// ─── ROLES ───────────────────────────────────────────────────────────────────

type UserRole struct {
	ID        uuid.UUID  `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()" json:"id"`
	UserID    uuid.UUID  `gorm:"type:uuid;not null"                              json:"user_id"`
	Role      RoleName   `gorm:"type:role_enum;default:'user'"                   json:"role"`
	GrantedBy *uuid.UUID `                                                       json:"granted_by,omitempty"`
	GrantedAt time.Time  `gorm:"default:now()"                                   json:"granted_at"`
}

// ─── KYC SUBMISSIONS ─────────────────────────────────────────────────────────

type KYCSubmission struct {
	ID              uuid.UUID  `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()" json:"id"`
	UserID          uuid.UUID  `gorm:"type:uuid;not null;uniqueIndex"                  json:"user_id"`
	Status          KYCStatus  `gorm:"type:kyc_status_enum;default:'pending'"          json:"status"`
	SubmittedAt     *time.Time `                                                       json:"submitted_at,omitempty"`
	ReviewedAt      *time.Time `                                                       json:"reviewed_at,omitempty"`
	ReviewedBy      *uuid.UUID `                                                       json:"reviewed_by,omitempty"`
	RejectionReason string     `                                                       json:"rejection_reason,omitempty"`

	FullName    string       `gorm:"size:150;not null" json:"full_name"`
	Gender      Gender       `gorm:"type:gender_enum"  json:"gender"`
	DateOfBirth *time.Time   `gorm:"type:date"         json:"date_of_birth"`
	PhoneNumber string       `gorm:"size:20;not null"  json:"phone_number"`
	Email       string       `gorm:"size:255;not null" json:"email"`
	IDType      DocumentType `gorm:"type:document_type_enum" json:"id_type"`
	IDNumber    string       `gorm:"size:100"          json:"id_number"`
	IDImageURL  string       `gorm:"column:id_image_url"     json:"id_image_url"`
	Address     string       `                         json:"address"`
	City        string       `gorm:"size:100"          json:"city"`
	Country     string       `gorm:"size:100;default:'Ghana'" json:"country"`

	CreatedAt time.Time     `json:"created_at"`
	UpdatedAt time.Time     `json:"updated_at"`
	Documents []KYCDocument `gorm:"foreignKey:KYCID" json:"documents,omitempty"`
}

// ─── KYC DOCUMENTS ───────────────────────────────────────────────────────────

type KYCDocument struct {
	ID           uuid.UUID    `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()" json:"id"`
	KYCID        uuid.UUID    `gorm:"column:kyc_id;not null"                          json:"kyc_id"`
	DocumentType DocumentType `gorm:"type:document_type_enum;not null"                json:"document_type"`
	FileURL      string       `gorm:"column:file_url;not null"                        json:"file_url"`
	FileSize     int          `gorm:"column:file_size_bytes"                          json:"file_size_bytes"`
	MimeType     string       `gorm:"size:100"                                        json:"mime_type"`
	IsVerified   bool         `gorm:"default:false"                                   json:"is_verified"`
	UploadedAt   time.Time    `gorm:"default:now()"                                   json:"uploaded_at"`
}

// ─── DRIVER PROFILES ─────────────────────────────────────────────────────────

type DriverProfile struct {
	ID              uuid.UUID    `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()" json:"id"`
	UserID          uuid.UUID    `gorm:"type:uuid;not null;uniqueIndex"                  json:"user_id"`
	Status          DriverStatus `gorm:"type:driver_status_enum;default:'pending'"       json:"status"`
	VehicleType     VehicleType  `gorm:"type:vehicle_type_enum"                          json:"vehicle_type"`
	VehiclePlate    string       `gorm:"size:20"                                         json:"vehicle_plate"`
	VehicleModel    string       `gorm:"size:100"                                        json:"vehicle_model"`
	VehicleColor    string       `gorm:"size:50"                                         json:"vehicle_color"`
	LicenseNumber   string       `gorm:"size:50"                                         json:"license_number"`
	CurrentLat      float64      `gorm:"type:decimal(10,8)"                              json:"current_lat"`
	CurrentLng      float64      `gorm:"type:decimal(11,8)"                              json:"current_lng"`
	LastLocationAt  *time.Time   `                                                       json:"last_location_at,omitempty"`
	Rating          float64      `gorm:"type:decimal(3,2);default:5.00"                  json:"rating"`
	TotalRatings    int          `gorm:"default:0"                                       json:"total_ratings"`
	TotalDeliveries int          `gorm:"default:0"                                       json:"total_deliveries"`
	IsAvailable     bool         `gorm:"default:false"                                   json:"is_available"`
	IsOnline        bool         `gorm:"default:false"                                   json:"is_online"`
	ApprovedAt      *time.Time   `                                                       json:"approved_at,omitempty"`
	ApprovedBy      *uuid.UUID   `                                                       json:"approved_by,omitempty"`
	CreatedAt       time.Time    `                                                       json:"created_at"`
	UpdatedAt       time.Time    `                                                       json:"updated_at"`

	// Relationships
	User User `gorm:"foreignKey:UserID" json:"-"` // omit to avoid circular JSON
}

// ─── OTP VERIFICATIONS ───────────────────────────────────────────────────────

type OTPVerification struct {
	ID         uuid.UUID  `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()" json:"id"`
	UserID     *uuid.UUID `gorm:"type:uuid"                                       json:"user_id,omitempty"`
	Identifier string     `gorm:"size:255;not null"                               json:"identifier"`
	OTPHash    string     `gorm:"column:otp_hash;not null"                        json:"-"`
	Purpose    string     `gorm:"size:50;not null"                                json:"purpose"`
	IsUsed     bool       `gorm:"default:false"                                   json:"is_used"`
	ExpiresAt  time.Time  `gorm:"not null"                                        json:"expires_at"`
	CreatedAt  time.Time  `gorm:"default:now()"                                   json:"created_at"`
}

// ─── REFRESH TOKENS ──────────────────────────────────────────────────────────

type RefreshToken struct {
	ID         uuid.UUID  `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()" json:"id"`
	UserID     uuid.UUID  `gorm:"type:uuid;not null"                              json:"user_id"`
	TokenHash  string     `gorm:"not null;unique"                                 json:"-"`
	DeviceInfo string     `gorm:"type:jsonb"                                      json:"-"`
	IPAddress  string     `gorm:"type:inet"                                       json:"-"`
	ExpiresAt  time.Time  `gorm:"not null"                                        json:"expires_at"`
	RevokedAt  *time.Time `                                                       json:"-"`
	CreatedAt  time.Time  `gorm:"default:now()"                                   json:"created_at"`
}

// ─── AUDIT LOGS ──────────────────────────────────────────────────────────────

type AuditLog struct {
	ID         int64      `gorm:"primaryKey"       json:"id"`
	UserID     *uuid.UUID `gorm:"type:uuid"        json:"user_id,omitempty"`
	Action     string     `gorm:"size:100;not null" json:"action"`
	EntityType string     `gorm:"size:100"          json:"entity_type"`
	EntityID   *uuid.UUID `gorm:"type:uuid"         json:"entity_id,omitempty"`
	OldValue   string     `gorm:"type:jsonb"        json:"-"`
	NewValue   string     `gorm:"type:jsonb"        json:"-"`
	IPAddress  string     `gorm:"type:inet"         json:"-"`
	UserAgent  string     `                         json:"-"`
	CreatedAt  time.Time  `gorm:"default:now()"     json:"created_at"`
}

func (User) TableName() string            { return "users" }
func (UserRole) TableName() string        { return "user_roles" }
func (KYCSubmission) TableName() string   { return "kyc_submissions" }
func (KYCDocument) TableName() string     { return "kyc_documents" }
func (DriverProfile) TableName() string   { return "driver_profiles" }
func (OTPVerification) TableName() string { return "otp_verifications" }
func (RefreshToken) TableName() string    { return "refresh_tokens" }
func (AuditLog) TableName() string        { return "audit_logs" }
