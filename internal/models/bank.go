package models

import (
	"time"

	"github.com/google/uuid"
)

// --- ENUM TYPES ---
type AccountType string

const (
	AccWallet  AccountType = "wallet"
	AccSavings AccountType = "savings"
	AccCurrent AccountType = "current"
	AccEscrow  AccountType = "escrow"
	AccTrust   AccountType = "trust"
)

type AccountStatus string

const (
	AccPending AccountStatus = "pending"
	AccActive  AccountStatus = "active"
	AccFrozen  AccountStatus = "frozen"
	AccClosed  AccountStatus = "closed"
)

type TxnType string

const (
	TxnCredit           TxnType = "credit"
	TxnDebit            TxnType = "debit"
	TxnTransferIn       TxnType = "transfer_in"
	TxnTransferOut      TxnType = "transfer_out"
	TxnFee              TxnType = "fee"
	TxnRefund           TxnType = "refund"
	TxnInterest         TxnType = "interest"
	TxnLoanDisbursement TxnType = "loan_disbursement"
	TxnLoanRepayment    TxnType = "loan_repayment"
	TxnSusuContribution TxnType = "susu_contribution"
	TxnSusuPayout       TxnType = "susu_payout"
	TxnOrderPayment     TxnType = "order_payment"
	TxnDriverEarning    TxnType = "driver_earning"
)

type TxnStatus string

const (
	TxnPending    TxnStatus = "pending"
	TxnProcessing TxnStatus = "processing"
	TxnSuccess    TxnStatus = "success"
	TxnFailed     TxnStatus = "failed"
	TxnReversed   TxnStatus = "reversed"
)

type TransferStatus string

const (
	XferPending    TransferStatus = "pending"
	XferProcessing TransferStatus = "processing"
	XferCompleted  TransferStatus = "completed"
	XferFailed     TransferStatus = "failed"
	XferCancelled  TransferStatus = "cancelled"
)

// --- BANK ACCOUNTS ---
type BankAccount struct {
	ID            uuid.UUID     `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()"`
	UserID        uuid.UUID     `gorm:"not null"`
	AccountType   AccountType   `gorm:"type:account_type_enum;default:'wallet'"`
	AccountNumber string        `gorm:"size:20;unique;not null"`
	AccountName   string        `gorm:"size:200;not null"`
	Currency      string        `gorm:"size:10;default:'GHS'"`
	Balance       float64       `gorm:"type:decimal(18,2);default:0.00"`
	LedgerBalance float64       `gorm:"type:decimal(18,2);default:0.00"`
	Status        AccountStatus `gorm:"type:account_status_enum;default:'pending'"`
	IsPrimary     bool          `gorm:"default:false"`
	PinHash       string        `gorm:"column:pin_hash"`
	DailyLimit    float64       `gorm:"type:decimal(18,2);default:5000.00"`
	MonthlyLimit  float64       `gorm:"type:decimal(18,2);default:50000.00"`
	KycTier       int16         `gorm:"column:kyc_tier;default:1"`
	FrozenReason  string
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

// --- TRANSACTIONS ---
type Transaction struct {
	ID            uuid.UUID `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()"`
	AccountID     uuid.UUID `gorm:"not null"`
	UserID        uuid.UUID `gorm:"not null"`
	Type          TxnType   `gorm:"type:txn_type_enum;not null"`
	Status        TxnStatus `gorm:"type:txn_status_enum;default:'pending'"`
	Amount        float64   `gorm:"type:decimal(18,2);not null"`
	Fee           float64   `gorm:"type:decimal(18,2);default:0.00"`
	BalanceBefore float64   `gorm:"type:decimal(18,2);not null"`
	BalanceAfter  float64   `gorm:"type:decimal(18,2);not null"`
	Currency      string    `gorm:"size:10;default:'GHS'"`
	Reference     string    `gorm:"size:100;unique;not null"`
	ExternalRef   string    `gorm:"size:100"`
	Description   string
	Metadata      string     `gorm:"type:jsonb"`
	SourceApp     string     `gorm:"size:50"`
	ReversedBy    *uuid.UUID `gorm:"type:uuid"`
	ReversedAt    *time.Time
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

// --- TRANSFERS ---
type Transfer struct {
	ID                  uuid.UUID      `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()"`
	FromAccountID       uuid.UUID      `gorm:"not null"`
	ToAccountID         *uuid.UUID     `gorm:"type:uuid"`
	FromUserID          uuid.UUID      `gorm:"not null"`
	ToUserID            *uuid.UUID     `gorm:"type:uuid"`
	Amount              float64        `gorm:"type:decimal(18,2);not null"`
	Fee                 float64        `gorm:"type:decimal(18,2);default:0.00"`
	Currency            string         `gorm:"size:10;default:'GHS'"`
	Status              TransferStatus `gorm:"type:transfer_status_enum;default:'pending'"`
	Reference           string         `gorm:"size:100;unique;not null"`
	DebitTxnID          *uuid.UUID     `gorm:"column:debit_txn_id"`
	CreditTxnID         *uuid.UUID     `gorm:"column:credit_txn_id"`
	ExternalBankCode    string         `gorm:"size:20"`
	ExternalAccountNo   string         `gorm:"size:30"`
	ExternalAccountName string         `gorm:"size:200"`
	Narration           string
	CompletedAt         *time.Time
	FailedReason        string
	CreatedAt           time.Time
	UpdatedAt           time.Time
}

// --- STATEMENTS ---
type AccountStatement struct {
	ID             uuid.UUID `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()"`
	AccountID      uuid.UUID `gorm:"not null"`
	PeriodYear     int16     `gorm:"not null"`
	PeriodMonth    int16     `gorm:"not null"`
	OpeningBalance float64   `gorm:"type:decimal(18,2);not null"`
	ClosingBalance float64   `gorm:"type:decimal(18,2);not null"`
	TotalCredits   float64   `gorm:"type:decimal(18,2);default:0.00"`
	TotalDebits    float64   `gorm:"type:decimal(18,2);default:0.00"`
	TotalFees      float64   `gorm:"type:decimal(18,2);default:0.00"`
	TxnCount       int       `gorm:"default:0"`
	GeneratedAt    time.Time `gorm:"default:now()"`
}

func (BankAccount) TableName() string      { return "bank_accounts" }
func (Transaction) TableName() string      { return "transactions" }
func (Transfer) TableName() string         { return "transfers" }
func (AccountStatement) TableName() string { return "account_statements" }
