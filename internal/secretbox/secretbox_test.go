package secretbox

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"strings"
	"testing"
)

func key(t *testing.T) []byte {
	t.Helper()
	k := make([]byte, 32)
	if _, err := rand.Read(k); err != nil {
		t.Fatal(err)
	}
	return k
}

func TestSealOpenRoundTrip(t *testing.T) {
	b, err := New("1", key(t), nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, msg := range [][]byte{nil, []byte("x"), bytes.Repeat([]byte("secret"), 1000)} {
		s, err := b.Seal(msg)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.HasPrefix(s, "v1:") {
			t.Fatalf("sealed value must carry the key id: %q", s)
		}
		got, err := b.Open(s)
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(got, msg) {
			t.Fatalf("round trip: got %q want %q", got, msg)
		}
	}
	a, _ := b.Seal([]byte("same"))
	c, _ := b.Seal([]byte("same"))
	if a == c {
		t.Fatal("two seals of the same plaintext must differ (random nonce)")
	}
}

func TestTamperAndWrongKey(t *testing.T) {
	b, _ := New("1", key(t), nil)
	s, _ := b.Seal([]byte("token"))
	raw := []byte(s)
	raw[len(raw)-2] ^= 1
	if _, err := b.Open(string(raw)); err == nil {
		t.Fatal("a tampered value must not open")
	}
	other, _ := New("1", key(t), nil)
	if _, err := other.Open(s); err == nil {
		t.Fatal("another key must not open it")
	}
	// Relabelling the key id is caught by the authenticated data.
	both, _ := New("2", key(t), map[string][]byte{"1": b.keys["1"]})
	if _, err := both.Open("v2" + strings.TrimPrefix(s, "v1")); err == nil {
		t.Fatal("a relabelled value must not open")
	}
	for _, bad := range []string{"", "nope", "v1", "v1:!!!", "v9:AAAA"} {
		if _, err := b.Open(bad); err == nil {
			t.Errorf("Open(%q) must fail", bad)
		}
	}
}

func TestRotation(t *testing.T) {
	oldKey, newKey := key(t), key(t)
	old, _ := New("1", oldKey, nil)
	sealed, _ := old.Seal([]byte("legacy"))

	env := map[string]string{
		"MAHAAM_SECRET_KEY":          base64.StdEncoding.EncodeToString(newKey),
		"MAHAAM_SECRET_KEY_ID":       "2",
		"MAHAAM_SECRET_KEY_PREVIOUS": "1:" + base64.StdEncoding.EncodeToString(oldKey),
	}
	rotated, err := FromEnv(func(k string) string { return env[k] })
	if err != nil {
		t.Fatal(err)
	}
	got, err := rotated.Open(sealed)
	if err != nil || string(got) != "legacy" {
		t.Fatalf("a value sealed with the previous key must open: %q %v", got, err)
	}
	fresh, _ := rotated.Seal([]byte("new"))
	if !strings.HasPrefix(fresh, "v2:") {
		t.Fatalf("new values use the current key: %q", fresh)
	}
}

func TestFromEnvLegacyNames(t *testing.T) {
	oldKey := key(t)
	old, _ := New("1", oldKey, nil)
	sealed, _ := old.Seal([]byte("legacy"))
	env := map[string]string{"MANAGY_SECRET_KEY": base64.StdEncoding.EncodeToString(oldKey)}
	b, err := FromEnv(func(k string) string { return env[k] })
	if err != nil {
		t.Fatal(err)
	}
	if got, err := b.Open(sealed); err != nil || string(got) != "legacy" {
		t.Fatalf("MANAGY_SECRET_KEY must still work as a fallback: %q %v", got, err)
	}
}

func TestFromEnvRejectsBadKeys(t *testing.T) {
	for _, v := range []string{"", "short", base64.StdEncoding.EncodeToString(make([]byte, 16))} {
		if _, err := FromEnv(func(k string) string {
			if k == "MAHAAM_SECRET_KEY" {
				return v
			}
			return ""
		}); err == nil {
			t.Errorf("key %q must be rejected", v)
		}
	}
}

func TestSignVerify(t *testing.T) {
	b, _ := New("1", key(t), nil)
	sig := b.Sign([]byte("state"))
	if !b.Verify([]byte("state"), sig) {
		t.Fatal("own signature must verify")
	}
	if b.Verify([]byte("State"), sig) || b.Verify([]byte("state"), sig+"x") {
		t.Fatal("a changed message or signature must not verify")
	}
	other, _ := New("1", key(t), nil)
	if other.Verify([]byte("state"), sig) {
		t.Fatal("another key must not verify")
	}
}

func TestInitProductionRequiresKey(t *testing.T) {
	mu.Lock()
	def, initErr = nil, nil
	mu.Unlock()
	t.Cleanup(func() { mu.Lock(); def, initErr = nil, nil; mu.Unlock() })
	t.Setenv("MAHAAM_SECRET_KEY", "")
	t.Setenv("MANAGY_SECRET_KEY", "")
	t.Setenv("APP_ENV", "production")
	if err := Init(nil); err == nil {
		t.Fatal("production without MAHAAM_SECRET_KEY must fail")
	}
	mu.Lock()
	def, initErr = nil, nil
	mu.Unlock()
	t.Setenv("APP_ENV", "development")
	if err := Init(nil); err != nil {
		t.Fatal(err)
	}
	s, err := Seal([]byte("dev"))
	if err != nil || !strings.HasPrefix(s, "vdev:") {
		t.Fatalf("dev fallback: %q %v", s, err)
	}
}
