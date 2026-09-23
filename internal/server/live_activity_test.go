package server

/*
TestLiveActivity: the lock-screen timer and the widgets follow changes made elsewhere (MH-355),
against the fake FCM from native_push_test.go.

	TEST_DATABASE_URL=… TEST_APP_DATABASE_URL=… go test -count=1 ./internal/server/ -run LiveActivity -v
*/

import (
	"testing"
	"time"
)

// laMessages returns what went to the fake for Live Activity token la.
func (f *fakeFCM) laMessages(la string) []map[string]any {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []map[string]any
	for _, m := range f.messages {
		if apns, _ := m["apns"].(map[string]any); apns != nil && apns["live_activity_token"] == la {
			out = append(out, m)
		}
	}
	return out
}

func (f *fakeFCM) widgetPushes(device string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	n := 0
	for _, m := range f.messages {
		if d, _ := m["data"].(map[string]any); d != nil && d["kind"] == "widgets.refresh" && m["token"] == device {
			n++
		}
	}
	return n
}

func aps(m map[string]any) map[string]any {
	apns, _ := m["apns"].(map[string]any)
	payload, _ := apns["payload"].(map[string]any)
	a, _ := payload["aps"].(map[string]any)
	return a
}

func eventually(t *testing.T, what string, ok func() bool) {
	t.Helper()
	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		if ok() {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

func TestLiveActivity(t *testing.T) {
	fake := withFakeFCM(t)
	t.Setenv("WIDGET_REFRESH_SECONDS", "3600")
	a, srv := bootStack(t)
	alice, _, _ := signup(t, a, srv.URL, "la-alice")
	ws := alice.must("POST", "/api/me/workspaces", map[string]string{"name": "Live " + rnd()}, 201)["workspace"].(map[string]any)["id"].(string)
	alice.ws = ws
	project := alice.must("POST", "/api/w/projects", map[string]any{"name": "Lock screen " + rnd(), "visibility": "workspace"}, 201)
	pid, pname := project["id"].(string), project["name"].(string)

	device := "alice-iphone-" + rnd()
	alice.must("POST", "/api/me/devices", map[string]any{"platform": "ios", "app": "team", "push_token": device}, 200)
	// A token for a device that isn't registered (or isn't yours) is refused.
	if code, _ := alice.do("POST", "/api/me/devices/nope/live-activity", map[string]any{"kind": "timer", "push_to_start_token": "x"}); code != 404 {
		t.Errorf("live activity for an unknown device: %d", code)
	}
	p2s := "p2s-" + rnd()
	alice.must("POST", "/api/me/devices/"+device+"/live-activity", map[string]any{"kind": "timer", "push_to_start_token": p2s}, 204)

	// 1. A timer started from the web starts the activity on the phone, via push-to-start.
	alice.must("POST", "/api/w/time/start", map[string]any{"project": pid, "description": "Writing the spec"}, 201)
	eventually(t, "a push-to-start", func() bool { return len(fake.laMessages(p2s)) > 0 })
	start := aps(fake.laMessages(p2s)[0])
	if start["event"] != "start" || start["attributes-type"] != "TimerActivityAttributes" {
		t.Errorf("push-to-start aps: %v", start)
	}
	cs, _ := start["content-state"].(map[string]any)
	if cs["label"] != "Writing the spec" || cs["project"] != pname || cs["started_at"] == nil {
		t.Errorf("content-state: %v", cs)
	}

	// The phone reports the running activity's own token.
	la := "la-" + rnd()
	alice.must("POST", "/api/me/devices/"+device+"/live-activity", map[string]any{"kind": "timer", "activity_token": la}, 204)

	// 2. Switching timers publishes a stop and a start in one request. The phone must end up
	// showing the new timer: one update, not an end racing an update.
	alice.must("POST", "/api/w/time/start", map[string]any{"project": pid, "description": "Reviewing"}, 201)
	eventually(t, "an update", func() bool { return len(fake.laMessages(la)) > 0 })
	time.Sleep(800 * time.Millisecond)
	msgs := fake.laMessages(la)
	if len(msgs) != 1 || aps(msgs[0])["event"] != "update" {
		t.Errorf("switching timers sent %d message(s), first %v; want one update", len(msgs), aps(msgs[0]))
	} else if cs, _ := aps(msgs[0])["content-state"].(map[string]any); cs["label"] != "Reviewing" {
		t.Errorf("update content-state: %v", cs)
	}

	// 3. Widgets: one request with progress and the running timer.
	alice.must("POST", "/api/w/projects/"+pid+"/tasks", map[string]any{"title": "One"}, 201)
	w := alice.must("GET", "/api/w/widgets/projects", nil, 200)
	projects, _ := w["projects"].([]any)
	if len(projects) == 0 {
		t.Fatalf("widgets: no projects: %v", w)
	}
	first := projects[0].(map[string]any)
	if first["id"] != pid || first["tasks_total"] != float64(1) {
		t.Errorf("widget project: %v", first)
	}
	if timer, _ := w["timer"].(map[string]any); timer == nil || timer["label"] != "Reviewing" {
		t.Errorf("widget timer: %v", w["timer"])
	}

	// 4. Progress changed, so the phone was told to reload its widgets, once, however many
	// changes follow inside the throttle window.
	eventually(t, "a widget refresh push", func() bool { return fake.widgetPushes(device) > 0 })
	alice.must("POST", "/api/w/projects/"+pid+"/tasks", map[string]any{"title": "Two"}, 201)
	time.Sleep(1 * time.Second)
	if n := fake.widgetPushes(device); n != 1 {
		t.Errorf("%d widget pushes inside the throttle window, want 1", n)
	}
	for _, m := range fake.messages {
		if d, _ := m["data"].(map[string]any); d != nil && d["kind"] == "widgets.refresh" {
			if h := m["apns"].(map[string]any)["headers"].(map[string]any); h["apns-push-type"] != "background" {
				t.Errorf("a widget refresh that isn't a background push: %v", h)
			}
		}
	}

	// 5. Stopping anywhere ends the activity, and its token is dropped once ended.
	alice.must("POST", "/api/w/time/stop", map[string]any{}, 200)
	eventually(t, "an end", func() bool {
		m := fake.laMessages(la)
		return len(m) > 1 && aps(m[len(m)-1])["event"] == "end"
	})
	var n int
	eventually(t, "the ended token to be dropped", func() bool {
		_ = a.SysDB.QueryRow(`SELECT count(*) FROM live_activity_tokens WHERE token = $1`, la).Scan(&n)
		return n == 0
	})
}
