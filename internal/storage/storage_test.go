package storage

import (
	"bytes"
	"errors"
	"testing"
)

func TestDetectImageRejectsNonImages(t *testing.T) {
	cases := map[string][]byte{
		"html page":        []byte("<!DOCTYPE html><html><script>alert(1)</script></html>"),
		"svg with script":  []byte(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`),
		"plain text":       []byte("just some text pretending to be a .png"),
		"empty file":       {},
		"windows exe (MZ)": append([]byte("MZ"), make([]byte, 64)...),
	}
	for name, data := range cases {
		if _, _, err := DetectImage(bytes.NewReader(data)); !errors.Is(err, ErrUnsupportedFileType) {
			t.Errorf("%s: expected ErrUnsupportedFileType, got %v", name, err)
		}
	}
}

func TestDetectImageAcceptsRealImages(t *testing.T) {
	cases := map[string]struct {
		data []byte
		ext  string
	}{
		"png":  {append([]byte("\x89PNG\r\n\x1a\n"), make([]byte, 32)...), ".png"},
		"jpeg": {append([]byte{0xFF, 0xD8, 0xFF, 0xE0}, make([]byte, 32)...), ".jpg"},
		"webp": {append([]byte("RIFF\x00\x00\x00\x00WEBPVP8 "), make([]byte, 32)...), ".webp"},
	}
	for name, tc := range cases {
		r := bytes.NewReader(tc.data)
		_, ext, err := DetectImage(r)
		if err != nil || ext != tc.ext {
			t.Errorf("%s: got ext=%q err=%v, want %q", name, ext, err, tc.ext)
		}
		if pos, _ := r.Seek(0, 1); pos != 0 {
			t.Errorf("%s: reader not rewound (pos %d)", name, pos)
		}
	}
}

func TestUploadBucketAllowed(t *testing.T) {
	cases := []struct {
		bucket  string
		isStaff bool
		want    bool
	}{
		{"kyc", false, true},
		{"avatars", false, true},
		{"products", false, false},    // staff-only bucket
		{"store-logos", false, false}, // staff-only bucket
		{"products", true, true},
		{"attacker-bucket", false, false},
		{"attacker-bucket", true, false},
		{"", false, false},
	}
	for _, tc := range cases {
		if got := UploadBucketAllowed(tc.bucket, tc.isStaff); got != tc.want {
			t.Errorf("UploadBucketAllowed(%q, staff=%v) = %v, want %v", tc.bucket, tc.isStaff, got, tc.want)
		}
	}
}

func TestValidMediaPath(t *testing.T) {
	cases := []struct {
		path    string
		buckets []string
		want    bool
	}{
		{"/kyc/0f8a3c1e-1111-2222-3333-444455556666.jpg", []string{"kyc"}, true},
		{"kyc/abc.png", []string{"kyc"}, true},
		{"/avatars/abc.jpg", []string{"kyc"}, false},
		{`x" onerror="alert(1)`, []string{"kyc"}, false},
		{"javascript:alert(1)", []string{"kyc"}, false},
		{"https://evil.example/kyc/a.jpg", []string{"kyc"}, false},
		{"/kyc/../secret.jpg", []string{"kyc"}, false},
		{"/kyc/a/b.jpg", []string{"kyc"}, false},
		{"/kyc/a.jpg?x=1", []string{"kyc"}, false},
		{"/profile-images/a.webp", []string{"avatars", "profile-images"}, true},
	}
	for _, tc := range cases {
		if got := ValidMediaPath(tc.path, tc.buckets...); got != tc.want {
			t.Errorf("ValidMediaPath(%q) = %v, want %v", tc.path, got, tc.want)
		}
	}
}

func TestPrivateBuckets(t *testing.T) {
	if !PrivateBuckets["kyc"] {
		t.Fatal("kyc bucket must be private")
	}
	if PrivateBuckets["avatars"] {
		t.Fatal("avatars bucket should be public")
	}
}
