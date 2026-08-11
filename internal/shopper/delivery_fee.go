package shopper

import (
	"fmt"
	"math"
	"strings"

	"sokoapp/internal/pricing"
)

// deliveryFeeBreakdown is the pure result of the delivery-fee pricing rules
// (time-of-day surcharge, distance banding, holiday stacking) — split out
// from GetDeliveryFee so the rules can be unit tested without a database.
type deliveryFeeBreakdown struct {
	Fee         float64
	Reason      string
	Breakdown   string
	DistanceKm  float64
	HasDistance bool
}

// computeDeliveryFee applies SokoApp's delivery pricing rules given
// pre-resolved inputs: the current UTC hour, the customer-to-store distance
// (if known), and the holiday pricing status already looked up for the
// store's country. It has no side effects and does not touch the database.
func computeDeliveryFee(hour int, distanceKm float64, hasDistance bool, holiday pricing.Status) deliveryFeeBreakdown {
	const (
		baseFee          = 15.0
		freeKm           = 3.0
		ratePerKm        = 2.0
		eveningSurcharge = 3.0
		nightSurcharge   = 7.0
	)

	var timeFee float64
	var timeLabel string
	switch {
	case hour >= 22 || hour < 6:
		timeFee = nightSurcharge
		timeLabel = "Night surcharge (10PM–6AM)"
	case hour >= 18:
		timeFee = eveningSurcharge
		timeLabel = "Late evening surcharge (6PM–10PM)"
	}

	var distanceFee float64
	if hasDistance && distanceKm > freeKm {
		distanceFee = (distanceKm - freeKm) * ratePerKm
	}

	subtotal := baseFee + timeFee + distanceFee

	var holidayFee float64
	if holiday.Active {
		holidayFee = pricing.Round2(subtotal * (holiday.Multiplier - 1))
	}

	totalFee := pricing.Round2(subtotal + holidayFee)

	parts := []string{fmt.Sprintf("Base: GHS %.2f", baseFee)}
	if hasDistance {
		parts = append(parts, fmt.Sprintf("Distance (%.1f km): GHS %.2f", distanceKm, distanceFee))
	}
	if timeFee > 0 {
		parts = append(parts, fmt.Sprintf("%s: GHS %.2f", timeLabel, timeFee))
	}
	if holiday.Active {
		parts = append(parts, fmt.Sprintf("Holiday surcharge +%.0f%% (%s): GHS %.2f", holiday.SurchargePct, holiday.HolidayName, holidayFee))
	}

	reason := "Standard delivery"
	switch {
	case timeFee > 0 && distanceFee > 0:
		reason = fmt.Sprintf("%.1f km away + %s", math.Round(distanceKm*10)/10, strings.ToLower(timeLabel))
	case timeFee > 0:
		reason = timeLabel
	case distanceFee > 0:
		reason = fmt.Sprintf("Distance-based (%.1f km)", math.Round(distanceKm*10)/10)
	}
	if holiday.Active {
		if reason == "Standard delivery" {
			reason = fmt.Sprintf("Holiday pricing (%s)", holiday.HolidayName)
		} else {
			reason = fmt.Sprintf("%s + holiday pricing (%s)", reason, holiday.HolidayName)
		}
	}

	return deliveryFeeBreakdown{
		Fee:         totalFee,
		Reason:      reason,
		Breakdown:   strings.Join(parts, " | "),
		DistanceKm:  math.Round(distanceKm*10) / 10,
		HasDistance: hasDistance,
	}
}

// haversineKm returns the great-circle distance between two lat/lng points,
// in kilometres.
func haversineKm(lat1, lng1, lat2, lng2 float64) float64 {
	const R = 6371.0
	dLat := (lat2 - lat1) * math.Pi / 180.0
	dLng := (lng2 - lng1) * math.Pi / 180.0
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1*math.Pi/180.0)*math.Cos(lat2*math.Pi/180.0)*
			math.Sin(dLng/2)*math.Sin(dLng/2)
	return R * 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
}
