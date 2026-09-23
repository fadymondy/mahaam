package server

/*
TestBoardRealtime: task.*, issue.* and project.updated on /api/w/events (MH-351), against the real
stack and the real stream.

What it pins down is who hears what. A member ON a members-only project gets its events; a member
who isn't gets nothing, not even that something happened. And no event carries a title: an event
is a hint to refetch, and the refetch applies the access rules.

	TEST_DATABASE_URL=… TEST_APP_DATABASE_URL=… go test -count=1 ./internal/server/ -run BoardRealtime -v
*/

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

// collect reads events from ch for d and returns them by name.
func collect(ch <-chan sseEvent, d time.Duration) map[string][]map[string]any {
	out := map[string][]map[string]any{}
	deadline := time.After(d)
	for {
		select {
		case e, ok := <-ch:
			if !ok {
				return out
			}
			var data map[string]any
			_ = json.Unmarshal([]byte(e.data), &data)
			out[e.name] = append(out[e.name], data)
		case <-deadline:
			return out
		}
	}
}

// waitFor reads until an event called name arrives (and returns everything seen), or d passes.
func waitFor(ch <-chan sseEvent, name string, d time.Duration) (map[string][]map[string]any, bool) {
	out := map[string][]map[string]any{}
	deadline := time.After(d)
	for {
		select {
		case e, ok := <-ch:
			if !ok {
				return out, false
			}
			var data map[string]any
			_ = json.Unmarshal([]byte(e.data), &data)
			out[e.name] = append(out[e.name], data)
			if e.name == name {
				return out, true
			}
		case <-deadline:
			return out, false
		}
	}
}

func TestBoardRealtime(t *testing.T) {
	a, srv := bootStack(t)
	alice, _, _ := signup(t, a, srv.URL, "rt-alice")
	bob, bobID, _ := signup(t, a, srv.URL, "rt-bob")
	carol, carolID, _ := signup(t, a, srv.URL, "rt-carol")
	ws := alice.must("POST", "/api/me/workspaces", map[string]string{"name": "Realtime " + rnd()}, 201)["workspace"].(map[string]any)["id"].(string)
	for _, id := range []string{bobID, carolID} {
		if _, err := a.SysDB.Exec(`INSERT INTO workspace_members (workspace_id, user_id, role, status) VALUES ($1, $2, 'member', 'active')`, ws, id); err != nil {
			t.Fatal(err)
		}
	}
	alice.ws, bob.ws, carol.ws = ws, ws, ws

	// A members-only project with bob on it and carol not.
	secret := "Top secret launch " + rnd()
	pid := alice.must("POST", "/api/w/projects", map[string]any{"name": "Launch " + rnd(), "visibility": "members"}, 201)["id"].(string)
	alice.must("PUT", "/api/w/projects/"+pid+"/members/"+bobID, map[string]any{}, 200)

	bobStream := openStream(t, bob, ws)
	carolStream := openStream(t, carol, ws)
	aliceStream := openStream(t, alice, ws)
	time.Sleep(300 * time.Millisecond) // the streams are subscribed before anything happens
	collect(bobStream, 200*time.Millisecond)
	collect(carolStream, 200*time.Millisecond)
	collect(aliceStream, 200*time.Millisecond)

	// 1. A task is created: bob and the owner hear it, with the project's new progress.
	task := alice.must("POST", "/api/w/projects/"+pid+"/tasks", map[string]any{"title": secret}, 201)
	key := task["key"].(string)
	got, ok := waitFor(bobStream, "project.updated", 5*time.Second)
	if !ok || len(got["task.created"]) == 0 {
		t.Fatalf("bob (on the project) did not hear the task: %v", got)
	}
	created := got["task.created"][0]
	if created["project_id"] != pid || created["task_id"] == nil {
		t.Errorf("task.created payload: %v", created)
	}
	progress := got["project.updated"][0]
	if progress["tasks_total"] != float64(1) || progress["tasks_done"] != float64(0) {
		t.Errorf("project.updated progress: %v", progress)
	}
	if got, ok := waitFor(aliceStream, "task.created", 5*time.Second); !ok {
		t.Errorf("the owner did not hear the task: %v", got)
	}

	// 2. A comment and a move.
	alice.must("POST", "/api/w/tasks/"+key+"/comments", map[string]any{"body": "on it"}, 201)
	if got, ok := waitFor(bobStream, "task.commented", 5*time.Second); !ok {
		t.Errorf("no task.commented: %v", got)
	}
	board := alice.must("GET", "/api/w/projects/"+pid+"/board", nil, 200)
	done := ""
	for _, c := range board["statuses"].([]any) {
		if st := c.(map[string]any); st["category"] == "done" {
			done, _ = st["id"].(string)
		}
	}
	if done == "" {
		t.Fatal("the project has no done column")
	}
	alice.must("POST", "/api/w/tasks/"+key+"/move", map[string]any{"status": done}, 200)
	got, ok = waitFor(bobStream, "project.updated", 5*time.Second)
	if !ok || len(got["task.moved"]) == 0 {
		t.Errorf("no task.moved / progress after a move: %v", got)
	} else if p := got["project.updated"][len(got["project.updated"])-1]; p["tasks_done"] != float64(1) {
		t.Errorf("progress after moving to done: %v", p)
	}

	// 3. An issue in the project, then a status change.
	issueKey := alice.must("POST", "/api/w/issues", map[string]any{"title": secret + " issue", "project": pid}, 201)["key"].(string)
	got, ok = waitFor(bobStream, "issue.created", 5*time.Second)
	if !ok || got["issue.created"][0]["key"] != issueKey {
		t.Errorf("issue.created: %v", got)
	}
	alice.must("PATCH", "/api/w/issues/"+issueKey, map[string]any{"status": "in_progress"}, 200)
	got, ok = waitFor(bobStream, "issue.moved", 5*time.Second)
	if !ok || got["issue.moved"][0]["status"] != "in_progress" {
		t.Errorf("issue.moved: %v", got)
	}

	// 4. Carol, a member who isn't on the project, heard none of it.
	for name, evs := range collect(carolStream, 1500*time.Millisecond) {
		if strings.HasPrefix(name, "task.") || strings.HasPrefix(name, "issue.") || name == "project.updated" {
			t.Errorf("carol (not on the project) got %s: %v", name, evs)
		}
	}

	// 5. Nothing on the wire carried the title.
	for name, evs := range collect(bobStream, 500*time.Millisecond) {
		for _, e := range evs {
			if b, _ := json.Marshal(e); strings.Contains(string(b), secret) {
				t.Errorf("%s carried content: %s", name, b)
			}
		}
	}
	if b, _ := json.Marshal(created); strings.Contains(string(b), secret) {
		t.Errorf("task.created carried the title: %s", b)
	}
}
