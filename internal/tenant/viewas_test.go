package tenant

import "testing"

func TestCanViewAs(t *testing.T) {
	cases := []struct {
		role, target string
		want         bool
	}{
		{"owner", "client", true},
		{"owner", "member", true},
		{"owner", "admin", true},
		{"admin", "admin", true},
		{"admin", "manager", true},
		{"admin", "owner", false},
		{"manager", "member", false},
		{"member", "client", false},
		{"client", "client", false},
		{"owner", "bogus", false},
		{"", "client", false},
	}
	for _, c := range cases {
		if got := CanViewAs(c.role, c.target); got != c.want {
			t.Errorf("CanViewAs(%q, %q) = %v, want %v", c.role, c.target, got, c.want)
		}
	}
}
