package circlexo

import "testing"

func TestMapRole(t *testing.T) {
	for in, want := range map[string]string{"owner": "owner", "ADMIN": "admin", "member": "member", "billing": "member", "": "member"} {
		if got := mapRole(in); got != want {
			t.Errorf("mapRole(%q) = %q, want %q", in, got, want)
		}
	}
}
