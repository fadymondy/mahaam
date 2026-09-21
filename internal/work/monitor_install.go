package work

import (
	"context"
	"fmt"
	"strings"

	"github.com/fadymondy/mahaam/internal/authz"
)

/*
Install guides for the Mahaam SDK: backend error monitoring, Sentry-shaped, keyed by
a DSN rather than the widget's public pfk_ key. Same text for the settings page (REST)
and for an agent, mirroring feedback_install.go.

This is the other half of the pair. Feedback is the browser widget and reports what a
human chose to report; this reports what crashed, from the server, with no UI at all.
A project carries one key of each kind and they are not interchangeable.
*/

// MonitorStacks are the install targets, in the order the UI shows them.
var MonitorStacks = []string{"agent", "go", "node", "python", "php"}

// MonitorInstall is every stack's guide for one DSN.
type MonitorInstall struct {
	DSN    string            `json:"dsn"`
	Name   string            `json:"name"`
	Guides map[string]string `json:"guides"`
}

// GetMonitorInstall builds the guides for a project's monitor key: keyRef (id) or,
// when empty, the newest live key. manager+ (feedback_keys:read, same as the widget).
func (sv *Service) GetMonitorInstall(ctx context.Context, projectRef, keyRef string) (*MonitorInstall, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := require(s, authz.FeedbackKeysRead); err != nil {
		return nil, err
	}
	keys, err := sv.ListMonitorKeys(ctx, projectRef)
	if err != nil {
		return nil, err
	}
	keyRef = strings.TrimSpace(keyRef)
	var k *MonitorKey
	for i := range keys {
		c := &keys[i]
		live := c.RevokedAt == nil
		if keyRef == "" && live || keyRef != "" && c.ID == keyRef {
			k = c
			break
		}
	}
	if k == nil {
		if keyRef == "" {
			return nil, invalid("this project has no active monitoring DSN — create one first")
		}
		return nil, notFound("monitor key")
	}
	return &MonitorInstall{DSN: k.DSN, Name: k.Name, Guides: monitorGuides(k.DSN)}, nil
}

func monitorGuides(dsn string) map[string]string {
	env := "MAHAAM_DSN=" + dsn

	g := map[string]string{
		"go": fmt.Sprintf(`go get github.com/fadymondy/mahaam-go

# .env
%s

import mahaam "github.com/fadymondy/mahaam-go"

mon := mahaam.New(mahaam.Config{Environment: "production"}) // reads MAHAAM_DSN
http.ListenAndServe(":8080", mon.Recover(handler))

// Recover reports the panic with its stack, then re-panics so your own recovery
// middleware still runs. For a worker or cron job, use defer mon.LogUnhandled() instead.`, env),

		"node": fmt.Sprintf(`npm i @mahaam/sdk

# .env
%s

import { Monitor, expressErrorHandler, installMonitorHook } from "@mahaam/sdk"

const monitor = new Monitor({ environment: "production" }) // reads MAHAAM_DSN
installMonitorHook(monitor)                // uncaught exceptions + unhandled rejections
app.use(expressErrorHandler(monitor))      // mount LAST, after all routes`, env),

		"python": fmt.Sprintf(`pip install mahaam-sdk

# .env
%s

from mahaam_sdk import configure, install_excepthook
configure()             # reads MAHAAM_DSN
install_excepthook()    # reports uncaught exceptions, then re-raises as before

# Django: MIDDLEWARE += ["mahaam_sdk.MonitorMiddleware"]
# Flask:  from mahaam_sdk import init_app; init_app(app)`, env),

		"php": fmt.Sprintf(`composer require mahaam/sdk

# .env
%s

use Mahaam\Sdk\Facades\Mahaam;

// bootstrap/app.php (Laravel 11/12):
->withExceptions(fn ($e) => $e->report(fn (Throwable $t) => Mahaam::captureException($t)))

// In Laravel 10, register the same callback in App\Exceptions\Handler::register().`, env),
	}

	g["agent"] = fmt.Sprintf(`Add Mahaam error monitoring to this project.

This is the BACKEND SDK: it reports unhandled server-side errors to Mahaam using a DSN.
It is not the feedback widget — that is a separate frontend product with its own key,
and nothing here touches the browser.

1. Detect the stack: Go, Node/Express, Python (Django/Flask), or PHP/Laravel.
2. Add this to .env and to the deploy config. Never commit a real DSN — only the
   example file gets a placeholder:
%s
3. Follow the matching guide below.
4. Verify: trigger a deliberate error (a debug-only route works well) and confirm it
   appears as a new issue on the project's board with source "monitor". Trigger the
   same error again and confirm it bumps that issue's occurrence count rather than
   filing a second one. Then delete the test issue.

An absent or malformed DSN disables the client rather than throwing, so it is safe to
wire in everywhere and simply leave MAHAAM_DSN unset in development.

---- Go ----
%s

---- Node / Express ----
%s

---- Python ----
%s

---- PHP / Laravel ----
%s`, indent(env), g["go"], g["node"], g["python"], g["php"])

	return g
}
