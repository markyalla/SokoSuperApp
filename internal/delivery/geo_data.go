package delivery

import (
	"encoding/json"
	"io"
	"net/http"
	neturl "net/url"
	"strconv"
	"strings"
	"time"
)

// AfricanCountry is a geocoding-supported country: its Nominatim ISO-3166-1
// alpha-2 code (for the countrycodes bias param) and a capital-city centroid
// used as a last-resort fallback when structured geocoding finds nothing.
type AfricanCountry struct {
	Name string
	ISO2 string
	Lat  float64
	Lng  float64
}

// SupportedCountries covers Ghana plus its immediate neighbours and the
// next tier of major West/East/Southern African markets. Ghana is the only
// one with region-level (state) resolution for now — see GhanaRegions.
var SupportedCountries = []AfricanCountry{
	{Name: "Ghana", ISO2: "GH", Lat: 5.6037, Lng: -0.1870},
	{Name: "Togo", ISO2: "TG", Lat: 6.1725, Lng: 1.2314},
	{Name: "Côte d'Ivoire", ISO2: "CI", Lat: 5.3600, Lng: -4.0083},
	{Name: "Burkina Faso", ISO2: "BF", Lat: 12.3714, Lng: -1.5197},
	{Name: "Benin", ISO2: "BJ", Lat: 6.3703, Lng: 2.3912},
	{Name: "Nigeria", ISO2: "NG", Lat: 9.0765, Lng: 7.3986},
	{Name: "Senegal", ISO2: "SN", Lat: 14.7167, Lng: -17.4677},
	{Name: "Cameroon", ISO2: "CM", Lat: 3.8480, Lng: 11.5021},
	{Name: "Kenya", ISO2: "KE", Lat: -1.2921, Lng: 36.8219},
	{Name: "South Africa", ISO2: "ZA", Lat: -25.7479, Lng: 28.2293},
}

// GhanaRegion is one of the 16 current administrative regions (post-2019
// split). Lat/Lng is the region's geometric centroid, not its capital —
// used to price a delivery when the named town/community can't be resolved
// on OpenStreetMap, so the fee is never computed from a wrong or (0,0) point.
type GhanaRegion struct {
	Name string
	Lat  float64
	Lng  float64
}

var GhanaRegions = []GhanaRegion{
	{Name: "Greater Accra", Lat: 5.8102, Lng: 0.0995},
	{Name: "Ashanti", Lat: 6.8003, Lng: -1.5188},
	{Name: "Western", Lat: 5.4261, Lng: -2.1287},
	{Name: "Western North", Lat: 6.2279, Lng: -2.8235},
	{Name: "Central", Lat: 5.7244, Lng: -1.3762},
	{Name: "Eastern", Lat: 6.4469, Lng: -0.3771},
	{Name: "Volta", Lat: 6.5349, Lng: 0.4556},
	{Name: "Oti", Lat: 7.8634, Lng: 0.3186},
	{Name: "Bono", Lat: 7.6762, Lng: -2.4735},
	{Name: "Bono East", Lat: 7.8035, Lng: -1.0876},
	{Name: "Ahafo", Lat: 6.9169, Lng: -2.5351},
	{Name: "Northern", Lat: 9.6600, Lng: -0.3944},
	{Name: "Savannah", Lat: 9.1401, Lng: -1.7111},
	{Name: "North East", Lat: 10.3960, Lng: -0.5411},
	{Name: "Upper East", Lat: 10.7854, Lng: -0.8514},
	{Name: "Upper West", Lat: 10.3670, Lng: -2.0921},
}

func countryByName(name string) (AfricanCountry, bool) {
	name = strings.TrimSpace(name)
	for _, c := range SupportedCountries {
		if strings.EqualFold(c.Name, name) {
			return c, true
		}
	}
	return AfricanCountry{}, false
}

func regionCentroid(name string) (lat, lng float64, ok bool) {
	name = strings.TrimSpace(name)
	for _, r := range GhanaRegions {
		if strings.EqualFold(r.Name, name) {
			return r.Lat, r.Lng, true
		}
	}
	return 0, 0, false
}

