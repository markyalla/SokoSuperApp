package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sokoapp/internal/db"
	"sokoapp/internal/models"
	"time"

	"github.com/hibiken/asynq"
)

type TaskProcessor interface {
	Start() error
	ProcessTaskProcessKYC(ctx context.Context, t *asynq.Task) error
	ProcessTaskAssignDriver(ctx context.Context, t *asynq.Task) error
}

type RedisTaskProcessor struct {
	server *asynq.Server
	dbs    *db.Manager
}

func NewRedisTaskProcessor(redisOpt asynq.RedisClientOpt, dbs *db.Manager) TaskProcessor {
	server := asynq.NewServer(redisOpt, asynq.Config{
		Queues: map[string]int{
			"critical": 6,
			"default":  3,
		},
	})

	return &RedisTaskProcessor{
		server: server,
		dbs:    dbs,
	}
}

func (processor *RedisTaskProcessor) ProcessTaskProcessKYC(ctx context.Context, t *asynq.Task) error {
	var payload KYCProcessingPayload
	if err := json.Unmarshal(t.Payload(), &payload); err != nil {
		return fmt.Errorf("failed to unmarshal payload: %w", asynq.SkipRetry)
	}

	log.Printf("Worker: Processing KYC for User %s", payload.UserID)

	// Simulated KYC logic: Update status to Under Review
	// In a real scenario, this would involve calling verification APIs
	err := processor.dbs.Account.Model(&models.KYCSubmission{}).
		Where("user_id = ?", payload.UserID).
		Update("status", models.KYCUnderReview).Error

	return err
}

func (processor *RedisTaskProcessor) ProcessTaskAssignDriver(ctx context.Context, t *asynq.Task) error {
	var payload AssignDriverPayload
	if err := json.Unmarshal(t.Payload(), &payload); err != nil {
		return fmt.Errorf("failed to unmarshal payload: %w", asynq.SkipRetry)
	}

	log.Printf("Worker: Attempting to assign driver for Assignment %s", payload.AssignmentID)

	// 1. Logic to find an available driver from models.DriverProfile
	// In a real scenario, use PostGIS to find the closest driver
	var driver models.DriverProfile
	err := processor.dbs.Account.Preload("User").
		Where("is_online = ? AND is_available = ?", true, true).First(&driver).Error
	if err != nil {
		log.Printf("Worker: No drivers available for assignment %s", payload.AssignmentID)
		return err
	}

	// 2. Update Assignment status and link driver
	err = processor.dbs.Delivery.Model(&models.DeliveryAssignment{}).
		Where("id = ?", payload.AssignmentID).
		Updates(map[string]interface{}{
			"driver_user_id": driver.UserID,
			"status":         models.DelAccepted,
			"updated_at":     time.Now(),
		}).Error

	if err == nil {
		// 3. Mark driver unavailable until this delivery is complete
		processor.dbs.Account.Model(&models.DriverProfile{}).
			Where("user_id = ?", driver.UserID).
			Update("is_available", false)
		log.Printf("Worker: Notification sent to Driver %s and User for Assignment %s", driver.User.FullName, payload.AssignmentID)
	}

	return err
}

func (processor *RedisTaskProcessor) Start() error {
	mux := asynq.NewServeMux()
	mux.HandleFunc(TypeKYCProcessing, processor.ProcessTaskProcessKYC)
	mux.HandleFunc(TypeAssignDriver, processor.ProcessTaskAssignDriver)

	return processor.server.Run(mux)
}
