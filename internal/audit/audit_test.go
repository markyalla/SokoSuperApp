package audit

import "testing"

func TestMarshalOrNil(t *testing.T) {
	t.Run("nil input returns a nil pointer (maps to SQL NULL, not an empty string)", func(t *testing.T) {
		if got := marshalOrNil(nil); got != nil {
			t.Errorf("marshalOrNil(nil) = %v, want nil", got)
		}
	})

	cases := []struct {
		name string
		in   any
		want string
	}{
		{"map marshals to JSON", map[string]any{"reference": "SK-SHOP-123"}, `{"reference":"SK-SHOP-123"}`},
		{"string marshals as a JSON string", "hello", `"hello"`},
		{"int marshals as a JSON number", 42, `42`},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := marshalOrNil(tc.in)
			if got == nil {
				t.Fatalf("marshalOrNil(%#v) = nil, want %q", tc.in, tc.want)
			}
			if *got != tc.want {
				t.Errorf("marshalOrNil(%#v) = %q, want %q", tc.in, *got, tc.want)
			}
		})
	}
}
