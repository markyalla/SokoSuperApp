package sokosusu

import (
	"net/http"
	"sokoapp/internal/models"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type CreateGroupRequest struct {
	Name               string  `json:"name" binding:"required,min=3,max=150"`
	ContributionAmount float64 `json:"contribution_amount" binding:"required,gt=0"`
	CyclePeriod        string  `json:"cycle_period" binding:"required,oneof=weekly monthly"`
	MaxMembers         int     `json:"max_members" binding:"required,min=2,max=50"`
}

type ContributeRequest struct {
	CycleNumber   int    `json:"cycle_number" binding:"required,min=1"`
	TransactionID string `json:"transaction_id" binding:"omitempty,uuid"`
}

// CreateGroup creates a new susu group and adds the creator as admin member at position 1.
func CreateGroup(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req CreateGroupRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		userID := c.GetString("user_id")
		userUUID, err := uuid.Parse(userID)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid user id"})
			return
		}

		group := models.SusuGroup{
			ID:                 uuid.New(),
			Name:               req.Name,
			ContributionAmount: req.ContributionAmount,
			CyclePeriod:        req.CyclePeriod,
			MaxMembers:         req.MaxMembers,
			Status:             "forming",
		}

		err = db.Transaction(func(tx *gorm.DB) error {
			if err := tx.Create(&group).Error; err != nil {
				return err
			}
			member := models.SusuMember{
				GroupID:  group.ID,
				UserID:   userUUID,
				JoinedAt: time.Now(),
				IsAdmin:  true,
				Position: 1,
			}
			return tx.Create(&member).Error
		})

		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create group"})
			return
		}

		c.JSON(http.StatusCreated, gin.H{"group": group})
	}
}

// ListGroups returns ALL susu groups, annotated with the caller's role in each.
func ListGroups(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userUUID, err := uuid.Parse(c.GetString("user_id"))
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid user id"})
			return
		}

		var groups []models.SusuGroup
		if err := db.Order("created_at desc").Find(&groups).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch groups"})
			return
		}

		if len(groups) == 0 {
			c.JSON(http.StatusOK, gin.H{"groups": []interface{}{}})
			return
		}

		groupIDs := make([]uuid.UUID, len(groups))
		for i, g := range groups {
			groupIDs[i] = g.ID
		}

		var memberships []models.SusuMember
		db.Where("group_id IN ? AND user_id = ?", groupIDs, userUUID).Find(&memberships)

		roleMap := make(map[uuid.UUID]string)
		for _, m := range memberships {
			if m.IsAdmin {
				roleMap[m.GroupID] = "admin"
			} else {
				roleMap[m.GroupID] = "member"
			}
		}

		// Get pending join requests for the user so we can show request status on non-member groups
		var joinRequests []models.SusuJoinRequest
		db.Where("group_id IN ? AND user_id = ? AND status = ?", groupIDs, userUUID, "pending").Find(&joinRequests)
		pendingSet := make(map[uuid.UUID]bool)
		for _, r := range joinRequests {
			pendingSet[r.GroupID] = true
		}

		type GroupItem struct {
			models.SusuGroup
			MyRole  string `json:"my_role"`
			IsAdmin bool   `json:"is_admin"`
		}

		result := make([]GroupItem, len(groups))
		for i, g := range groups {
			role := roleMap[g.ID]
			if role == "" {
				if pendingSet[g.ID] {
					role = "pending"
				} else {
					role = "none"
				}
			}
			result[i] = GroupItem{
				SusuGroup: g,
				MyRole:    role,
				IsAdmin:   role == "admin",
			}
		}

		c.JSON(http.StatusOK, gin.H{"groups": result})
	}
}

// DiscoverGroups returns all forming groups annotated with the caller's request/membership status.
func DiscoverGroups(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userUUID, _ := uuid.Parse(c.GetString("user_id"))

		var groups []models.SusuGroup
		if err := db.Where("status = ?", "forming").Find(&groups).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch groups"})
			return
		}

		if len(groups) == 0 {
			c.JSON(http.StatusOK, gin.H{"groups": []interface{}{}})
			return
		}

		groupIDs := make([]uuid.UUID, len(groups))
		for i, g := range groups {
			groupIDs[i] = g.ID
		}

		var joinRequests []models.SusuJoinRequest
		db.Where("group_id IN ? AND user_id = ?", groupIDs, userUUID).Find(&joinRequests)
		requestStatusMap := make(map[uuid.UUID]string)
		for _, r := range joinRequests {
			requestStatusMap[r.GroupID] = r.Status
		}

		var memberships []models.SusuMember
		db.Where("group_id IN ? AND user_id = ?", groupIDs, userUUID).Find(&memberships)
		memberGroupIDs := make(map[uuid.UUID]bool)
		for _, m := range memberships {
			memberGroupIDs[m.GroupID] = true
		}

		type DiscoverItem struct {
			models.SusuGroup
			MyRequestStatus string `json:"my_request_status"`
		}

		items := make([]DiscoverItem, len(groups))
		for i, g := range groups {
			status := "none"
			if memberGroupIDs[g.ID] {
				status = "member"
			} else if s, ok := requestStatusMap[g.ID]; ok {
				status = s
			}
			items[i] = DiscoverItem{SusuGroup: g, MyRequestStatus: status}
		}

		c.JSON(http.StatusOK, gin.H{"groups": items})
	}
}

