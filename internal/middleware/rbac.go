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

// HasAnyRole reports whether the authenticated caller holds any of the given roles.
func HasAnyRole(c *gin.Context, allowed ...models.RoleName) bool {
	raw, _ := c.Get("roles")
	roles, _ := raw.([]string)
	for _, r := range roles {
		for _, a := range allowed {
			if r == string(a) {
				return true
			}
		}
	}
	return false
}

// IsStaff reports whether the caller holds superadmin or any module-admin role.
func IsStaff(c *gin.Context) bool {
	return HasAnyRole(c, models.RoleSuperAdmin, models.RoleShopperAdmin, models.RoleDeliveryAdmin,
		models.RoleLoanAdmin, models.RoleSusuAdmin)
}
