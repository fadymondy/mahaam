package account

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"math/big"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// fakeApple is a JWKS endpoint serving whichever keys the test publishes.
type fakeApple struct {
	mu    sync.Mutex
	keys  map[string]*rsa.PrivateKey
	hits  int
	srv   *httptest.Server
	clock time.Time
}

func newFakeApple(t *testing.T) *fakeApple {
	t.Helper()
	f := &fakeApple{keys: map[string]*rsa.PrivateKey{}, clock: time.Now()}
	f.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		f.hits++
		set := []map[string]string{}
		for kid, k := range f.keys {
			set = append(set, map[string]string{"kty": "RSA", "kid": kid, "use": "sig", "alg": "RS256",
				"n": base64.RawURLEncoding.EncodeToString(k.N.Bytes()),
				"e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(k.E)).Bytes())})
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"keys": set})
	}))
	t.Cleanup(f.srv.Close)
	return f
}

func (f *fakeApple) publish(t *testing.T, kid string) *rsa.PrivateKey {
	t.Helper()
	k, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	f.mu.Lock()
	f.keys[kid] = k
	f.mu.Unlock()
	return k
}

func signApple(t *testing.T, k *rsa.PrivateKey, kid string, claims jwt.MapClaims) string {
	t.Helper()
	tok := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	tok.Header["kid"] = kid
	s, err := tok.SignedString(k)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func appleClaims(now time.Time, nonce string) jwt.MapClaims {
	return jwt.MapClaims{
		"iss": appleIssuer, "aud": "com.fadymondy.mahaam", "sub": "001234.abcdef.1234",
		"iat": now.Unix(), "exp": now.Add(10 * time.Minute).Unix(),
		"nonce": sha256Hex(nonce), "email": "x@privaterelay.appleid.com", "email_verified": "true", "is_private_email": true,
	}
}

func TestAppleVerify(t *testing.T) {
	f := newFakeApple(t)
	k1 := f.publish(t, "k1")
	const raw = "0123456789abcdef-raw-nonce"
	now := time.Now()
	v := &AppleVerifier{KeysURL: f.srv.URL, ClientIDs: []string{"com.fadymondy.mahaam", "com.fadymondy.mahaam.web"},
		HTTP: f.srv.Client(), TTL: time.Hour}

	other, _ := rsa.GenerateKey(rand.Reader, 2048)
	with := func(mut func(jwt.MapClaims)) jwt.MapClaims {
		c := appleClaims(now, raw)
		mut(c)
		return c
	}
	cases := []struct {
		name  string
		token string
		nonce string
		want  error // nil = accepted
	}{
		{"valid", signApple(t, k1, "k1", appleClaims(now, raw)), raw, nil},
		{"second allowed client id", signApple(t, k1, "k1", with(func(c jwt.MapClaims) { c["aud"] = "com.fadymondy.mahaam.web" })), raw, nil},
		{"audience list", signApple(t, k1, "k1", with(func(c jwt.MapClaims) { c["aud"] = []string{"x", "com.fadymondy.mahaam"} })), raw, nil},
		{"wrong aud", signApple(t, k1, "k1", with(func(c jwt.MapClaims) { c["aud"] = "com.evil.app" })), raw, ErrAppleToken},
		{"wrong iss", signApple(t, k1, "k1", with(func(c jwt.MapClaims) { c["iss"] = "https://evil.example" })), raw, ErrAppleToken},
		{"expired", signApple(t, k1, "k1", with(func(c jwt.MapClaims) {
			c["iat"], c["exp"] = now.Add(-2*time.Hour).Unix(), now.Add(-time.Hour).Unix()
		})), raw, ErrAppleToken},
		{"no exp", signApple(t, k1, "k1", with(func(c jwt.MapClaims) { delete(c, "exp") })), raw, ErrAppleToken},
		{"issued in the future", signApple(t, k1, "k1", with(func(c jwt.MapClaims) { c["iat"] = now.Add(time.Hour).Unix() })), raw, ErrAppleToken},
		{"bad nonce", signApple(t, k1, "k1", appleClaims(now, raw)), raw + "x", ErrAppleNonce},
		{"raw nonce in the token instead of its hash", signApple(t, k1, "k1", with(func(c jwt.MapClaims) { c["nonce"] = raw })), raw, ErrAppleNonce},
		{"no nonce claim", signApple(t, k1, "k1", with(func(c jwt.MapClaims) { delete(c, "nonce") })), raw, ErrAppleNonce},
		{"no subject", signApple(t, k1, "k1", with(func(c jwt.MapClaims) { delete(c, "sub") })), raw, ErrAppleToken},
		{"signed by someone else", signApple(t, other, "k1", appleClaims(now, raw)), raw, ErrAppleToken},
		{"HS256 with a guessable secret", func() string {
			tok := jwt.NewWithClaims(jwt.SigningMethodHS256, appleClaims(now, raw))
			tok.Header["kid"] = "k1"
			s, _ := tok.SignedString([]byte("secret"))
			return s
		}(), raw, ErrAppleToken},
		{"alg none", func() string {
			tok := jwt.NewWithClaims(jwt.SigningMethodNone, appleClaims(now, raw))
			tok.Header["kid"] = "k1"
			s, _ := tok.SignedString(jwt.UnsafeAllowNoneSignatureType)
			return s
		}(), raw, ErrAppleToken},
		{"garbage", "not.a.jwt", raw, ErrAppleToken},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c, err := v.Verify(context.Background(), tc.token, tc.nonce)
			if tc.want == nil {
				if err != nil {
					t.Fatalf("refused: %v", err)
				}
				if c.Subject != "001234.abcdef.1234" || c.Email != "x@privaterelay.appleid.com" || !c.EmailVerified || !c.PrivateEmail {
					t.Fatalf("claims: %+v", c)
				}
				return
			}
			if !errors.Is(err, tc.want) {
				t.Fatalf("got %v, want %v", err, tc.want)
			}
		})
	}
	if f.hits != 1 {
		t.Errorf("the key set was fetched %d times, want once (cached)", f.hits)
	}
}

