// Package weather exposes current conditions plus a short hourly outlook from
// the Google Maps Platform Weather API, normalized into a small contract the
// mobile app renders in its weather popup.
package weather

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"sync"

	"sokoapp/internal/googleapi"
)

const defaultBaseURL = "https://weather.googleapis.com/v1"

// Client calls the Google Weather API. BaseURL is overridable for tests.
type Client struct {
	APIKey  string
	BaseURL string
	HTTP    *http.Client
}

// NewClientFromEnv reads GOOGLE_WEATHER_API_KEY, falling back to the shared
// GOOGLE_MAPS_SERVER_KEY. An empty key leaves the feature switched off.
func NewClientFromEnv() *Client {
	return &Client{
		APIKey:  googleapi.Key("GOOGLE_WEATHER_API_KEY", "GOOGLE_MAPS_SERVER_KEY"),
		BaseURL: defaultBaseURL,
		HTTP:    googleapi.NewHTTPClient(),
	}
}

// Hour is one slot of the near-term outlook.
type Hour struct {
	Time          string  `json:"time"`
	TempC         float64 `json:"temp_c"`
	Condition     string  `json:"condition"`
	ConditionType string  `json:"condition_type"`
	IconURL       string  `json:"icon_url,omitempty"`
	PrecipChance  int     `json:"precip_chance"`
}

// Report is the normalized response returned to the app.
type Report struct {
	Time          string  `json:"time"`
	TimeZone      string  `json:"time_zone,omitempty"`
	IsDaytime     bool    `json:"is_daytime"`
	TempC         float64 `json:"temp_c"`
	FeelsLikeC    float64 `json:"feels_like_c"`
	Condition     string  `json:"condition"`
	ConditionType string  `json:"condition_type"`
	IconURL       string  `json:"icon_url,omitempty"`
	HumidityPct   int     `json:"humidity_pct"`
	PrecipChance  int     `json:"precip_chance"`
	PrecipType    string  `json:"precip_type,omitempty"`
	WindKph       float64 `json:"wind_kph"`
	UVIndex       int     `json:"uv_index"`
	Hourly        []Hour  `json:"hourly"`
	Source        string  `json:"source"`
}

// --- provider wire types (only the fields we read) ---

type gCondition struct {
	IconBaseURI string `json:"iconBaseUri"`
	Description struct {
		Text string `json:"text"`
	} `json:"description"`
	Type string `json:"type"`
}

type gTemp struct {
	Degrees float64 `json:"degrees"`
}

type gPrecip struct {
	Probability struct {
		Percent int    `json:"percent"`
		Type    string `json:"type"`
	} `json:"probability"`
}

type gCurrent struct {
	CurrentTime string `json:"currentTime"`
	TimeZone    struct {
		ID string `json:"id"`
	} `json:"timeZone"`
	IsDaytime            bool       `json:"isDaytime"`
	WeatherCondition     gCondition `json:"weatherCondition"`
	Temperature          gTemp      `json:"temperature"`
	FeelsLikeTemperature gTemp      `json:"feelsLikeTemperature"`
	RelativeHumidity     int        `json:"relativeHumidity"`
	UVIndex              int        `json:"uvIndex"`
	Precipitation        gPrecip    `json:"precipitation"`
	Wind                 struct {
		Speed struct {
			Value float64 `json:"value"`
		} `json:"speed"`
	} `json:"wind"`
}

type gHours struct {
	ForecastHours []struct {
		Interval struct {
			StartTime string `json:"startTime"`
		} `json:"interval"`
		WeatherCondition gCondition `json:"weatherCondition"`
		Temperature      gTemp      `json:"temperature"`
		Precipitation    gPrecip    `json:"precipitation"`
	} `json:"forecastHours"`
}

// iconURL turns Google's extension-less icon base into a PNG React Native can
// render (RN's <Image> doesn't draw SVG).
func iconURL(base string) string {
	if base == "" {
		return ""
	}
	return base + ".png"
}

func (c *Client) get(ctx context.Context, path string, q url.Values, out any) error {
	q.Set("key", c.APIKey)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.BaseURL+path+"?"+q.Encode(), nil)
	if err != nil {
		return err
	}
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode == http.StatusNotFound {
		// The Weather API answers 404 for locations it has no coverage for.
		return googleapi.ErrNoResult
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return &googleapi.ProviderError{Status: resp.StatusCode, Detail: string(body)}
	}
	if err := json.Unmarshal(body, out); err != nil {
		return fmt.Errorf("malformed provider response: %w", err)
	}
	return nil
}

func locationQuery(lat, lng float64) url.Values {
	q := url.Values{}
	q.Set("location.latitude", strconv.FormatFloat(lat, 'f', -1, 64))
	q.Set("location.longitude", strconv.FormatFloat(lng, 'f', -1, 64))
	q.Set("unitsSystem", "METRIC")
	q.Set("languageCode", "en")
	return q
}

// Current fetches current conditions and the next few hours in parallel. The
// hourly outlook is a nice-to-have: if only that call fails, the report is
// still returned with an empty Hourly list.
func (c *Client) Current(ctx context.Context, lat, lng float64, hours int) (*Report, error) {
	if c.APIKey == "" {
		return nil, googleapi.ErrNotConfigured
	}

	var (
		cur    gCurrent
		hrs    gHours
		curErr error
		wg     sync.WaitGroup
	)
	wg.Add(2)
	go func() {
		defer wg.Done()
		curErr = c.get(ctx, "/currentConditions:lookup", locationQuery(lat, lng), &cur)
	}()
	go func() {
		defer wg.Done()
		q := locationQuery(lat, lng)
		q.Set("hours", strconv.Itoa(hours))
		q.Set("pageSize", strconv.Itoa(hours))
		if err := c.get(ctx, "/forecast/hours:lookup", q, &hrs); err != nil {
			hrs = gHours{}
		}
	}()
	wg.Wait()
	if curErr != nil {
		return nil, curErr
	}

	r := &Report{
		Time:          cur.CurrentTime,
		TimeZone:      cur.TimeZone.ID,
		IsDaytime:     cur.IsDaytime,
		TempC:         cur.Temperature.Degrees,
		FeelsLikeC:    cur.FeelsLikeTemperature.Degrees,
		Condition:     cur.WeatherCondition.Description.Text,
		ConditionType: cur.WeatherCondition.Type,
		IconURL:       iconURL(cur.WeatherCondition.IconBaseURI),
		HumidityPct:   cur.RelativeHumidity,
		PrecipChance:  cur.Precipitation.Probability.Percent,
		PrecipType:    cur.Precipitation.Probability.Type,
		WindKph:       cur.Wind.Speed.Value,
		UVIndex:       cur.UVIndex,
		Hourly:        []Hour{},
		Source:        "Google Weather",
	}
	for i, h := range hrs.ForecastHours {
		if i >= hours {
			break
		}
		r.Hourly = append(r.Hourly, Hour{
			Time:          h.Interval.StartTime,
			TempC:         h.Temperature.Degrees,
			Condition:     h.WeatherCondition.Description.Text,
			ConditionType: h.WeatherCondition.Type,
			IconURL:       iconURL(h.WeatherCondition.IconBaseURI),
			PrecipChance:  h.Precipitation.Probability.Percent,
		})
	}
	return r, nil
}
