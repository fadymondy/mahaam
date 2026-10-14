package account

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"encoding/pem"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func testAppleKeyPEM(t *testing.T) (*ecdsa.PrivateKey, string) {
	t.Helper()
	k, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	der, _ := x509.MarshalPKCS8PrivateKey(k)
	return k, string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}))
}

func TestAppleClientFromEnv(t *testing.T) {
	t.Setenv("APPLE_TEAM_ID", "")
	t.Setenv("APPLE_KEY_ID", "")
	t.Setenv("APPLE_PRIVATE_KEY", "")
	t.Setenv("APPLE_PRIVATE_KEY_FILE", "")
	if c, err := NewAppleClientFromEnv(); c != nil || err != nil {
		t.Fatalf("unconfigured: %v %v", c, err)
	}
	k, p := testAppleKeyPEM(t)
	t.Setenv("APPLE_TEAM_ID", "TEAM123")
	t.Setenv("APPLE_KEY_ID", "KEY123")
	// One line with "\n" escapes, as an env file holds it.
	t.Setenv("APPLE_PRIVATE_KEY", strings.ReplaceAll(p, "\n", `\n`))
	c, err := NewAppleClientFromEnv()
	if err != nil || c == nil {
		t.Fatalf("configured: %v %v", c, err)
	}
	secret, err := c.ClientSecret("com.fadymondy.mahaam.web")
	if err != nil {
		t.Fatal(err)
	}
	claims := jwt.MapClaims{}
	tok, err := jwt.ParseWithClaims(secret, claims, func(*jwt.Token) (any, error) { return &k.PublicKey, nil },
		jwt.WithValidMethods([]string{"ES256"}), jwt.WithIssuer("TEAM123"), jwt.WithAudience("https://appleid.apple.com"),
		jwt.WithSubject("com.fadymondy.mahaam.web"), jwt.WithExpirationRequired())
	if err != nil || tok.Header["kid"] != "KEY123" {
		t.Fatalf("client secret: %v %v", err, tok.Header)
	}
	exp, _ := claims.GetExpirationTime()
	if exp.Sub(time.Now()) > 6*30*24*time.Hour {
		t.Error("Apple refuses client secrets that live over six months")
	}

	t.Setenv("APPLE_PRIVATE_KEY", "not a key")
	if _, err := NewAppleClientFromEnv(); err == nil {
		t.Error("a malformed key should be an error")
	}
}

func TestSocialState(t *testing.T) {
	st := socialState{Provider: "apple", Next: "/en/x", Bind: sha256Hex("b"), Expires: time.Now().Add(time.Minute).Unix(), ID: "id1", Nonce: "n"}
	raw := sealState(st)
	got, err := openState(raw)
	if err != nil || *got != st {
		t.Fatalf("round trip: %v %v", got, err)
	}
	payload, sig, _ := strings.Cut(raw, ".")
	for _, bad := range []string{"", payload, payload + ".", "x" + payload + "." + sig, payload + "." + sig + "x"} {
		if _, err := openState(bad); err == nil {
			t.Errorf("accepted %q", bad)
		}
	}
}
