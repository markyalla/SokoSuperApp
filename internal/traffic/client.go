// Package traffic powers SokoTraffic: destination search (Google Places API
// (New) Autocomplete + Place Details) and traffic-aware route alternatives
// (Google Routes API computeRoutes), normalized into a small contract for the
// mobile app. No route history or user coordinates are stored.
package traffic

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"sokoapp/internal/googleapi"
)

const (
	defaultRoutesURL = "https://routes.googleapis.com/directions/v2:computeRoutes"
	defaultPlacesURL = "https://places.googleapis.com/v1"

	// Only the fields we use — Routes/Places bill by the field mask tier.
	routesFieldMask = "routes.duration,routes.staticDuration,routes.distanceMeters," +
		"routes.description,routes.routeLabels,routes.polyline.encodedPolyline," +
		"routes.travelAdvisory.speedReadingIntervals," +
		"routes.legs.steps.navigationInstruction,routes.legs.steps.distanceMeters," +
		"routes.legs.steps.staticDuration"
	autocompleteFieldMask = "suggestions.placePrediction.placeId," +
		"suggestions.placePrediction.structuredFormat"
	detailsFieldMask = "id,displayName,formattedAddress,location"
)

// Client talks to the Routes and Places APIs. URLs are overridable for tests.
type Client struct {
	RoutesKey   string
	PlacesKey   string
	RoutesURL   string
	PlacesURL   string
	RegionCodes []string // optional Places restriction, e.g. ["gh"]
	HTTP        *http.Client
}

// NewClientFromEnv reads GOOGLE_ROUTES_API_KEY and GOOGLE_PLACES_API_KEY, both
// falling back to GOOGLE_MAPS_SERVER_KEY. TRAFFIC_REGION_CODES (comma list of
// CLDR region codes, e.g. "gh,ng") narrows destination suggestions.
func NewClientFromEnv() *Client {
	var regions []string
	for _, r := range strings.Split(googleapi.Key("TRAFFIC_REGION_CODES"), ",") {
		if r = strings.ToLower(strings.TrimSpace(r)); r != "" {
			regions = append(regions, r)
		}
	}
	return &Client{
		RoutesKey:   googleapi.Key("GOOGLE_ROUTES_API_KEY", "GOOGLE_MAPS_SERVER_KEY"),
		PlacesKey:   googleapi.Key("GOOGLE_PLACES_API_KEY", "GOOGLE_ROUTES_API_KEY", "GOOGLE_MAPS_SERVER_KEY"),
		RoutesURL:   defaultRoutesURL,
		PlacesURL:   defaultPlacesURL,
		RegionCodes: regions,
		HTTP:        googleapi.NewHTTPClient(),
	}
}

// ---------- normalized contract ----------

type LatLng struct {
	Lat float64 `json:"lat"`
	Lng float64 `json:"lng"`
}

type Step struct {
	Instruction     string `json:"instruction"`
	Maneuver        string `json:"maneuver,omitempty"`
	DistanceMeters  int    `json:"distance_meters"`
	DurationSeconds int    `json:"duration_seconds"`
}

// TrafficSegment covers polyline points [StartIndex, EndIndex) with one of
// NORMAL, SLOW or TRAFFIC_JAM.
type TrafficSegment struct {
	StartIndex int    `json:"start_index"`
	EndIndex   int    `json:"end_index"`
	Speed      string `json:"speed"`
}

type Route struct {
	ID                    string           `json:"id"`
	Description           string           `json:"description,omitempty"`
	DistanceMeters        int              `json:"distance_meters"`
	DurationSeconds       int              `json:"duration_seconds"`        // traffic-aware ETA
	StaticDurationSeconds int              `json:"static_duration_seconds"` // without traffic
	DelaySeconds          int              `json:"delay_seconds"`
	Polyline              string           `json:"polyline"` // Google encoded polyline
	TrafficSegments       []TrafficSegment `json:"traffic_segments"`
	Steps                 []Step           `json:"steps"`
	IsFastest             bool             `json:"is_fastest"`
	IsShortest            bool             `json:"is_shortest"`
	IsDefault             bool             `json:"is_default"`
}

type Suggestion struct {
	PlaceID       string `json:"place_id"`
	MainText      string `json:"main_text"`
	SecondaryText string `json:"secondary_text"`
}

type Place struct {
	PlaceID string  `json:"place_id"`
	Name    string  `json:"name"`
	Address string  `json:"address"`
	Lat     float64 `json:"lat"`
	Lng     float64 `json:"lng"`
}

// ---------- HTTP helper ----------

