package monitor

import (
	"bytes"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// intake is a fake /api/monitor/{project}/envelope that records what the SDK sends.
type intake struct {
	mu  sync.Mutex
	got []map[string]any
}

func (in *intake) server(t *testing.T) *httptest.Server {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var env map[string]any
		_ = json.NewDecoder(r.Body).Decode(&env)
		in.mu.Lock()
		in.got = append(in.got, env)
		in.mu.Unlock()
		w.WriteHeader(http.StatusAccepted)
	}))
	t.Cleanup(srv.Close)
	return srv
}

func (in *intake) wait(t *testing.T, n int) []map[string]any {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		in.mu.Lock()
		got := append([]map[string]any(nil), in.got...)
		in.mu.Unlock()
		if len(got) >= n {
			return got
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("waited for %d envelope(s)", n)
	return nil
}

func dsn(srv *httptest.Server) string {
	return "http://mdsn_test@" + strings.TrimPrefix(srv.URL, "http://") + "/monitor/proj-1"
}

func TestRecoverReportsAndAnswers500(t *testing.T) {
	in := &intake{}
	srv := in.server(t)
	t.Setenv("MAHAAM_DSN", dsn(srv))
	c := New()
	if !c.Enabled() {
		t.Fatal("the client is not enabled with a DSN set")
	}
	h := Recover(c, nil)(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { panic("boom") }))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/x", nil))

	// Before: the panic reached net/http and the connection was dropped.
	if rec.Code != http.StatusInternalServerError || !strings.Contains(rec.Body.String(), "something went wrong") {
		t.Errorf("a panic answered %d %q, want a 500", rec.Code, rec.Body.String())
	}
	env := in.wait(t, 1)[0]
	if env["public_key"] != "mdsn_test" || !strings.Contains(env["exception_value"].(string), "boom") || env["stacktrace"] == "" {
		t.Errorf("envelope: %v", env)
	}
}

func TestRecoverWithoutDSNStillAnswers500(t *testing.T) {
	t.Setenv("MAHAAM_DSN", "")
	h := Recover(New(), nil)(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { panic("boom") }))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	if rec.Code != http.StatusInternalServerError {
		t.Errorf("no DSN: a panic answered %d, want 500", rec.Code)
	}
}

func TestRecoverLetsAClientHangUpThrough(t *testing.T) {
	t.Setenv("MAHAAM_DSN", "")
	h := Recover(New(), nil)(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { panic(http.ErrAbortHandler) }))
	defer func() {
		if v := recover(); v != http.ErrAbortHandler {
			t.Errorf("ErrAbortHandler was swallowed: %v", v)
		}
	}()
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/", nil))
}

func TestBridge(t *testing.T) {
	in := &intake{}
	srv := in.server(t)
	t.Setenv("MAHAAM_DSN", dsn(srv))
	var buf bytes.Buffer
	log := slog.New(Bridge(slog.NewTextHandler(&buf, nil), New())).With("component", "invoices")

	log.Info("fine") // not an error: not reported
	log.Error("could not send the invoice", "err", errors.New("smtp down"), "invoice", "INV-7")
	log.Error("could not send the invoice", "err", errors.New("smtp down")) // same message, throttled
	log.Error("panic serving request", "path", "/x", monitored, true)       // already reported by Recover

	got := in.wait(t, 1)
	time.Sleep(300 * time.Millisecond)
	in.mu.Lock()
	n := len(in.got)
	in.mu.Unlock()
	if n != 1 {
		t.Fatalf("%d envelopes, want 1 (info skipped, repeat throttled, monitored skipped)", n)
	}
	env := got[0]
	if env["exception_type"] != "could not send the invoice" || env["exception_value"] != "smtp down" || env["fingerprint"] != "log:could not send the invoice" {
		t.Errorf("envelope: %v", env)
	}
	extra, _ := env["extra"].(map[string]any)
	if extra["invoice"] != "INV-7" || extra["component"] != "invoices" {
		t.Errorf("extra: %v", extra)
	}
	// The ordinary log output is untouched.
	if !strings.Contains(buf.String(), "could not send the invoice") || !strings.Contains(buf.String(), "fine") {
		t.Errorf("the wrapped handler lost records: %s", buf.String())
	}
}
