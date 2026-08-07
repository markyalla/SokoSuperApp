package middleware

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
)

// RateLimit throttles requests per client IP using a fixed-window counter in
// Redis, keyed by keyPrefix. It's a coarse defense-in-depth layer against
// scripted brute force — separate from the per-account lockout enforced in
// the login handler itself, which is what actually stops targeted attacks
// on one account.
func RateLimit(client *redis.Client, keyPrefix string, limit int, window time.Duration) gin.HandlerFunc {
	return func(c *gin.Context) {
		key := fmt.Sprintf("ratelimit:%s:%s", keyPrefix, c.ClientIP())

		ctx := context.Background()
		count, err := client.Incr(ctx, key).Result()
		if err != nil {
			// Redis unavailable — fail open rather than blocking logins entirely.
			c.Next()
			return
		}
		if count == 1 {
			client.Expire(ctx, key, window)
		}

		if count > int64(limit) {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"error": "Too many requests. Please try again in a minute.",
			})
			return
		}

		c.Next()
	}
}
