# Site usage tracking — the design, and one decision that shapes everything else

MH-124. The issue is right that this is a privacy and compliance surface rather than a feature, and
right to demand a design first. The permission surface *is* the product decision here: once the
extension can see which pages someone visits, no amount of careful handling afterwards makes that
untrue.

This document answers the six requirements with decisions, not options, and flags the two places
where the decision is the owner's rather than mine.

> **Not legal advice.** The GDPR reasoning below is why the design is shaped this way. Before this
> ships to anyone employing anyone, it wants twenty minutes from someone who does this for a
> living — that is cheap next to the downside.

---

## The decision that shapes the rest

**Can a workspace admin turn this on for a member?**

**No. Not for someone else, not at all, not even with a nice confirmation dialog.** An admin may
*ask*; only the person at the keyboard can agree, and they can withdraw at any time without asking
anyone.

Three reasons, in the order they should be weighed:

**1. Consent from an employee is not freely given, and the GDPR says so.** The EDPB's opinion on
data processing at work is explicit that an employment relationship makes genuine consent rare:
you cannot meaningfully refuse your employer. An employer wanting to monitor browsing must
therefore lean on legitimate interests, which needs a documented balancing test, a proportionality
argument and a real chance to object — none of which can be delegated to a toggle in our settings
page. A product that lets an admin flip that switch is inviting its customers into a violation and
handing them the tool to commit it.

**2. A tracker the user did not enable and cannot see is spyware, and stores treat it that way.**
Chrome Web Store policy requires prominent disclosure and consent for collecting web-browsing
activity. An extension that starts recording because someone *else* changed a server-side setting
fails that test. The realistic outcome is not a warning; it is removal, taking the timer and issue
filing down with it.

**3. It is not what Mahaam's roles are for.** A workspace role governs work data — projects,
issues, time entries. It has never governed the member's own machine, and this would be the first
time a role reached past the product into someone's browser. That is a line worth not crossing by
accident.

**What an admin gets instead:** a way to *request* it, which appears in the member's extension as a
dismissible prompt naming who asked and what would be shared. Declining is silent — the admin is
told "not enabled", never "declined by Fady at 14:20", because a refusal that is reported is not a
refusal anyone is free to make.

**Owner's call, not mine:** whether to offer the request mechanism at all. It is defensible, and it
is also the feature a customer will lean on hardest. Shipping without it is the safer product.

---

## The six requirements

### 1. Explicit opt-in, off by default

Off. Not pre-checked, not "on for new installs", not enabled by accepting terms.

Turning it on is a two-step: the toggle, then a screen that says in plain language what is
recorded, what leaves the machine and who can see it. That screen is the consent record; the
extension stores its version and timestamp so "what did I agree to" has an answer.

Switching it on requires adding the host permission, so **Chrome asks too** — and that prompt is
not one we control or can style away. That is a feature, not friction.

### 2. Domain allowlist, never blanket capture

Nothing is recorded for a domain that is not on the list, and the list starts **empty**.

- The member adds domains themselves. A workspace can *suggest* a list (`github.com`, `figma.com`,
  the company's own tools); suggestions are not additions.
- Matching is exact-host or one leading wildcard (`*.atlassian.net`). No regexes and no path
  matching: a path pattern is a way to express "record this person reading that document", which is
  a different feature than the one being consented to.
- **Only the registrable domain is ever stored.** Not the path, not the query string, not the page
  title. `github.com`, never `github.com/acme/secret-repo/pull/12`. This is the single most
  important line in the design, because it is what makes a leak boring: the worst case is a list of
  domains someone visited, not a reading history.

### 3. Local-first aggregation; totals, not history

The extension keeps a per-domain, per-day second count in local storage. It does not keep a
timeline, and it cannot reconstruct one afterwards because the timeline is never written.

What is sent, once a day, is one row per domain per day:

```jsonc
{ "date": "2026-09-22", "domain": "github.com", "seconds": 4320 }
```

Two rules that follow from "totals, not history", and are easy to erode later:

- **Never send an event stream.** No "visited at 14:03, left at 14:51". If the server holds
  timestamps it holds a history, whatever the endpoint is called.
- **Round, and drop the tail.** Totals to the nearest minute, and a domain under five minutes in a
  day is discarded rather than sent. A two-second visit is noise to a timesheet and a fact about a
  person's afternoon.

Upload happens on the local day boundary in the workspace timezone, matching how Mahaam already
cuts days. A day already sent is never re-sent.

### 4. A visible indicator, and an easy pause

- The toolbar badge shows a distinct state while tracking is active. Not a subtle tint — if someone
  has to be told their browser is recording, the indicator has failed.
- **Pause** is one click in the popup, with 15 minutes / 1 hour / until tomorrow. Paused means
  paused: nothing is recorded, and the gap is not inferred or backfilled.
- The popup shows today's totals as they accumulate, on the same screen as the pause button. Seeing
  what is being collected, while it is collected, is the honest version of transparency.

### 5. Retention and deletion

| where | kept | deleted |
| --- | --- | --- |
| The browser | 30 days of daily totals | Switching off clears it immediately, and uninstalling takes it with the extension |
| The workspace | 90 days by default, admin-settable **down** only | On request, by the member, without asking an admin |

Two properties worth stating because they are the ones people get wrong:

- **The member can delete their own history at any time**, from the extension, with no admin
  involvement and no notification to anyone. A deletion an admin can veto is not a deletion.
- **An admin cannot raise the retention above 90 days.** Letting them set "forever" turns a
  time-attribution aid into a permanent record of what someone reads.

Leaving the workspace deletes their rows. Not anonymises — deletes.

### 6. Who can see it

The member, always. A manager sees **aggregate project attribution**, not domains: "6h on Project
Atlas", derived from the domain-to-project mapping the member set up. The domain list itself never
leaves the member's own view.

That is the feature's actual purpose — attributing time to projects — and it happens to be
satisfiable without anyone else seeing which sites someone uses. When a design's purpose and its
privacy-preserving form line up this cleanly, that is a sign the invasive version was never
necessary.

---

## What this costs the extension

Today the extension asks for `storage`, `alarms` and `contextMenus`. It has no content scripts and
does not request `tabs` or `activeTab`, which is why its store listing can say plainly that it
cannot read page content — and why the review surface is so small.

This feature needs `tabs` (to know the active tab's URL) and host access for the allowlisted
domains. Both should be **optional permissions, requested at the moment of opt-in and dropped when
it is switched off**, so the default install keeps its current, very defensible shape.

**It also invalidates published copy.** `apps/extension/store/PRIVACY.md` currently states that
site-usage tracking is not in the extension and that if it ships it will be opt-in and disclosed
first. That was written to be true today, and it commits us: shipping this means updating the
privacy policy, the store listing's data-use disclosures, and re-submitting for review. That is
the correct order, and it is a real cost to schedule rather than discover.

## Recommendation

Build it in this order, and stop after step 2 if the value is not obvious:

1. **Local only.** Totals in the browser, visible in the popup, nothing uploaded. This is most of
   the usefulness — "where did my afternoon go" — at almost none of the risk, and it needs no
   server work.
2. **Manual attribution.** The member turns a total into a time entry with one tap. Still nothing
   automatic, still nothing leaving the machine except a time entry they created.
3. **Automatic upload**, as designed above, only if 1 and 2 prove people want it.

A good deal of the time, step 1 is the whole product and the rest is a liability someone assumed
was required.
