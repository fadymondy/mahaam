# GA4 event taxonomy

MH-128. One schema for the web console, the desktop tray, the mobile apps and the browser
extension, so a number from one can be compared with a number from another.

The issue is right that this comes before instrumenting. A taxonomy retrofitted onto events that
already ship is not a decision, it is a migration — GA4 keeps no history under a renamed event, so
getting it wrong costs you the months you were measuring.

**Nothing here is instrumented yet**, and no GA4 property exists (MH-127). This is the contract
each client implements against.

---

## The rule that outranks the rest

**Customer content never leaves the device.** Not task titles, not project names, not client names,
not issue bodies, not comment text, not file names, not URLs from the extension.

Mahaam holds other companies' work. An analytics pipeline is a third party (Google), a second copy,
and a place that is read by more people with less care than the database. A task title is one of
the most revealing strings a work tool holds — "migrate off <vendor>", "termination letter for
<name>" — and it has no analytical value whatsoever. *How many* tasks someone created is the
useful number; *what they were called* is a liability.

This is not a review checklist item. Any event carrying a free-text field from user content is a
bug, and the review that lets one through has failed.

## What GA4 actually enforces

These are limits, not guidance — exceed them and data is dropped silently, which is worse than an
error because the dashboard still looks plausible.

| limit | value | what happens past it |
| --- | --- | --- |
| Event name | 40 chars, letters/digits/underscores, must start with a letter | event rejected |
| Distinct event names | 500 per property | further names ignored |
| Parameters per event | 25 | extras dropped, silently |
| Parameter name | 40 chars | dropped |
| Parameter value | 100 chars | **truncated**, not rejected |
| Registered custom dimensions | 50 event-scoped | unregistered params are collected but not reportable |

Two consequences worth stating, because they are the ones people get wrong:

- **snake_case, always.** `timer_started`, never `timerStarted` or `Timer Started`. GA4 treats case
  as distinct, so one client shouting produces a second event that looks like a different feature.
- **Never build an event name from data.** `timer_started_MH-42` burns one of 500 names per task
  and reports nothing. The variable part is a parameter.

Avoid GA4's reserved and automatic names — `session_start`, `first_open`, `page_view`,
`user_engagement`, `app_remove`, `purchase`, `login`, `sign_up`. Some are rejected, some silently
merge with GA4's own, which is worse: the number moves and nobody knows why.

## Parameters on every event

Sent with each event so any figure can be split by surface, version and language. That is what
makes the clients *comparable* rather than merely all reporting.

| param | example | why |
| --- | --- | --- |
| `surface` | `web` · `desktop` · `mobile` · `extension` | the single most useful split; register it first |
| `app_version` | `1.4.2 (318)` | so a regression can be tied to a release |
| `os` | `windows` · `macos` · `linux` · `ios` · `android` | |
| `locale` | `en` · `ar` | Arabic is a first-class UI, and its usage should be visible rather than assumed |
| `plan` | `free` · `team` · `unlimited` | behaviour by plan tier, without identifying the workspace |
| `ws_size` | `1` · `2-5` · `6-20` · `21+` | a bucket, never a count — an exact member count plus a plan is close to naming the customer |

**`plan` and `ws_size` are buckets on purpose.** A workspace id is an identifier; "a 3-person team
on the free plan" is a segment. Segments answer product questions; identifiers create obligations.

## Identity: no `user_id`, and a pseudonymous install id instead

**Recommendation: do not send Mahaam's `user_id` to GA4.** Send a random `install_id`, generated on
first launch, stored locally, and regenerated on sign-out.

The cost is real and worth naming: you lose cross-device identity. "Did the person who installed
the desktop app also try mobile" becomes unanswerable, and that is a question a product team
genuinely wants.

Three reasons it is still the right default:

1. **It changes what GA4 is.** With a `user_id` matching Mahaam's own, the analytics property
   becomes a per-person behavioural record of employees at your customers' companies, joinable back
   to your database. That is a different product, with different disclosure and deletion duties, and
   nobody decided to build it.
