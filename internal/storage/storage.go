package storage

import (
	"context"
	"fmt"
	"log"
	"mime/multipart"
	"net/url"
	"os"
	"time"

	"github.com/google/uuid"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

type Client struct {
	Minio     *minio.Client
	PublicURL string
}

func NewClient() *Client {
	endpoint := os.Getenv("STORAGE_ENDPOINT")
	accessKey := os.Getenv("STORAGE_ACCESS_KEY")
	secretKey := os.Getenv("STORAGE_SECRET_KEY")
	useSSL := os.Getenv("STORAGE_USE_SSL") == "true"

	minioClient, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: useSSL,
	})
	if err != nil {
		log.Printf("Error initializing MinIO: %v", err)
		return nil
	}

	return &Client{
		Minio:     minioClient,
		PublicURL: os.Getenv("API_BASE_URL"),
	}
}

func (c *Client) UploadFile(file *multipart.FileHeader, bucket string) (string, error) {
	ctx := context.Background()

	// Ensure bucket exists
	exists, _ := c.Minio.BucketExists(ctx, bucket)
	if !exists {
		c.Minio.MakeBucket(ctx, bucket, minio.MakeBucketOptions{})
	}

	src, err := file.Open()
	if err != nil {
		return "", err
	}
	defer src.Close()

	fileName := fmt.Sprintf("%s-%s", uuid.New().String(), file.Filename)
	_, err = c.Minio.PutObject(ctx, bucket, fileName, src, file.Size, minio.PutObjectOptions{
		ContentType: file.Header.Get("Content-Type"),
	})

	if err != nil {
		return "", err
	}

	return fmt.Sprintf("/%s/%s", bucket, fileName), nil
}

// GetPresignedURL generates a temporary URL to view a private file (like KYC docs)
func (c *Client) GetPresignedURL(bucket, fileName string, expires time.Duration) (string, error) {
	reqParams := make(url.Values)
	presignedURL, err := c.Minio.PresignedGetObject(context.Background(), bucket, fileName, expires, reqParams)
	if err != nil {
		return "", err
	}
	return presignedURL.String(), nil
}
