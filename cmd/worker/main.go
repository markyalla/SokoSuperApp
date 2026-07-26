package main

import (
	"fmt"
	"log"
	"os"
	"sokoapp/internal/db"
	"sokoapp/internal/worker"

	"github.com/hibiken/asynq"
	"github.com/joho/godotenv"
)

func main() {
	if err := godotenv.Load(); err != nil {
		log.Println("Warning: .env file not found")
	}

	dbs := db.NewManager()

	redisAddr := fmt.Sprintf("%s:%s", os.Getenv("REDIS_HOST"), os.Getenv("REDIS_PORT"))
	redisOpt := asynq.RedisClientOpt{Addr: redisAddr, Password: os.Getenv("REDIS_PASSWORD")}
	processor := worker.NewRedisTaskProcessor(redisOpt, dbs)

	log.Println("Starting Asynq worker...")
	if err := processor.Start(); err != nil {
		log.Fatalf("Worker failed: %v", err)
	}
}
