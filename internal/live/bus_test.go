package live

import (
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"strings"
	"testing"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
)

/*
Two hubs, one database — which is what two API instances behind a balancer actually are.

The bug this guards against is quiet by nature: with in-process fan-out the event IS delivered,
just to the streams the publishing instance happens to hold. A person connected to the other
instance sees nothing and gets no error, and neither does the server. So every test here checks
what arrives at the *other* hub.

	TEST_DATABASE_URL=… go test -count=1 ./internal/live/ -v
*/

func dsn(t *testing.T) string {
	t.Helper()
	url := strings.TrimSpace(os.Getenv("TEST_DATABASE_URL"))
	if url == "" {
		t.Skip("set TEST_DATABASE_URL to exercise the cross-instance bus")
	}
	return url
}

// instance stands in for one API process: a hub, its bus, and a listener.
type instance struct {
	hub *Hub
	bus *Bus
	db  *sql.DB
}

func newInstance(t *testing.T, ctx context.Context, url string) *instance {
	t.Helper()
	db, err := sql.Open("pgx", url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	hub := New()
	bus := NewBus(hub, db, url, discardLogger())
	if bus == nil {
		t.Fatal("NewBus returned nil with a database and a URL")
	}
	hub.UseBus(bus)
	go bus.Listen(ctx)
	return &instance{hub: hub, bus: bus, db: db}
}

// waitListening blocks until the instance has issued its LISTEN. Publishing before that is a
// race the bus cannot win, and blaming it for the loss would be unfair.
func waitListening(t *testing.T, in *instance) {
	t.Helper()
	select {
	case <-in.bus.Ready():
	case <-time.After(15 * time.Second):
		t.Fatal("the bus never started listening")
	}
}

type frame struct {
	event string
	data  map[string]any
}

// next reads one frame, failing rather than hanging if nothing arrives.
func next(t *testing.T, ch <-chan []byte, within time.Duration) (frame, bool) {
	t.Helper()
	select {
	case b := <-ch:
		return parse(t, b), true
	case <-time.After(within):
		return frame{}, false
	}
}

func parse(t *testing.T, b []byte) frame {
	t.Helper()
	var f frame
	for _, line := range strings.Split(strings.TrimSpace(string(b)), "\n") {
		switch {
		case strings.HasPrefix(line, "event: "):
			f.event = strings.TrimPrefix(line, "event: ")
		case strings.HasPrefix(line, "data: "):
			_ = json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &f.data)
		}
	}
	return f
}

func TestAnEventReachesAStreamOnAnotherInstance(t *testing.T) {
	url := dsn(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	a := newInstance(t, ctx, url)
	b := newInstance(t, ctx, url)
	waitListening(t, b)

	// The person's browser is connected to instance B.
	ch, closeB := b.hub.Subscribe("ws1", "user1")
	defer closeB()

	// Their timer is started through instance A.
	a.hub.Publish("ws1", "user1", "timer.started", map[string]any{"id": "entry-1"})

	f, ok := next(t, ch, 10*time.Second)
	if !ok {
		t.Fatal("nothing reached the stream on the other instance — this is the bug: no error, no event")
	}
	if f.event != "timer.started" || f.data["id"] != "entry-1" {
		t.Errorf("got %q %v", f.event, f.data)
	}
}

func TestThePublishingInstanceDoesNotDeliverTwice(t *testing.T) {
	url := dsn(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	a := newInstance(t, ctx, url)
	waitListening(t, a)

	ch, closeA := a.hub.Subscribe("ws2", "user2")
	defer closeA()

	a.hub.Publish("ws2", "user2", "timer.stopped", map[string]any{"id": "entry-2"})

	if f, ok := next(t, ch, 5*time.Second); !ok || f.event != "timer.stopped" {
		t.Fatalf("local delivery: %v %q", ok, f.event)
	}
	// Its own NOTIFY comes back to it. Delivering that as well would show the user the same
	// event twice — a timer that stops, then stops again.
	if f, ok := next(t, ch, 2*time.Second); ok {
		t.Errorf("the publishing instance delivered its own announcement a second time: %q", f.event)
	}
}

func TestAnEventForSomeoneElseIsNotDelivered(t *testing.T) {
	url := dsn(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	a := newInstance(t, ctx, url)
	b := newInstance(t, ctx, url)
	waitListening(t, b)

	ch, closeB := b.hub.Subscribe("ws3", "user3")
	defer closeB()

	// Every instance receives every announcement, so the filtering has to hold on the receiving
	// side. Getting this wrong would leak one person's timer to another across the bus — exactly
	// what this package exists to prevent.
	a.hub.Publish("ws3", "someone-else", "timer.started", map[string]any{"id": "x"})
	a.hub.Publish("other-ws", "user3", "timer.started", map[string]any{"id": "y"})

	if f, ok := next(t, ch, 2*time.Second); ok {
		t.Errorf("received an event addressed to someone else: %q %v", f.event, f.data)
	}
}

func TestAnOversizeEventBecomesAResync(t *testing.T) {
	url := dsn(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	a := newInstance(t, ctx, url)
	b := newInstance(t, ctx, url)
	waitListening(t, b)

	ch, closeB := b.hub.Subscribe("ws4", "user4")
	defer closeB()

	// Postgres NOTIFY caps a payload at 8000 bytes. Dropping the event would leave the other
	// instance's client silently stale; a resync marker at least tells it to refetch.
	a.hub.Publish("ws4", "user4", "inbox.changed", map[string]any{"blob": strings.Repeat("x", 9000)})

	f, ok := next(t, ch, 10*time.Second)
	if !ok {
		t.Fatal("an oversize event produced nothing at all")
	}
	if f.event != ResyncEvent {
		t.Fatalf("got %q, want %q", f.event, ResyncEvent)
	}
	if f.data["event"] != "inbox.changed" {
		t.Errorf("the resync does not say what was lost: %v", f.data)
	}
}

func TestAHubWithoutABusStillWorks(t *testing.T) {
	// A development machine with no DATABASE_URL must still serve streams. One instance is
	// correct without a bus; that is the whole reason NewBus returns nil rather than failing.
	if NewBus(New(), nil, "postgres://ignored", nil) != nil {
		t.Error("NewBus built a bus with no database")
	}
	if NewBus(New(), &sql.DB{}, "", nil) != nil {
		t.Error("NewBus built a bus with no URL")
	}

	hub := New()
	ch, done := hub.Subscribe("ws", "user")
	defer done()
	hub.Publish("ws", "user", "timer.started", map[string]any{"id": "1"})
	if f, ok := next(t, ch, time.Second); !ok || f.event != "timer.started" {
		t.Errorf("a hub with no bus stopped delivering locally: %v %q", ok, f.event)
	}
}

func TestInstanceIDsDiffer(t *testing.T) {
	// Two instances sharing an id would each ignore the other's events as their own, which is the
	// in-process bug again with extra steps.
	db := &sql.DB{}
	a := NewBus(New(), db, "postgres://x", nil)
	b := NewBus(New(), db, "postgres://x", nil)
	if a.Instance() == "" || a.Instance() == b.Instance() {
		t.Errorf("instance ids: %q and %q", a.Instance(), b.Instance())
	}
}

// discardLogger keeps the bus's reconnect chatter out of the test output.
func discardLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}
