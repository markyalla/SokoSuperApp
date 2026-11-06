package weather

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	"sokoapp/internal/googleapi"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
)

const hourlySlots = 6

// cacheTTL is WEATHER_CACHE_SECONDS (default 0 = off). Only turn it on once
// you have confirmed the Google Maps Platform terms allow caching Weather API
// content for that long; nearby users then share one upstream call.
func cacheTTL() time.Duration {
	n, err := strconv.Atoi(os.Getenv("WEATHER_CACHE_SECONDS"))
	if err != nil || n <= 0 {
		return 0
	}
	return time.Duration(n) * time.Second
}

// GetCurrent handles GET /api/v1/weather/current?lat=..&lng=..
//
// The coordinate is rounded to ~1 km before it is sent to Google or used as a
// cache key, and it is never logged or stored.
func GetCurrent(client *Client, rdb *redis.Client) gin.HandlerFunc {
	ttl := cacheTTL()
	return func(c *gin.Context) {
		lat, errLat := strconv.ParseFloat(c.Query("lat"), 64)
		lng, errLng := strconv.ParseFloat(c.Query("lng"), 64)
		if errLat != nil || errLng != nil || !googleapi.ValidLatLng(lat, lng) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "We couldn't read your location. Please try again.", "code": "invalid_location"})
			return
		}
		lat, lng = googleapi.Coarsen(lat, 2), googleapi.Coarsen(lng, 2)
		cacheKey := fmt.Sprintf("weather:v1:%.2f:%.2f", lat, lng)

		if ttl > 0 && rdb != nil {
			if raw, err := rdb.Get(c.Request.Context(), cacheKey).Bytes(); err == nil {
				var cached Report
				if json.Unmarshal(raw, &cached) == nil {
					c.JSON(http.StatusOK, cached)
					return
				}
			}
		}

		ctx, cancel := context.WithTimeout(c.Request.Context(), 8*time.Second)
		defer cancel()
		start := time.Now()
		report, err := client.Current(ctx, lat, lng, hourlySlots)
		elapsed := time.Since(start)

		if err != nil {
			status, msg, code := mapError(err)
			// Latency + outcome only — no coordinates in logs.
			log.Printf("[weather] upstream error after %s: %v", elapsed.Round(time.Millisecond), err)
			c.JSON(status, gin.H{"error": msg, "code": code})
			return
		}
		log.Printf("[weather] ok in %s", elapsed.Round(time.Millisecond))

		if ttl > 0 && rdb != nil {
			if raw, err := json.Marshal(report); err == nil {
				rdb.Set(c.Request.Context(), cacheKey, raw, ttl)
			}
		}
		c.JSON(http.StatusOK, report)
	}
}

func mapError(err error) (int, string, string) {
	var pe *googleapi.ProviderError
	switch {
	case errors.Is(err, googleapi.ErrNotConfigured):
		return http.StatusServiceUnavailable, "Weather updates aren't available right now.", "not_configured"
	case errors.Is(err, googleapi.ErrNoResult):
		return http.StatusNotFound, "Weather isn't available for your area yet.", "no_coverage"
	case errors.Is(err, context.DeadlineExceeded):
		return http.StatusGatewayTimeout, "Weather is taking too long to load. Please try again.", "timeout"
	case errors.As(err, &pe) && pe.IsQuota():
		return http.StatusServiceUnavailable, "Weather is busy right now. Please try again later.", "quota"
	default:
		return http.StatusBadGateway, "We couldn't load the weather. Please try again.", "provider_error"
	}
}
