package server

import (
	"net/http/httptest"
	"testing"
)

func TestStripUntrustedForwarding(t *testing.T) {
	t.Setenv("TRUSTED_PROXIES", "10.0.0.0/8")
	trusted := trustedProxies()

	r := httptest.NewRequest("POST", "/api/auth/login", nil)
	r.RemoteAddr = "203.0.113.9:5000"
	r.Header.Set("X-Forwarded-For", "6.6.6.6")
	stripUntrustedForwarding(trusted, r)
	if r.Header.Get("X-Forwarded-For") != "" {
		t.Error("an untrusted client must not set X-Forwarded-For")
	}

	r = httptest.NewRequest("POST", "/api/auth/login", nil)
	r.RemoteAddr = "10.1.2.3:5000"
	r.Header.Set("X-Forwarded-For", "198.51.100.7")
	stripUntrustedForwarding(trusted, r)
	if r.Header.Get("X-Forwarded-For") != "198.51.100.7" {
		t.Error("a trusted proxy's X-Forwarded-For must pass")
	}
}
