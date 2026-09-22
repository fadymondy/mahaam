package server

/*
TestDeltaSync — GET /api/w/sync, the endpoint an offline client catches up through.

The cycle that matters: a first sync sees everything, a later sync sees only what changed, and a
delete shows up as a tombstone — because a deleted row is, by definition, absent from "what
changed", and without a marker an offline client keeps it for ever.

	TEST_DATABASE_URL=… TEST_APP_DATABASE_URL=… go test -count=1 ./internal/server/ -run DeltaSync -v
*/

import (
	"encoding/json"
	"net/http"
	"net/url"
	"testing"
	"time"
)

type syncPage struct {
	Projects []struct {
		ID string `json:"id"`
	} `json:"projects"`
	Tasks []struct {
		ID    string `json:"id"`
		Key   string `json:"key"`
		Title string `json:"title"`
	} `json:"tasks"`
	TimeEntries []struct {
		ID string `json:"id"`
	} `json:"time_entries"`
	Deletions []struct {
		Entity string `json:"entity"`
		ID     string `json:"id"`
	} `json:"deletions"`
	NextSince time.Time `json:"next_since"`
}

func syncOnce(t *testing.T, c *client, since string) syncPage {
	t.Helper()
	path := "/api/w/sync"
	if since != "" {
		path += "?since=" + url.QueryEscape(since)
	}
	code, b := c.do("GET", path, nil)
	if code != http.StatusOK {
		t.Fatalf("sync since=%q: %d %s", since, code, b)
	}
	var p syncPage
	if err := json.Unmarshal(b, &p); err != nil {
		t.Fatalf("sync body: %v: %s", err, b)
	}
	return p
}

func TestDeltaSync(t *testing.T) {
	a, srv := bootStack(t)
	alice, _, _ := signup(t, a, srv.URL, "sync-alice")
	bob, _, _ := signup(t, a, srv.URL, "sync-bob")

	ws := alice.must("POST", "/api/me/workspaces", map[string]string{"name": "Sync " + rnd()}, 201)["workspace"].(map[string]any)["id"].(string)
	alice.ws = ws
	proj := alice.must("POST", "/api/w/projects", map[string]any{"name": "P " + rnd()}, 201)["id"].(string)
	task := alice.must("POST", "/api/w/projects/"+proj+"/tasks", map[string]any{"title": "keep me"}, 201)
	gone := alice.must("POST", "/api/w/projects/"+proj+"/tasks", map[string]any{"title": "delete me"}, 201)
	alice.must("POST", "/api/w/time/start", map[string]any{"description": "working", "project": proj}, 201)

	// 1. A first sync is a bootstrap: everything, no tombstones.
	before := time.Now()
	first := syncOnce(t, alice, "")
	if len(first.Projects) != 1 || len(first.Tasks) != 2 || len(first.TimeEntries) != 1 {
		t.Fatalf("first sync: %d projects, %d tasks, %d entries — want 1, 2, 1", len(first.Projects), len(first.Tasks), len(first.TimeEntries))
	}
	if len(first.Deletions) != 0 {
		t.Errorf("a first sync carried %d tombstones; there is nothing for a new client to forget", len(first.Deletions))
	}

	// 2. The cursor is rewound. now() would lose any row whose transaction began before the sync
	// and committed after it — its updated_at is behind the cursor for ever. Five seconds of
	// overlap is the fix, and it has to actually be there.
	if lag := before.Sub(first.NextSince); lag < 4*time.Second {
		t.Errorf("next_since is only %v behind the call; the rewind that prevents lost rows is missing", lag)
	}

	// 3. A delete shows up as a tombstone. Without it the offline client keeps the row for ever.
	cursor := first.NextSince.Format(time.RFC3339Nano)
	alice.must("DELETE", "/api/w/tasks/"+gone["key"].(string), nil, 204)
	after := syncOnce(t, alice, cursor)
	found := false
	for _, d := range after.Deletions {
		if d.Entity == "tasks" && d.ID == gone["id"] {
			found = true
		}
	}
	if !found {
		t.Fatalf("the deleted task has no tombstone: %+v", after.Deletions)
	}
	for _, tk := range after.Tasks {
		if tk.ID == gone["id"] {
			t.Error("the deleted task is still being sent as a row")
		}
	}

	// 4. A change after the cursor is in the delta.
	alice.must("PATCH", "/api/w/tasks/"+task["key"].(string), map[string]any{"title": "renamed"}, 200)
	changed := syncOnce(t, alice, cursor)
	renamed := false
	for _, tk := range changed.Tasks {
		if tk.ID == task["id"] && tk.Title == "renamed" {
			renamed = true
		}
	}
	if !renamed {
		t.Error("an update after the cursor is missing from the delta")
	}

	// 5. Tenancy. Bob in his own workspace sees none of alice's rows and none of her tombstones —
	// a tombstone leaks as much as a row does: it says what existed and when it went.
	bobWS := bob.must("POST", "/api/me/workspaces", map[string]string{"name": "Bob " + rnd()}, 201)["workspace"].(map[string]any)["id"].(string)
	bob.ws = bobWS
	theirs := syncOnce(t, bob, cursor)
	if len(theirs.Tasks) != 0 || len(theirs.Deletions) != 0 || len(theirs.TimeEntries) != 0 {
		t.Errorf("bob's sync saw alice's data: %d tasks, %d tombstones, %d entries", len(theirs.Tasks), len(theirs.Deletions), len(theirs.TimeEntries))
	}
	// And naming her workspace gets him nothing at all.
	bob.ws = ws
	if code, b := bob.do("GET", "/api/w/sync", nil); code != http.StatusNotFound {
		t.Errorf("a non-member syncing alice's workspace: got %d, want 404: %s", code, b)
	}

	// 6. A malformed cursor is refused, not treated as "from the beginning". Silently bootstrapping
	// would look like it worked and ship the whole workspace to a phone that asked for a minute.
	if code, _ := alice.do("GET", "/api/w/sync?since=yesterday", nil); code != http.StatusUnprocessableEntity && code != http.StatusBadRequest {
		t.Errorf("a malformed since: got %d, want 422", code)
	}

	// 7. Anonymous: 401 like every other workspace route.
	anon := newClient(t, srv.URL)
	anon.ws = ws
	if code, _ := anon.do("GET", "/api/w/sync", nil); code != http.StatusUnauthorized {
		t.Errorf("anonymous sync: got %d, want 401", code)
	}
}
