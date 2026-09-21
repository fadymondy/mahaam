# Mahaam SDK — the wire contract

One spec, four implementations. React Native, Flutter, Kotlin and Swift each ship their own SDK,
and they must all produce the same envelope, or the same crash reported from two platforms becomes
two different issues on the board.

This describes what the server already accepts — `internal/reports/monitor.go` is the authority,
and everything below was read from it rather than designed fresh. The Go, Node, Python and PHP
SDKs already speak it.

## DSN

```
https://<public_key>@<host>/monitor/<project_id>
```

`public_key` is `mdsn_` + hex, minted in a project's **Settings → Monitoring**. The SDK parses the
DSN into an ingest URL:

```
POST {scheme}://{host}/api/monitor/{project_id}/envelope
Content-Type: application/json
```

Three rules every existing SDK follows, and the mobile ones must too:

1. **A missing or malformed DSN disables the client — it never throws.** Wiring monitoring in must
   not be the reason an app fails to start, and leaving `MAHAAM_DSN` unset in development is the
   normal case.
2. **The path may or may not carry the `monitor/` prefix.** Strip it if present, so both
   `…/monitor/<id>` and `…/<id>` resolve to the same project.
3. **No auth header.** The public key travels in the body, not in `Authorization`.

## Envelope

```jsonc
{
  "public_key":      "mdsn_…",   // required; the only credential
  "level":           "error",     // fatal | error | warning | info | debug — blank means error
  "message":         "…",         // for a log-style event with no exception
  "exception_type":  "TypeError",
  "exception_value": "x is not a function",
  "stacktrace":      "…",         // pre-formatted text, newline separated, most recent frame first
  "environment":     "production",
  "release":         "1.4.2",
  "server_name":     "…",         // on mobile: the device model (see below)
  "fingerprint":     "",          // optional override; omit to let the server group
  "tags":            { "…": "…" },// string → string
  "extra":           { "…": … }   // free-form JSON
}
```

`stacktrace` is **text the SDK has already formatted**, not structured frames. The server does no
symbolication and no parsing beyond taking the first non-empty line (see grouping). That is the
single most important thing for the mobile SDKs to get right, because it means **symbolication is
the SDK's job**, not the server's.

## Grouping — why the first stack line matters

The server groups by a fingerprint it computes itself:

```
sha256( project_id + "|" + exception_type + "|" + (first non-empty stacktrace line || message) )[:16]
```

A repeated fault within **14 days** does not file a new issue: it bumps `occurrence_count` and
`last_seen_at` on the existing open one.

Two consequences the mobile SDKs must respect:

- **The first line of `stacktrace` must be stable across occurrences of the same fault.** If it
  carries a memory address, a timestamp or a thread id, every crash becomes a new issue and the
  board fills with duplicates. Strip anything varying from the top frame.
- **Unsymbolicated frames still group**, they just group unhelpfully. If symbolication happens on
  a later launch (see below), the fingerprint changes and the same crash splits into two issues.
  Either symbolicate before the first send, or pass an explicit `fingerprint` that does not depend
  on symbol names.

`level` maps to issue priority: `fatal` → highest, `error` → high, `warning` → medium, anything
else → low.

## What mobile adds

`server_name` is the device identifier on mobile — model, not hostname. Everything else specific
to a phone goes in `tags`, so it is filterable, with longer values in `extra`:

| tag | example | why |
| --- | --- | --- |
| `os` | `ios` / `android` | the first split anyone wants |
| `os_version` | `17.4` | a crash confined to one OS version |
| `app_version` | `1.4.2 (318)` | `release` carries the marketing version; the build is what identifies a binary |
| `device` | `iPhone14,3` | model identifier, not the marketing name |
| `network` | `wifi` / `cellular` / `none` | distinguishes a real fault from an offline one |

Do **not** put a user identifier, an email or a location in `tags` or `extra` unless the host app
opts in. These are crash reports from someone's phone.

## Offline and delivery

A phone is offline far more often than a server, so unlike the backend SDKs delivery must be
durable:

- **Persist the envelope before attempting to send**, and send on next launch if the attempt fails.
  A crash report that only exists in memory is lost by definition — the process is about to die.
- **Cap the on-disk queue** (a few hundred envelopes) and drop oldest-first. An app that crashes in
  a loop offline must not fill the device.
- **Never block app start** on flushing the queue.
- The ingest endpoint is rate limited to **60 requests per minute per IP**. Batch or back off; do
  not replay a hundred queued envelopes at once.

## Errors

| status | meaning | what the SDK should do |
| --- | --- | --- |
| 201 | accepted | drop the envelope from the queue |
| 403 | unknown, revoked, or wrong-project key | stop sending and disable; retrying cannot help |
| 429 | rate limited | back off, keep the envelope |
| 5xx / network | transient | keep the envelope, retry later |

403 is deliberately indistinguishable between *unknown*, *revoked* and *belongs to another
project* — the endpoint is public, and telling a caller which one it was would let them probe for
valid keys.

## Feedback is a different product

The Feedback widget (`pfk_` key, `POST /api/feedback/embed`) is not this. It reports what a person
chose to report, with a screenshot they approved. This reports what crashed. A project holds one
key of each kind and they are not interchangeable — see MH-118 for the mobile feedback reporter.