2. **Deletion becomes a promise you cannot keep.** A customer asking you to delete their data can be
   satisfied in Postgres. GA4 user-deletion is a request with a lag and a scope you do not control.
3. **The questions it answers are few.** Almost every product question is a *segment* question
   (which plan, which surface, which locale), and segments need no identity at all.

If cross-device identity is later judged worth it, it should arrive as its own decision, with the
disclosure updated first — not as a quiet parameter addition.

## The events

Deliberately short. A taxonomy of two hundred events is one nobody reads and everyone adds to; this
is the set that answers activation, retention and adoption, and nothing else earns a slot.

### Activation — does a new person reach the point of value

| event | params | notes |
| --- | --- | --- |
| `app_opened` | *(base)* | first event of a session on any surface |
| `signed_in` | `method`: `password` \| `oauth` | **not** GA4's reserved `login` |
| `workspace_created` | *(base)* | |
| `first_timer_started` | `seconds_since_signup` | the activation moment for a time-tracking product; fire once per install |

### Core loop — the thing the product is for

| event | params | notes |
| --- | --- | --- |
| `timer_started` | `origin`: `manual` \| `task` \| `next_up` \| `shortcut` \| `tray` | `origin` is the whole value; a bare count is not actionable |
| `timer_stopped` | `duration_bucket`: `<5m` \| `5-30m` \| `30m-2h` \| `2h+`, `was_idle_trimmed`: bool | a bucket, not a duration — an exact duration plus a timestamp is a movement record |
| `time_logged_manually` | `origin`: `timesheet` \| `mobile` \| `extension` | |
| `timer_discarded` | *(base)* | a strong signal of an unwanted start |

### Adoption — is a shipped feature used

| event | params |
| --- | --- |
| `issue_filed` | `surface_origin`: `board` \| `extension_page` \| `portal` \| `embed`, `has_screenshot`: bool |
| `issue_moved` | `to_stage` |
| `invoice_drafted` | `from`: `unbilled_time` \| `manual` |
| `report_exported` | `format`: `csv` \| `xlsx` \| `pdf` |
| `pomodoro_completed` | `phase`: `focus` \| `break` |
| `feature_used` | `feature` — the escape hatch for a small feature that does not deserve its own name |

`feature_used` earns its keep by keeping the 500-name budget for things that matter. It is not a
licence to route everything through one event: if a `feature` value is in the top ten for a month,
it should be promoted to a name of its own.

### Health — the things that make people leave

| event | params | notes |
| --- | --- | --- |
| `sync_failed` | `reason`: `offline` \| `auth` \| `server` \| `conflict` | |
| `offline_queue_flushed` | `count_bucket` | |
| `error_shown` | `code` — an application error **code**, never a message | a message can contain customer content; a code cannot |

Crashes are **not** here. Crashlytics owns native crashes and ANRs, and the Mahaam DSN SDK owns
app-level errors (MH-126, and `docs/mobile-crash-capture.md` for why). Duplicating them into GA4
gives a third number that disagrees with both.

## Consent

GA4 does not ship until there is a way to decline it, and declining must actually stop collection
rather than only stop reporting.

- **Off before consent** on every surface. No events buffered "to send once they agree".
- The browser extension has a further constraint: the Chrome Web Store requires prominent
  disclosure for analytics, and `apps/extension/store/PRIVACY.md` currently states the extension has
  **no analytics and no telemetry of any kind**. That is true today and it commits us — adding GA4
  there means updating the policy, the store data-use disclosures, and re-submitting for review.
  That is a schedule cost, not a footnote.

## Review checklist

Before any new event merges:

- [ ] snake_case, under 40 chars, not a GA4 reserved name
- [ ] no name built from data
- [ ] ≤25 params, each name ≤40 chars
- [ ] **no free-text field derived from user content** — titles, names, bodies, URLs, file names
- [ ] durations and counts bucketed, not exact
- [ ] listed in this document in the same commit
