// Package live is Managy's realtime channel: one stream per person per workspace.
//
// Why not togo realtime: its SSE broker (togo-framework/realtime) sends every event to every
// connected client, and realtime-ws authenticates a connection with a ticket that is not bound to a
// user, after which the client may subscribe to ANY "private-" channel by name — another user's
// included. Neither can carry a person's timer without leaking it across people and tenants.
//
// Here the client never names a channel. The stream is GET /api/w/events, behind the same guard as
// every workspace route (session + active membership of X-Workspace-ID), and the channel is taken
// from that resolved tenant.Scope: a connection can only ever receive its own person's events in
// its own workspace. The scaffold's global /events stays unmounted.
//
// Fan-out is in-process: correct for one API instance. Several instances behind one balancer need a
// shared bus (Postgres LISTEN/NOTIFY) first.
package live

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/fadymondy/managy/internal/tenant"
)

type key struct{ workspace, user string }

// Hub fans events out to the open streams of one person in one workspace.
type Hub struct {
	mu   sync.RWMutex
	subs map[key]map[chan []byte]struct{}
}

// New returns an empty hub.
func New() *Hub { return &Hub{subs: map[key]map[chan []byte]struct{}{}} }

// Subscribe opens a stream for (workspace, user). Call the returned func to close it.
func (h *Hub) Subscribe(workspace, user string) (<-chan []byte, func()) {
	ch := make(chan []byte, 32)
	k := key{workspace, user}
	h.mu.Lock()
	if h.subs[k] == nil {
		h.subs[k] = map[chan []byte]struct{}{}
	}
	h.subs[k][ch] = struct{}{}
	h.mu.Unlock()
	var once sync.Once
	return ch, func() {
		once.Do(func() {
			h.mu.Lock()
			delete(h.subs[k], ch)
			if len(h.subs[k]) == 0 {
				delete(h.subs, k)
			}
			h.mu.Unlock()
		})
	}
}

// Publish sends an event to every open stream of one person in one workspace. It never blocks: a
// stream 32 events behind drops the event, and the client resyncs from the "hello" state it gets
// on reconnect.
func (h *Hub) Publish(workspace, user, event string, data any) {
	if h == nil || workspace == "" || user == "" {
		return
	}
	frame := Frame(event, data)
	h.mu.RLock()
	defer h.mu.RUnlock()
	for ch := range h.subs[key{workspace, user}] {
		select {
		case ch <- frame:
		default:
		}
	}
}

// Subscribers counts the open streams of one person in one workspace.
func (h *Hub) Subscribers(workspace, user string) int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.subs[key{workspace, user}])
}

// Frame renders one server-sent event.
func Frame(event string, data any) []byte {
	b, err := json.Marshal(data)
	if err != nil {
		b = []byte("null")
	}
	return []byte("event: " + event + "\ndata: " + string(b) + "\n\n")
}

// Handler serves the stream for the tenant.Scope the guard resolved. hello, if set, is sent first —
// the current state — so a client that reconnects after missing events is right immediately.
func (h *Hub) Handler(hello func(ctx context.Context) (string, any)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		s, ok := tenant.From(r.Context())
		if !ok || s.WorkspaceID == "" || s.UserID == "" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"error":"workspace not found"}`))
			return
		}
		rc := http.NewResponseController(w)
		_ = rc.SetWriteDeadline(time.Time{}) // a stream outlives the server's write timeout
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache, no-transform")
		w.Header().Set("X-Accel-Buffering", "no") // nginx (NPM) must not buffer it
		w.WriteHeader(http.StatusOK)

		ch, cancel := h.Subscribe(s.WorkspaceID, s.UserID)
		defer cancel()
		write := func(b []byte) bool {
			if _, err := w.Write(b); err != nil {
				return false
			}
			return rc.Flush() == nil
		}
		if !write([]byte("retry: 3000\n\n")) {
			return
		}
		if hello != nil {
			if ev, data := hello(r.Context()); ev != "" && !write(Frame(ev, data)) {
				return
			}
		}
		ping := time.NewTicker(25 * time.Second)
		defer ping.Stop()
		for {
			select {
			case <-r.Context().Done():
				return
			case b := <-ch:
				if !write(b) {
					return
				}
			case <-ping.C:
				if !write([]byte(": ping\n\n")) {
					return
				}
			}
		}
	}
}
