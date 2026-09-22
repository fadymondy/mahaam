package server

/*
TestProfile: the account a person manages for themselves (MH-343), against the real stack.

Profile fields, the picture pipeline, moving to a new email address, revoking the token an app
holds, and the invitation bug that made every app unable to join a workspace.

	TEST_DATABASE_URL=… TEST_APP_DATABASE_URL=… go test -count=1 ./internal/server/ -run Profile -v
*/

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"hash/crc32"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"net/http"
	"strings"
	"testing"
)

func TestProfile(t *testing.T) {
	mailDir := t.TempDir()
	t.Setenv("MAIL_DRIVER", "file")
	t.Setenv("MAIL_DIR", mailDir)
	a, srv := bootStack(t)

	alice, _, email := signup(t, a, srv.URL, "profile-alice")
	_, _, bobEmail := signup(t, a, srv.URL, "profile-bob")

	// 1. An account that never saved a profile has the empty one, not a 404.
	p := alice.must("GET", "/api/me/profile", nil, 200)
	if p["email"] != email || p["name"] != "" || p["avatar"] != nil || p["locale"] != nil {
		t.Fatalf("empty profile: %v", p)
	}

	// 2. Fields round-trip; whitespace in a name is collapsed; an absent field is left alone and
	// an empty one clears.
	p = alice.must("PATCH", "/api/me/profile", map[string]any{"name": "  Alice \t Smith ", "locale": "ar", "timezone": "Africa/Cairo"}, 200)
	if p["name"] != "Alice Smith" || p["locale"] != "ar" || p["timezone"] != "Africa/Cairo" {
		t.Errorf("after the first patch: %v", p)
	}
	p = alice.must("PATCH", "/api/me/profile", map[string]any{"locale": ""}, 200)
	if p["locale"] != nil || p["name"] != "Alice Smith" || p["timezone"] != "Africa/Cairo" {
		t.Errorf("clearing locale touched something else: %v", p)
	}
	for _, tz := range []string{"Mars/Olympus_Mons", "Local"} {
		if code, b := alice.do("PATCH", "/api/me/profile", map[string]any{"timezone": tz}); code != 422 {
			t.Errorf("timezone %q: got %d, want 422: %s", tz, code, b)
		}
	}

	// 3. A picture: a wide PNG with a transparent half comes back as a 256px JPEG square, the
	// transparent part white rather than black.
	src := image.NewNRGBA(image.Rect(0, 0, 900, 600))
	for y := 0; y < 600; y++ {
		for x := 0; x < 900; x++ {
			if x < 450 {
				src.Set(x, y, color.NRGBA{R: 200, G: 30, B: 30, A: 255})
			} // the right half stays fully transparent
		}
	}
	var pngBytes bytes.Buffer
	_ = png.Encode(&pngBytes, src)
	code, b := alice.upload("/api/me/avatar", "me.png", pngBytes.Bytes())
	if code != 200 {
		t.Fatalf("avatar upload: %d %s", code, b)
	}
	p = alice.must("GET", "/api/me/profile", nil, 200)
	url, _ := p["avatar"].(string)
	if !strings.HasPrefix(url, "data:image/jpeg;base64,") {
		t.Fatalf("stored avatar is not a JPEG data URL: %.60s", url)
	}
	raw, _ := base64.StdEncoding.DecodeString(strings.TrimPrefix(url, "data:image/jpeg;base64,"))
	img, err := jpeg.Decode(bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	if img.Bounds().Dx() != 256 || img.Bounds().Dy() != 256 {
		t.Errorf("avatar is %v, want 256×256", img.Bounds())
	}
	// The crop is the centred 600×600 square (x 150–750), so the left 300 of it are red and
	// the right 300 were transparent.
	if r, g, bl, _ := img.At(250, 128).RGBA(); r>>8 < 230 || g>>8 < 230 || bl>>8 < 230 {
		t.Errorf("a transparent area came out (%d,%d,%d), want white", r>>8, g>>8, bl>>8)
	}
	if r, g, _, _ := img.At(5, 128).RGBA(); r>>8 < 150 || g>>8 > 80 {
		t.Errorf("the opaque area lost its colour: r=%d g=%d", r>>8, g>>8)
	}

	// Not an image → 415, and the stored picture is untouched.
	if code, _ := alice.upload("/api/me/avatar", "x.png", []byte("<svg onload=alert(1)>")); code != http.StatusUnsupportedMediaType {
		t.Errorf("a non-image upload: got %d, want 415", code)
	}
	// A header that claims an absurd size is refused before it is decoded.
	var huge bytes.Buffer
	_ = png.Encode(&huge, image.NewGray(image.Rect(0, 0, 1, 1)))
	bomb := huge.Bytes()
	bomb[16], bomb[17], bomb[18], bomb[19] = 0, 0, 0xEA, 0x60 // width 60000
	bomb[20], bomb[21], bomb[22], bomb[23] = 0, 0, 0xEA, 0x60 // height 60000
	binary.BigEndian.PutUint32(bomb[29:33], crc32.ChecksumIEEE(bomb[12:29])) // a valid IHDR
	if code, _ := alice.upload("/api/me/avatar", "bomb.png", bomb); code != http.StatusRequestEntityTooLarge {
		t.Errorf("a 3.6-gigapixel header: got %d, want 413", code)
	}
	if p := alice.must("GET", "/api/me/profile", nil, 200); p["avatar"] != url {
		t.Error("a refused upload changed the stored picture")
	}
	if p := alice.must("DELETE", "/api/me/avatar", nil, 200); p["avatar"] != nil {
		t.Errorf("after delete: %v", p["avatar"])
	}

	// 4. Moving to a new address.
	if code, _ := alice.do("POST", "/api/me/email", map[string]string{"email": "x-" + rnd() + "@example.test", "password": "wrong-password"}); code != 403 {
		t.Errorf("email change with the wrong password: %d", code)
	}
	// An address someone else has: the same 202, and no code goes anywhere.
	alice.must("POST", "/api/me/email", map[string]string{"email": bobEmail, "password": "correct-horse-9"}, 202)

	next := "profile-alice-new-" + rnd() + "@example.test"
	alice.must("POST", "/api/me/email", map[string]string{"email": next, "password": "correct-horse-9"}, 202)
	code2 := codeIn(t, mailTo(t, mailDir, next, "Confirm your new", 0))
	if n := len(mailsTo(mailDir, bobEmail, "")); n != 0 {
		t.Errorf("%d message(s) went to an address another account holds", n)
	}
	wrong := "000000"
	if code2 == wrong {
		wrong = "111111"
	}
	if code, _ := alice.do("POST", "/api/me/email/confirm", map[string]string{"code": wrong}); code != 400 {
		t.Errorf("a wrong confirm code: %d", code)
	}
	p = alice.must("POST", "/api/me/email/confirm", map[string]string{"code": code2}, 200)
	if p["email"] != next {
		t.Fatalf("after confirm the email is %v, want %s", p["email"], next)
	}
	// The session alice already holds was issued with the old address baked in, and
	// /api/auth/me used to echo it back, so every screen showed the old email until she signed out.
	if me := alice.must("GET", "/api/auth/me", nil, 200); me["email"] != next {
		t.Errorf("/api/auth/me after the change: %v, want %s", me["email"], next)
	}
	// The old address hears about it, and the new one signs in.
	mailTo(t, mailDir, email, "email address was changed", 0)
	fresh := newClient(t, srv.URL)
	if code, _ := fresh.do("POST", "/api/auth/login", map[string]string{"email": email, "password": "correct-horse-9"}); code != 401 {
		t.Errorf("the old address still signs in: %d", code)
	}
	fresh.must("POST", "/api/auth/login", map[string]string{"email": next, "password": "correct-horse-9"}, 200)

	// 5. An invitation accepted with a PAT. The identity behind a PAT has no email, so the
	// "is this invitation yours" check compared the invitation against "" and refused every app.
	ws := alice.must("POST", "/api/me/workspaces", map[string]string{"name": "Profile " + rnd()}, 201)["workspace"].(map[string]any)["id"].(string)
	alice.ws = ws
	carol, _, carolEmail := signup(t, a, srv.URL, "profile-carol")
	inv := alice.must("POST", "/api/w/invitations", map[string]string{"email": carolEmail, "role": "member"}, 201)
	token := strings.TrimPrefix(inv["accept_url"].(string), "/invite/")
	pat := carol.must("POST", "/api/auth/tokens", map[string]any{"name": "carol phone"}, 201)["token"].(string)
	app := newClient(t, srv.URL)
	app.bearer = pat
	if code, b := app.do("POST", "/api/invitations/accept", map[string]string{"token": token}); code != 200 {
		t.Errorf("accepting an invitation with a PAT: got %d: %s", code, b)
	}

	// A PAT's identity has no email at all; /api/auth/me fills it from the account.
	if me := app.must("GET", "/api/auth/me", nil, 200); me["email"] != carolEmail {
		t.Errorf("/api/auth/me with a PAT: email %v, want %s", me["email"], carolEmail)
	}

	// 6. Signing out of an app revokes the token it holds.
	app.must("GET", "/api/me/profile", nil, 200)
	app.must("DELETE", "/api/me/token", nil, 204)
	if code, _ := app.do("GET", "/api/me/profile", nil); code != 401 {
		t.Errorf("a revoked PAT still works: %d", code)
	}
	// With a cookie session it is a no-op, not an error, and the session survives.
	carol.must("DELETE", "/api/me/token", nil, 204)
	carol.must("GET", "/api/me/profile", nil, 200)

	// 7. Signed out, none of it is reachable.
	anon := newClient(t, srv.URL)
	for _, path := range []string{"/api/me/profile", "/api/me/avatar"} {
		if code, _ := anon.do("GET", path, nil); code != 401 && code != 405 {
			t.Errorf("GET %s signed out: %d", path, code)
		}
	}
}
