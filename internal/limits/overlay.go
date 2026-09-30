package limits

import (
	"context"
	"net/http"
	"sync"
)

/*
An overlay lets an outside entitlement source rewrite a workspace's Effective limits after the plan
and overrides are merged. The CircleXO integration (internal/circlexo) uses it: for a workspace
linked to a hub org, `projects`, `members` and the customer portal come from the hub, and every
other key keeps the workspace's Mahaam plan. Unlinked workspaces pass through untouched. With no
overlay registered (the default) this file changes nothing.
*/

// Overlay adjusts e in place for workspace ws. It returns an error only when it cannot tell whether
// ws is governed at all (a database failure); an unreachable hub is not an error, it is expressed
// on e (fail closed: limits 0, features off, ReadOnly).
type Overlay func(ctx context.Context, ws string, e *Effective) error

var (
	overlayMu sync.RWMutex
	overlay   Overlay
)

// SetOverlay installs (or, with nil, removes) the overlay and drops every cached plan.
func SetOverlay(o Overlay) {
	overlayMu.Lock()
	overlay = o
	overlayMu.Unlock()
	Invalidate("")
}

func applyOverlay(ctx context.Context, ws string, e *Effective) error {
	overlayMu.RLock()
	o := overlay
	overlayMu.RUnlock()
	if o == nil {
		return nil
	}
	return o(ctx, ws, e)
}

// HubGoverned reports whether a hub overlay decides limit key: a read-only workspace refuses adds
// of exactly these.
func HubGoverned(key string) bool { return key == Members || key == Projects }

func readOnlyError(e *Effective, key string) *Exceeded {
	d, _ := DefOf(key)
	noun := d.Noun
	if noun == "" {
		noun = key
	}
	return &Exceeded{Status: http.StatusPaymentRequired, Code: "plan_read_only", Key: key,
		Msg: "Your CircleXO entitlements could not be confirmed, so this workspace is read-only for now — adding " + noun + " is paused until they can be"}
}
