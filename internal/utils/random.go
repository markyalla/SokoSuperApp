package utils

import (
	"crypto/rand"
	"math/big"
	"strings"
)

// RandomDigits returns an n-digit numeric code from a cryptographically secure
// source (unlike time-based codes, which are predictable).
func RandomDigits(n int) (string, error) {
	var b strings.Builder
	for i := 0; i < n; i++ {
		d, err := rand.Int(rand.Reader, big.NewInt(10))
		if err != nil {
			return "", err
		}
		b.WriteByte(byte('0' + d.Int64()))
	}
	return b.String(), nil
}

// MaxHandoverOTPAttempts caps wrong guesses at a delivery handover code before
// the driver must generate a new one — a 4-digit code is otherwise trivially
// brute-forced.
const MaxHandoverOTPAttempts = 5
