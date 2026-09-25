package storage

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
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

// allowedImageTypes maps sniffed content types to the extension we store them
// under. The client's filename and Content-Type header are never trusted: an
// "image" that is really HTML or SVG would otherwise be served back from the
// API origin with an attacker-chosen type.
var allowedImageTypes = map[string]string{
	"image/jpeg": ".jpg",
	"image/png":  ".png",
	"image/webp": ".webp",
}

// ErrUnsupportedFileType is returned when an upload isn't a JPEG, PNG or WEBP image.
var ErrUnsupportedFileType = errors.New("only JPG, PNG and WEBP images are allowed")

// DetectImage sniffs the first bytes of r and returns the image content type
// and storage extension, or ErrUnsupportedFileType. r is rewound afterwards.
func DetectImage(r io.ReadSeeker) (contentType, ext string, err error) {
	head := make([]byte, 512)
	n, _ := io.ReadFull(r, head)
	contentType = http.DetectContentType(head[:n])
	ext, ok := allowedImageTypes[contentType]
	if !ok {
		return "", "", ErrUnsupportedFileType
	}
	if _, err := r.Seek(0, io.SeekStart); err != nil {
		return "", "", err
	}
	return contentType, ext, nil
}

// MaxUploadBytes caps a single upload.
const MaxUploadBytes = 10 << 20 // 10 MB

func (c *Client) UploadFile(file *multipart.FileHeader, bucket string) (string, error) {
	ctx := context.Background()

	if file.Size > MaxUploadBytes {
		return "", fmt.Errorf("file is too large (max %d MB)", MaxUploadBytes>>20)
	}

	src, err := file.Open()
	if err != nil {
		return "", err
	}
	defer src.Close()

	contentType, ext, err := DetectImage(src)
	if err != nil {
		return "", err
	}

	// Buckets are created on demand but only for names the caller has already
	// validated against an allowlist (see shopper.UploadMedia).
	exists, _ := c.Minio.BucketExists(ctx, bucket)
	if !exists {
		if err := c.Minio.MakeBucket(ctx, bucket, minio.MakeBucketOptions{}); err != nil {
			return "", err
		}
	}

	fileName := uuid.New().String() + ext
	_, err = c.Minio.PutObject(ctx, bucket, fileName, src, file.Size, minio.PutObjectOptions{
		ContentType: contentType,
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

// Bucket policy shared by the upload and serve endpoints.
//
// PrivateBuckets hold identity documents: they are only served to staff (see
// the /media/serve route) and never to the public URL anyone could share.
var PrivateBuckets = map[string]bool{
	"kyc": true,
}

// uploadBuckets lists every bucket clients may upload into, and whether the
// uploader must be staff (admin panel only).
var uploadBuckets = map[string]bool{ // bucket -> staff only
	"general":              false,
	"avatars":              false,
	"profile-images":       false,
	"kyc":                  false,
	"sokoindex-portfolios": false,
	"products":             true,
	"store-logos":          true,
}

// UploadBucketAllowed reports whether bucket is a known upload target and, if
// so, whether the caller's staff status permits uploading into it.
func UploadBucketAllowed(bucket string, isStaff bool) bool {
	staffOnly, known := uploadBuckets[bucket]
	return known && (!staffOnly || isStaff)
}

// RemoveByPath deletes an object given the "/bucket/file" path stored in the
// database (or a full /api/v1/media/serve/bucket/file URL). Empty paths are a no-op.
func (c *Client) RemoveByPath(path string) error {
	if path == "" {
		return nil
	}
	if i := strings.Index(path, "/media/serve/"); i >= 0 {
		path = path[i+len("/media/serve/"):]
	}
	path = strings.TrimPrefix(path, "/")
	bucket, object, ok := strings.Cut(path, "/")
	if !ok || bucket == "" || object == "" {
		return fmt.Errorf("unrecognised storage path %q", path)
	}
	return c.Minio.RemoveObject(context.Background(), bucket, object, minio.RemoveObjectOptions{})
}

// mediaPathRe matches a stored upload path: "/<bucket>/<file>" with no
// traversal, query strings, schemes or markup.
var mediaPathRe = regexp.MustCompile(`^/?([a-z0-9-]+)/([A-Za-z0-9._-]+)$`)

// ValidMediaPath reports whether path is an upload path in one of the given
// buckets. Used where clients send back a path they got from /media/upload,
// so a crafted value (e.g. HTML or a javascript: URL) can't be stored and
// later rendered in the admin panel.
func ValidMediaPath(path string, buckets ...string) bool {
	m := mediaPathRe.FindStringSubmatch(path)
	if m == nil || strings.Contains(m[2], "..") {
		return false
	}
	for _, b := range buckets {
		if m[1] == b {
			return true
		}
	}
	return false
}
