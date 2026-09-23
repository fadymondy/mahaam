package account

import (
	"context"
	"crypto/rsa"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

/*
Verifying a Sign in with Apple identity token (a JWT Apple signs with RS256).

The app asks Apple for an authorization with a nonce, gets back an identity token, and sends us
the token and its RAW nonce. What we check, in order:

  - the signature, against Apple's published keys (APPLE_KEYS_URL, default
    https://appleid.apple.com/auth/keys), cached and refetched when a token names a key we don't
    have (Apple rotates them);
  - alg is RS256 and nothing else (no "none", no HS256 with the public key as the secret);
  - iss is https://appleid.apple.com;
  - aud is one of our client ids (APPLE_CLIENT_IDS: the iOS bundle id, plus the Services ID if the
    web ever uses Apple too);
  - exp is present and in the future (iat not in the future), with 30 seconds of clock skew;
  - nonce == lowercase hex(SHA-256(raw nonce)). Apple copies whatever the app set as the request's
    nonce into the token verbatim; the app sets SHA-256 hex of a random value it keeps, and sends
    us the value. expo-apple-authentication does NOT hash for you: the app calls
    Crypto.digestStringAsync(SHA256, raw) (hex by default) and passes that to signInAsync.
*/

const (
	appleIssuer         = "https://appleid.apple.com"
	appleDefaultKeysURL = "https://appleid.apple.com/auth/keys"
	appleDefaultClient  = "com.fadymondy.mahaam"
)

var (
	ErrAppleToken = errors.New("the Apple sign-in could not be verified; try again")
	ErrAppleNonce = errors.New("the Apple sign-in does not match this request; try again")
)

// AppleClaims is what we use from a verified identity token.
type AppleClaims struct {
	Subject       string
	Email         string
	EmailVerified bool
	PrivateEmail  bool
	Audience      string
	ExpiresAt     time.Time
}

// AppleVerifier checks identity tokens. The zero value is not usable; see NewAppleVerifier.
type AppleVerifier struct {
	KeysURL   string
	ClientIDs []string
	HTTP      *http.Client
	// MinRefetch is the least time between two fetches of the key set triggered by an unknown
	// kid, so a stream of junk tokens can't turn us into a request amplifier against Apple.
	MinRefetch time.Duration
	// TTL is how long a fetched key set is trusted before it is fetched again.
	TTL time.Duration
	Now func() time.Time

	mu      sync.Mutex
	keys    map[string]*rsa.PublicKey
	fetched time.Time
	fetches int
}

// NewAppleVerifier reads APPLE_CLIENT_IDS (comma-separated, default com.fadymondy.mahaam) and
// APPLE_KEYS_URL (default Apple's).
func NewAppleVerifier() *AppleVerifier {
	ids := []string{}
	for _, p := range strings.Split(os.Getenv("APPLE_CLIENT_IDS"), ",") {
		if p = strings.TrimSpace(p); p != "" {
			ids = append(ids, p)
		}
	}
	if len(ids) == 0 {
		ids = []string{appleDefaultClient}
	}
	url := strings.TrimSpace(os.Getenv("APPLE_KEYS_URL"))
	if url == "" {
		url = appleDefaultKeysURL
	}
	return &AppleVerifier{KeysURL: url, ClientIDs: ids, HTTP: &http.Client{Timeout: 10 * time.Second},
		MinRefetch: 30 * time.Second, TTL: 12 * time.Hour}
}

func (v *AppleVerifier) now() time.Time {
	if v.Now != nil {
		return v.Now()
	}
	return time.Now()
}

// Verify checks token and returns its claims. rawNonce is the value whose SHA-256 hex the app put
// in the authorization request.
func (v *AppleVerifier) Verify(ctx context.Context, token, rawNonce string) (*AppleClaims, error) {
	claims := jwt.MapClaims{}
	_, err := jwt.ParseWithClaims(token, claims, func(t *jwt.Token) (any, error) {
		kid, _ := t.Header["kid"].(string)
		if kid == "" {
			return nil, errors.New("no kid")
		}
		return v.key(ctx, kid)
	},
		jwt.WithValidMethods([]string{"RS256"}),
		jwt.WithIssuer(appleIssuer),
		jwt.WithExpirationRequired(),
		jwt.WithIssuedAt(),
		jwt.WithLeeway(30*time.Second),
		jwt.WithTimeFunc(v.now),
	)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrAppleToken, err)
	}

	aud, _ := claims.GetAudience()
	match := ""
	for _, a := range aud {
		for _, id := range v.ClientIDs {
			if a == id {
				match = a
			}
		}
	}
	if match == "" {
		return nil, fmt.Errorf("%w: audience %v is not ours", ErrAppleToken, []string(aud))
	}

	got, _ := claims["nonce"].(string)
	want := sha256Hex(rawNonce)
	if rawNonce == "" || got == "" || subtle.ConstantTimeCompare([]byte(strings.ToLower(got)), []byte(want)) != 1 {
		return nil, ErrAppleNonce
	}

	sub, _ := claims["sub"].(string)
	if sub == "" || len(sub) > 255 {
		return nil, fmt.Errorf("%w: no subject", ErrAppleToken)
	}
	exp, _ := claims.GetExpirationTime()
	out := &AppleClaims{Subject: sub, Audience: match, EmailVerified: truthy(claims["email_verified"]),
		PrivateEmail: truthy(claims["is_private_email"])}
	if exp != nil {
		out.ExpiresAt = exp.Time
	}
	if e, ok := claims["email"].(string); ok {
		out.Email = strings.TrimSpace(e)
	}
	return out, nil
}

