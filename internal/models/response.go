package models

import "github.com/google/uuid"

type JSONResponse struct {
	Success   bool        `json:"success"`
	Message   string      `json:"message,omitempty"`
	Data      interface{} `json:"data,omitempty"`
	Error     interface{} `json:"error,omitempty"`
	RequestID uuid.UUID   `json:"request_id,omitempty"`
}
