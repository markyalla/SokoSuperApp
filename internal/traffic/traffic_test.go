package traffic

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

const routesJSON = `{"routes": [
  {"duration": "1500s", "staticDuration": "1100s", "distanceMeters": 9000, "description": "N1",
   "routeLabels": ["DEFAULT_ROUTE"], "polyline": {"encodedPolyline": "abc"},
   "travelAdvisory": {"speedReadingIntervals": [{"endPolylinePointIndex": 5, "speed": "NORMAL"}, {"startPolylinePointIndex": 5, "endPolylinePointIndex": 9, "speed": "TRAFFIC_JAM"}]},
   "legs": [{"steps": [{"distanceMeters": 400, "staticDuration": "60s", "navigationInstruction": {"maneuver": "TURN_LEFT", "instructions": "Turn left onto Ring Rd"}}]}]},
  {"duration": "1300s", "staticDuration": "1200s", "distanceMeters": 11000, "description": "Spintex Rd",
   "routeLabels": ["DEFAULT_ROUTE_ALTERNATE"], "polyline": {"encodedPolyline": "def"}, "legs": []}
]}`

type captured struct {
	path, key, mask string
	body            map[string]any
}

func fakeGoogle(t *testing.T, status int, payload string) (*Client, *captured) {
	t.Helper()
	cap := &captured{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cap.path = r.URL.String()
		cap.key = r.Header.Get("X-Goog-Api-Key")
		cap.mask = r.Header.Get("X-Goog-FieldMask")
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &cap.body)
		w.WriteHeader(status)
		w.Write([]byte(payload))
	}))
	t.Cleanup(srv.Close)
	return &Client{
		RoutesKey: "rk", PlacesKey: "pk",
		RoutesURL: srv.URL + "/routes", PlacesURL: srv.URL,
		HTTP: srv.Client(),
	}, cap
}

func serve(t *testing.T, client *Client, method, target string, body any) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/traffic/routes", ComputeRoutesHandler(client))
	r.GET("/traffic/places/autocomplete", AutocompleteHandler(client))
	r.GET("/traffic/places/:id", PlaceDetailsHandler(client))
	var rdr io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rdr = bytes.NewReader(b)
	}
	req := httptest.NewRequest(method, target, rdr)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var out map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	return w, out
}

var accraTrip = map[string]any{
	"origin":      map[string]float64{"lat": 5.6037, "lng": -0.1870},
	"destination": map[string]float64{"lat": 5.6500, "lng": -0.1000},
}

func TestComputeRoutesNormalizes(t *testing.T) {
	client, cap := fakeGoogle(t, 200, routesJSON)
	w, body := serve(t, client, http.MethodPost, "/traffic/routes", accraTrip)
	if w.Code != 200 {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	if cap.key != "rk" || !strings.Contains(cap.mask, "routes.polyline.encodedPolyline") {
		t.Fatalf("bad upstream headers: key=%q mask=%q", cap.key, cap.mask)
	}
	if cap.body["routingPreference"] != "TRAFFIC_AWARE" || cap.body["computeAlternativeRoutes"] != true {
		t.Fatalf("bad upstream body: %v", cap.body)
	}
	routes := body["routes"].([]any)
	if len(routes) != 2 {
		t.Fatalf("routes = %d", len(routes))
	}
	r0 := routes[0].(map[string]any)
	r1 := routes[1].(map[string]any)
	if r0["duration_seconds"].(float64) != 1500 || r0["delay_seconds"].(float64) != 400 {
		t.Fatalf("r0 durations wrong: %v", r0)
	}
	// Route 0 is shorter, route 1 is faster — both flags must be distinct.
	if r0["is_shortest"] != true || r0["is_fastest"] != false || r1["is_fastest"] != true || r1["is_shortest"] != false {
		t.Fatalf("fastest/shortest flags wrong: %v / %v", r0, r1)
	}
	if r0["is_default"] != true {
		t.Fatal("default label lost")
	}
	segs := r0["traffic_segments"].([]any)
	if len(segs) != 2 || segs[1].(map[string]any)["speed"] != "TRAFFIC_JAM" || segs[0].(map[string]any)["start_index"].(float64) != 0 {
		t.Fatalf("segments wrong: %v", segs)
	}
	steps := r0["steps"].([]any)
	if len(steps) != 1 || steps[0].(map[string]any)["instruction"] != "Turn left onto Ring Rd" {
		t.Fatalf("steps wrong: %v", steps)
	}
	if strings.Contains(w.Body.String(), "rk") {
		t.Fatal("api key leaked")
	}
}

func TestWalkOmitsTrafficPreference(t *testing.T) {
	client, cap := fakeGoogle(t, 200, routesJSON)
	trip := map[string]any{"origin": accraTrip["origin"], "destination": accraTrip["destination"], "travel_mode": "walk"}
	w, _ := serve(t, client, http.MethodPost, "/traffic/routes", trip)
	if w.Code != 200 {
		t.Fatalf("status %d", w.Code)
	}
	if _, ok := cap.body["routingPreference"]; ok {
		t.Fatal("WALK must not send routingPreference")
	}
}

func TestComputeRoutesErrors(t *testing.T) {
	cases := []struct {
		name     string
		status   int
		payload  string
		body     any
		noKey    bool
		wantCode int
		wantErr  string
	}{
		{"bad json", 200, routesJSON, "nope", false, 400, "invalid_request"},
		{"invalid coords", 200, routesJSON, map[string]any{"origin": map[string]float64{"lat": 200, "lng": 0}, "destination": accraTrip["destination"]}, false, 400, "invalid_location"},
		{"bad mode", 200, routesJSON, map[string]any{"origin": accraTrip["origin"], "destination": accraTrip["destination"], "travel_mode": "PLANE"}, false, 400, "invalid_mode"},
		{"no routes", 200, `{}`, accraTrip, false, 404, "no_result"},
		{"quota", 429, `{}`, accraTrip, false, 503, "quota"},
		{"unsupported", 400, `{"error":{"message":"two wheeler not supported"}}`, accraTrip, false, 422, "unsupported"},
		{"not configured", 200, routesJSON, accraTrip, true, 503, "not_configured"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			client, _ := fakeGoogle(t, tc.status, tc.payload)
			if tc.noKey {
				client.RoutesKey = ""
			}
			w, body := serve(t, client, http.MethodPost, "/traffic/routes", tc.body)
			if w.Code != tc.wantCode || body["code"] != tc.wantErr {
				t.Fatalf("got %d %v, want %d %s", w.Code, body, tc.wantCode, tc.wantErr)
			}
		})
	}
}

