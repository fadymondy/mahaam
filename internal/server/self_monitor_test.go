package server

/*
TestSelfMonitoring: the Go SDK, wired the way the API wires it (internal/monitor), against the
real intake and the real database (MH-129). An error logged by Mahaam becomes an issue on a Mahaam
board; the same error again bumps that issue instead of filing another.

	TEST_DATABASE_URL=… TEST_APP_DATABASE_URL=… go test -count=1 ./internal/server/ -run SelfMonitoring -v
*/

import (
	"errors"
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/fadymondy/mahaam/internal/monitor"
)

func TestSelfMonitoring(t *testing.T) {
	a, srv := bootStack(t)
	owner, _, _ := signup(t, a, srv.URL, "selfmon")
	ws := owner.must("POST", "/api/me/workspaces", map[string]string{"name": "Mahaam itself " + rnd()}, 201)["workspace"].(map[string]any)["id"].(string)
	owner.ws = ws
	pid := owner.must("POST", "/api/w/projects", map[string]any{"name": "API " + rnd(), "visibility": "workspace"}, 201)["id"].(string)
	key := owner.must("POST", "/api/w/projects/"+pid+"/monitor-keys", map[string]any{"name": "api"}, 201)["public_key"].(string)

	// The DSN the API would be given, pointed at this test server.
	t.Setenv("MAHAAM_DSN", "http://"+key+"@"+strings.TrimPrefix(srv.URL, "http://")+"/monitor/"+pid)
	log := slog.New(monitor.Bridge(slog.NewTextHandler(io.Discard, nil), monitor.New()))

	msg := "invoice email failed " + rnd()
	log.Error(msg, "err", errors.New("smtp: connection refused"), "invoice", "INV-42")

	var id, title, body, source string
	var count int
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		err := a.SysDB.QueryRow(`SELECT id, title, coalesce(body, ''), source, occurrence_count FROM reports
			WHERE workspace_id = $1 AND project_id = $2 AND title LIKE '%' || $3 || '%'`, ws, pid, msg).Scan(&id, &title, &body, &source, &count)
		if err == nil {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	if id == "" {
		rows, _ := a.SysDB.Query(`SELECT title, source FROM reports WHERE workspace_id = $1`, ws)
		for rows != nil && rows.Next() {
			var tt, src string
			_ = rows.Scan(&tt, &src)
			t.Logf("on the board: %q (%s)", tt, src)
		}
		t.Fatal("the logged error never became an issue on the board")
	}
	if source != "monitor" || count != 1 {
		t.Errorf("issue: source %q, occurrences %d", source, count)
	}
	if !strings.Contains(body, "smtp: connection refused") || !strings.Contains(body, "INV-42") {
		t.Errorf("the issue body lost the error or its context:\n%s", body)
	}
	// The card says what failed, then why: not the Go type of the error value.
	if !strings.HasPrefix(title, msg+": smtp: connection refused") {
		t.Errorf("title %q", title)
	}
	t.Logf("filed: %s", title)

	// The same error from a fresh process (the per-process throttle doesn't apply) is the same
	// issue, one more occurrence, not a second card.
	again := slog.New(monitor.Bridge(slog.NewTextHandler(io.Discard, nil), monitor.New()))
	again.Error(msg, "err", errors.New("smtp: connection refused"))
	deadline = time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) && count < 2 {
		_ = a.SysDB.QueryRow(`SELECT occurrence_count FROM reports WHERE id = $1`, id).Scan(&count)
		time.Sleep(100 * time.Millisecond)
	}
	var cards int
	_ = a.SysDB.QueryRow(`SELECT count(*) FROM reports WHERE workspace_id = $1 AND title LIKE '%' || $2 || '%'`, ws, msg).Scan(&cards)
	if count != 2 || cards != 1 {
		t.Errorf("a repeat: %d occurrence(s) on %d card(s), want 2 on 1", count, cards)
	}
}
