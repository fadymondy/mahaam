package monitor

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestDisabledWithoutDSN(t *testing.T) {
	c := New(Config{})
	if c.Enabled() {
		t.Fatal("a Client with no DSN should be disabled")
	}
	// Every method must be a safe no-op, not a nil-pointer panic.
	c.Capture(context.Background(), Event{Message: "x"})
	if err := c.Send(context.Background(), Event{Message: "x"}); err != nil {
		t.Errorf("Send on a disabled client should be a no-op: %v", err)
	}
	h := c.Recover(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) }))
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, httptest.NewRequest("GET", "/", nil))
	if rr.Code != 200 {
		t.Errorf("Recover on a disabled client should just pass through: %d", rr.Code)
	}
}

func TestDSNParsing(t *testing.T) {
	c := New(Config{DSN: "https://mdsn_abc123@mcp.mahaam.app/monitor/proj-1"})
	if !c.Enabled() {
		t.Fatal("a valid DSN should enable the client")
	}
	if got := c.ingestURL(); got != "https://mcp.mahaam.app/api/monitor/proj-1/envelope" {
		t.Errorf("ingestURL = %q", got)
	}
	if c.key != "mdsn_abc123" {
		t.Errorf("key = %q", c.key)
	}

	for _, bad := range []string{"", "not a url", "https://mcp.mahaam.app/monitor/proj-1", "https://key@mcp.mahaam.app/"} {
		if New(Config{DSN: bad}).Enabled() {
			t.Errorf("%q should not enable the client", bad)
		}
	}
}

func TestSendPostsTheEnvelope(t *testing.T) {
	var got map[string]any
	var gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		_ = json.NewDecoder(r.Body).Decode(&got)
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"key":"MH-1","status":"created"}`))
	}))
	defer srv.Close()

	c := New(Config{DSN: "http://mdsn_test@" + strings.TrimPrefix(srv.URL, "http://") + "/monitor/p1", Environment: "test"})
	if err := c.Send(context.Background(), Event{Type: "boom.Error", Value: "kaboom", Level: "fatal"}); err != nil {
		t.Fatalf("Send: %v", err)
	}
	if gotPath != "/api/monitor/p1/envelope" {
		t.Errorf("path = %q", gotPath)
	}
	if got["public_key"] != "mdsn_test" || got["exception_type"] != "boom.Error" || got["level"] != "fatal" || got["environment"] != "test" {
		t.Errorf("envelope = %v", got)
	}
}

func TestRecoverReportsAndRepanics(t *testing.T) {
	hit := make(chan struct{}, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if !strings.Contains(body["exception_value"].(string), "kaboom") {
			t.Errorf("reported value: %v", body["exception_value"])
		}
		w.WriteHeader(201)
		hit <- struct{}{}
	}))
	defer srv.Close()

	c := New(Config{DSN: "http://mdsn_x@" + strings.TrimPrefix(srv.URL, "http://") + "/monitor/p1"})
	h := c.Recover(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { panic("kaboom") }))

	defer func() {
		if recover() == nil {
			t.Error("Recover must re-panic after reporting, not swallow it")
		}
		// CaptureException fires the report on its own goroutine (see its doc comment) so a
		// recovering caller that is about to re-panic isn't blocked on network I/O — give it a
		// moment to land rather than racing it.
		select {
		case <-hit:
		case <-time.After(time.Second):
			t.Error("the panic should have been reported")
		}
	}()
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/", nil))
}

func TestErrAbortHandlerNeverReported(t *testing.T) {
	reported := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { reported = true }))
	defer srv.Close()

	c := New(Config{DSN: "http://mdsn_x@" + strings.TrimPrefix(srv.URL, "http://") + "/monitor/p1"})
	h := c.Recover(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { panic(http.ErrAbortHandler) }))

	defer func() {
		if recover() != http.ErrAbortHandler {
			t.Error("ErrAbortHandler must still propagate untouched")
		}
		if reported {
			t.Error("ErrAbortHandler must never be reported as an error")
		}
	}()
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/", nil))
}
