// Package audit writes to the shared audit_logs table (sokoaccount DB) that
// both sokoApp (this package) and SokoWeb write to directly. It's meant to
// answer two different questions from one place: "who did what" (admin
// actions) and "what's currently broken" (payment failures, stuck orders,
// background job failures, API errors) — see the SokoWeb admin Audit Log
// page for the reading side.
//
// Writing here must never be allowed to break the operation it's logging
// about: every write is best-effort and swallows its own errors (logged to
// stdout only) rather than propagating them to the caller.
package audit

import (
	"encoding/json"
	"log"

	"sokoapp/internal/models"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Category string

const (
	CategoryAdminAction    Category = "admin_action"
	CategoryPaymentFailure Category = "payment_failure"
	CategoryOrderStuck     Category = "order_stuck"
	CategoryJobFailure     Category = "job_failure"
	CategoryAPIError       Category = "api_error"
)

type Severity string

const (
	SeverityInfo     Severity = "info"
	SeverityWarning  Severity = "warning"
	SeverityError    Severity = "error"
	SeverityCritical Severity = "critical"
)

// Entry is everything Log can record about one event. Only Category,
// Severity, and Action are required — everything else is optional context.
type Entry struct {
	Category    Category
	Severity    Severity
	UserID      *uuid.UUID
	ActorLabel  string
	Action      string
	EntityType  string
	EntityID    *uuid.UUID
	Message     string
	OldValue    any
	NewValue    any
	Metadata    any
	RequestPath string
	StatusCode  int
	IPAddress   string
	UserAgent   string
}

// Log writes one audit entry. db must be the sokoaccount connection (where
// audit_logs lives). Never returns an error — a failure to write an audit
// entry is logged to stdout and otherwise ignored, since the point of this
// package is to observe the system, not to become a new way for it to break.
func Log(db *gorm.DB, e Entry) {
	if e.Category == "" || e.Severity == "" || e.Action == "" {
		log.Printf("audit: dropped incomplete entry (category=%q severity=%q action=%q)", e.Category, e.Severity, e.Action)
		return
	}

	row := models.AuditLog{
		Category:    string(e.Category),
		Severity:    string(e.Severity),
		UserID:      e.UserID,
		ActorLabel:  e.ActorLabel,
		Action:      e.Action,
		EntityType:  e.EntityType,
		EntityID:    e.EntityID,
		Message:     e.Message,
		OldValue:    marshalOrNil(e.OldValue),
		NewValue:    marshalOrNil(e.NewValue),
		Metadata:    marshalOrNil(e.Metadata),
		RequestPath: e.RequestPath,
		StatusCode:  e.StatusCode,
		IPAddress:   e.IPAddress,
		UserAgent:   e.UserAgent,
	}

	if row.ActorLabel == "" {
		row.ActorLabel = "system"
	}

	if err := db.Create(&row).Error; err != nil {
		log.Printf("audit: failed to write log entry (category=%s action=%s): %v", e.Category, e.Action, err)
	}
}

// marshalOrNil returns nil for a nil input so it maps to SQL NULL — an empty
// Go string is not valid JSON and Postgres rejects it for a jsonb column.
func marshalOrNil(v any) *string {
	if v == nil {
		return nil
	}
	b, err := json.Marshal(v)
	if err != nil {
		return nil
	}
	s := string(b)
	return &s
}
