// Package pricing computes holiday surge pricing for shopper item prices and
// delivery fees. It's structured per-country so other African markets can be
// added later — right now only Ghana has a holiday calendar and an active
// setting; every other country simply gets no surcharge.
package pricing

import (
	"math"
	"strings"
	"time"

	"sokoapp/internal/models"

	"gorm.io/gorm"
)

// Ghana's fixed-date public holidays (month, day). Movable holidays (Eid,
// Easter) aren't included since they shift year to year and would need a
// maintained lookup table instead of a fixed date. Mirrors the list used for
// the SokoWeb analytics dashboard (app/routes/analytics.py) — keep both in
// sync if this changes.
var ghanaFixedHolidays = map[[2]int]string{
	{1, 1}:   "New Year's Day",
	{3, 6}:   "Independence Day",
	{5, 1}:   "Labour Day",
	{7, 1}:   "Republic Day",
	{8, 4}:   "Founders' Day",
	{9, 21}:  "Kwame Nkrumah Memorial Day",
	{12, 25}: "Christmas Day",
	{12, 26}: "Boxing Day",
}

// Status describes whether a holiday surcharge is currently active for a
// given store's country, and by how much.
type Status struct {
	Active       bool
	Multiplier   float64 // e.g. 1.15 — apply by multiplying the normal price
	SurchargePct float64 // e.g. 15
	HolidayName  string
}

// inactive is what every non-Ghana / non-holiday / disabled-setting lookup
// resolves to: today's price, unchanged.
var inactive = Status{Active: false, Multiplier: 1.0}

// ghanaHolidayOn returns the fixed-date Ghana holiday name for the given
// date and whether the store's country qualifies at all. Pure — no DB — so
// the date/country matching rules can be unit tested directly.
func ghanaHolidayOn(storeCountry string, at time.Time) (name string, isHoliday bool) {
	if !strings.EqualFold(strings.TrimSpace(storeCountry), "Ghana") {
		return "", false
	}
	name, isHoliday = ghanaFixedHolidays[[2]int{int(at.Month()), at.Day()}]
	return name, isHoliday
}

// statusFromSurcharge builds the Status a given surcharge percentage
// produces for a named holiday. A percentage of zero or less always means
// no surcharge, regardless of the row existing in the settings table.
func statusFromSurcharge(holidayName string, surchargePct float64) Status {
	if surchargePct <= 0 {
		return inactive
	}
	return Status{
		Active:       true,
		Multiplier:   1 + surchargePct/100.0,
		SurchargePct: surchargePct,
		HolidayName:  holidayName,
	}
}

// ForStore returns the current holiday pricing status for a store, given its
// country string (Store.Country — free text like "Ghana", not an ISO code)
// and the time to evaluate. It looks up the configurable surcharge percentage
// from the holiday_pricing_settings table, seeded/edited from the superadmin
// panel — a missing or disabled row means no surcharge even on a holiday.
func ForStore(db *gorm.DB, storeCountry string, at time.Time) Status {
	holidayName, isHoliday := ghanaHolidayOn(storeCountry, at)
	if !isHoliday {
		return inactive
	}

	var setting models.HolidayPricingSetting
	err := db.Where("enabled = ? AND lower(country_name) = ?", true, "ghana").
		First(&setting).Error
	if err != nil {
		return inactive
	}

	return statusFromSurcharge(holidayName, setting.SurchargePct)
}

// Round2 rounds to 2 decimal places — every GHS amount in this codebase is
// displayed and stored that way.
func Round2(v float64) float64 {
	return math.Round(v*100) / 100
}
