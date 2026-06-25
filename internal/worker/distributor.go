package worker

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/hibiken/asynq"
)

type TaskDistributor interface {
	DistributeTaskProcessKYC(
		ctx context.Context,
		payload *KYCProcessingPayload,
		opts ...asynq.Option,
	) error
	DistributeTaskAssignDriver(
		ctx context.Context,
		payload *AssignDriverPayload,
		opts ...asynq.Option,
	) error
}

type RedisTaskDistributor struct {
	client *asynq.Client
}

func NewRedisTaskDistributor(redisOpt asynq.RedisClientOpt) TaskDistributor {
	client := asynq.NewClient(redisOpt)
	return &RedisTaskDistributor{client: client}
}

func (distributor *RedisTaskDistributor) DistributeTaskProcessKYC(
	ctx context.Context,
	payload *KYCProcessingPayload,
	opts ...asynq.Option,
) error {
	jsonPayload, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal kyc payload: %w", err)
	}

	task := asynq.NewTask(TypeKYCProcessing, jsonPayload, opts...)
	_, err = distributor.client.EnqueueContext(ctx, task)
	return err
}

func (distributor *RedisTaskDistributor) DistributeTaskAssignDriver(
	ctx context.Context,
	payload *AssignDriverPayload,
	opts ...asynq.Option,
) error {
	jsonPayload, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal assign driver payload: %w", err)
	}

	task := asynq.NewTask(TypeAssignDriver, jsonPayload, opts...)
	_, err = distributor.client.EnqueueContext(ctx, task)
	return err
}