// geocodeStructured resolves a place within a region/country to GPS coords,
// falling back through increasingly coarse (but increasingly reliable) tiers
// so two addresses in the same municipality always land near each other
// instead of one silently drifting to (0,0) or the wrong place entirely:
//
//  1. landmark + town, freeform, scoped by region/country/countrycodes — most
//     precise, but landmark-level places (a specific suburb, street, or
//     compound name) are often missing from OpenStreetMap.
//  2. town alone, structured (city=) — the reliable anchor. Real Ghanaian
//     municipalities (Koforidua, Kumasi, Tamale, ...) are well-mapped even
//     when the neighbourhood inside them isn't, so this tier is what makes
//     "Koforidua, Trom" and "Koforidua, Kenkey Factory Road" both resolve to
//     essentially the same point when the landmark itself can't be found.
//  3. the region's centroid (Ghana only, for now).
//  4. the country's centroid.
//
// Two addresses in the same town therefore never end up wildly apart just
// because one landmark geocoded and the other didn't.
func geocodeStructured(landmark, town, region, country string) (lat, lng float64) {
	if landmark != "" {
		full := strings.Join(filterEmpty(landmark, town, region, country), ", ")
		if la, lo, ok := nominatimFreeform(full, country); ok {
			return la, lo
		}
	}

	if town != "" || region != "" {
		if la, lo, ok := nominatimStructured(town, region, country); ok {
			return la, lo
		}
	}

	if country == "" || strings.EqualFold(country, "Ghana") {
		if la, lo, ok := regionCentroid(region); ok {
			return la, lo
		}
	}

	if c, ok := countryByName(country); ok {
		return c.Lat, c.Lng
	}

	// Unknown country string — behave like the old default (Ghana-biased freeform).
	return geocodeAddress(strings.TrimSpace(strings.Join(filterEmpty(town, region, country), ", ")))
}

// nominatimFreeform is the same lookup as the original geocodeAddress but
// scoped to whichever country was actually selected, instead of always
// hardcoding Ghana — needed for the precise landmark-level attempt above.
func nominatimFreeform(query, country string) (lat, lng float64, ok bool) {
	q := neturl.Values{}
	q.Set("q", query)
	q.Set("format", "json")
	q.Set("limit", "1")
	if c, found := countryByName(country); found {
		q.Set("countrycodes", strings.ToLower(c.ISO2))
	}

	apiURL := "https://nominatim.openstreetmap.org/search?" + q.Encode()
	req, err := http.NewRequest("GET", apiURL, nil)
	if err != nil {
		return 0, 0, false
	}
	req.Header.Set("User-Agent", "SokoApp/1.0 (delivery@sokoapp.com)")
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return 0, 0, false
	}
	defer resp.Body.Close()

	var results []struct {
		Lat string `json:"lat"`
		Lon string `json:"lon"`
	}
	raw, _ := io.ReadAll(resp.Body)
	if err := json.Unmarshal(raw, &results); err != nil || len(results) == 0 {
		return 0, 0, false
	}
	la, err1 := strconv.ParseFloat(results[0].Lat, 64)
	lo, err2 := strconv.ParseFloat(results[0].Lon, 64)
	if err1 != nil || err2 != nil {
		return 0, 0, false
	}
	return la, lo, true
}

func nominatimStructured(town, region, country string) (lat, lng float64, ok bool) {
	q := neturl.Values{}
	if town != "" {
		q.Set("city", town)
	}
	if region != "" {
		q.Set("state", region)
	}
	if country != "" {
		q.Set("country", country)
	} else {
		q.Set("country", "Ghana")
	}
	q.Set("format", "json")
	q.Set("limit", "1")
	if c, found := countryByName(country); found {
		q.Set("countrycodes", strings.ToLower(c.ISO2))
	}

	apiURL := "https://nominatim.openstreetmap.org/search?" + q.Encode()
	req, err := http.NewRequest("GET", apiURL, nil)
	if err != nil {
		return 0, 0, false
	}
	req.Header.Set("User-Agent", "SokoApp/1.0 (delivery@sokoapp.com)")
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return 0, 0, false
	}
	defer resp.Body.Close()

	var results []struct {
		Lat string `json:"lat"`
		Lon string `json:"lon"`
	}
	raw, _ := io.ReadAll(resp.Body)
	if err := json.Unmarshal(raw, &results); err != nil || len(results) == 0 {
		return 0, 0, false
	}
	la, err1 := strconv.ParseFloat(results[0].Lat, 64)
	lo, err2 := strconv.ParseFloat(results[0].Lon, 64)
	if err1 != nil || err2 != nil {
		return 0, 0, false
	}
	return la, lo, true
}

