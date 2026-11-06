// Package googleapi holds the small pieces shared by the server-side Google
// Maps Platform integrations (weather, routes, places): key lookup from the
// environment, coordinate validation, and error types that handlers map to
// plain user-facing messages.
//
// Keys live only in the server's environment (.env / deployment secrets) and
// are never returned to clients or written to logs.
package googleapi

import (
	"errors"
	"fmt"
	"math"
	"net/http"
	"os"
	"strings"
	"time"
)

var (
	// ErrNotConfigured means the API key for this feature isn't set, so the
	// feature is switched off on this server.
	ErrNotConfigured = errors.New("provider not configured")
	// ErrNoResult means the provider answered but had nothing for the request
	// (no route between the points, unknown place, no coverage).
	ErrNoResult = errors.New("no result")
)

// ProviderError is a non-2xx answer from Google. Status is the upstream HTTP
// status; Detail is Google's message (logged server-side, never sent to users).
type ProviderError struct {
	Status int
	Detail string
}

func (e *ProviderError) Error() string {
	return fmt.Sprintf("provider returned %d: %s", e.Status, e.Detail)
}

// IsQuota reports whether the provider rejected the call for quota/rate reasons.
func (e *ProviderError) IsQuota() bool { return e.Status == http.StatusTooManyRequests }

// Key returns the first non-empty environment variable among names, so a
// feature can use its own restricted key and fall back to a shared one.
func Key(names ...string) string {
	for _, n := range names {
		if v := strings.TrimSpace(os.Getenv(n)); v != "" {
			return v
		}
	}
	return ""
}

// NewHTTPClient returns a client with a short timeout: these calls sit in
// front of a user waiting on a screen, so failing fast beats hanging.
func NewHTTPClient() *http.Client {
	return &http.Client{Timeout: 8 * time.Second}
}

// ValidLatLng rejects NaN/Inf, out-of-range values, and the exact 0,0 "null
// island" that a broken GPS fix or an unset form field tends to produce.
func ValidLatLng(lat, lng float64) bool {
	if math.IsNaN(lat) || math.IsNaN(lng) || math.IsInf(lat, 0) || math.IsInf(lng, 0) {
		return false
	}
	if lat < -90 || lat > 90 || lng < -180 || lng > 180 {
		return false
	}
	return !(lat == 0 && lng == 0)
}

// Coarsen rounds a coordinate to the given number of decimal places.
// 2 decimals ≈ 1.1 km — plenty for weather, and it means the precise
// position of the user never leaves our server.
func Coarsen(v float64, decimals int) float64 {
	p := math.Pow(10, float64(decimals))
	return math.Round(v*p) / p
}

// SafeToken reports whether s is a short URL-safe token (place IDs, Places
// session tokens), so client input can't inject path segments or query
// parameters into upstream URLs.
func SafeToken(s string, maxLen int) bool {
	if s == "" || len(s) > maxLen {
		return false
	}
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_':
		default:
			return false
		}
	}
	return true
}
