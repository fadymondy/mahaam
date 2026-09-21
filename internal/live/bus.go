package live

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
)

/*
The shared bus that makes the hub correct for more than one API instance.

Fan-out is in-process: an event published on instance A reaches only the streams A is holding.
With two instances behind a balancer, a person's browser connected to B never hears about the timer
they started through A — and it fails silently, because the event was delivered, just not to them.

So every publish is also announced on a Postgres channel, and every instance listens. Postgres is
already a hard dependency and already the thing both instances agree on; adding Redis or NATS to
move a few hundred bytes would be a second piece of infrastructure to run, monitor and lose.

Two things this deliberately does not do:

  - No replay, no ordering guarantee, no delivery guarantee. NOTIFY is fire-and-forget, and that
    matches the hub, which already drops events for a stream 32 behind and relies on the `hello`
    frame to make a client right on reconnect. A bus with stronger promises than the thing it
    feeds would be a false comfort.
  - No cross-instance subscriber registry. Every instance receives every notification and drops
    the ones it has no subscriber for. At Mahaam's scale that is a map lookup per event per
    instance; routing tables would cost more to keep honest than they would save.
*/

// Channel is the Postgres NOTIFY channel every instance listens on.
const Channel = "mahaam_live"

// maxPayload is Postgres's NOTIFY limit (8000 bytes), less room for the channel name and framing.
// An event that does not fit is replaced by a resync marker rather than dropped, so a client on
// another instance still learns that something changed.
const maxPayload = 7500

type busMessage struct {
	// From is the instance that published it. An instance ignores its own messages: it has
	// already delivered them locally, and delivering again would show a duplicate.
	From      string          `json:"f"`
	Workspace string          `json:"w"`
	User      string          `json:"u"`
	Event     string          `json:"e"`
	Data      json.RawMessage `json:"d,omitempty"`
	// Oversize marks a message whose data did not fit. The event name survives; the payload does
	// not, so the client is told to refetch rather than shown a half-event.
	Oversize bool `json:"o,omitempty"`
}

// ResyncEvent is what a remote instance emits in place of an event too large for NOTIFY. A client
// that does not recognise it ignores it, exactly as it ignores any unknown event, and falls back
// to the resync it already does on reconnect.
const ResyncEvent = "resync"

// Bus connects a Hub to the other instances through Postgres LISTEN/NOTIFY.
//
// Nil-safe: a Hub with no Bus is the single-instance behaviour, unchanged.
type Bus struct {
	hub      *Hub
	db       *sql.DB // for NOTIFY; any pooled connection will do
	url      string  // for LISTEN; needs a connection of its own
	instance string
	log      *slog.Logger
	// ready closes the first time LISTEN succeeds. Until then this instance publishes to the
	// others but hears nothing back, so it is worth being able to ask.
	ready     chan struct{}
	readyOnce sync.Once
}

// NewBus wires a hub to the bus. db is used to send (one statement, any pooled connection) and url
// to listen (a dedicated connection, because a listening connection cannot be shared with a pool).
//
// It returns nil when either is missing, which leaves the hub in its single-instance mode rather
// than failing to start — a development machine with no DATABASE_URL should still serve streams.
func NewBus(hub *Hub, db *sql.DB, url string, log *slog.Logger) *Bus {
	if hub == nil || db == nil || url == "" {
		return nil
	}
	if log == nil {
		log = slog.Default()
	}
	return &Bus{hub: hub, db: db, url: url, instance: randomID(), log: log, ready: make(chan struct{})}
}

// Instance is this process's id on the bus. Exposed for tests and for logs.
func (b *Bus) Instance() string {
	if b == nil {
		return ""
	}
	return b.instance
}

// Announce publishes an event to the other instances. It never blocks the caller and never
// returns an error: a realtime event that cannot be announced is a missed update, not a failed
// request, and the client resyncs on its next reconnect.
func (b *Bus) Announce(workspace, user, event string, data any) {
	if b == nil || workspace == "" || user == "" {
		return
	}
	payload, err := b.encode(workspace, user, event, data)
	if err != nil {
		b.log.Debug("live bus: could not encode", "event", event, "err", err)
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if _, err := b.db.ExecContext(ctx, "SELECT pg_notify($1, $2)", Channel, payload); err != nil {
			b.log.Debug("live bus: notify failed", "event", event, "err", err)
		}
	}()
}

