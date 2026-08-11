package middleware

import (
	"fmt"
	"net/http"
	"strings"

	"sokoapp/internal/audit"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// adminRoles mirrors the *_admin / superadmin role names in
// internal/models.RoleName — kept as plain strings here since roles arrive
// in the Gin context as []string (see middleware.JWTAuthMiddleware), not the
// typed RoleName.
var adminRoles = map[string]bool{
	"sokoshopper_admin":  true,
	"sokodelivery_admin": true,
	"sokoloan_admin":     true,
	"sokosusu_admin":     true,
	"sokobank_admin":     true,
	"superadmin":         true,
}

func isMutating(method string) bool {
	switch method {
	case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
		return true
	default:
		return false
	}
}

// AuditRequests is a global, best-effort activity log for two overlapping
// concerns that would otherwise be invisible outside container logs no one
// watches:
//
//  1. Every mutating request made by a staff/admin-role user — a generic
//     "who did what" trail that covers every current and future admin route
//     without needing to instrument each handler individually.
//  2. Every request (staff or not) that comes back as a server error or
//     panics — a generic API-error feed.
//
// A single mutating admin request that also happens to fail is logged once,
// as an admin_action at error/critical severity, not twice.
//
// Must be registered with r.Use() AFTER gin.Default()'s built-in Recovery
// middleware (i.e. simply after the gin.Default() call, which is what
// registers Recovery first). On a panic this logs it and then re-panics so
// Gin's own Recovery still produces its usual response + stack trace log —
// this middleware only observes, it doesn't take over error handling.
//
// db must be the sokoaccount connection (where audit_logs lives).
func AuditRequests(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		defer func() {
			userID, actorLabel := actorFromContext(c)
			isAdmin := false
			if rolesRaw, ok := c.Get("roles"); ok {
				if roles, ok := rolesRaw.([]string); ok {
					for _, r := range roles {
						if adminRoles[r] {
							isAdmin = true
							break
						}
					}
				}
			}
			action := fmt.Sprintf("%s %s", c.Request.Method, c.FullPath())

			if r := recover(); r != nil {
				audit.Log(db, audit.Entry{
					Category:    audit.CategoryAPIError,
					Severity:    audit.SeverityCritical,
					UserID:      userID,
					ActorLabel:  actorLabel,
					Action:      action,
					Message:     fmt.Sprintf("panic recovered: %v", r),
					RequestPath: c.Request.URL.Path,
					IPAddress:   c.ClientIP(),
					UserAgent:   c.Request.UserAgent(),
				})
				panic(r) // let Gin's own Recovery middleware still handle the response
			}

			status := c.Writer.Status()
			shouldLogAdminAction := isAdmin && isMutating(c.Request.Method)
			shouldLogAPIError := status >= 500
			if !shouldLogAdminAction && !shouldLogAPIError {
				return
			}

			severity := audit.SeverityInfo
			switch {
			case status >= 500:
				severity = audit.SeverityError
			case status >= 400:
				severity = audit.SeverityWarning
			}

			category := audit.CategoryAPIError
			if shouldLogAdminAction {
				category = audit.CategoryAdminAction
			}

			message := ""
			if len(c.Errors) > 0 {
				message = strings.TrimSpace(c.Errors.String())
			}

			audit.Log(db, audit.Entry{
				Category:    category,
				Severity:    severity,
				UserID:      userID,
				ActorLabel:  actorLabel,
				Action:      action,
				Message:     message,
				RequestPath: c.Request.URL.Path,
				StatusCode:  status,
				IPAddress:   c.ClientIP(),
				UserAgent:   c.Request.UserAgent(),
			})
		}()

		c.Next()
	}
}

func actorFromContext(c *gin.Context) (*uuid.UUID, string) {
	sub, ok := c.Get("user_id")
	if !ok {
		return nil, "system"
	}
	subStr, ok := sub.(string)
	if !ok {
		return nil, "system"
	}
	parsed, err := uuid.Parse(subStr)
	if err != nil {
		return nil, "system"
	}
	return &parsed, subStr
}
