package middleware

import (
	"sync"
	"time"

	"gorm.io/gorm"
)

// Access tokens are valid for 72h and carry no server-side state, so without
// this check a user who deletes their account (or is deactivated by an admin)
// would keep full API access until the token expired. Each request re-checks
// the users row, cached briefly so it isn't a DB hit per call.

const activeUserCacheTTL = time.Minute

var (
	accountDB       *gorm.DB
	activeUserCache sync.Map // user_id -> activeUserEntry
)

type activeUserEntry struct {
	active    bool
	checkedAt time.Time
}

// SetAccountDB wires the sokoaccount DB into the auth middleware. Call once at startup.
func SetAccountDB(db *gorm.DB) {
	accountDB = db
}

// ForgetUser drops a cached status so a deactivation/deletion takes effect immediately.
func ForgetUser(userID string) {
	activeUserCache.Delete(userID)
}

func isUserActive(userID string) bool {
	if v, ok := activeUserCache.Load(userID); ok {
		e := v.(activeUserEntry)
		if time.Since(e.checkedAt) < activeUserCacheTTL {
			return e.active
		}
	}
	if accountDB == nil {
		return true
	}

	var row struct {
		IsActive  bool
		IsDeleted bool
	}
	err := accountDB.Table("users").Select("is_active, is_deleted").
		Where("id = ?", userID).Take(&row).Error
	if err == gorm.ErrRecordNotFound {
		activeUserCache.Store(userID, activeUserEntry{active: false, checkedAt: time.Now()})
		return false
	}
	if err != nil {
		// DB hiccup — fail open rather than logging every user out; the token
		// signature has already been verified at this point.
		return true
	}

	active := row.IsActive && !row.IsDeleted
	activeUserCache.Store(userID, activeUserEntry{active: active, checkedAt: time.Now()})
	return active
}
