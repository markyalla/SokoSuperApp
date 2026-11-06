package traffic

import (
	"context"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"sokoapp/internal/googleapi"

	"github.com/gin-gonic/gin"
)

type routesRequest struct {
	Origin      LatLng `json:"origin"`
	Destination LatLng `json:"destination"`
	TravelMode  string `json:"travel_mode"`
}

// ComputeRoutesHandler handles POST /api/v1/traffic/routes.
func ComputeRoutesHandler(client *Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req routesRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Please choose where you're starting from and where you're going.", "code": "invalid_request"})
			return
		}
		if !googleapi.ValidLatLng(req.Origin.Lat, req.Origin.Lng) || !googleapi.ValidLatLng(req.Destination.Lat, req.Destination.Lng) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "We couldn't read one of the locations. Please pick them again.", "code": "invalid_location"})
			return
		}
		mode := strings.ToUpper(strings.TrimSpace(req.TravelMode))
		if mode == "" {
			mode = "DRIVE"
		}
		if !TravelModes[mode] {
			c.JSON(http.StatusBadRequest, gin.H{"error": "That travel mode isn't supported.", "code": "invalid_mode"})
			return
		}

		ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
		defer cancel()
		start := time.Now()
		routes, err := client.ComputeRoutes(ctx, req.Origin, req.Destination, mode)
		elapsed := time.Since(start).Round(time.Millisecond)
		if err != nil {
			log.Printf("[traffic] routes %s failed after %s: %v", mode, elapsed, err)
			status, msg, code := mapError(err, "No route found between these places.")
			c.JSON(status, gin.H{"error": msg, "code": code})
			return
		}
		log.Printf("[traffic] routes %s ok in %s (%d alternatives)", mode, elapsed, len(routes))
		c.JSON(http.StatusOK, gin.H{
			"travel_mode": mode,
			"routes":      routes,
			"source":      "Google Maps",
			"computed_at": time.Now().UTC().Format(time.RFC3339),
		})
	}
}

// AutocompleteHandler handles GET /api/v1/traffic/places/autocomplete?q=..&lat=..&lng=..&session=..
func AutocompleteHandler(client *Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		q := strings.TrimSpace(c.Query("q"))
		if utf8.RuneCountInString(q) < 2 {
			c.JSON(http.StatusOK, gin.H{"suggestions": []Suggestion{}})
			return
		}
		if utf8.RuneCountInString(q) > 120 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "That search is too long.", "code": "invalid_request"})
			return
		}
		session := c.Query("session")
		if session != "" && !googleapi.SafeToken(session, 36) {
			session = ""
		}
		var near *LatLng
		lat, e1 := strconv.ParseFloat(c.Query("lat"), 64)
		lng, e2 := strconv.ParseFloat(c.Query("lng"), 64)
		if e1 == nil && e2 == nil && googleapi.ValidLatLng(lat, lng) {
			near = &LatLng{Lat: googleapi.Coarsen(lat, 2), Lng: googleapi.Coarsen(lng, 2)}
		}

		ctx, cancel := context.WithTimeout(c.Request.Context(), 6*time.Second)
		defer cancel()
		suggestions, err := client.Autocomplete(ctx, q, near, session)
		if err != nil {
			log.Printf("[traffic] autocomplete failed: %v", err)
			status, msg, code := mapError(err, "No places found.")
			c.JSON(status, gin.H{"error": msg, "code": code})
			return
		}
		c.JSON(http.StatusOK, gin.H{"suggestions": suggestions})
	}
}

// PlaceDetailsHandler handles GET /api/v1/traffic/places/:id?session=..
func PlaceDetailsHandler(client *Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		if !googleapi.SafeToken(id, 512) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "That place couldn't be found.", "code": "invalid_place"})
			return
		}
		session := c.Query("session")
		if session != "" && !googleapi.SafeToken(session, 36) {
			session = ""
		}
		ctx, cancel := context.WithTimeout(c.Request.Context(), 6*time.Second)
		defer cancel()
		place, err := client.PlaceDetails(ctx, id, session)
		if err != nil {
			log.Printf("[traffic] place details failed: %v", err)
			status, msg, code := mapError(err, "That place couldn't be found.")
			c.JSON(status, gin.H{"error": msg, "code": code})
			return
		}
		c.JSON(http.StatusOK, place)
	}
}

func mapError(err error, noResultMsg string) (int, string, string) {
	var pe *googleapi.ProviderError
	switch {
	case errors.Is(err, googleapi.ErrNotConfigured):
		return http.StatusServiceUnavailable, "SokoTraffic isn't available right now.", "not_configured"
	case errors.Is(err, googleapi.ErrNoResult):
		return http.StatusNotFound, noResultMsg, "no_result"
	case errors.Is(err, context.DeadlineExceeded):
		return http.StatusGatewayTimeout, "This is taking too long. Please try again.", "timeout"
	case errors.As(err, &pe) && pe.IsQuota():
		return http.StatusServiceUnavailable, "SokoTraffic is busy right now. Please try again later.", "quota"
	case errors.As(err, &pe) && pe.Status == http.StatusBadRequest:
		// Usually an unsupported mode/region combination (e.g. TWO_WHEELER).
		return http.StatusUnprocessableEntity, "We couldn't plan this trip. Try another travel mode or destination.", "unsupported"
	default:
		return http.StatusBadGateway, "We couldn't reach the map service. Please try again.", "provider_error"
	}
}
