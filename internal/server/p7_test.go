package server

import (
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"strings"
	"testing"
)

/*
P7: the client portal, client-filed issues, and the public embeddable-feedback
endpoint. Boots the real stack (bootStack) on the throwaway test database.
*/

// postForm posts multipart/form-data with an optional Origin header, no session,
// used to exercise the public embed endpoint the way the SDK does.
func postForm(t *testing.T, url, origin string, fields map[string]string) (int, map[string]any) {
	t.Helper()
	return postFormH(t, url, origin, fields, nil)
}

// postFormH is postForm with extra request headers (the feedback-core snippets send X-Mahaam-Key).
func postFormH(t *testing.T, url, origin string, fields, headers map[string]string) (int, map[string]any) {
	t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	for k, v := range fields {
		_ = w.WriteField(k, v)
	}
	_ = w.Close()
	req, _ := http.NewRequest(http.MethodPost, url, &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	out := map[string]any{}
	_ = json.Unmarshal(b, &out)
	return res.StatusCode, out
}

func TestP7EmbedAndPortal(t *testing.T) {
	a, srv := bootStack(t)

	// Owner + workspace + client + project.
	owner, ownerID, _ := signup(t, a, srv.URL, "p8-owner")
	ws := owner.must("POST", "/api/me/workspaces", map[string]string{"name": "P8 " + rnd()}, 201)["workspace"].(map[string]any)
	wsID := ws["id"].(string)
	owner.ws = wsID
	clID := owner.must("POST", "/api/w/clients", map[string]any{"name": "Acme " + rnd()}, 201)["id"].(string)
	prID := owner.must("POST", "/api/w/projects", map[string]any{"name": "Site " + rnd(), "client_id": clID, "visibility": "members"}, 201)["id"].(string)
	otherPr := owner.must("POST", "/api/w/projects", map[string]any{"name": "Internal " + rnd(), "visibility": "members"}, 201)["id"].(string)

	// ---- per-project public feedback key ----------------------------------
	key := owner.must("POST", "/api/w/projects/"+prID+"/feedback-keys",
		map[string]any{"name": "Website", "allowed_origins": []string{"https://client.test"}}, 201)
	pk := key["public_key"].(string)
	if !strings.HasPrefix(pk, "pfk_") {
		t.Fatalf("public key should start pfk_: %q", pk)
	}
	keyID := key["id"].(string)
	embed := srv.URL + "/api/feedback/embed"

	// Valid key + allowed origin -> 201, filed as source=embed into the project.
	code, out := postForm(t, embed, "https://client.test", map[string]string{
		"public_key": pk, "title": "Embed bug", "issue_type": "bug", "body": "broken", "page_url": "https://client.test/x",
	})
	if code != 201 {
		t.Fatalf("embed valid: got %d %v", code, out)
	}
	repKey, _ := out["key"].(string)
	if repKey == "" {
		t.Fatalf("embed valid returned no issue key: %v", out)
	}
	var src, projID string
	if err := a.SysDB.QueryRow(`SELECT source, project_id FROM reports WHERE workspace_id = $1 AND key = $2`, wsID, repKey).Scan(&src, &projID); err != nil {
		t.Fatal(err)
	}
	if src != "embed" || projID != prID {
		t.Fatalf("embed report: source=%q project=%q, want embed/%s", src, projID, prID)
	}

	// Disallowed origin -> 403.
	if code, _ := postForm(t, embed, "https://evil.test", map[string]string{"public_key": pk, "title": "x"}); code != 403 {
		t.Fatalf("embed wrong origin: got %d want 403", code)
	}
	// Bogus and missing key -> 403.
	if code, _ := postForm(t, embed, "https://client.test", map[string]string{"public_key": "pfk_nope", "title": "x"}); code != 403 {
		t.Fatalf("embed bogus key: got %d want 403", code)
	}
	if code, _ := postForm(t, embed, "https://client.test", map[string]string{"title": "x"}); code != 403 {
		t.Fatalf("embed no key: got %d want 403", code)
	}

	// MH-727: the key in the X-Mahaam-Key header (the install snippets) works like the form field,
	// still behind the origin allowlist, and the preflight allows that header with credentials.
	if code, out := postFormH(t, embed, "https://client.test", map[string]string{"title": "Header key"}, map[string]string{"X-Mahaam-Key": pk}); code != 201 {
		t.Fatalf("embed header key: got %d %v", code, out)
	}
	if code, _ := postFormH(t, embed, "https://evil.test", map[string]string{"title": "x"}, map[string]string{"X-Mahaam-Key": pk}); code != 403 {
		t.Fatalf("embed header key wrong origin: got %d want 403", code)
	}
	pre, _ := http.NewRequest(http.MethodOptions, embed, nil)
	pre.Header.Set("Origin", "https://client.test")
	pre.Header.Set("Access-Control-Request-Method", "POST")
	pre.Header.Set("Access-Control-Request-Headers", "x-mahaam-key")
	preRes, err := http.DefaultClient.Do(pre)
	if err != nil {
		t.Fatal(err)
	}
	preRes.Body.Close()
	if h := preRes.Header.Get("Access-Control-Allow-Headers"); !strings.Contains(h, "X-Mahaam-Key") {
		t.Fatalf("preflight Allow-Headers = %q, want X-Mahaam-Key", h)
	}
	if preRes.Header.Get("Access-Control-Allow-Credentials") != "true" {
		t.Fatalf("preflight should allow credentials (feedback-core sends credentials: include)")
	}

	// Revoke -> the key is refused afterwards.
	owner.must("POST", "/api/w/feedback-keys/"+keyID+"/revoke", nil, 204)
	if code, _ := postForm(t, embed, "https://client.test", map[string]string{"public_key": pk, "title": "after revoke"}); code != 403 {
		t.Fatalf("embed after revoke: got %d want 403", code)
	}

	// Rate limit: a fresh active key, fire past the per-IP limit (20/min).
	pk2 := owner.must("POST", "/api/w/projects/"+prID+"/feedback-keys",
		map[string]any{"name": "k2", "allowed_origins": []string{"https://client.test"}}, 201)["public_key"].(string)
	var got429 bool
	for i := 0; i < 30; i++ {
		code, _ := postForm(t, embed, "https://client.test", map[string]string{"public_key": pk2, "title": "flood"})
		if code == 429 {
			got429 = true
			break
		}
	}
	if !got429 {
		t.Errorf("embed endpoint never rate-limited after 30 rapid requests")
	}

	// ---- the client portal -------------------------------------------------
	client, clientUserID, _ := signup(t, a, srv.URL, "p8-client")
	// Invite the person as a client member and link them to the client record.
	if _, err := a.SysDB.Exec(`INSERT INTO workspace_members (workspace_id, user_id, role, status)
		VALUES ($1, $2, 'client', 'active')`, wsID, clientUserID); err != nil {
		t.Fatal(err)
	}
	owner.must("PUT", "/api/w/clients/"+clID+"/contacts/"+clientUserID, nil, 200)
	client.ws = wsID

	// The client sees only their client's project.
	projects := client.must("GET", "/api/w/projects", nil, 200)["projects"].([]any)
	if len(projects) != 1 || projects[0].(map[string]any)["id"].(string) != prID {
		t.Fatalf("client should see exactly the shared project, got %v", projects)
	}
	if strings.Contains(mustString(t, client, "GET", "/api/w/projects"), otherPr) {
		t.Fatalf("client can see the internal project %s", otherPr)
	}

	// The client files an issue into that project through the portal.
	code, b := client.do("POST", "/api/w/portal/issues", map[string]any{"project_id": prID, "title": "Portal issue", "issue_type": "bug"})
	if code != 201 {
		t.Fatalf("portal file issue: got %d %s", code, b)
	}
	issues := client.must("GET", "/api/w/portal/issues", nil, 200)["issues"].([]any)
	if len(issues) != 1 {
		t.Fatalf("client should see their one filed issue, got %d", len(issues))
	}

	// Tasks are readable on their own project only (MH-1176), never on an internal one.
	ownTask := owner.must("POST", "/api/w/projects/"+prID+"/tasks", map[string]any{"title": "Shared task"}, 201)["id"].(string)
	internalTask := owner.must("POST", "/api/w/projects/"+otherPr+"/tasks", map[string]any{"title": "Internal task"}, 201)["id"].(string)
	tasks := mustString(t, client, "GET", "/api/w/tasks")
	if !strings.Contains(tasks, ownTask) || strings.Contains(tasks, internalTask) {
		t.Fatalf("client tasks should hold %s and not %s: %s", ownTask, internalTask, tasks)
	}
	if code, _ := client.do("GET", "/api/w/tasks/"+internalTask, nil); code == 200 {
		t.Errorf("client opened a task of the internal project")
	}

	// Restricted: time, rates, members, other clients are all denied.
	for _, p := range []string{"/api/w/time/entries", "/api/w/rates", "/api/w/members", "/api/w/clients"} {
		if code, _ := client.do("GET", p, nil); code == 200 {
			t.Errorf("client reached %s (got 200) — it must be denied", p)
		}
	}
	// Their invoices endpoint is reachable (read-only).
	if code, _ := client.do("GET", "/api/w/portal/invoices", nil); code != 200 {
		t.Errorf("client portal invoices: got %d want 200", code)
	}
	_ = ownerID
}

func mustString(t *testing.T, c *client, method, path string) string {
	t.Helper()
	_, b := c.do(method, path, nil)
	return string(b)
}
