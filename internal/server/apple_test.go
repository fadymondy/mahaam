package server

/*
TestAppleSignIn: native Sign in with Apple (POST /api/auth/apple) against the real stack, with a
local JWKS standing in for https://appleid.apple.com/auth/keys and tokens signed by keys the test
makes. The verifier's own edge cases (iss, exp, alg, key rotation) are unit-tested in
internal/account/apple_verify_test.go; this covers accounts, links and the sign-in gates.

	TEST_DATABASE_URL=… TEST_APP_DATABASE_URL=… go test -count=1 ./internal/server/ -run AppleSignIn -v
*/

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/fadymondy/mahaam/internal/platform"
)

type appleIDP struct {
	key *rsa.PrivateKey
	kid string
	aud string
}

func newAppleIDP(t *testing.T) *appleIDP {
	t.Helper()
	k, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	idp := &appleIDP{key: k, kid: "test-key-1", aud: "com.fadymondy.mahaam.test"}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"keys": []map[string]string{{
			"kty": "RSA", "kid": idp.kid, "use": "sig", "alg": "RS256",
			"n": base64.RawURLEncoding.EncodeToString(k.N.Bytes()),
			"e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(k.E)).Bytes()),
		}}})
	}))
	t.Cleanup(srv.Close)
	t.Setenv("APPLE_KEYS_URL", srv.URL)
	t.Setenv("APPLE_CLIENT_IDS", "com.other.app, "+idp.aud)
	return idp
}

// token returns an identity token for sub and the raw nonce that goes with it.
func (p *appleIDP) token(t *testing.T, sub, email string, verified bool, mut ...func(jwt.MapClaims)) (string, string) {
	t.Helper()
	raw := "raw-nonce-" + rnd() + rnd()
	sum := sha256.Sum256([]byte(raw))
	now := time.Now()
	c := jwt.MapClaims{"iss": "https://appleid.apple.com", "aud": p.aud, "sub": sub, "iat": now.Unix(),
		"exp": now.Add(10 * time.Minute).Unix(), "nonce": hex.EncodeToString(sum[:]), "email_verified": verified}
	if email != "" {
		c["email"] = email
	}
	for _, m := range mut {
		m(c)
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodRS256, c)
	tok.Header["kid"] = p.kid
	s, err := tok.SignedString(p.key)
	if err != nil {
		t.Fatal(err)
	}
	return s, raw
}