func (b *Bus) encode(workspace, user, event string, data any) (string, error) {
	raw, err := json.Marshal(data)
	if err != nil {
		return "", err
	}
	msg := busMessage{From: b.instance, Workspace: workspace, User: user, Event: event, Data: raw}
	out, err := json.Marshal(msg)
	if err != nil {
		return "", err
	}
	if len(out) <= maxPayload {
		return string(out), nil
	}
	// Too big for NOTIFY. Tell the other instances that this person's state moved, without
	// claiming to say how — better than silence, and honest about what was lost.
	small, err := json.Marshal(busMessage{From: b.instance, Workspace: workspace, User: user, Event: event, Oversize: true})
	if err != nil {
		return "", err
	}
	return string(small), nil
}

// Listen receives what other instances announce and delivers it to this one's streams. It runs
// until ctx is cancelled, reconnecting on failure, and is meant to be started once in a goroutine.
func (b *Bus) Listen(ctx context.Context) {
	if b == nil {
		return
	}
	backoff := time.Second
	for {
		if err := b.listenOnce(ctx); err != nil && ctx.Err() == nil {
			b.log.Warn("live bus: listener stopped, retrying", "err", err, "in", backoff)
		}
		if ctx.Err() != nil {
			return
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}
		// A database that is down stays down for a while; backing off to 30s keeps the log
		// readable and the reconnect storm off the server when it comes back.
		if backoff < 30*time.Second {
			backoff *= 2
		}
	}
}

func (b *Bus) listenOnce(ctx context.Context) error {
	conn, err := pgx.Connect(ctx, b.url)
	if err != nil {
		return err
	}
	defer func() {
		closeCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = conn.Close(closeCtx)
	}()

	// The channel name is a constant, so the quoting below is not user input.
	if _, err := conn.Exec(ctx, "LISTEN "+Channel); err != nil {
		return err
	}
	b.log.Info("live bus: listening", "channel", Channel, "instance", b.instance)
	b.readyOnce.Do(func() { close(b.ready) })

	for {
		n, err := conn.WaitForNotification(ctx)
		if err != nil {
			if errors.Is(err, context.Canceled) {
				return nil
			}
			return err
		}
		b.deliver(n.Payload)
	}
}

// deliver hands one announcement to the local hub. Malformed payloads are dropped quietly: the
// channel is ours, so anything unreadable on it is a version skew during a rolling deploy, not
// something to make noise about on every event.
func (b *Bus) deliver(payload string) {
	var msg busMessage
	if json.Unmarshal([]byte(payload), &msg) != nil {
		return
	}
	if msg.From == b.instance {
		return // already delivered locally when it was published
	}
	if msg.Oversize {
		b.hub.deliver(msg.Workspace, msg.User, Frame(ResyncEvent, map[string]string{"reason": "oversize", "event": msg.Event}))
		return
	}
	b.hub.deliver(msg.Workspace, msg.User, rawFrame(msg.Event, msg.Data))
}

func randomID() string {
	var a [8]byte
	if _, err := rand.Read(a[:]); err != nil {
		// Only reachable if the OS entropy source fails. A clock-based id still separates this
		// instance from the others well enough to stop the echo.
		return hex.EncodeToString([]byte(time.Now().Format(time.RFC3339Nano)))[:16]
	}
	return hex.EncodeToString(a[:])
}

// Ready closes once this instance has successfully issued its LISTEN. Before that it can announce
// events to the others but will not hear theirs, which is worth being able to ask about — in a
// health check, and in a test that would otherwise race the listener.
//
// A nil Bus returns a channel that never closes: a hub with no bus is never going to be ready,
// and saying so is better than claiming it is.
func (b *Bus) Ready() <-chan struct{} {
	if b == nil {
		return make(chan struct{})
	}
	return b.ready
}
