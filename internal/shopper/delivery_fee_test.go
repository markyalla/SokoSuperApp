package shopper

import (
	"testing"

	"sokoapp/internal/pricing"
)

var noHoliday = pricing.Status{Active: false, Multiplier: 1.0}

var christmasHoliday15pct = pricing.Status{
	Active:       true,
	Multiplier:   1.15,
	SurchargePct: 15,
	HolidayName:  "Christmas Day",
}

func TestComputeDeliveryFee(t *testing.T) {
	cases := []struct {
		name        string
		hour        int
		distanceKm  float64
		hasDistance bool
		holiday     pricing.Status
		wantFee     float64
		wantReason  string
		wantBreak   string
	}{
		{
			name: "base fee only, no distance, midday, no holiday",
			hour: 12, hasDistance: false, holiday: noHoliday,
			wantFee:    15.0,
			wantReason: "Standard delivery",
			wantBreak:  "Base: GHS 15.00",
		},
		{
			name: "distance within free radius adds no fee but still reported",
			hour: 12, distanceKm: 2, hasDistance: true, holiday: noHoliday,
			wantFee:    15.0,
			wantReason: "Standard delivery",
			wantBreak:  "Base: GHS 15.00 | Distance (2.0 km): GHS 0.00",
		},
		{
			name: "distance beyond free radius is billed per km",
			hour: 12, distanceKm: 5, hasDistance: true, holiday: noHoliday,
			wantFee:    19.0,
			wantReason: "Distance-based (5.0 km)",
			wantBreak:  "Base: GHS 15.00 | Distance (5.0 km): GHS 4.00",
		},
		{
			name: "night surcharge applies at 11PM",
			hour: 23, hasDistance: false, holiday: noHoliday,
			wantFee:    22.0,
			wantReason: "Night surcharge (10PM–6AM)",
			wantBreak:  "Base: GHS 15.00 | Night surcharge (10PM–6AM): GHS 7.00",
		},
		{
			name: "night surcharge wraps past midnight to 2AM",
			hour: 2, hasDistance: false, holiday: noHoliday,
			wantFee:    22.0,
			wantReason: "Night surcharge (10PM–6AM)",
			wantBreak:  "Base: GHS 15.00 | Night surcharge (10PM–6AM): GHS 7.00",
		},
		{
			name: "6AM is just outside the night window",
			hour: 6, hasDistance: false, holiday: noHoliday,
			wantFee:    15.0,
			wantReason: "Standard delivery",
			wantBreak:  "Base: GHS 15.00",
		},
		{
			name: "evening surcharge applies at 7PM",
			hour: 19, hasDistance: false, holiday: noHoliday,
			wantFee:    18.0,
			wantReason: "Late evening surcharge (6PM–10PM)",
			wantBreak:  "Base: GHS 15.00 | Late evening surcharge (6PM–10PM): GHS 3.00",
		},
		{
			name: "6PM boundary is evening, not standard",
			hour: 18, hasDistance: false, holiday: noHoliday,
			wantFee:    18.0,
			wantReason: "Late evening surcharge (6PM–10PM)",
			wantBreak:  "Base: GHS 15.00 | Late evening surcharge (6PM–10PM): GHS 3.00",
		},
		{
			name: "10PM boundary switches from evening to night",
			hour: 22, hasDistance: false, holiday: noHoliday,
			wantFee:    22.0,
			wantReason: "Night surcharge (10PM–6AM)",
			wantBreak:  "Base: GHS 15.00 | Night surcharge (10PM–6AM): GHS 7.00",
		},
		{
			name: "5PM has no time surcharge yet",
			hour: 17, hasDistance: false, holiday: noHoliday,
			wantFee:    15.0,
			wantReason: "Standard delivery",
			wantBreak:  "Base: GHS 15.00",
		},
		{
			name: "distance and night surcharge stack together",
			hour: 23, distanceKm: 5, hasDistance: true, holiday: noHoliday,
			wantFee:    26.0,
			wantReason: "5.0 km away + night surcharge (10pm–6am)",
			wantBreak:  "Base: GHS 15.00 | Distance (5.0 km): GHS 4.00 | Night surcharge (10PM–6AM): GHS 7.00",
		},
		{
			name: "holiday surcharge stacks on top of the standard base fee",
			hour: 12, hasDistance: false, holiday: christmasHoliday15pct,
			wantFee:    17.25,
			wantReason: "Holiday pricing (Christmas Day)",
			wantBreak:  "Base: GHS 15.00 | Holiday surcharge +15% (Christmas Day): GHS 2.25",
		},
		{
			name: "holiday surcharge stacks on top of distance + night combo",
			hour: 23, distanceKm: 5, hasDistance: true, holiday: christmasHoliday15pct,
			wantFee:    29.9,
			wantReason: "5.0 km away + night surcharge (10pm–6am) + holiday pricing (Christmas Day)",
			wantBreak:  "Base: GHS 15.00 | Distance (5.0 km): GHS 4.00 | Night surcharge (10PM–6AM): GHS 7.00 | Holiday surcharge +15% (Christmas Day): GHS 3.90",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := computeDeliveryFee(tc.hour, tc.distanceKm, tc.hasDistance, tc.holiday)
			if got.Fee != tc.wantFee {
				t.Errorf("Fee = %v, want %v", got.Fee, tc.wantFee)
			}
			if got.Reason != tc.wantReason {
				t.Errorf("Reason = %q, want %q", got.Reason, tc.wantReason)
			}
			if got.Breakdown != tc.wantBreak {
				t.Errorf("Breakdown = %q, want %q", got.Breakdown, tc.wantBreak)
			}
			if got.HasDistance != tc.hasDistance {
				t.Errorf("HasDistance = %v, want %v", got.HasDistance, tc.hasDistance)
			}
		})
	}
}

func TestHaversineKm(t *testing.T) {
	cases := []struct {
		name                   string
		lat1, lng1, lat2, lng2 float64
		wantApprox             float64
		tolerance              float64
	}{
		// Accra (5.6037, -0.1870) to Kumasi (6.6885, -1.6244) is
		// approximately 199.5km by great-circle distance.
		{"Accra to Kumasi", 5.6037, -0.1870, 6.6885, -1.6244, 199.5, 0.1},
		{"same point is zero distance", 5.6037, -0.1870, 5.6037, -0.1870, 0, 0.001},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := haversineKm(tc.lat1, tc.lng1, tc.lat2, tc.lng2)
			diff := got - tc.wantApprox
			if diff < 0 {
				diff = -diff
			}
			if diff > tc.tolerance {
				t.Errorf("haversineKm(...) = %v, want approx %v (±%v)", got, tc.wantApprox, tc.tolerance)
			}
		})
	}
}