// GetGroup returns details of a specific group including its members.
// Only group members can access.
func GetGroup(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		groupID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid group id"})
			return
		}

		userUUID, _ := uuid.Parse(c.GetString("user_id"))

		var membership models.SusuMember
		if err := db.Where("group_id = ? AND user_id = ?", groupID, userUUID).First(&membership).Error; err != nil {
			c.JSON(http.StatusForbidden, gin.H{"error": "not a member of this group"})
			return
		}

		var group models.SusuGroup
		if err := db.First(&group, "id = ?", groupID).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "group not found"})
			return
		}

		var members []models.SusuMember
		db.Where("group_id = ?", groupID).Order("position asc").Find(&members)

		var memberCount int64
		db.Model(&models.SusuMember{}).Where("group_id = ?", groupID).Count(&memberCount)

		var pendingRequestCount int64
		db.Model(&models.SusuJoinRequest{}).Where("group_id = ? AND status = ?", groupID, "pending").Count(&pendingRequestCount)

		c.JSON(http.StatusOK, gin.H{
			"group":                 group,
			"members":               members,
			"member_count":          memberCount,
			"my_position":           membership.Position,
			"is_admin":              membership.IsAdmin,
			"pending_request_count": pendingRequestCount,
		})
	}
}

// RequestToJoin submits a join request for a forming group; the admin must approve it.
func RequestToJoin(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		groupID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid group id"})
			return
		}

		userUUID, err := uuid.Parse(c.GetString("user_id"))
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid user id"})
			return
		}

		var group models.SusuGroup
		if err := db.First(&group, "id = ?", groupID).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "group not found"})
			return
		}

		if group.Status != "forming" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "group is no longer accepting members"})
			return
		}

		var existing models.SusuMember
		if err := db.Where("group_id = ? AND user_id = ?", groupID, userUUID).First(&existing).Error; err == nil {
			c.JSON(http.StatusConflict, gin.H{"error": "already a member of this group"})
			return
		}

		var existingReq models.SusuJoinRequest
		if err := db.Where("group_id = ? AND user_id = ? AND status = ?", groupID, userUUID, "pending").First(&existingReq).Error; err == nil {
			c.JSON(http.StatusConflict, gin.H{"error": "join request already pending", "request_id": existingReq.ID})
			return
		}

		var memberCount int64
		db.Model(&models.SusuMember{}).Where("group_id = ?", groupID).Count(&memberCount)
		if group.MaxMembers > 0 && int(memberCount) >= group.MaxMembers {
			c.JSON(http.StatusBadRequest, gin.H{"error": "group is full"})
			return
		}

		request := models.SusuJoinRequest{
			ID:      uuid.New(),
			GroupID: groupID,
			UserID:  userUUID,
			Status:  "pending",
		}

		if err := db.Create(&request).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to submit join request"})
			return
		}

		c.JSON(http.StatusCreated, gin.H{"message": "join request submitted", "request_id": request.ID})
	}
}

// ListJoinRequests returns all pending join requests for a group (admin only).
func ListJoinRequests(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		groupID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid group id"})
			return
		}

		userUUID, _ := uuid.Parse(c.GetString("user_id"))

		var adminMembership models.SusuMember
		if err := db.Where("group_id = ? AND user_id = ? AND is_admin = ?", groupID, userUUID, true).First(&adminMembership).Error; err != nil {
			c.JSON(http.StatusForbidden, gin.H{"error": "only the group admin can view join requests"})
			return
		}

		var requests []models.SusuJoinRequest
		if err := db.Where("group_id = ? AND status = ?", groupID, "pending").Order("created_at asc").Find(&requests).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch join requests"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"requests": requests})
	}
}

