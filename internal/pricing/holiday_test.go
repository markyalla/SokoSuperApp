package pricing

import (
	"testing"
	"time"
)

func date(month, day int) time.Time {
	return time.Date(2026, time.Month(month), day, 12, 0, 0, 0, time.UTC)
}

func TestGhanaHolidayOn(t *testing.T) {
	cases := []struct {
		name         string
		storeCountry string
		at           time.Time
		wantHoliday  string
		wantIsHoliday bool
	}{
		{"New Year's Day", "Ghana", date(1, 1), "New Year's Day", true},
		{"Christmas Day", "Ghana", date(12, 25), "Christmas Day", true},
		{"Boxing Day", "Ghana", date(12, 26), "Boxing Day", true},
		{"Independence Day", "Ghana", date(3, 6), "Independence Day", true},
		{"day after Christmas is fine, day before is not a holiday", "Ghana", date(12, 24), "", false},
		{"ordinary day", "Ghana", date(6, 15), "", false},
		{"non-Ghana country on a Ghana holiday date", "Nigeria", date(12, 25), "", false},
		{"empty country", "", date(12, 25), "", false},
		{"case-insensitive country match", "ghana", date(1, 1), "New Year's Day", true},
		{"whitespace-padded country match", "  Ghana  ", date(1, 1), "New Year's Day", true},
		{"uppercase country match", "GHANA", date(5, 1), "Labour Day", true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			gotName, gotIsHoliday := ghanaHolidayOn(tc.storeCountry, tc.at)
			if gotIsHoliday != tc.wantIsHoliday {
				t.Fatalf("isHoliday = %v, want %v", gotIsHoliday, tc.wantIsHoliday)
			}
			if gotName != tc.wantHoliday {
				t.Fatalf("holiday name = %q, want %q", gotName, tc.wantHoliday)
			}
		})
	}
}

func TestStatusFromSurcharge(t *testing.T) {
	t.Run("positive surcharge activates pricing", func(t *testing.T) {
		got := statusFromSurcharge("Christmas Day", 15)
		if !got.Active {
			t.Fatal("expected Active = true")
		}
		if got.Multiplier != 1.15 {
			t.Fatalf("Multiplier = %v, want 1.15", got.Multiplier)
		}
		if got.SurchargePct != 15 {
			t.Fatalf("SurchargePct = %v, want 15", got.SurchargePct)
		}
		if got.HolidayName != "Christmas Day" {
			t.Fatalf("HolidayName = %q, want %q", got.HolidayName, "Christmas Day")
		}
	})

	t.Run("zero surcharge stays inactive", func(t *testing.T) {
		got := statusFromSurcharge("Christmas Day", 0)
		if got != inactive {
			t.Fatalf("got %+v, want inactive %+v", got, inactive)
		}
	})

	t.Run("negative surcharge stays inactive", func(t *testing.T) {
		got := statusFromSurcharge("Christmas Day", -5)
		if got != inactive {
			t.Fatalf("got %+v, want inactive %+v", got, inactive)
		}
	})
}

func TestRound2(t *testing.T) {
	cases := []struct {
		in   float64
		want float64
	}{
		{12.344, 12.34},
		{12.346, 12.35},
		{0, 0},
		{10, 10},
		{-2.346, -2.35},
		{99.995, 100.0}, // 99.995 is not exactly representable in float64 and
		// rounds up under round-half-away-from-zero, same as math.Round does.
	}

	for _, tc := range cases {
		if got := Round2(tc.in); got != tc.want {
			t.Errorf("Round2(%v) = %v, want %v", tc.in, got, tc.want)
		}
	}
}
