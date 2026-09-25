package utils

import "testing"

func TestRandomDigits(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 200; i++ {
		code, err := RandomDigits(4)
		if err != nil {
			t.Fatal(err)
		}
		if len(code) != 4 {
			t.Fatalf("got %q, want 4 digits", code)
		}
		for _, ch := range code {
			if ch < '0' || ch > '9' {
				t.Fatalf("non-digit in %q", code)
			}
		}
		seen[code] = true
	}
	// Time-based codes generated back-to-back collide heavily; random ones don't.
	if len(seen) < 150 {
		t.Errorf("only %d distinct codes out of 200 — generator looks predictable", len(seen))
	}
}
