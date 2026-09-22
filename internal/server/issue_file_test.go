package server

/*
TestIssueFileIntake — POST /api/w/issues/file, the route that lets a member file an issue with a
screenshot.

It exists because there was no way to do that: POST /api/w/issues is JSON only, and the two
multipart intakes that accept an image are both wrong for a signed-in member (one wants a project's
public key and an Origin allowlist, the other files into the platform workspace).

	TEST_DATABASE_URL=… TEST_APP_DATABASE_URL=… go test -count=1 ./internal/server/ -run IssueFileIntake -v
*/

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"strings"
	"testing"
)

// A one-pixel PNG. Real bytes, because the intake sniffs the declared content type and the
// screenshot has to survive a round trip through storage.
var onePixelPNG = []byte{
	0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a,
	0, 0, 0, 0x0d, 'I', 'H', 'D', 'R', 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0,
	0x1f, 0x15, 0xc4, 0x89, 0, 0, 0, 0x0a, 'I', 'D', 'A', 'T',
	0x78, 0x9c, 0x63, 0, 1, 0, 0, 5, 0, 1, 0x0d, 0x0a, 0x2d, 0xb4,
	0, 0, 0, 0, 'I', 'E', 'N', 'D', 0xae, 0x42, 0x60, 0x82,
}

// fileIssue posts the multipart payload the capture clients produce.
func fileIssue(t *testing.T, c *client, fields map[string]string, img []byte, filename, contentType string) (int, []byte) {
	t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	for k, v := range fields {
		_ = w.WriteField(k, v)
	}
	if img != nil {
		h := make(textproto.MIMEHeader)
		h.Set("Content-Disposition", `form-data; name="screenshot"; filename="`+filename+`"`)
		h.Set("Content-Type", contentType)
		part, err := w.CreatePart(h)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := part.Write(img); err != nil {
			t.Fatal(err)
		}
	}
	_ = w.Close()

	req, _ := http.NewRequest(http.MethodPost, c.base+"/api/w/issues/file", &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	return c.send(req, http.MethodPost)
}

func TestIssueFileIntake(t *testing.T) {
	a, srv := bootStack(t)
	alice, _, _ := signup(t, a, srv.URL, "file-alice")
	bob, _, _ := signup(t, a, srv.URL, "file-bob")

	ws := alice.must("POST", "/api/me/workspaces", map[string]string{"name": "File " + rnd()}, 201)["workspace"].(map[string]any)["id"].(string)
	alice.ws = ws
	proj := alice.must("POST", "/api/w/projects", map[string]any{"name": "P " + rnd()}, 201)["id"].(string)

	key := func(b []byte) string {
		t.Helper()
		var out struct {
			Key string `json:"key"`
		}
		if err := json.Unmarshal(b, &out); err != nil {
			t.Fatalf("body: %v: %s", err, b)
		}
		return out.Key
	}

	// 1. The whole point: a member files with a screenshot, and it comes back from the GET that
	// already existed but had nothing to serve.
	code, b := fileIssue(t, alice, map[string]string{
		"title": "The board will not load", "body": "Spins for ever.",
		"project": proj, "issue_type": "bug", "priority": "high",
		"page_url": "https://console.mahaam.app/ar/w/x/board", "viewport": "1280x800",
	}, onePixelPNG, "shot.png", "image/png")
	if code != http.StatusCreated {
		t.Fatalf("file with a screenshot: %d %s", code, b)
	}
	filed := key(b)

	shotCode, shot := alice.do("GET", "/api/w/issues/"+filed+"/screenshot", nil)
	if shotCode != http.StatusOK {
		t.Fatalf("the screenshot did not come back: %d %s", shotCode, shot)
	}
	if !bytes.Equal(shot, onePixelPNG) {
		t.Errorf("the screenshot changed in transit: %d bytes back, %d sent", len(shot), len(onePixelPNG))
	}

	// The issue is a normal board issue, not a second-class one.
	issue := alice.must("GET", "/api/w/issues/"+filed, nil, 200)
	if issue["title"] != "The board will not load" || issue["priority"] != "high" {
		t.Errorf("filed issue: %v", issue)
	}
	if issue["source"] != "app" {
		// Not "embed" (a stranger with a public key) and not "portal" (a customer). The board
		// filters on this, so getting it wrong hides the issue from the people who filed it.
		t.Errorf("source = %v, want app", issue["source"])
	}

	// 2. A project is optional. An extension filing "this page is broken" from a random site
	// usually has none in mind, and forcing a choice makes people pick a wrong one.
	code, b = fileIssue(t, alice, map[string]string{"title": "No project"}, nil, "", "")
	if code != http.StatusCreated {
		t.Fatalf("file without a project or screenshot: %d %s", code, b)
	}

	// 3. A title is still required — the one field an issue cannot be triaged without.
	if code, _ := fileIssue(t, alice, map[string]string{"body": "no title"}, nil, "", ""); code != http.StatusUnprocessableEntity {
		t.Errorf("no title: got %d, want 422", code)
	}

	// 4. The image restrictions are the shared ones, not a second set that drifted. An SVG is the
	// case that matters: it is an image to a human and a script container to a browser.
	code, b = fileIssue(t, alice, map[string]string{"title": "svg"}, []byte(`<svg onload="alert(1)"/>`), "x.svg", "image/svg+xml")
	if code != http.StatusUnprocessableEntity {
		t.Errorf("an SVG screenshot: got %d, want 422: %s", code, b)
	}

	// 5. Tenancy. Bob is not a member; naming alice's workspace tells him nothing.
	bob.ws = ws
	if code, b := fileIssue(t, bob, map[string]string{"title": "intruder"}, nil, "", ""); code != http.StatusNotFound {
		t.Errorf("a non-member filing: got %d, want 404: %s", code, b)
	}
	// And a project he cannot see is a 404, not a hint that it exists.
	bobWS := bob.must("POST", "/api/me/workspaces", map[string]string{"name": "Bob " + rnd()}, 201)["workspace"].(map[string]any)["id"].(string)
	bob.ws = bobWS
	if code, b := fileIssue(t, bob, map[string]string{"title": "x", "project": proj}, nil, "", ""); code != http.StatusNotFound {
		t.Errorf("filing into another workspace's project: got %d, want 404: %s", code, b)
	}
	// Alice's issue count is unchanged by any of that.
	list := alice.must("GET", "/api/w/issues?state=open", nil, 200)
	if items, _ := list["issues"].([]any); len(items) != 2 {
		t.Errorf("alice has %d issues, want the 2 she filed", len(items))
	}

	// 6. Anonymous: 401, like every other workspace route.
	anon := newClient(t, srv.URL)
	anon.ws = ws
	if code, _ := fileIssue(t, anon, map[string]string{"title": "x"}, nil, "", ""); code != http.StatusUnauthorized {
		t.Errorf("anonymous filing: got %d, want 401", code)
	}

	// 7. A screenshot over the cap is refused rather than truncated — a half-written PNG on disk
	// is worse than no PNG.
	big := bytes.Repeat([]byte{0x89}, 9<<20)
	if code, b := fileIssue(t, alice, map[string]string{"title": "huge"}, big, "big.png", "image/png"); code != http.StatusRequestEntityTooLarge {
		if !strings.Contains(string(b), "larger") {
			t.Errorf("a 9 MB screenshot: got %d, want 413: %s", code, b)
		}
	}
}