// truthy reads Apple's booleans, which arrive as true or as the string "true" depending on the
// token's vintage.
func truthy(v any) bool {
	switch b := v.(type) {
	case bool:
		return b
	case string:
		return strings.EqualFold(b, "true")
	}
	return false
}

// key returns the public key for kid: from the cache when it's fresh, else after one fetch.
func (v *AppleVerifier) key(ctx context.Context, kid string) (*rsa.PublicKey, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	now := v.now()
	k, have := v.keys[kid]
	fresh := !v.fetched.IsZero() && now.Sub(v.fetched) < v.TTL
	if have && fresh {
		return k, nil
	}
	// Unknown kid on a fresh set: Apple may have rotated, so fetch — but not more often than
	// MinRefetch, whatever kids the tokens claim.
	if !have && fresh && now.Sub(v.fetched) < v.MinRefetch {
		return nil, fmt.Errorf("unknown key %q", kid)
	}
	keys, err := v.fetch(ctx)
	if err != nil {
		if have {
			return k, nil // stale beats nothing while Apple is unreachable
		}
		return nil, err
	}
	v.keys, v.fetched = keys, now
	v.fetches++
	if k, ok := keys[kid]; ok {
		return k, nil
	}
	return nil, fmt.Errorf("unknown key %q", kid)
}

type jwk struct {
	Kty string `json:"kty"`
	Kid string `json:"kid"`
	Use string `json:"use"`
	Alg string `json:"alg"`
	N   string `json:"n"`
	E   string `json:"e"`
}

func (v *AppleVerifier) fetch(ctx context.Context) (map[string]*rsa.PublicKey, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, v.KeysURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	client := v.HTTP
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	res, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("apple keys: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("apple keys: status %d", res.StatusCode)
	}
	var set struct {
		Keys []jwk `json:"keys"`
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&set); err != nil {
		return nil, fmt.Errorf("apple keys: %w", err)
	}
	out := map[string]*rsa.PublicKey{}
	for _, k := range set.Keys {
		if k.Kty != "RSA" || k.Kid == "" || (k.Use != "" && k.Use != "sig") || (k.Alg != "" && k.Alg != "RS256") {
			continue
		}
		pub, err := rsaKey(k.N, k.E)
		if err != nil {
			continue
		}
		out[k.Kid] = pub
	}
	if len(out) == 0 {
		return nil, errors.New("apple keys: no usable key")
	}
	return out, nil
}

func rsaKey(n64, e64 string) (*rsa.PublicKey, error) {
	nb, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(n64, "="))
	if err != nil {
		return nil, err
	}
	eb, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(e64, "="))
	if err != nil || len(eb) == 0 || len(eb) > 4 {
		return nil, errors.New("bad exponent")
	}
	e := 0
	for _, b := range eb {
		e = e<<8 | int(b)
	}
	n := new(big.Int).SetBytes(nb)
	if e < 3 || n.BitLen() < 2048 {
		return nil, errors.New("weak key")
	}
	return &rsa.PublicKey{N: n, E: e}, nil
}