// ApproveJoinRequest approves a pending join request, creating the member record (admin only).
func ApproveJoinRequest(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		groupID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid group id"})
			return
		}

		requestID, err := uuid.Parse(c.Param("requestId"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request id"})
			return
		}

		userUUID, _ := uuid.Parse(c.GetString("user_id"))

		var adminMembership models.SusuMember
		if err := db.Where("group_id = ? AND user_id = ? AND is_admin = ?", groupID, userUUID, true).First(&adminMembership).Error; err != nil {
			c.JSON(http.StatusForbidden, gin.H{"error": "only the group admin can approve requests"})
			return
		}

		var request models.SusuJoinRequest
		if err := db.Where("id = ? AND group_id = ? AND status = ?", requestID, groupID, "pending").First(&request).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "pending join request not found"})
			return
		}

		var group models.SusuGroup
		if err := db.First(&group, "id = ?", groupID).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "group not found"})
			return
		}

		if group.Status != "forming" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "group is no longer accepting members"})
			return
		}

		var memberCount int64
		db.Model(&models.SusuMember{}).Where("group_id = ?", groupID).Count(&memberCount)
		if group.MaxMembers > 0 && int(memberCount) >= group.MaxMembers {
			c.JSON(http.StatusBadRequest, gin.H{"error": "group is full"})
			return
		}

		newPosition := int(memberCount) + 1
		member := models.SusuMember{
			GroupID:  groupID,
			UserID:   request.UserID,
			JoinedAt: time.Now(),
			IsAdmin:  false,
			Position: newPosition,
		}

		err = db.Transaction(func(tx *gorm.DB) error {
			if err := tx.Create(&member).Error; err != nil {
				return err
			}
			if err := tx.Model(&request).Update("status", "approved").Error; err != nil {
				return err
			}
			if group.MaxMembers > 0 && newPosition >= group.MaxMembers {
				return tx.Model(&group).Update("status", "active").Error
			}
			return nil
		})

		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to approve request"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"message": "request approved", "position": newPosition})
	}
}

// RejectJoinRequest rejects a pending join request (admin only).
func RejectJoinRequest(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		groupID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid group id"})
			return
		}

		requestID, err := uuid.Parse(c.Param("requestId"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request id"})
			return
		}

		userUUID, _ := uuid.Parse(c.GetString("user_id"))

		var adminMembership models.SusuMember
		if err := db.Where("group_id = ? AND user_id = ? AND is_admin = ?", groupID, userUUID, true).First(&adminMembership).Error; err != nil {
			c.JSON(http.StatusForbidden, gin.H{"error": "only the group admin can reject requests"})
			return
		}

		var request models.SusuJoinRequest
		if err := db.Where("id = ? AND group_id = ? AND status = ?", requestID, groupID, "pending").First(&request).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "pending join request not found"})
			return
		}

		if err := db.Model(&request).Update("status", "rejected").Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to reject request"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"message": "request rejected"})
	}
}

// Contribute records a member's contribution for a given cycle.
func Contribute(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		groupID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid group id"})
			return
		}

		userUUID, err := uuid.Parse(c.GetString("user_id"))
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid user id"})
			return
		}

		var req ContributeRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		var member models.SusuMember
		if err := db.Where("group_id = ? AND user_id = ?", groupID, userUUID).First(&member).Error; err != nil {
			c.JSON(http.StatusForbidden, gin.H{"error": "not a member of this group"})
			return
		}

		var group models.SusuGroup
		if err := db.First(&group, "id = ?", groupID).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "group not found"})
			return
		}

		var dup models.SusuContribution
		if err := db.Where("group_id = ? AND user_id = ? AND cycle_number = ?", groupID, userUUID, req.CycleNumber).First(&dup).Error; err == nil {
			c.JSON(http.StatusConflict, gin.H{"error": "already contributed for this cycle"})
			return
		}

		contribution := models.SusuContribution{
			ID:          uuid.New(),
			GroupID:     groupID,
			UserID:      userUUID,
			Amount:      group.ContributionAmount,
			CycleNumber: req.CycleNumber,
		}

		if req.TransactionID != "" {
			txID, _ := uuid.Parse(req.TransactionID)
			contribution.TransactionID = txID
		}

		if err := db.Create(&contribution).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to record contribution"})
			return
		}

		c.JSON(http.StatusCreated, gin.H{"contribution": contribution})
	}
}

// ListContributions returns all contributions for a group (members only).
func ListContributions(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		groupID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid group id"})
			return
		}

		userUUID, _ := uuid.Parse(c.GetString("user_id"))

		var membership models.SusuMember
		if err := db.Where("group_id = ? AND user_id = ?", groupID, userUUID).First(&membership).Error; err != nil {
			c.JSON(http.StatusForbidden, gin.H{"error": "not a member of this group"})
			return
		}

		var contributions []models.SusuContribution
		if err := db.Where("group_id = ?", groupID).Order("cycle_number asc, created_at asc").Find(&contributions).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch contributions"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"contributions": contributions})
	}
}

// ListPayouts returns all payouts for a group (members only).
func ListPayouts(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		groupID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid group id"})
			return
		}

		userUUID, _ := uuid.Parse(c.GetString("user_id"))

		var membership models.SusuMember
		if err := db.Where("group_id = ? AND user_id = ?", groupID, userUUID).First(&membership).Error; err != nil {
			c.JSON(http.StatusForbidden, gin.H{"error": "not a member of this group"})
			return
		}

		var payouts []models.SusuPayout
		if err := db.Where("group_id = ?", groupID).Order("cycle_number asc").Find(&payouts).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch payouts"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"payouts": payouts})
	}
}
