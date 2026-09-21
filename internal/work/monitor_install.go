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
var MonitorStacks = []string{"agent", "go", "node", "python", "php", "react-native", "flutter", "kotlin", "swift"}

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

		// The mobile SDKs share the backend wire format but differ in two ways that matter:
		// the DSN is compiled into the binary rather than read from the environment, and
		// delivery has to be durable because a phone is offline far more often than a server.
		// None of them report native crashes — that is Crashlytics' job, and the guides say so
		// rather than implying coverage we do not have.
		"react-native": fmt.Sprintf(`npm i @mahaam/react-native

import { Monitor, installErrorHandler } from "@mahaam/react-native"
import AsyncStorage from "@react-native-async-storage/async-storage"

export const monitor = new Monitor({
  dsn: "%s",
  environment: __DEV__ ? "development" : "production",
  storage: AsyncStorage,            // without it, a failed send is lost
  tags: { os: Platform.OS, os_version: String(Platform.Version) },
})

installErrorHandler(monitor)        // uncaught JS; chains to the red box
void monitor.flush()                // what the last run could not send. Do not await.

// Render errors never reach ErrorUtils — React catches those itself. For those:
// import { MahaamErrorBoundary } from "@mahaam/react-native/boundary"

// Native crashes (SIGSEGV, NDK) are not reported here. Use Crashlytics for those.`, dsn),

		"flutter": fmt.Sprintf(`# pubspec.yaml
dependencies:
  mahaam: ^0.1.0

import 'package:mahaam/mahaam.dart';

late final Monitor monitor;

void main() => runGuarded(monitor, () async {
      WidgetsFlutterBinding.ensureInitialized();   // must be INSIDE the zone
      final dir = await getApplicationSupportDirectory();
      monitor = Monitor(
        dsn: '%s',
        environment: kReleaseMode ? 'production' : 'development',
        store: FileEnvelopeStore('${dir.path}/mahaam-queue.ndjson'),
      );
      installErrorHandlers(monitor);   // framework errors + uncaught async
      unawaited(monitor.flush());      // never block app start on the network
      runApp(const MyApp());
    });

// All three hooks are needed: install only FlutterError.onError and a failed Future
// with no catchError is dropped silently.
// Native crashes and ANRs are not reported here. Use Crashlytics for those.`, dsn),

		"kotlin": fmt.Sprintf(`// build.gradle.kts
implementation("app.mahaam:mahaam-sdk:0.1.0")

// Application.onCreate()
val monitor = Monitor(
    dsn = "%s",
    environment = if (BuildConfig.DEBUG) "development" else "production",
    release = BuildConfig.VERSION_NAME,
    device = Build.MODEL,
    store = FileEnvelopeStore(File(filesDir, "mahaam-queue.ndjson")),
    tags = mapOf("os" to "android", "os_version" to Build.VERSION.RELEASE),
)

installUncaughtExceptionHandler(monitor)   // chains to Crashlytics, does not replace it
Thread { monitor.flush() }.start()         // off the main thread

// R8 obfuscates stack frames and this SDK uploads no mapping file, so titles may read
// a.b.c(SourceFile). Grouping still works; retrace with that build's mapping.
// Native crashes and ANRs are not reported here. Use Crashlytics for those.`, dsn),

		"swift": fmt.Sprintf(`// Package.swift
.package(url: "https://github.com/fadymondy/mahaam-swift.git", from: "0.1.0")

import Mahaam

let monitor = Monitor(
    dsn: "%s",
    environment: "production",
    device: UIDevice.current.model,
    store: FileEnvelopeStore(url: supportDir.appendingPathComponent("mahaam-queue.ndjson"))
)

installUncaughtExceptionHandler(monitor)   // chains to Crashlytics
monitor.flushInBackground()

// Handled errors carry no stack of their own, so pass one:
// monitor.capture(error: error, callStack: Thread.callStackSymbols)

// READ THIS: NSSetUncaughtExceptionHandler catches NSException and nothing else.
// Force-unwrapping nil, an out-of-bounds index and SIGSEGV arrive as signals, not
// exceptions, and are NOT reported here. In a pure-Swift app that is most crashes.
// Use Crashlytics for those.`, dsn),
	}

	g["agent"] = fmt.Sprintf(`Add Mahaam error monitoring to this project.

This is the MONITORING SDK: it reports unhandled errors to Mahaam using a DSN. It is
not the feedback widget — that is a separate frontend product with its own key, and
nothing here collects anything a person chose to send.

1. Detect the stack: Go, Node/Express, Python (Django/Flask), PHP/Laravel, or a mobile
   app (React Native, Flutter, Kotlin/Android, Swift/iOS).
2. On a server, add this to .env and to the deploy config. Never commit a real DSN —
   only the example file gets a placeholder:
%s
   In a mobile app there is no .env: the DSN is compiled in, so read it from the build
   config (BuildConfig, Info.plist, --dart-define, EXPO_PUBLIC_*) rather than pasting
   it into a source file that ships to a store.
3. Follow the matching guide below.
4. Verify: trigger a deliberate error (a debug-only route works well) and confirm it
   appears as a new issue on the project's board with source "monitor". Trigger the
   same error again and confirm it bumps that issue's occurrence count rather than
   filing a second one. Then delete the test issue.

An absent or malformed DSN disables the client rather than throwing, so it is safe to
wire in everywhere and simply leave it unset in development.

On mobile, two things differ from a server. Delivery must be durable — a phone is
offline far more often, and a report held only in memory dies with the process — so
always pass the SDK a store. And none of the mobile SDKs report native crashes: that
is Crashlytics' job, and installing a second signal handler to compete with it loses
reports for both. Do not promise coverage the SDK does not have.

---- Go ----
%s

---- Node / Express ----
%s

---- Python ----
%s

---- PHP / Laravel ----
%s

---- React Native ----
%s

---- Flutter ----
%s

---- Kotlin / Android ----
%s

---- Swift / iOS ----
%s`, indent(env), g["go"], g["node"], g["python"], g["php"],
		g["react-native"], g["flutter"], g["kotlin"], g["swift"])

	return g
}
