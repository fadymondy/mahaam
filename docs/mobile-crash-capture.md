# Native crash capture — what the Mahaam SDKs should and should not do

MH-113. The short version: **do not write signal handlers.** Crashlytics is already the decision
for native crashes (MH-126), and the hard, dangerous part of this problem is precisely the part it
already solves. The Mahaam SDKs should own the layer above it, which is the layer Crashlytics is
worst at and where our issue board is actually useful.

## Why not signal handlers

A native crash on iOS or Android arrives as a signal (`SIGSEGV`, `SIGBUS`, `SIGABRT`) or a Mach
exception. Handling one correctly is a specialist job, not an afternoon:

- A signal handler may only call **async-signal-safe** functions. No `malloc`, no Objective-C
  runtime, no `NSLog`, no JSON encoder, no network. Every buffer must be pre-allocated before the
  crash, and the report written with raw `write(2)`.
- Breaking that rule usually *appears* to work and deadlocks a fraction of the time, because the
  crashing thread already holds the allocator lock. That is the worst possible failure: a crash
  reporter that occasionally hangs the app instead of reporting.
- Only one handler can be last. Chaining with Crashlytics — which installs its own — means
  whoever installs second decides whether the other ever sees the crash. Two reporters fighting
  over `SIGSEGV` loses reports in ways that are miserable to debug.
- Symbolication then needs dSYM and R8/ProGuard mapping upload pipelines, keyed per build, or the
  stack is hex.

None of that gets us a better board. It gets us a second, worse Crashlytics.

## The split

| layer | owner | why |
| --- | --- | --- |
| Native crash (`SIGSEGV`, Mach exception, NDK) | **Crashlytics** | needs async-signal-safe capture and symbol upload; already solved |
| ANR / app hang | **Crashlytics** | needs a watchdog thread and platform hooks |
| Uncaught JS / Dart exception | **Mahaam SDK** | ordinary runtime hook, symbolicated by the bundler's source map |
| Uncaught Java/Kotlin or Swift exception | **Mahaam SDK** | `Thread.setDefaultUncaughtExceptionHandler` / `NSSetUncaughtExceptionHandler` — not a signal handler |
| Handled error the app chose to report | **Mahaam SDK** | the app calls us |
| Failed request, bad state, "this should not happen" | **Mahaam SDK** | never reaches a crash reporter at all |

The last row is the point. Most things worth an issue on the board are **not crashes** — they are
handled failures the app noticed and recovered from. Those never reach Crashlytics, and they are
exactly what a project-management tool should turn into a ticket with an owner.

## What each SDK hooks

**React Native** — `ErrorUtils.setGlobalHandler` for uncaught JS, plus an error boundary the host
app can mount. `isFatal` decides `level`: `fatal` if the app is going down, `error` otherwise.
Source maps are the bundler's; the stack arrives readable already.

**Flutter** — `FlutterError.onError` for framework errors and `PlatformDispatcher.instance.onError`
for uncaught async. Both must be installed, or async gaps are silently dropped. Run the app inside
`runZonedGuarded` to catch what escapes.

**Kotlin (Android)** — `Thread.setDefaultUncaughtExceptionHandler`, **chaining to the previous
handler** rather than replacing it, so Crashlytics still sees the throwable. Write the envelope to
disk, then call the previous handler. Obfuscated stacks are the cost of not owning a mapping
pipeline; note it in the README rather than pretending otherwise.

**Swift (iOS)** — `NSSetUncaughtExceptionHandler` for `NSException` only. Deliberately **no**
`signal()` calls. Swift runtime errors (force-unwrap of nil, array bounds) arrive as `SIGTRAP`/
`SIGILL`, not `NSException`, so they are Crashlytics' to report and the README must say so instead
of implying coverage we do not have.

## Delivery, given the process is about to die

The contract (`docs/mobile-sdk-contract.md`) already says persist before sending. In a terminal
handler that becomes a hard rule:

1. Serialise the envelope and write it to disk **synchronously**. No network at crash time.
2. Return control to the previous handler immediately.
3. On next launch, before anything else, flush the directory.

An envelope that reaches the network at crash time is luck, not design — the socket rarely
completes before the process dies.

## Grouping still has to hold

Per the contract, the server hashes the first non-empty stack line. An obfuscated Android frame
(`a.b.c(SourceFile:1)`) is stable across occurrences, so grouping works even unsymbolicated — the
issue title is just unhelpful. What breaks grouping is a frame carrying an **address or thread
id**, so strip those from the top frame before sending.

## What this means for MH-114 through MH-117

Each SDK becomes a runtime-hook + queue + HTTP client, with no native crash handling. That is a
few hundred lines per platform rather than a specialist project, it cannot deadlock the host app,
and it does not fight Crashlytics for the signal handler.

If native crashes are later wanted on the Mahaam board too, the cheap path is Crashlytics' own
export/webhook into `POST /api/monitor/{project}/envelope` — not a second in-process reporter.