// reverseGeocode turns GPS coords back into a (region, town, country) so we
// can tell the customer whether their pickup and dropoff are actually in the
// same town/region, instead of just trusting whatever text they typed. Only
// used for pickup, since dropoff's region/town come directly from the
// structured form fields the customer already chose.
func reverseGeocode(lat, lng float64) (region, town, country string, ok bool) {
	q := neturl.Values{}
	q.Set("format", "json")
	q.Set("lat", strconv.FormatFloat(lat, 'f', -1, 64))
	q.Set("lon", strconv.FormatFloat(lng, 'f', -1, 64))
	q.Set("zoom", "12")
	q.Set("addressdetails", "1")

	apiURL := "https://nominatim.openstreetmap.org/reverse?" + q.Encode()
	req, err := http.NewRequest("GET", apiURL, nil)
	if err != nil {
		return "", "", "", false
	}
	req.Header.Set("User-Agent", "SokoApp/1.0 (delivery@sokoapp.com)")
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", "", "", false
	}
	defer resp.Body.Close()

	var result struct {
		Address struct {
			State        string `json:"state"`
			City         string `json:"city"`
			Town         string `json:"town"`
			Municipality string `json:"municipality"`
			County       string `json:"county"`
			Country      string `json:"country"`
		} `json:"address"`
	}
	raw, _ := io.ReadAll(resp.Body)
	if err := json.Unmarshal(raw, &result); err != nil {
		return "", "", "", false
	}

	town = result.Address.City
	if town == "" {
		town = result.Address.Town
	}
	if town == "" {
		town = result.Address.Municipality
	}
	if town == "" {
		town = result.Address.County
	}

	if result.Address.State == "" && town == "" && result.Address.Country == "" {
		return "", "", "", false
	}
	return result.Address.State, town, result.Address.Country, true
}

// classifyTripScope compares pickup (reverse-geocoded from GPS) against
// dropoff (the customer's structured form input) and summarises the trip as
// "same_town", "same_region", "cross_region", or "cross_country" — "unknown"
// if we don't have enough resolved data to say. Region names are normalised
// before comparing since Nominatim tags Ghanaian regions as e.g. "Eastern
// Region" while our own picker list (and typical customer input) just says
// "Eastern".
func classifyTripScope(pickupCountry, pickupRegion, pickupTown, dropoffCountry, dropoffRegion, dropoffTown string) string {
	if dropoffCountry == "" {
		dropoffCountry = "Ghana"
	}
	if pickupCountry != "" && !strings.EqualFold(normalizeRegion(pickupCountry), normalizeRegion(dropoffCountry)) {
		return "cross_country"
	}
	if pickupRegion == "" || dropoffRegion == "" {
		return "unknown"
	}
	if !strings.EqualFold(normalizeRegion(pickupRegion), normalizeRegion(dropoffRegion)) {
		return "cross_region"
	}
	if pickupTown != "" && dropoffTown != "" && strings.EqualFold(normalizeRegion(pickupTown), normalizeRegion(dropoffTown)) {
		return "same_town"
	}
	return "same_region"
}

func normalizeRegion(s string) string {
	s = strings.TrimSpace(strings.ToLower(s))
	s = strings.TrimSuffix(s, " region")
	return s
}

func filterEmpty(vals ...string) []string {
	out := make([]string, 0, len(vals))
	for _, v := range vals {
		if v != "" {
			out = append(out, v)
		}
	}
	return out
}
