package server

/*
TestMonitorIntake — the backend error-monitoring DSN flow: a manager mints a key, the DSN's public
key files into the exact project it belongs to, a repeated fault (same fingerprint) bumps the
existing open issue instead of flooding the board, an unrelated error creates its own issue, a
revoked or wrong-project key is refused (and refused identically either way), and the resulting
issues show up in the project's own board with source "monitor".

	TEST_DATABASE_URL=… TEST_APP_DATABASE_URL=… go test -count=1 ./internal/server/ -run MonitorIntake -v
*/

import "testing"

func TestMonitorIntake(t *testing.T) {
	a, srv := bootStack(t)
	owner, _, _ := signup(t, a, srv.URL, "monitor")
	ws := owner.must("POST", "/api/me/workspaces", map[string]string{"name": "Monitor " + rnd()}, 201)["workspace"].(map[string]any)["id"].(string)
	owner.ws = ws
	proj := owner.must("POST", "/api/w/projects", map[string]any{"name": "P " + rnd()}, 201)
	pid := proj["id"].(string)
	otherProj := owner.must("POST", "/api/w/projects", map[string]any{"name": "Other " + rnd()}, 201)
	otherPid := otherProj["id"].(string)

	mk := owner.must("POST", "/api/w/projects/"+pid+"/monitor-keys", map[string]any{"name": "prod"}, 201)
	pubKey := mk["public_key"].(string)
	if dsn, _ := mk["dsn"].(string); dsn == "" || dsn[:8] != "https://" {
		t.Fatalf("dsn: %v", mk)
	}

	post := func(project string, body map[string]any) (int, map[string]any) {
		return postJSON(t, srv.URL+"/api/monitor/"+project+"/envelope", body)
	}

	// 1. A real event, with the right key for the right project, files a new issue.
	code, out := post(pid, map[string]any{
		"public_key": pubKey, "level": "error", "exception_type": "NullPointerException", "exception_value": "x was nil",
		"stacktrace": "at main.go:42\nat handler.go:10", "environment": "production",
	})
	if code != 201 || out["status"] != "created" {
		t.Fatalf("first event: %d %v", code, out)
	}
	key1 := out["key"].(string)

	// 2. The exact same fault, reported again, updates the SAME issue instead of making a new one.
	code, out = post(pid, map[string]any{
		"public_key": pubKey, "level": "error", "exception_type": "NullPointerException", "exception_value": "x was nil",
		"stacktrace": "at main.go:42\nat handler.go:10", "environment": "production",
	})
	if code != 200 || out["status"] != "updated" || out["key"] != key1 {
		t.Fatalf("repeat event should dedupe onto %s: %d %v", key1, code, out)
	}
	issue := owner.must("GET", "/api/w/issues/"+key1, nil, 200)
	if issue["source"] != "monitor" {
		t.Errorf("issue source: %v", issue["source"])
	}

	// 3. A different fault in the same project makes its own issue.
	code, out = post(pid, map[string]any{"public_key": pubKey, "level": "fatal", "exception_type": "OutOfMemoryError", "exception_value": "heap exhausted"})
	if code != 201 {
		t.Fatalf("second fault: %d %v", code, out)
	}
	key2 := out["key"].(string)
	if key2 == key1 {
		t.Errorf("a different fault must not dedupe onto the first issue")
	}
	issue2 := owner.must("GET", "/api/w/issues/"+key2, nil, 200)
	if issue2["priority"] != "highest" {
		t.Errorf("fatal should map to highest priority: %v", issue2["priority"])
	}

	// 4. The key only works for the project it was minted for.
	if code, out := post(otherPid, map[string]any{"public_key": pubKey, "exception_type": "X"}); code != 403 {
		t.Errorf("a key used against another project should be refused: %d %v", code, out)
	}

	// 5. Revoked: refused, identically to an unknown key (no oracle for "does this key exist").
	owner.must("DELETE", "/api/w/projects/"+pid+"/monitor-keys/"+mk["id"].(string), nil, 204)
	codeRevoked, outRevoked := post(pid, map[string]any{"public_key": pubKey, "exception_type": "X"})
	codeUnknown, outUnknown := post(pid, map[string]any{"public_key": "mdsn_doesnotexist", "exception_type": "X"})
	if codeRevoked != 403 || codeUnknown != 403 || outRevoked["error"] != outUnknown["error"] {
		t.Errorf("revoked vs unknown should answer identically: %d %v / %d %v", codeRevoked, outRevoked, codeUnknown, outUnknown)
	}

	// 6. It shows up on the project's board, same as any other issue (reusing the one system).
	board := owner.must("GET", "/api/w/projects/"+pid+"/board", nil, 200)
	var found bool
	for _, x := range board["tasks"].([]any) {
		if x.(map[string]any)["key"] == key1 {
			found = true
		}
	}
	if !found {
		t.Errorf("the monitor-filed issue should be a card on its project's board")
	}
}
