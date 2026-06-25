package middleware

import (
	"net/http"
	"sokoapp/internal/models"

	"github.com/gin-gonic/gin"
)

func AuthorizeRoles(allowedRoles ...models.RoleName) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Assume user claims are already in context from JWT middleware
		userRoles, exists := c.Get("roles")
		if !exists {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "No roles assigned"})
			return
		}

		roles := userRoles.([]string)
		authorized := false
		for _, r := range roles {
			for _, allowed := range allowedRoles {
				if r == string(allowed) {
					authorized = true
					break
				}
			}
		}

		if !authorized {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Insufficient permissions"})
			return
		}

		c.Next()
	}
}
