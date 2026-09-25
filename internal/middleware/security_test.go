package middleware

import (
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"sokoapp/internal/models"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

func ctxWithRoles(roles ...string) *gin.Context {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Set("roles", roles)
	return c
}

func TestHasAnyRoleAndIsStaff(t *testing.T) {
	if !HasAnyRole(ctxWithRoles("user", "driver"), models.RoleDriver) {
		t.Error("driver should have driver role")
	}
	if HasAnyRole(ctxWithRoles("user"), models.RoleSuperAdmin) {
		t.Error("plain user must not pass superadmin check")
	}
	if IsStaff(ctxWithRoles("user", "driver", "artisan")) {
		t.Error("user/driver/artisan are not staff")
	}
	for _, r := range []string{"superadmin", "sokoshopper_admin", "sokodelivery_admin"} {
		if !IsStaff(ctxWithRoles(r)) {
			t.Errorf("%s should be staff", r)
		}
	}
	c, _ := gin.CreateTestContext(httptest.NewRecorder()) // no roles at all
	if IsStaff(c) {
		t.Error("request without roles must not be staff")
	}
}

func signedToken(t *testing.T, secret, sub string) string {
	t.Helper()
	tok, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": sub, "roles": []string{"user"}, "exp": time.Now().Add(time.Hour).Unix(),
	}).SignedString([]byte(secret))
	if err != nil {
		t.Fatal(err)
	}
	return tok
}

func runJWT(t *testing.T, token string) int {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/x", JWTAuthMiddleware(), func(c *gin.Context) { c.Status(http.StatusOK) })
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	r.ServeHTTP(w, req)
	return w.Code
}

func TestJWTRejectsDeactivatedUser(t *testing.T) {
	os.Setenv("JWT_SECRET", "test-secret-test-secret-test-secret")
	const active, deleted = "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"
	activeUserCache.Store(active, activeUserEntry{active: true, checkedAt: time.Now()})
	activeUserCache.Store(deleted, activeUserEntry{active: false, checkedAt: time.Now()})
	defer ForgetUser(active)
	defer ForgetUser(deleted)

	if code := runJWT(t, signedToken(t, os.Getenv("JWT_SECRET"), active)); code != http.StatusOK {
		t.Errorf("active user: got %d, want 200", code)
	}
	if code := runJWT(t, signedToken(t, os.Getenv("JWT_SECRET"), deleted)); code != http.StatusUnauthorized {
		t.Errorf("deleted user with a still-valid token: got %d, want 401", code)
	}
}

func TestJWTRejectsForgedToken(t *testing.T) {
	os.Setenv("JWT_SECRET", "test-secret-test-secret-test-secret")
	if code := runJWT(t, signedToken(t, "attacker-guess", "33333333-3333-3333-3333-333333333333")); code != http.StatusUnauthorized {
		t.Errorf("token signed with wrong key: got %d, want 401", code)
	}
	if code := runJWT(t, signedToken(t, "", "33333333-3333-3333-3333-333333333333")); code != http.StatusUnauthorized {
		t.Errorf("token signed with empty key: got %d, want 401", code)
	}
}
