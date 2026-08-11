package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"sokoapp/internal/audit"
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
		// Previously these errors only went to stdout — invisible once a
		// container's logs roll over. Every failed attempt is logged as a
		// warning (it'll retry); once retries are exhausted it's logged
		// again as critical, since at that point the job silently never ran.
		ErrorHandler: asynq.ErrorHandlerFunc(func(ctx context.Context, task *asynq.Task, err error) {
			retried, _ := asynq.GetRetryCount(ctx)
			maxRetry, _ := asynq.GetMaxRetry(ctx)
			exhausted := retried >= maxRetry

			severity := audit.SeverityWarning
			verb := "failed, will retry"
			if exhausted {
				severity = audit.SeverityCritical
				verb = "failed, retries exhausted — job will not run again"
			}

			audit.Log(dbs.Account, audit.Entry{
				Category: audit.CategoryJobFailure,
				Severity: severity,
				Action:   fmt.Sprintf("job_failed:%s", task.Type()),
				Message:  fmt.Sprintf("Background job %s %s (attempt %d/%d): %v", task.Type(), verb, retried+1, maxRetry+1, err),
				Metadata: map[string]any{"payload": string(task.Payload())},
			})
		}),
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

// haversineKm returns the great-circle distance between two coordinates, in
// kilometers. Mirrors the same formula SokoWeb's admin "Assign Nearest
// Driver" button uses, so both paths pick the same driver.
func haversineKm(lat1, lng1, lat2, lng2 float64) float64 {
	const earthRadiusKm = 6371.0
	dLat := (lat2 - lat1) * math.Pi / 180
	dLng := (lng2 - lng1) * math.Pi / 180
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1*math.Pi/180)*math.Cos(lat2*math.Pi/180)*math.Sin(dLng/2)*math.Sin(dLng/2)
	return earthRadiusKm * 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
}

// vehicleMatches treats "motorbike" (the customer-facing vehicle choice) and
// "motorcycle" (the DriverProfile.vehicle_type enum value) as the same
// vehicle — everything else must match exactly, since a van/truck-sized item
// genuinely can't ride on a bicycle or motorbike.
func vehicleMatches(requested, candidate string) bool {
	if requested == "" {
		return true
	}
	if requested == candidate {
		return true
	}
	isMotorbike := func(v string) bool { return v == "motorbike" || v == "motorcycle" }
	return isMotorbike(requested) && isMotorbike(candidate)
}

func (processor *RedisTaskProcessor) ProcessTaskAssignDriver(ctx context.Context, t *asynq.Task) error {
	var payload AssignDriverPayload
	if err := json.Unmarshal(t.Payload(), &payload); err != nil {
		return fmt.Errorf("failed to unmarshal payload: %w", asynq.SkipRetry)
	}

	log.Printf("Worker: Attempting to assign driver for Assignment %s", payload.AssignmentID)

	var assignment models.DeliveryAssignment
	if err := processor.dbs.Delivery.Where("id = ?", payload.AssignmentID).First(&assignment).Error; err != nil {
		log.Printf("Worker: Assignment %s not found: %v", payload.AssignmentID, err)
		return err
	}

	// 1. Find the nearest online, available driver whose vehicle can
	// actually carry this delivery (a van/truck-sized item can't ride on a
	// motorbike or bicycle) — same rule SokoWeb's manual "nearest driver"
	// assignment uses.
	var candidates []models.DriverProfile
	if err := processor.dbs.Account.Preload("User").
		Where("is_online = ? AND is_available = ? AND current_lat IS NOT NULL AND current_lng IS NOT NULL", true, true).
		Find(&candidates).Error; err != nil {
		log.Printf("Worker: failed to query drivers for assignment %s: %v", payload.AssignmentID, err)
		return err
	}

	var nearest *models.DriverProfile
	nearestDistance := math.MaxFloat64
	for i := range candidates {
		if !vehicleMatches(payload.VehicleType, string(candidates[i].VehicleType)) {
			continue
		}
		d := haversineKm(assignment.PickupLat, assignment.PickupLng, candidates[i].CurrentLat, candidates[i].CurrentLng)
		if d < nearestDistance {
			nearestDistance = d
			nearest = &candidates[i]
		}
	}
	if nearest == nil {
		err := fmt.Errorf("no online %s driver available for assignment %s", payload.VehicleType, payload.AssignmentID)
		log.Printf("Worker: %v", err)
		return err
	}

	// 2. Update Assignment status and link driver — guarded by status so
	// this never clobbers an admin who manually assigned this same
	// assignment in SokoWeb while this task was queued/retrying. If the row
	// is no longer pending/broadcast, someone already handled it: treat that
	// as success (nothing to do), not a failure to retry.
	res := processor.dbs.Delivery.Model(&models.DeliveryAssignment{}).
		Where("id = ? AND status IN ?", payload.AssignmentID, []models.DeliveryStatus{models.DelPending, models.DelBroadcast}).
		Updates(map[string]interface{}{
			"driver_id":  nearest.UserID,
			"status":     models.DelAssigned,
			"updated_at": time.Now(),
		})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		log.Printf("Worker: assignment %s already handled (likely assigned manually) — skipping", payload.AssignmentID)
		return nil
	}

	// 3. Mark driver unavailable until this delivery is complete
	processor.dbs.Account.Model(&models.DriverProfile{}).
		Where("user_id = ?", nearest.UserID).
		Update("is_available", false)
	log.Printf("Worker: Assigned driver %s (%.1f km away) to assignment %s", nearest.User.FullName, nearestDistance, payload.AssignmentID)

	return nil
}

func (processor *RedisTaskProcessor) Start() error {
	mux := asynq.NewServeMux()
	mux.HandleFunc(TypeKYCProcessing, processor.ProcessTaskProcessKYC)
	mux.HandleFunc(TypeAssignDriver, processor.ProcessTaskAssignDriver)

	return processor.server.Run(mux)
}