func TestAutocomplete(t *testing.T) {
	payload := `{"suggestions": [
	  {"placePrediction": {"placeId": "ChIJabc", "structuredFormat": {"mainText": {"text": "Accra Mall"}, "secondaryText": {"text": "Spintex Rd, Accra"}}}},
	  {"queryPrediction": {"text": {"text": "accra restaurants"}}}
	]}`
	client, cap := fakeGoogle(t, 200, payload)
	w, body := serve(t, client, http.MethodGet, "/traffic/places/autocomplete?q=accra+mall&lat=5.6037&lng=-0.187&session=abc-123", nil)
	if w.Code != 200 {
		t.Fatalf("status %d", w.Code)
	}
	s := body["suggestions"].([]any)
	if len(s) != 1 || s[0].(map[string]any)["main_text"] != "Accra Mall" {
		t.Fatalf("suggestions wrong: %v", s)
	}
	if cap.key != "pk" || cap.body["sessionToken"] != "abc-123" || cap.body["locationBias"] == nil {
		t.Fatalf("upstream request wrong: %+v", cap)
	}

	// One-character input short-circuits without calling Google.
	cap.path = ""
	w, body = serve(t, client, http.MethodGet, "/traffic/places/autocomplete?q=a", nil)
	if w.Code != 200 || len(body["suggestions"].([]any)) != 0 || cap.path != "" {
		t.Fatalf("short query should not hit upstream: %d %v %q", w.Code, body, cap.path)
	}
}

func TestPlaceDetails(t *testing.T) {
	payload := `{"id": "ChIJabc", "displayName": {"text": "Accra Mall"}, "formattedAddress": "Spintex Rd, Accra", "location": {"latitude": 5.6227, "longitude": -0.1733}}`
	client, cap := fakeGoogle(t, 200, payload)
	w, body := serve(t, client, http.MethodGet, "/traffic/places/ChIJabc?session=s1", nil)
	if w.Code != 200 || body["lat"].(float64) != 5.6227 || body["name"] != "Accra Mall" {
		t.Fatalf("got %d %v", w.Code, body)
	}
	if cap.path != "/places/ChIJabc?sessionToken=s1" {
		t.Fatalf("upstream path = %q", cap.path)
	}

	// Path-injection attempts are rejected before reaching Google.
	// (%2F is already turned away by the router; %3F decodes to "?" inside the param.)
	w, body = serve(t, client, http.MethodGet, "/traffic/places/abc%3Fkey%3Dx", nil)
	if w.Code != 400 || body["code"] != "invalid_place" {
		t.Fatalf("got %d %v", w.Code, body)
	}
}