func (c *Client) do(ctx context.Context, method, endpoint, key, fieldMask string, body any, out any) error {
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, endpoint, rdr)
	if err != nil {
		return err
	}
	req.Header.Set("X-Goog-Api-Key", key)
	req.Header.Set("X-Goog-FieldMask", fieldMask)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if resp.StatusCode == http.StatusNotFound {
		return googleapi.ErrNoResult
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return &googleapi.ProviderError{Status: resp.StatusCode, Detail: string(raw)}
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return fmt.Errorf("malformed provider response: %w", err)
	}
	return nil
}

// parseDuration reads protobuf JSON durations like "1234s" or "12.5s".
func parseDuration(s string) int {
	f, err := strconv.ParseFloat(strings.TrimSuffix(s, "s"), 64)
	if err != nil {
		return 0
	}
	return int(f + 0.5)
}

// ---------- Routes ----------

type gLatLng struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
}

type gWaypoint struct {
	Location struct {
		LatLng gLatLng `json:"latLng"`
	} `json:"location"`
}

func waypoint(p LatLng) gWaypoint {
	var w gWaypoint
	w.Location.LatLng = gLatLng{Latitude: p.Lat, Longitude: p.Lng}
	return w
}

type gRoutesResp struct {
	Routes []struct {
		Duration       string   `json:"duration"`
		StaticDuration string   `json:"staticDuration"`
		DistanceMeters int      `json:"distanceMeters"`
		Description    string   `json:"description"`
		RouteLabels    []string `json:"routeLabels"`
		Polyline       struct {
			EncodedPolyline string `json:"encodedPolyline"`
		} `json:"polyline"`
		TravelAdvisory struct {
			SpeedReadingIntervals []struct {
				StartPolylinePointIndex int    `json:"startPolylinePointIndex"`
				EndPolylinePointIndex   int    `json:"endPolylinePointIndex"`
				Speed                   string `json:"speed"`
			} `json:"speedReadingIntervals"`
		} `json:"travelAdvisory"`
		Legs []struct {
			Steps []struct {
				DistanceMeters        int    `json:"distanceMeters"`
				StaticDuration        string `json:"staticDuration"`
				NavigationInstruction struct {
					Maneuver     string `json:"maneuver"`
					Instructions string `json:"instructions"`
				} `json:"navigationInstruction"`
			} `json:"steps"`
		} `json:"legs"`
	} `json:"routes"`
}

// TravelModes accepted from the app. TWO_WHEELER (motorbike/okada) is only
// supported by Google in some countries — the API errors where it isn't.
var TravelModes = map[string]bool{"DRIVE": true, "TWO_WHEELER": true, "WALK": true}

// ComputeRoutes returns traffic-aware alternatives between two points.
func (c *Client) ComputeRoutes(ctx context.Context, origin, dest LatLng, mode string) ([]Route, error) {
	if c.RoutesKey == "" {
		return nil, googleapi.ErrNotConfigured
	}
	body := map[string]any{
		"origin":                   waypoint(origin),
		"destination":              waypoint(dest),
		"travelMode":               mode,
		"computeAlternativeRoutes": true,
		"languageCode":             "en",
		"units":                    "METRIC",
	}
	// Traffic-aware routing (and traffic on the polyline) only exists for
	// motor vehicles; WALK must leave routingPreference unset.
	if mode != "WALK" {
		body["routingPreference"] = "TRAFFIC_AWARE"
		body["extraComputations"] = []string{"TRAFFIC_ON_POLYLINE"}
	}

	var resp gRoutesResp
	if err := c.do(ctx, http.MethodPost, c.RoutesURL, c.RoutesKey, routesFieldMask, body, &resp); err != nil {
		return nil, err
	}
	if len(resp.Routes) == 0 {
		return nil, googleapi.ErrNoResult
	}

	routes := make([]Route, 0, len(resp.Routes))
	for i, gr := range resp.Routes {
		r := Route{
			ID:                    "route_" + strconv.Itoa(i),
			Description:           gr.Description,
			DistanceMeters:        gr.DistanceMeters,
			DurationSeconds:       parseDuration(gr.Duration),
			StaticDurationSeconds: parseDuration(gr.StaticDuration),
			Polyline:              gr.Polyline.EncodedPolyline,
			TrafficSegments:       []TrafficSegment{},
			Steps:                 []Step{},
		}
		if r.StaticDurationSeconds == 0 {
			r.StaticDurationSeconds = r.DurationSeconds
		}
		if d := r.DurationSeconds - r.StaticDurationSeconds; d > 0 {
			r.DelaySeconds = d
		}
		for _, l := range gr.RouteLabels {
			if l == "DEFAULT_ROUTE" {
				r.IsDefault = true
			}
		}
		for _, s := range gr.TravelAdvisory.SpeedReadingIntervals {
			r.TrafficSegments = append(r.TrafficSegments, TrafficSegment{
				StartIndex: s.StartPolylinePointIndex, EndIndex: s.EndPolylinePointIndex, Speed: s.Speed,
			})
		}
		for _, leg := range gr.Legs {
			for _, s := range leg.Steps {
				if s.NavigationInstruction.Instructions == "" && s.DistanceMeters == 0 {
					continue
				}
				r.Steps = append(r.Steps, Step{
					Instruction:     s.NavigationInstruction.Instructions,
					Maneuver:        s.NavigationInstruction.Maneuver,
					DistanceMeters:  s.DistanceMeters,
					DurationSeconds: parseDuration(s.StaticDuration),
				})
			}
		}
		routes = append(routes, r)
	}
	markBest(routes)
	return routes, nil
}

