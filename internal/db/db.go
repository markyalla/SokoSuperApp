package db

import (
	"fmt"
	"log"
	"os"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

type Manager struct {
	Account  *gorm.DB
	Shopper  *gorm.DB
	Delivery *gorm.DB
	Loan     *gorm.DB
	Susu     *gorm.DB
	Bank     *gorm.DB
}

func NewManager() *Manager {
	return &Manager{
		Account:  initDB("sokoaccount"),
		Shopper:  initDB("sokoshopper"),
		Delivery: initDB("sokodelivery"),
		Loan:     initDB("sokoloan"),
		Susu:     initDB("sokosusu"),
		Bank:     initDB("sokobank"),
	}
}

func initDB(dbname string) *gorm.DB {
	dsn := fmt.Sprintf("host=%s user=%s password=%s dbname=%s port=%s sslmode=disable TimeZone=UTC",
		os.Getenv("DB_HOST"),
		os.Getenv("DB_USER"),
		os.Getenv("DB_PASSWORD"),
		dbname,
		os.Getenv("DB_PORT"),
	)

	var db *gorm.DB
	var err error

	maxRetries := 10
	retryDelay := 3 * time.Second

	for i := 1; i <= maxRetries; i++ {
		db, err = gorm.Open(postgres.Open(dsn), &gorm.Config{
			PrepareStmt: true,
		})
		if err == nil {
			// Verify connection is actually alive
			sqlDB, pingErr := db.DB()
			if pingErr == nil {
				if pingErr = sqlDB.Ping(); pingErr == nil {
					log.Printf("Connected to database: %s", dbname)
					return db
				}
			}
			err = pingErr
		}

		log.Printf("Attempt %d/%d — waiting for database %s: %v", i, maxRetries, dbname, err)
		time.Sleep(retryDelay)
	}

	log.Fatalf("Failed to connect to database %s after %d attempts: %v", dbname, maxRetries, err)
	return nil
}