func TestAppleSignIn(t *testing.T) {
	idp := newAppleIDP(t)
	a, srv := bootStack(t)
	apple := func(body map[string]any) (int, map[string]any) {
		t.Helper()
		// A native app: no cookies, no CSRF header, no Authorization.
		return postJSON(t, srv.URL+"/api/auth/apple", body)
	}
	bearer := func(tok string) *client {
		c := newClient(t, srv.URL)
		c.bearer = tok
		return c
	}
	userOf := func(out map[string]any) string {
		u, _ := out["user"].(map[string]any)
		id, _ := u["id"].(string)
		return id
	}
	suspend := func(id string, on bool) {
		t.Helper()
		if _, err := a.SysDB.Exec(`
			INSERT INTO platform_users (user_id, suspended_at, suspended_reason, updated_at) VALUES ($1, CASE WHEN $2 THEN now() END, 'test', now())
			ON CONFLICT (user_id) DO UPDATE SET suspended_at = CASE WHEN $2 THEN now() END, updated_at = now()`, id, on); err != nil {
			t.Fatal(err)
		}
		platform.Invalidate(id)
	}

	// 1. First sign-in: a new account, named from the first authorization, email verified, and a
	//    device token when device_name is sent.
	subA, relay := "001.apple."+rnd(), "ada-"+rnd()+"@privaterelay.appleid.com"
	tok, raw := idp.token(t, subA, relay, true)
	code, out := apple(map[string]any{"identity_token": tok, "nonce": raw, "name": map[string]string{"given": "Ada", "family": "Lovelace"},
		"device_name": "Ada's iPhone", "locale": "ar"})
	if code != 200 || out["created"] != true || out["token"] == "" {
		t.Fatalf("first sign-in: %d %v", code, out)
	}
	adaID := userOf(out)
	if u, _ := out["user"].(map[string]any); u["email"] != relay {
		t.Errorf("user email: %v", u["email"])
	}
	prof := bearer(out["token"].(string)).must("GET", "/api/me/profile", nil, 200)
	if prof["name"] != "Ada Lovelace" || prof["locale"] != "ar" {
		t.Errorf("profile of the new account: %v", prof)
	}
	pat, _ := out["access_token"].(string)
	if len(pat) < 10 || pat[:9] != "togo_pat_" {
		t.Fatalf("device token: %q", pat)
	}
	bearer(pat).must("GET", "/api/auth/me", nil, 200)
	var verified bool
	_ = a.SysDB.QueryRow(`SELECT email_verified_at IS NOT NULL FROM platform_users WHERE user_id = $1`, adaID).Scan(&verified)
	if !verified {
		t.Error("an Apple-verified email should mark the account verified")
	}
	var pw string
	_ = a.SysDB.QueryRow(`SELECT password_hash FROM users WHERE id = $1`, adaID).Scan(&pw)
	if pw != "!sso" {
		t.Errorf("a passwordless account's hash: %q", pw)
	}

	// 2. The same token and nonce again: refused (a token is accepted once).
	if code, out := apple(map[string]any{"identity_token": tok, "nonce": raw}); code != 401 {
		t.Errorf("replayed token: %d %v", code, out)
	}

	// 3. Signing in again by sub finds the same account, even when Apple reports another address,
	//    and a name sent again does not replace the one on the profile.
	tok, raw = idp.token(t, subA, "other-"+rnd()+"@privaterelay.appleid.com", true)
	code, out = apple(map[string]any{"identity_token": tok, "nonce": raw, "name": map[string]string{"given": "Someone", "family": "Else"}})
	if code != 200 || userOf(out) != adaID || out["created"] != false || out["access_token"] != nil {
		t.Fatalf("second sign-in by sub: %d %v", code, out)
	}
	if prof := bearer(out["token"].(string)).must("GET", "/api/me/profile", nil, 200); prof["name"] != "Ada Lovelace" {
		t.Errorf("the name was replaced: %v", prof["name"])
	}

	// 4. A verified email matching an existing account links to it (no second account).
	bob, bobID, bobEmail := signup(t, a, srv.URL, "apple-bob")
	subB := "001.apple." + rnd()
	tok, raw = idp.token(t, subB, bobEmail, true)
	code, out = apple(map[string]any{"identity_token": tok, "nonce": raw, "name": map[string]string{"given": "Bob"}})
	if code != 200 || userOf(out) != bobID || out["created"] != false {
		t.Fatalf("email match: %d %v (bob is %s)", code, out, bobID)
	}
	var linked string
	_ = a.SysDB.QueryRow(`SELECT user_id FROM user_identities WHERE provider = 'apple' AND subject = $1`, subB).Scan(&linked)
	if linked != bobID {
		t.Errorf("link row: %q", linked)
	}
	if prof := bob.must("GET", "/api/me/profile", nil, 200); prof["name"] != "Bob" {
		t.Errorf("an empty profile name should take Apple's: %v", prof["name"])
	}

	// 5. An UNverified email matching an account is not linked.
	_, _, carolEmail := signup(t, a, srv.URL, "apple-carol")
	tok, raw = idp.token(t, "001.apple."+rnd(), carolEmail, false)
	if code, out := apple(map[string]any{"identity_token": tok, "nonce": raw}); code != 409 || out["code"] != "account_exists" {
		t.Errorf("unverified email match: %d %v", code, out)
	}

	// 6. A new subject without an email can't make an account.
	tok, raw = idp.token(t, "001.apple."+rnd(), "", false)
	if code, out := apple(map[string]any{"identity_token": tok, "nonce": raw}); code != 400 || out["code"] != "email_required" {
		t.Errorf("no email: %d %v", code, out)
	}

	// 7. Token checks through the endpoint: wrong audience, wrong nonce.
	tok, raw = idp.token(t, subA, relay, true, func(c jwt.MapClaims) { c["aud"] = "com.evil.app" })
	if code, _ := apple(map[string]any{"identity_token": tok, "nonce": raw}); code != 401 {
		t.Errorf("wrong audience: %d", code)
	}
	tok, _ = idp.token(t, subA, relay, true)
	if code, _ := apple(map[string]any{"identity_token": tok, "nonce": "some-other-raw-nonce-value"}); code != 401 {
		t.Errorf("wrong nonce: %d", code)
	}

	// 8. A suspended account is refused, as at POST /api/auth/login.
	suspend(adaID, true)
	tok, raw = idp.token(t, subA, relay, true)
	if code, out := apple(map[string]any{"identity_token": tok, "nonce": raw}); code != 403 || out["code"] != "account_suspended" {
		t.Errorf("suspended: %d %v", code, out)
	}
	suspend(adaID, false)

	// 9. Two-factor on: a challenge, no token; the challenge finishes at /api/auth/2fa/challenge.
	en := bob.must("POST", "/api/me/2fa/enroll", map[string]string{"password": "correct-horse-9"}, 200)
	secret := en["secret"].(string)
	bob.must("POST", "/api/me/2fa/confirm", map[string]string{"code": totpNow(t, secret)}, 200)
	if _, err := a.SysDB.Exec(`UPDATE user_totp SET last_step = 0 WHERE user_id = $1`, bobID); err != nil {
		t.Fatal(err)
	}
	tok, raw = idp.token(t, subB, bobEmail, true)
	code, out = apple(map[string]any{"identity_token": tok, "nonce": raw, "device_name": "Bob's iPhone"})
	ch, _ := out["challenge"].(string)
	if code != 401 || out["code"] != "mfa_required" || out["mfa_required"] != true || ch == "" || out["token"] != nil || out["access_token"] != nil {
		t.Fatalf("2FA account: %d %v", code, out)
	}
	code, out = postJSON(t, srv.URL+"/api/auth/2fa/challenge", map[string]string{"challenge": ch, "code": totpNow(t, secret)})
	if code != 200 || userOf(out) != bobID {
		t.Fatalf("finishing the challenge: %d %v", code, out)
	}
	// ...and the app then mints its device token the way it does after a password sign-in.
	b := bearer(out["token"].(string))
	if tok := b.must("POST", "/api/auth/tokens", map[string]any{"name": "Bob's iPhone", "abilities": []string{}}, 201); tok["token"] == "" {
		t.Errorf("PAT after 2FA: %v", tok)
	}

}