// markBest flags the fastest (traffic-aware ETA) and the shortest (distance)
// route so the app can label them; they're often, but not always, the same.
func markBest(routes []Route) {
	if len(routes) == 0 {
		return
	}
	fast, short := 0, 0
	for i, r := range routes {
		if r.DurationSeconds < routes[fast].DurationSeconds {
			fast = i
		}
		if r.DistanceMeters < routes[short].DistanceMeters {
			short = i
		}
	}
	routes[fast].IsFastest = true
	routes[short].IsShortest = true
}

// ---------- Places ----------

type gAutocompleteResp struct {
	Suggestions []struct {
		PlacePrediction *struct {
			PlaceID          string `json:"placeId"`
			StructuredFormat struct {
				MainText struct {
					Text string `json:"text"`
				} `json:"mainText"`
				SecondaryText struct {
					Text string `json:"text"`
				} `json:"secondaryText"`
			} `json:"structuredFormat"`
		} `json:"placePrediction"`
	} `json:"suggestions"`
}

// Autocomplete returns destination suggestions, biased towards near (when
// known). sessionToken groups the keystrokes and the final details lookup
// into one billed Places session.
func (c *Client) Autocomplete(ctx context.Context, input string, near *LatLng, sessionToken string) ([]Suggestion, error) {
	if c.PlacesKey == "" {
		return nil, googleapi.ErrNotConfigured
	}
	body := map[string]any{"input": input, "languageCode": "en"}
	if sessionToken != "" {
		body["sessionToken"] = sessionToken
	}
	if near != nil {
		body["locationBias"] = map[string]any{
			"circle": map[string]any{
				"center": gLatLng{Latitude: near.Lat, Longitude: near.Lng},
				"radius": 50000.0,
			},
		}
		body["origin"] = gLatLng{Latitude: near.Lat, Longitude: near.Lng}
	}
	if len(c.RegionCodes) > 0 {
		body["includedRegionCodes"] = c.RegionCodes
	}

	var resp gAutocompleteResp
	if err := c.do(ctx, http.MethodPost, c.PlacesURL+"/places:autocomplete", c.PlacesKey, autocompleteFieldMask, body, &resp); err != nil {
		return nil, err
	}
	out := []Suggestion{}
	for _, s := range resp.Suggestions {
		if s.PlacePrediction == nil || s.PlacePrediction.PlaceID == "" {
			continue // query predictions have no place to route to
		}
		out = append(out, Suggestion{
			PlaceID:       s.PlacePrediction.PlaceID,
			MainText:      s.PlacePrediction.StructuredFormat.MainText.Text,
			SecondaryText: s.PlacePrediction.StructuredFormat.SecondaryText.Text,
		})
	}
	return out, nil
}

type gPlace struct {
	ID          string `json:"id"`
	DisplayName struct {
		Text string `json:"text"`
	} `json:"displayName"`
	FormattedAddress string  `json:"formattedAddress"`
	Location         gLatLng `json:"location"`
}

// PlaceDetails resolves a suggestion to coordinates. placeID and sessionToken
// must already be validated with googleapi.SafeToken.
func (c *Client) PlaceDetails(ctx context.Context, placeID, sessionToken string) (*Place, error) {
	if c.PlacesKey == "" {
		return nil, googleapi.ErrNotConfigured
	}
	endpoint := c.PlacesURL + "/places/" + url.PathEscape(placeID)
	if sessionToken != "" {
		endpoint += "?sessionToken=" + url.QueryEscape(sessionToken)
	}
	var p gPlace
	if err := c.do(ctx, http.MethodGet, endpoint, c.PlacesKey, detailsFieldMask, nil, &p); err != nil {
		return nil, err
	}
	if !googleapi.ValidLatLng(p.Location.Latitude, p.Location.Longitude) {
		return nil, googleapi.ErrNoResult
	}
	return &Place{
		PlaceID: p.ID,
		Name:    p.DisplayName.Text,
		Address: p.FormattedAddress,
		Lat:     p.Location.Latitude,
		Lng:     p.Location.Longitude,
	}, nil
}
