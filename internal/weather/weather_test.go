package weather

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

const currentJSON = `{
  "currentTime": "2026-11-05T10:00:00Z",
  "timeZone": {"id": "Africa/Accra"},
  "isDaytime": true,
  "weatherCondition": {"iconBaseUri": "https://maps.gstatic.com/weather/v1/cloudy", "description": {"text": "Cloudy"}, "type": "CLOUDY"},
  "temperature": {"degrees": 29.4, "unit": "CELSIUS"},
  "feelsLikeTemperature": {"degrees": 33.1},
  "relativeHumidity": 78,
  "uvIndex": 6,
  "precipitation": {"probability": {"percent": 40, "type": "RAIN"}},
  "wind": {"speed": {"value": 14, "unit": "KILOMETERS_PER_HOUR"}}
}`

const hoursJSON = `{"forecastHours": [
  {"interval": {"startTime": "2026-11-05T11:00:00Z"}, "weatherCondition": {"description": {"text": "Rain"}, "type": "RAIN"}, "temperature": {"degrees": 28}, "precipitation": {"probability": {"percent": 70}}},
  {"interval": {"startTime": "2026-11-05T12:00:00Z"}, "weatherCondition": {"description": {"text": "Showers"}, "type": "SHOWERS"}, "temperature": {"degrees": 27}, "precipitation": {"probability": {"percent": 60}}}
]}`

func fakeGoogle(t *testing.T, currentStatus int, hoursStatus int) (*httptest.Server, *[]string) {
	t.Helper()
	var seen []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = append(seen, r.URL.String())
		switch {
		case strings.HasPrefix(r.URL.Path, "/currentConditions:lookup"):
			w.WriteHeader(currentStatus)
			if currentStatus == 200 {
				w.Write([]byte(currentJSON))
			}
		case strings.HasPrefix(r.URL.Path, "/forecast/hours:lookup"):
			w.WriteHeader(hoursStatus)
			if hoursStatus == 200 {
				w.Write([]byte(hoursJSON))
			}
		default:
			w.WriteHeader(404)
		}
	}))
	t.Cleanup(srv.Close)
	return srv, &seen
}

func run(t *testing.T, client *Client, query string) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/weather/current", GetCurrent(client, nil))
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/weather/current?"+query, nil)
	r.ServeHTTP(w, req)
	var body map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	return w, body
}

func TestGetCurrentNormalizes(t *testing.T) {
	srv, seen := fakeGoogle(t, 200, 200)
	client := &Client{APIKey: "k", BaseURL: srv.URL, HTTP: srv.Client()}

	w, body := run(t, client, "lat=5.614818&lng=-0.205874")
	if w.Code != 200 {
		t.Fatalf("status = %d, body %s", w.Code, w.Body.String())
	}
	if body["temp_c"].(float64) != 29.4 || body["condition"] != "Cloudy" || body["precip_chance"].(float64) != 40 {
		t.Fatalf("unexpected body: %v", body)
	}
	if body["icon_url"] != "https://maps.gstatic.com/weather/v1/cloudy.png" {
		t.Fatalf("icon_url = %v", body["icon_url"])
	}
	if n := len(body["hourly"].([]any)); n != 2 {
		t.Fatalf("hourly len = %d", n)
	}
	// Coordinates are coarsened to 2 decimals before leaving the server.
	for _, u := range *seen {
		if strings.Contains(u, "5.614818") || !strings.Contains(u, "location.latitude=5.61") {
			t.Fatalf("precise coordinate sent upstream: %s", u)
		}
	}
	if strings.Contains(w.Body.String(), "key=") {
		t.Fatal("api key leaked into response")
	}
}

func TestGetCurrentHourlyFailureIsNonFatal(t *testing.T) {
	srv, _ := fakeGoogle(t, 200, 500)
	client := &Client{APIKey: "k", BaseURL: srv.URL, HTTP: srv.Client()}
	w, body := run(t, client, "lat=5.6&lng=-0.2")
	if w.Code != 200 || len(body["hourly"].([]any)) != 0 {
		t.Fatalf("status %d body %v", w.Code, body)
	}
}

func TestGetCurrentErrors(t *testing.T) {
	cases := []struct {
		name     string
		key      string
		status   int
		query    string
		wantCode int
		wantErr  string
	}{
		{"missing coords", "k", 200, "", 400, "invalid_location"},
		{"out of range", "k", 200, "lat=95&lng=0", 400, "invalid_location"},
		{"null island", "k", 200, "lat=0&lng=0", 400, "invalid_location"},
		{"not configured", "", 200, "lat=5.6&lng=-0.2", 503, "not_configured"},
		{"no coverage", "k", 404, "lat=5.6&lng=-0.2", 404, "no_coverage"},
		{"quota", "k", 429, "lat=5.6&lng=-0.2", 503, "quota"},
		{"provider error", "k", 500, "lat=5.6&lng=-0.2", 502, "provider_error"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv, _ := fakeGoogle(t, tc.status, 200)
			client := &Client{APIKey: tc.key, BaseURL: srv.URL, HTTP: srv.Client()}
			w, body := run(t, client, tc.query)
			if w.Code != tc.wantCode || body["code"] != tc.wantErr {
				t.Fatalf("got %d %v, want %d %s", w.Code, body, tc.wantCode, tc.wantErr)
			}
		})
	}
}

func TestMalformedProviderResponse(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("{not json"))
	}))
	defer srv.Close()
	client := &Client{APIKey: "k", BaseURL: srv.URL, HTTP: srv.Client()}
	w, body := run(t, client, "lat=5.6&lng=-0.2")
	if w.Code != 502 || body["code"] != "provider_error" {
		t.Fatalf("got %d %v", w.Code, body)
	}
}
