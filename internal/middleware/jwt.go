package middleware

import (
	"fmt"
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

// JWTAuthMiddleware verifies the Bearer token in the Authorization header.
// If valid, it populates the Gin context with "user_id" and "roles".
func JWTAuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Authorization header is required"})
			return
		}

		// Expecting format: Bearer <token>
		parts := strings.SplitN(authHeader, " ", 2)
		if !(len(parts) == 2 && parts[0] == "Bearer") {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Authorization header format must be Bearer {token}"})
			return
		}

		tokenString := parts[1]
		secret := os.Getenv("JWT_SECRET")

		token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
			// Validate the signing method is HMAC
			if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
			}
			return []byte(secret), nil
		})

		if err != nil || !token.Valid {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Invalid or expired token"})
			return
		}

		claims, ok := token.Claims.(jwt.MapClaims)
		if !ok {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Invalid token claims"})
			return
		}

		// Extract user ID (sub)
		sub, ok := claims["sub"].(string)
		if !ok {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "User ID not found in token"})
			return
		}

		if !isUserActive(sub) {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "This account is no longer active"})
			return
		}

		// Extract roles. In jwt-go MapClaims, slices are usually parsed as []interface{}.
		rolesRaw, ok := claims["roles"].([]interface{})
		if !ok {
			rolesRaw = []interface{}{}
		}

		roles := make([]string, len(rolesRaw))
		for i, r := range rolesRaw {
			roles[i] = fmt.Sprint(r)
		}

		// Populate context for subsequent handlers/middlewares
		// These keys match what AuthorizeRoles expects.
		c.Set("user_id", sub)
		c.Set("roles", roles)

		c.Next()
	}
}

// OptionalJWTAuthMiddleware behaves like JWTAuthMiddleware but never aborts
// the request — it best-effort populates "user_id"/"roles" when a valid
// Bearer token is present, and simply proceeds unauthenticated otherwise.
// Used on public endpoints that personalize results for logged-in users
// (e.g. country-based sorting) without requiring login to view them at all.
func OptionalJWTAuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		parts := strings.SplitN(authHeader, " ", 2)
		if !(len(parts) == 2 && parts[0] == "Bearer") {
			c.Next()
			return
		}

		secret := os.Getenv("JWT_SECRET")
		token, err := jwt.Parse(parts[1], func(token *jwt.Token) (interface{}, error) {
			if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
			}
			return []byte(secret), nil
		})
		if err != nil || !token.Valid {
			c.Next()
			return
		}

		claims, ok := token.Claims.(jwt.MapClaims)
		if !ok {
			c.Next()
			return
		}

		sub, ok := claims["sub"].(string)
		if !ok || !isUserActive(sub) {
			c.Next()
			return
		}
		c.Set("user_id", sub)
		rolesRaw, _ := claims["roles"].([]interface{})
		roles := make([]string, len(rolesRaw))
		for i, r := range rolesRaw {
			roles[i] = fmt.Sprint(r)
		}
		c.Set("roles", roles)

		c.Next()
	}
}