func TestAppleVerifyKeyRotation(t *testing.T) {
	f := newFakeApple(t)
	k1 := f.publish(t, "k1")
	const raw = "0123456789abcdef-raw-nonce"
	now := time.Now()
	clock := now
	v := &AppleVerifier{KeysURL: f.srv.URL, ClientIDs: []string{"com.fadymondy.mahaam"}, HTTP: f.srv.Client(),
		TTL: time.Hour, MinRefetch: 30 * time.Second, Now: func() time.Time { return clock }}
	ctx := context.Background()

	if _, err := v.Verify(ctx, signApple(t, k1, "k1", appleClaims(now, raw)), raw); err != nil {
		t.Fatal(err)
	}
	// Apple rotates: a token names a key we have not seen.
	k2 := f.publish(t, "k2")
	t2 := signApple(t, k2, "k2", appleClaims(now, raw))
	// Within MinRefetch of the last fetch: refused without asking Apple again.
	if _, err := v.Verify(ctx, t2, raw); !errors.Is(err, ErrAppleToken) || f.hits != 1 {
		t.Fatalf("unknown kid inside the refetch window: err %v, fetches %d", err, f.hits)
	}
	// After it: one refetch, and the new key works.
	clock = clock.Add(31 * time.Second)
	if _, err := v.Verify(ctx, t2, raw); err != nil || f.hits != 2 {
		t.Fatalf("unknown kid after the window: err %v, fetches %d", err, f.hits)
	}
	// A kid Apple never published: one refetch at most, then refused.
	clock = clock.Add(31 * time.Second)
	bogus, _ := rsa.GenerateKey(rand.Reader, 2048)
	if _, err := v.Verify(ctx, signApple(t, bogus, "nope", appleClaims(now, raw)), raw); !errors.Is(err, ErrAppleToken) {
		t.Fatalf("bogus kid: %v", err)
	}
	if _, err := v.Verify(ctx, signApple(t, bogus, "nope", appleClaims(now, raw)), raw); !errors.Is(err, ErrAppleToken) || f.hits != 3 {
		t.Fatalf("bogus kid again: err %v, fetches %d (want 3: no second refetch)", err, f.hits)
	}
	// Apple down with a stale cache: the known key still verifies.
	clock = clock.Add(2 * time.Hour)
	f.srv.Close()
	if _, err := v.Verify(ctx, signApple(t, k1, "k1", appleClaims(clock, raw)), raw); err != nil {
		t.Fatalf("stale key while Apple is unreachable: %v", err)
	}
}

func TestCleanName(t *testing.T) {
	for in, want := range map[string]string{
		"  Ada   Lovelace ": "Ada Lovelace",
		"Ada\x00\nLovelace": "Ada Lovelace",
		"":                  "",
	} {
		if got := cleanName(in); got != want {
			t.Errorf("cleanName(%q) = %q, want %q", in, got, want)
		}
	}
	long := ""
	for i := 0; i < 200; i++ {
		long += "é"
	}
	if n := len([]rune(cleanName(long))); n != 120 {
		t.Errorf("long name kept %d runes", n)
	}
}
