# Mahaam — architecture and engineering notes

The long-form engineering notebook for Mahaam: what each phase built, how tenancy and
authorization work, the MCP surface, and the gotchas found along the way. For the overview and
quick start see the [README](../README.md).

- **Product home:** https://mahaam.app
- **App / console:** https://console.mahaam.app (login, REST `/api`, GraphQL, MCP `/api/mcp`,
  the widget at `/embed/v1.js`).
- **Stack:** [ToGO](https://github.com/togo-framework) (Go: chi + Huma + gqlgen + sqlc + Postgres
  with RLS) and Next.js 16. Clients in `apps/`: an Electron tray app, a Chrome extension and the
  Expo mobile apps (Mahaam Team, Mahaam Client). SDKs in `sdk/`.

Built so far:

| Phase | What |
|---|---|
| P0 | Tenancy, RLS, user + admin MCP, feedback intake |
| P1 | Clients, projects, teams, statuses, tasks (board/list), checklists, labels, comments, attachments, activity |
| P2 | Timer, timesheets, rates, realtime sync, reminders |
| P3 / P5 | MCP rate limits and report tools; reports, budgets, profitability, exports, saved views, notifications, email + digest |
| P6 / P7 | Invoices from time; client portal and the embeddable widget |
| P8 | Feedback SDK + issue tracker + `/issues` agent loop, GitHub / Jira / Linear, project vault, customer import + PDF/Markdown reports, customer portal with requests, label/team/task access, AI usage + subscriptions on invoices, employee KPIs, native clients |

**History.** A rebuild of `fadymondy/3x1projects`,
renamed iManage → Managy (2026-09-14) → **Mahaam** (2026-09-19). Renamed everywhere: the repo
(`fadymondy/mahaam`), the Go module, databases and roles (`mahaam`, `mahaam_app`), containers,
SDK packages (`@mahaam/feedback`, `mahaam/feedback`, `mahaam-feedback`), token prefixes (new
`mhm_` / `mha_`; old `mgy_` / `mga_` still accepted) and issue keys (new `MH-n`; old `MG-n` still
resolve). Kept on purpose: `MANAGY_*` env vars as fallbacks for `MAHAAM_*` (production's sealing key
is `MANAGY_SECRET_KEY` — never change it without rotation), scheduler job names, the secretbox
key-derivation constants, and old-name aliases in the SDKs and widget (`window.ManagyFeedback`, …).

## Ports (local dev)

| What | Port |
|---|---|
| API (Go) | **8110** — REST `/api`, GraphQL `/graphql`, docs `/docs`, MCP `/api/mcp`, admin MCP `/api/admin/mcp` |
| Web (Next dev) | **3010** — proxies `/api/*` and `/graphql` to 8110 |
| Postgres (docker compose, container `mahaam-postgres`) | **55460** — databases `mahaam`, `mahaam_test` |

## Run it

```bash
cp .env.example .env           # set the mahaam_app password and AUTH_SECRET
make db                        # Postgres on :55460
make migrate                   # schema, app role, FKs, RLS (idempotent)
make api                       # :8110
make web                       # :3010  (first time: cd web && npm install)
```

Open http://localhost:3010 → register → create a workspace.

### Running the web app against a remote API

For UI-only work you can point the Next dev server at any deployed Mahaam API instead of a local
one: `API_ORIGIN=https://your-mahaam-host npm run dev`. `cmd/api` never migrates (migrations are
`cmd/migrate`), and boot refuses to start if the app role can bypass RLS, so tenancy still holds.
Extra dev hostnames must be listed in `allowedDevOrigins` (`web/next.config.mjs`), otherwise
Next 16 serves the page but never hydrates.

Admin MCP bootstrap (after registering in the UI):

```bash
go run ./cmd/mahaam-admin promote you@example.com
go run ./cmd/mahaam-admin token you@example.com -name "claude" -scopes admin:issues:read,admin:issues:write
```

User MCP tokens are minted in the app: Workspace → MCP tokens.

## Tests

```bash
make test       # unit + CI guards: every MCP tool has a scope; every sqlc query on a
                # tenant table carries workspace_id = $n; authz matrix; slugs
make test-e2e   # boots the real stack on mahaam_test: the route sweep, TestTimeTracking, TestReports, TestMCPSession; sweeps EVERY route as
                # anonymous / non-member / other-workspace member (+ MCP checks)
make grid-check # apps/mobile grid + feedback-sdk copies match fadymondy.com-v2
```

## P1 — projects and tasks

- **One domain layer**, `internal/work`: REST under `/api/w/*` (`routes.go`) and the MCP tools
  call the same functions, so a browser and an agent share one authorization path.
- **Visibility** (`work.visibleClause`): managers+ see every project; members see
  `visibility = workspace` projects plus the ones they belong to; clients only the ones they
  belong to. Belonging = a `project_members` row or a team attached via `project_teams`.
  A project you cannot see answers **404**. Managers, or the project's lead, change a project;
  task writes need `member` and a non-archived project.
- **Generated CRUD** for the P1 tables is read-only and manager+ (`authz.Generated`); every
  write goes through `/api/w/*`, which validates references and records activity.
- **Integrity in the database**: every reference between tenant rows is a composite foreign key
  on `(workspace_id, ref)` (`internal/db/post/11_p1_constraints.sql`), so no row can point into
  another workspace whatever the code does. RLS covers every P1 table (`21_rls_p1.sql`).
- **Activity** (`activity_logs`): written by Mahaam in the transaction of the change; the actor
  is the session user or the MCP token's user (`actor_via = mcp`, token id recorded), the IP is
  `RemoteAddr`. Never togo `audit`, which takes the causer from `X-User-Id`. Append-only (RLS has
  SELECT + INSERT policies only).
- **Keys**: `MG-n` from `key_counters`, one sequence per workspace shared by tasks and reports.
- **Board order**: fractional positions per column; a drop calls
  `POST /api/w/tasks/{key}/move {status, index}` and the column is renumbered in the same
  transaction when a gap runs out.
- **Attachments**: togo storage at `attachments/<workspace>/<id>`, served only through the
  authorised download (`Content-Disposition: attachment`, `nosniff`, sandbox CSP), 25 MB max.
- **UI**: `/[locale]/w/{slug}/projects` (list), `/projects/{id}` Overview · Board · List ·
  Settings, the task side-over on `?task=MG-12`, `/clients`, `/teams`, `/settings/labels`.
  The board is `@shadcnspace/kanban-application-01` (dnd-kit) adapted; attachments use
  `@shadcnspace/file-upload-02` (react-dropzone). P1 strings live in `web/lang/work.{en,ar}.json`;
  user colours are palette keys mapped to `app/styles/mahaam-palette.css`.

Browser check (headless Chrome, fresh profile; counts animation frames first): with the API and
web running, `cd web && node e2e/p1-verify.mjs` — drag-and-drop persists across reload, the
Claude-style MCP flow lands on the board, the side-over's checklist / @mention / upload /
activity work, and board + side-over are screenshotted in en/ar × light/dark (`web/e2e/shots/`).

## P2 — time tracking

- **Invariants in Postgres** (`internal/db/schema/time_entry.sql`, `internal/db/post/12_p2_constraints.sql`):
  `one_running_timer` (unique partial index on `(workspace_id, user_id) WHERE ended_at IS NULL AND source <> 'mcp'`),
  `one_running_agent_timer_per_task` (`(workspace_id, user_id, task_id) WHERE ended_at IS NULL AND source = 'mcp'`),
  `no_overlap` (gist exclusion, btree_gist, `WHERE (source <> 'mcp')`; these three live in
  `internal/db/post/19p_parallel_agent_timers.sql`, which upgrades an existing database in place), `duration_s` GENERATED, `source` timer|manual|mcp|import,
  `invoice_id` / `locked_at` reserved (a set value makes the entry immutable). Deviations from the plan:
  `no_overlap` also keys on `workspace_id` (a cross-tenant constraint leaks another workspace's rows and
  contradicts the per-workspace running index); `user_id` references `users`, not `workspace_members`
  (removing a member deletes the membership row — a composite key would cascade billing history away or
  block the removal; membership is checked on every write instead). The task reference is
  `(workspace_id, project_id, task_id)`, so a task always belongs to the entry's project.
- **Parallel agent timers.** Agents act through the user's own `mgy_` token, so their entries are `source='mcp'`.
  Those may run in parallel: at most one per `(workspace, user, task)`, and they may overlap the human timer and
  each other (reports sum them; that overlap is accepted). Human timers (`timer`/`manual`/`import`) keep the old
  rules: one running per person, no overlap among themselves. The kinds never touch each other: a human start
  stops only the human timer, an agent start stops nothing. MCP `start_timer` **requires a task** (a project-only
  timer would have nothing to be idempotent on, so it is refused) and, on a task whose agent timer already runs,
  returns that timer (`already_running`) instead of erroring. `stop_timer` takes `task` or `entry`; with neither,
  a lone agent timer stops, several give an error that lists them, none falls back to the human timer.
  `GET /api/w/time/running` returns `{timer, agents[]}` (`timer` is the human one, as before); MCP
  `get_running_timer` and `whoami` list all. Realtime: `timer.state` carries `running` (human) plus `agents`;
  `timer.started`/`timer.stopped` carry the entry (id, source); the lock-screen timer follows the human timer
  only. The header shows the human timer plus an "N agent timers running" chip. Long-running reminders raise one
  notification per person per day for all agent timers together, not one per timer.
- **A human start stops the running human timer in the same transaction**, serialised per person by
  `pg_advisory_xact_lock` with the clock read after the lock — concurrent starts queue; the index is the
  backstop. Stop is own-only; `time:manage` (manager+) reaches members' timers.
- **Rates are snapshotted** on the entry when it is created: bill task → project → member → workspace
  default; cost member → workspace default (`internal/work/time.go`, `resolveRates`). `member_rates` are
  effective-dated rate cards; editing one never changes an entry already logged. Managers read rates,
  admins set them; members never see rates on entries.
- **Days are cut at local midnight** of the workspace timezone (calendar days, DST-safe; `time/tzdata`
  embedded). `week_start` and `rounding_minutes` are applied at report time only.
- **Realtime**: `internal/live`, `GET /api/w/events` (SSE) behind the guard — one stream per person per
  workspace, the channel taken from the session, never named by the client. Events: `timer.state`
  (sent first), `timer.started`, `timer.stopped`, `entry.changed`, `notification.*`. togo realtime is not
  used: its SSE broker broadcasts to every client, and realtime-ws lets any ticket holder subscribe to any
  `private-` channel by name.
  Fan-out is in-process, and `internal/live/bus.go` carries events between API instances over a
  Postgres `LISTEN/NOTIFY` channel (`mahaam_live`), so a person connected to one instance still hears
  what another published. Each instance tags its announcements with a random id and ignores its own,
  or it would deliver every local event twice. There is no replay and no delivery guarantee, which
  matches the hub — it already drops events for a stream 32 behind and relies on the `hello` frame to
  make a client right on reconnect; a bus promising more than the thing it feeds would be a false
  comfort. An event over Postgres's 8000-byte `NOTIFY` limit is replaced by a `resync` marker rather
  than dropped. Without `DATABASE_URL` there is no bus and the hub is single-instance, which is the
  development case and is correct. Covered by `internal/live/bus_test.go`, which runs two hubs
  against one database — what two instances behind a balancer actually are.
- **Reminders**: togo `scheduler`, every five minutes, idempotent (`notifications.dedupe_key`): timers running
  longer than `reminder_running_hours`; no time by 18:00 local on the five workdays from `week_start`, for
  members with an entry in the last 30 days. **In-app only** — email delivery waits for P5.
- **REST**: `/api/w/time/{running,start,stop,entries,entries/{entry},timesheet,team,settings}`,
  `/api/w/rates`, `/api/w/rates/{user}`, `/api/w/member-rates/{rate}`, `/api/w/notifications` (+ `/{id}/read`,
  `/read-all`). **MCP** (`internal/mcp/time_tools.go`): `get_running_timer`, `list_time_entries` (`time:read`);
  `start_timer`, `stop_timer`, `log_time`, `update_time_entry`, `delete_time_entry` (`time:write`; another
  member's time also needs `time:manage` on the token); `whoami` shows the running timer.
- **UI**: the timer bar in the header (start on a project, a task or free text; ⌘K / Ctrl+K "Start timer
  on…"), "Start timer" on the task side-over and on board cards, `/time` (week grid + day list + manual
  entries with the Calendar + Popover date picker; `?user=` for managers), `/time/team`, `/settings/time`,
  `/settings/rates`, and the notifications bell. Strings in `web/lang/time.{en,ar}.json`.
- A new workspace takes the UI language (`locale`), which names a new project's default columns.

Verification: `make test-e2e` runs the sweep and `TestTimeTracking` (50 parallel starts → one running
timer and no overlaps; the same entry split in Africa/Cairo and America/New_York; rate snapshot after a
rate edit; locked/invoiced refusals; MCP round-trip; realtime isolation; reminders). Browser:
`cd web && node e2e/p2-verify.mjs` (tab A → tab B realtime, ⌘K, side-over and card timers, MCP on the open
timesheet, a 23:00–01:00 manual entry, en/ar × light/dark at 1440 and 390; `WEB_ORIGIN=https://console.mahaam.app`
for the public preview) and `node e2e/ui-tour.mjs` (every page, both widths, both languages and themes).
The e2e scripts wait for `load`, not `networkidle`: the live stream keeps a request open.

## P3 — MCP completion

- **Rate limits** (togo `ratelimit`) on `/api/mcp` and `/api/admin/mcp`, separate policies: `MCP_RATE_PER_MINUTE`
  (default 120) calls per token, and `MCP_AUTH_FAIL_PER_MINUTE` (default 30) failed authentications per client
  address (`RemoteAddr` host). A limited call: HTTP 429, `Retry-After`, `X-RateLimit-*`, JSON-RPC error `-32029`.
- **Tools**: `time_summary`, `budget_status`, `timesheet` (`reports:read`); `profitability` (`reports:finance`,
  manager+); `update_feedback_status` (`feedback:write`).
- **Owner decision 11 is open**: tokens carry explicit scopes only, owners included (no `*`).
- Exit check: `TestMCPSession` (in `make test-e2e`), and against a running stack
  `cd web && node e2e/p3-mcp.mjs` (`WEB_ORIGIN=https://console.mahaam.app` for the preview; on this machine Node
  needs `--dns-result-order=ipv4first --network-family-autoselection-attempt-timeout=5000` to reach Cloudflare).

## P5 — reports and notifications

- **One aggregate** (`internal/work/reports.go`): time by project / member / client / label / task / day / week over
  local days; entries clipped to the range and cut at local midnight; a running timer counts to now. **Rounding at
  report time only**, per entry, spread over day/week buckets by cumulative rounding so rows always sum to the total
  (labels excepted: an entry counts under each label). Money = rounded time × rate snapshot, half up, workspace
  currency only (others counted in `other_currency_entries`), **manager+**. A member's report is their own time.
- **Budgets**: raw burn (hours; money = billable value for managers), levels ok / warning (80%) / over (100%).
  `budget.threshold` alerts go once per project/metric/threshold/budget value to managers+ (and, for hours, project
  leads), after time writes and every five minutes.
- **Profitability** per project and client (`reports:finance`). **Saved views** (`saved_reports`): own, shared by
  managers, owner-only edits; opening a view never widens rights.
- **Exports**: `GET /api/w/report/export?format=csv|xlsx` through togo `import-export` — the page's table, cell for
  cell, with the total row, en/ar headers, UTF-8 BOM and formula-injection neutralised.
- **Notifications**: `task.assigned`, `task.mentioned`, `task.done` written from the activity entry in the same
  transaction (never to the actor), plus `budget.threshold` and the P2 reminders. `notification_prefs`: mute kinds
  (not stored at all), email on/off, daily digest + hour.
- **Email** (togo `mail`): each inbox item mailed once (claimed first), the digest once per local day. `MAIL_DRIVER=file`
  (dev) writes `.eml` files to `storage/mail`; only `smtp` counts as configured — otherwise settings say "email is not
  configured" and refuse the email switches.
- **REST**: `/api/w/report/{time,export,budgets,profitability}`, `/api/w/projects/{project}/budget`,
  `/api/w/saved-reports[/{saved}]`, `/api/w/notification-settings`.
- Verification: `TestReports` (totals vs an independent computation in 140 reports: Cairo + New York across DST,
  rounding 0/1/6/15/60, every grouping; CSV = XLSX = table; alerts once; email once), the sweep, and
  `cd web && node e2e/p5-verify.mjs`.
- **Next (not built)**: timesheet submit/approve (`locked_at`), Toggl/Clockify CSV import (`source=import`).

## P8.1 — Feedback SDK and the agent issue loop

- **Widget** (`embed/src/widget.ts` → `make embed` → `/embed/v1.js`): the feedback-sdk ReportDialog anatomy
  (title · type + priority · details · Attach: Screenshot / Select element / Image · selector · preview) in a Shadow
  DOM on the grid tokens and the Mahaam brand. Inter and IBM Plex Sans Arabic come from the widget's origin, light/dark follows the host
  (`data-theme` overrides it), and it works in en/ar with RTL. A floating launcher (`data-position`, `data-launcher="false"` +
  `window.MahaamFeedback.open()`) and a "Powered by Mahaam" footer. Capture, picker and diagnostics are the shared
  `web/lib/feedback/core`. The intake now takes `priority`.
- **SDKs** (their own public repos; `sdk/` was retired): two separate products. *Feedback* is frontend-only —
  `@mahaam/feedback-core` plus shadcn registry items for React and Vue (`mahaam-feedback`), keyed by `pfk_`.
  *Mahaam SDK* is backend error monitoring, keyed by a DSN — `github.com/fadymondy/mahaam-go`, `@mahaam/sdk`,
  `mahaam-sdk`, `mahaam/sdk`. The server-side feedback helpers that used to live in `sdk/` are gone: server errors
  belong to the DSN product now.
- **Connect in one step**: `GET /api/w/projects/{project}/feedback-install` and MCP `get_feedback_install {project, stack}`
  return the env vars and the install steps per stack, and `stack=agent` returns a full prompt for a coding agent working in the
  client's repo. The project settings show the same text as tabs, with a "Copy agent prompt" button.
- **Issue MCP** (user, `issues:read|write`): `list_issues` (project, state; `human_only` hidden), `get_issue`,
  `list_mentions` (`@agent`/`@claude`/`@ai` with no agent reply since), `create_issue`, `comment_issue` (`as_agent`),
  `update_issue` (incl. `human_only`), `reorder_issue`, and the lifecycle in `internal/reports/lifecycle.go`:
  `start_issue {plan}` (refused without a plan or on `human_only`; the plan is posted as a comment), `review_issue {note}`,
  `request_approval {question}`, `finish_issue`. The lifecycle tools bank `agent_seconds` and clear `started_at`.
- **`/issues` skill** (`.claude/skills/issues`): fadymondy.com-v2's loop on Mahaam's MCP, with a run strategy
  (`sequential` · `parallel` (≤3 unrelated) · `mentions` · `drain` · `triage`) and the issue's own agent/skill/model.
- **Launcher look and behaviour**: each key has a `widget` look (colour, text colour, icon, text, shape
  pill/circle/square/tab, starting position, dialog theme and language). You set it in the project settings, with
  `PATCH /api/w/feedback-keys/{key}` `{widget}`, or with MCP `set_feedback_widget`. The widget reads it from the public
  `GET /api/feedback/embed/config?key=`, where an unknown key gets the default look. Attributes on the `<script>` tag override it.
  Visitors can drag the launcher anywhere and right-click it (long-press on touch) to dock it to the edge, move it to a
  corner, reset it, hide it for now or hide it on the site. These choices are kept in their browser, and Ctrl/⌘+Shift+F or
  `MahaamFeedback.show()` brings it back.
- Verification: `TestIssueLoop` (in `make test-e2e`).

## P8.3 — project vault (secrets + memory)

- One table, `project_vault_items`, holds two kinds of item. **memory** items are markdown notes that members+ on a visible
  project read and write. They are searchable with Postgres full-text (`simple` config, so Arabic and English both work) and
  `…/vault/recall?q=` ranks them. **secret** items are sealed with `internal/secretbox` (AES-256-GCM, `MAHAAM_SECRET_KEY`,
  rotatable). A list or a search never returns a secret's value. Only managers+ or the project lead can store, change or
  reveal a secret, and every reveal is written to the activity feed as `vault.secret_revealed`.
- **REST**: `/api/w/projects/{project}/vault` (GET with kind/q/tag, POST), `…/vault/recall`, `/api/w/vault/{item}`
  (GET/PATCH/DELETE), `/api/w/vault/{item}/reveal`. **MCP**: `vault_recall`, `vault_list` (`vault:read`);
  `vault_remember`, `vault_update`, `vault_forget` (`vault:write`); `vault_store_secret`, `vault_reveal_secret`
  (`vault:secrets`, manager+). **UI**: the project's Vault tab. Clients never see the vault.
- Verification: `TestVault`.

## P8.6 — roles and access (label → project → task)

- **Roles** are the existing workspace roles, renamed in the UI: admin (owner/admin), project manager (manager), employee
  (member) and customer (client). Managers+ see every project.
- An **employee** sees a project in any of these cases:
  - it is workspace-visible;
  - they are on it (`project_members`);
  - a team of theirs is attached (`project_teams`). Adding a team adds everyone in it, now and later;
  - they or a team of theirs hold a **label grant**, and the project carries that label (`project_labels`, set in the
    project's settings);
  - they or a team of theirs hold a **task grant** on one of its tasks, or are assigned one. In that case they see the
    project with only those tasks, and they cannot add tasks.
- The SQL lives in `internal/work/projects.go` (`visibleClause`, `fullAccessSQL`, `taskClause`). A trigger deletes a grant
  together with its label, task, team or membership (`18a_access_constraints.sql`).
- **REST** (manager+, `access:manage`): `/api/w/access-grants` (GET, POST), `/api/w/access-grants/{grant}` (DELETE),
  `/api/w/projects/{project}/project-labels` (GET, PUT). **MCP**: `list_access`, `grant_access`, `revoke_access`,
  `set_project_labels`. **UI**: Settings → Access, and the Labels section in project settings.
- Verification: `TestAccess`, and the sweep.

## P8.9 / P8.11 — AI consumption and project subscriptions (billed on invoices)

- **AI usage** (`ai_usage`) is stored per project, day, provider, model and source. Each row holds tokens (input, output,
  cache read and write), requests, what it cost us, and a billable flag. Agents or scripts push it daily with MCP
  `record_ai_usage` or `POST /api/w/projects/{project}/ai-usage` (`ai:record`, member+). A re-push of the same key replaces
  that day's numbers, unless the day is already invoiced, in which case it is refused.
- `GET /api/w/ai-usage` and MCP `ai_usage_summary` group usage by day, model, project or source, and show cost, billed
  amount and unbilled amount (manager+). Each project has a markup (`ai_markup_bp`) set with `PUT …/ai-markup` or
  `set_ai_markup`.
- **Subscriptions** (`project_subscriptions`) record what a customer project runs on through us: infrastructure, AI,
  marketing tools, domains, software, support. Each holds our cost and the billed price per month, quarter, year or
  one-off. Endpoints: `/api/w/subscriptions`, `/api/w/projects/{project}/subscriptions`,
  `/api/w/subscriptions/{subscription}`. MCP: `list_subscriptions`, `add_subscription`, `update_subscription` (manager+).
  A billed subscription cannot be deleted; deactivate it instead.
- **Invoices**: `draft_invoice_from_time` / `POST /api/w/invoices/from-time` bills three things:
  - the time, as before;
  - unbilled AI usage up to the end date, at cost + markup, one line per project and model. Those rows are then locked;
  - every due subscription period up to the end date, one `subscription_charges` row per period (unique per period).
  - Turn the last two off with `include_ai` / `include_subscriptions`. Voiding or deleting the invoice releases all three.
- **UI**: the project's Billing tab shows AI usage with a daily cost chart, the markup, and the subscriptions.
- Verification: `TestBilling`.

## P8.4 — customer import and report documents

- **Customer import** (`internal/work/client_import*.go`, manager+ / `clients:write`) into the workspace's
  clients (`name, email, phone, company, notes`; `company` added by `internal/db/post/19_client_import.sql`).
  Sources: CSV / XLSX upload (header row detected in the first five lines, Arabic and English headers,
  headerless files guessed from content, delimiter `, ; tab` sniffed, BOM dropped), a Google Contacts CSV
  export (both layouts map with no input), a vCard file (WhatsApp / phone contacts export; 2.1 quoted-
  printable, folded lines), Google Contacts over OAuth, and an optional WhatsApp Business / Evolution API.
- **Two steps, one plan**: `POST /api/w/clients/import/preview` writes nothing; `…/commit` re-parses and
  re-plans (never trusts the preview) and applies in one transaction with a savepoint per row — an invalid
  row is reported (`{row, column, message}`, row = the file line / card number) and the rest import.
  Every created / updated client gets its `client.created` / `client.updated` entry (`source: import:<source>`).
- **Dedupe**: email (case-insensitive) or phone (digits only, leading `00` dropped); email wins. A match
  **fills in** what the client lacks (email, phone, company; notes appended) — an import never overwrites or
  renames. Nothing new → skip ("already up to date"); `update_existing: false` skips every match; a repeat
  of an earlier row in the same file is skipped. Commits are serialised per workspace (advisory lock).
- **Google**: `POST /api/w/clients/import/google/start` → consent URL (`contacts.readonly`) with a state
  signed by `secretbox` (workspace, user, expiry, nonce) and the nonce in an HttpOnly cookie scoped to the
  callback. `GET /api/integrations/google/callback` is **PUBLIC** (exact path in the guard): state + cookie
  verified, code exchanged, `people/me/connections` paged, token dropped. Contacts wait in an **in-process**
  session (30 min, bound to user + workspace, used once) — several API replicas need sticky routing.
- **Env**: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (`GOOGLE_REDIRECT_URL` optional);
  `WHATSAPP_API_URL`, `WHATSAPP_API_TOKEN`, `WHATSAPP_INSTANCE`. Unset → 503 "not configured".
- **Report documents** (`internal/work/report_doc.go`): the time / profitability export takes
  `format=pdf|md` besides `csv|xlsx`; `GET /api/w/projects/{project}/report?format=pdf|md|json` is the
  project report (summary, tasks by status + % done, budget burn, time by member and by week, open issues,
  recent activity). Every number comes from the function the UI uses (`GetProject`, `ProjectBudget`,
  `TimeReport`, `ProjectActivity`); needs `reports:read` (clients 403; a member's time is their own).
- **PDF** is pure Go (`go-pdf/fpdf`) with Vazirmatn embedded (SIL OFL, `internal/work/fonts/OFL.txt`).
  fpdf has no OpenType shaping, so `pdf_shape.go` shapes Arabic into presentation forms (lam-alef
  ligatures included) and runs a simplified bidi pass; Arabic documents lay out right-to-left. Limits:
  harakat are not positioned, explicit bidi controls / nested embeddings are ignored. **Markdown is the
  exact path for Arabic.**
- **MCP**: `import_clients_preview`, `import_clients_commit` (`clients:write`; CSV / vCard text),
  `export_time_report`, `export_project_report` (`reports:read`; Markdown).
- **UI**: Clients → Import (CSV/XLSX, Google, WhatsApp tabs → mapping → preview → commit); PDF / Markdown
  next to CSV / XLSX on the reports pages; "Download report" on the project Overview.
- Verification: `TestClientImport` (DB), unit tests in `internal/work` (mapping, dedupe, vCard, Google /
  WhatsApp mapping, state signing, Markdown, shaping, PDF).

## P8.5 — customer portal and request portal

- **Customer panel** (`/w/{slug}/portal`, `/portal/projects/{id}`): per project, AGGREGATES only — task counts
  todo/doing/done and % done, status and dates, hours used vs the hours budget, hours per week (12 weeks, workspace
  timezone, totals, no names), and counts of tasks completed in 7/30 days. Never task rows, time entries, rates, people
  or the money budget. Money appears only on sent invoices (drafts hidden), to the client's own contacts or to invoice
  readers. The customer sees ALL issues of their projects (slim: no logs, agent fields or author ids).
  `internal/work/portal_panel.go`, `internal/reports/portal_panel.go`. Actions `portal:read` / `portal:write` (Client+)
  on top of project visibility (404 otherwise).
- **Customer full project (MH-1176)**: a customer opens the app's own Projects list (`/w/{slug}/projects`) and project
  pages (overview, board, list, issues, task sheet) and works them like a member — create, edit, move, assign, comment —
  on the projects `visibleClause` gives them, and nothing wider. Matrix: `tasks:read|write`, `feedback:read|write`,
  `labels:create` are Client+. The issue tracker (`internal/reports` `customer()`) limits `List`/`Find` to visible
  projects and refuses a project-less `Create`. `GET /api/w/people` is their directory (names on their projects; never the
  member list). Still member+: members, teams, clients, reports, time tracking, rates. The
  `/portal/projects` pages redirect to the app's; the portal panel endpoints above stay for the dashboard, MCP and mobile.
- **Customer project tabs (MH-1190)**: every tab but Settings. `integrations:read`, `vault:read|write` are Client+ (all
  go through `FindProject`); connecting/deploying and vault secrets stay manager+ or the lead. Billing is `billing:read`
  (Client role only — members keep none): `GET /api/w/ai-usage` and `/api/w/subscriptions` need `?project=` and return
  billed prices (`cost_minor` = cost × markup; subscriptions billable only, cost 0, no notes); the markup stays manager+.
  The Hosting tab opens the panel with the customer's one-time link. MCP scopes are unchanged (vault/integrations member+).
- **Customer issue control**: `PATCH /api/w/portal/issues/{key}` allows exactly accept (in_review → done), reopen
  (done | in_review → todo) and priority; `POST …/comments` replies. The general `PATCH /api/w/issues/{key}` is unchanged.
- **Requests**: a reports row with `request_state` (`pending | accepted | declined | converted`), `request_kind`
  (feature/change/bug), `request_reply`, `desired_on` (`19b_portal_requests.sql`). `reports.List` (the board,
  `/api/w/issues`, MCP `list_issues`) shows only `request_state IS NULL OR 'accepted'`. Customers file with
  `POST /api/w/portal/requests` (multipart, the feedback parser) and see them at `GET /api/w/portal/requests`. The
  **Requests inbox** (`requests:manage`, manager+): `GET /api/w/requests?state=`, `POST /api/w/requests/{key}/accept`
  `{status?, priority?, issue_type?, reply?}`, `/decline {reason}` (required; the customer reads it),
  `/convert-to-task {project?}` (a task via `internal/work`, a linking comment, state `converted`). Triage is only
  from `pending` (409 otherwise). Inbox notifications: `request.created` → managers+, `request.accepted|declined|converted`
  → the requester (`work.NotifyUsers`).
- **MCP**: `portal_projects`, `portal_project` (`portal:read`), `request_feature` (`portal:write`); `list_requests`,
  `accept_request`, `decline_request`, `convert_request` (`requests:manage`).
- **Request cycle fix (owner feedback)**: the inbox listed only `pending` and had no detail view, so a request vanished
  once triaged and could not be opened again (the `?key=` in the notification URL was ignored too). Now
  `GET /api/w/requests/{key}` answers in EVERY state: body, requester e-mail, history, thread, `task_key` +
  `task_project_id`. The inbox (`?state=` + `counts`) opens a side panel (`/requests?key=MG-n`) with "Convert to issue"
  (type / priority / column), "Convert to task", "Decline", and for handled requests `POST …/reopen {note?}` →
  pending (manager+; a task it became is kept). `19c_portal_share.sql` adds `request_history` (jsonb, appended on every
  decision), `request_task_key`, `request_decided_at/_by` (backfilled from the reply). The staff issue page shows a
  banner for request rows (`request_state` on `IssueDetail`). Screenshots are served (never publicly) at
  `GET /api/w/issues/{key}/screenshot` (feedback:read) and `/api/w/portal/issues/{key}/screenshot` (visible project).
- **Share with customer** (per project, `projects.share_board` on, `share_team` on, `share_money` off; `PATCH
  /api/w/projects/{id}`, project settings, manager/lead). The panel adds `share`, `team` (display names + initials,
  staff only, no ids/e-mails/rates), `columns` (status counts) and `budget_amount_minor` (money only when shared).
  Dedicated read-only endpoints with explicit whitelists (`internal/work/portal_share.go`):
  `GET /api/w/portal/projects/{project}/tasks` (board), `…/tasks/{task}` (description + checklist, never
  task_comments), `…/time` (total, weeks, by task when the board is shared), `…/activity` (task created/moved/completed
  when the board is shared, issue/request lifecycle). Board off → 404. Clients still get 403/404 on every staff task route.
- **Customer MCP**: clients mint their own `mgy_` token (`portal:read`, `portal:write`) from the "Connect your AI" card
  on the portal (or the MCP tokens page, which shows a client only the scopes their role may hold). `tools/list` now
  lists only the tools whose scope the caller's role may hold. Tools: `portal_projects`, `portal_project`,
  `portal_board`, `portal_task`, `portal_issues`, `portal_issue`, `portal_update_issue`, `portal_comment_issue`,
  `request_feature`, `portal_requests`, `portal_invoices`, `portal_time`; staff: `get_request`, `reopen_request`.
- **UI**: the shadcn `Tabs` root used `data-horizontal:` variants that never matched Base UI's `data-orientation`
  (tabs rendered beside the content — the tall box in RTL); fixed in `components/ui/tabs.tsx`. The portal uses
  `ScrollTabs` (horizontal, scrollable, RTL-safe): Overview · Board · Issues · Requests · Time · Invoices · Activity.
- Verification: `TestCustomerPortal` (incl. the reopen-after-action regression, board/task/time/activity, share
  settings, client MCP), and the sweep (`portal`, `requests`, `issues` segments). Screenshots `web/e2e/shots/portal-*.png`.

## P8.10 — employee KPI, manager reviews and per-user GitHub accounts

- **KPI** (`internal/work/kpi.go`): raw facts about one member over local days (workspace timezone), never a score.
  Time comes from ended `time_entries`, cut at local midnight, by project and week. Tasks are the assigned ones completed in
  range (and late), open and overdue now. Issues are the agent loop, attributed via `report_comments` with `author_kind='agent'`
  and `author_id` = the token's user (plans, reviews, approvals, finishes, the `agent_seconds` of the issues worked, and
  `@agent` mentions answered). AI is `ai_usage.user_id` (tokens always, cost only for `ai_usage:read`). GitHub is
  `github_events` matched to the member's `user_github_accounts` login (case-insensitive) or e-mails **at query time**, so a
  new mapping covers history and no event row is rewritten. MCP is `activity_logs` with `actor_via='mcp'`. Reviews are the
  `member_reviews` whose period overlaps the range.
- **Access** (authz): `kpi:read` (member+): your own KPI, GitHub account and reviews. `kpi:all` (manager+): anyone's, the
  team table and mapping someone's GitHub. `kpi:review` (manager+): write and delete reviews, never of yourself. A user
  who isn't an active non-client member is a 404.
- **GitHub accounts**: members connect themselves with the GitHub App's user authorization (`GITHUB_APP_CLIENT_ID/SECRET`).
  `GET /api/w/me/github/connect` returns the authorize URL with a secretbox-signed state (`github-user:` purpose
  prefix; workspace, user, slug, locale, nonce, 15-minute expiry) and sets the nonce as an HttpOnly cookie scoped to the
  callback. The PUBLIC `GET /api/integrations/github/user-callback` (guard allowlist) checks both, exchanges the code,
  reads `/user` and `/user/emails`, keeps only verified addresses plus `<id>+<login>@users.noreply.github.com`, seals
  the user token, and redirects to `/{locale}/w/{slug}/me`. Managers can map someone by hand with
  `PUT /api/w/members/{user}/github {login, emails}`. A login maps to one member per workspace.
- **REST**: `/api/w/me/github` (GET, DELETE), `/api/w/me/github/connect`, `/api/w/members/{user}/github` (GET, PUT, DELETE),
  `/api/w/members/{user}/kpi`, `…/kpi/dossier` (markdown + the AI prompt), `/api/w/members/{user}/reviews` (GET, POST),
  `/api/w/reviews/{review}` (DELETE), `/api/w/kpi/team`. `{user}` accepts an id, an e-mail or `me`.
- **MCP**: `employee_kpi {user, from, to}` returns the markdown dossier: sections, tables and raw facts, and it says
  where data is missing. `team_kpi`, `list_member_reviews` (`kpi:read`); `add_member_review` (`kpi:review`).
- **UI**: `/{locale}/w/{slug}/me` (the "My profile" item in the user menu) has the Connect GitHub card and your own
  dashboard. The member detail page carries the dashboard: date range, tiles, hours by week and project, GitHub by
  project, AI, reviews with "Add review", "Map GitHub", and "Copy AI prompt". `/members/kpi` is the team table (manager+).
- Verification: `TestKPI` (with a fake GitHub for the OAuth flow), the unit tests in `internal/work/kpi_test.go`, and the
  sweep (`members`, `reviews`, `kpi` segments).

## Platform admin and plans

- **Who**: platform admins are users whose `users.roles` contains `admin` (`go run ./cmd/mahaam-admin promote <email>`).
  The role is read from the database on every call (10-second in-process cache; changes made through the panel apply
  at once).
- **Admin panel** `/[locale]/admin` (Dashboard, Users, Workspaces, Plans, Issues, Audit log), linked from the user menu
  only when `GET /api/me/platform` says `is_admin`. REST: `/api/admin/*` (`internal/admin`), a guard tier of its own —
  session + CSRF + platform admin, and **404 to everyone else, anonymous included** (the isolation sweep checks every
  `/api/admin/*` route as anonymous and as a non-admin). Issues: platform admins act in the `platform` workspace as
  workspace admins without a membership row (`tenant.Resolve`), so the panel reuses `/w/platform/issues`.
- **Plans** (`plans`, platform table, owner pool only): names/descriptions/price labels en+ar, currency, base fee, and
  `limits` jsonb keyed by `internal/limits/catalog.go` — counts `members` (active staff + pending staff invitations;
  customers are free), `projects` (not archived), `clients`, `tasks`, `issues`, `teams`, `feedback_keys`,
  `mcp_tokens`; data `storage_mb` (attachments + issue/request screenshots); monthly `issues_per_month`,
  `tasks_per_month`, `api_calls_per_month` (UTC months); rate `api_rate_per_minute`. A rule is
  `{limit (null = unlimited), policy, unit_price_minor, unit_size}`: **block** refuses with 402 ("Your plan (Free)
  allows 2 projects — upgrade in Settings → Plan"); **overage** lets it through and bills whole `unit_size` blocks over
  the limit (count/storage limits on the month's peak). Features `ai_usage_tracking`, `integrations`
  (github/jira/linear), `customer_portal`, `vault`, `kpi` (402 `plan_feature`). Seeded: `free`, `pro`, `business`,
  `unlimited` (no limits, all features).
- **Per workspace**: `workspaces.plan_overrides` (a rule per key replaces the plan's; features merge per key),
  `status` active|suspended + `suspended_reason`. Suspended workspace → **403** `workspace_suspended` for members
  (REST + MCP), embed refuses; platform admins still see it. Suspended **account** (`platform_users.suspended_at`) →
  403 `account_suspended` everywhere, sign-in refused, MCP tokens refused. "Sign out everywhere" sets
  `sessions_valid_after` (older session JWTs and older personal access tokens → 401; a PAT is judged by its
  `created_at`, since it has no iat; MCP tokens are not sessions). **Password reset** (`internal/account`, MH-340):
  the auth plugin has none, so Mahaam adds `POST /api/auth/password/forgot` (always 202, sent off the request
  path so timing does not reveal an account) and `/reset` (six-digit code in `account_codes`, HMAC under
  `MAHAAM_SECRET_KEY`, 10 min, 5 attempts, one live code per purpose). A reset sets the password, deletes the
  user's PATs and moves `sessions_valid_after`, all in the code's transaction. Web: `/{locale}/forgot-password`.
  The admin panel still cannot send a reset on someone's behalf; the person asks for one themselves.
  **Profile** (MH-343): `user_profiles` (name, avatar, locale, timezone), a table of its own because the plugin
  reads `users` whole; `GET/PATCH /api/me/profile`, `POST/DELETE /api/me/avatar` (re-encoded server-side to a
  256px JPEG data: URL, EXIF and all else dropped), email change by a code sent to the NEW address
  (`/api/me/email`, `/confirm`; the old address is told), and `DELETE /api/me/token` to revoke the PAT a request
  carries (app sign-out). The auth identity's email is never trusted: it is empty for a PAT and stale after a
  change, so `/api/auth/me`, invitation accept, feedback and the admin audit read it from `users`.
  **Delete account** (MH-344): `POST /api/me/delete {password}` → 409 `sole_owner` with the workspaces the person
  alone owns (hand over or delete first), else 202 `{purge_after}`: sessions, PATs, MCP/OAuth tokens and push end at
  once, and `platform_users.deletion_requested_at`/`purge_after` are set (grace `ACCOUNT_DELETE_GRACE_DAYS`, default
  14). Any request on a session newer than the request, meaning they signed in again, cancels it (guard).
  The hourly `mahaam.account.purge` job ANONYMISES rather than deletes: time entries, comments, projects and invoices
  reference `users` with no cascade, so the row stays as `deleted-<id>@deleted.invalid` with an unmatchable password,
  and memberships, assignments, profile, inbox, codes and tokens go. It re-checks the sole-owner rule and postpones.
- **Email verification** (MH-342): a code is mailed on the auth plugin's `auth.registered` hook (plugin untouched);
  `GET/POST /api/me/verify-email`, `/resend`. `platform_users.email_verified_at`; accounts that existed before were
  marked verified once (`platform_meta` flag). A password reset by code and a confirmed email change also verify.
  The gate: an unverified account can't `POST /api/me/workspaces` (403 `email_unverified`) when `EMAIL_VERIFICATION`
  is `required`, or `auto` (the default) with a mail driver that really delivers. Without SMTP nobody could receive
  the code, so `auto` leaves the gate off.
- **Two-factor sign-in** (MH-341, `internal/account/twofa.go`): Mahaam's own TOTP, because the plugin's
  `/api/auth/2fa/enroll|verify` stored the secret in plain text as issuer "togo" and sign-in never checked it. Those
  two routes are now blocked. `user_totp` holds the secret sealed with secretbox, a `last_step` replay guard, and failure
  counting in the DB (10 per 15 min); `user_recovery_codes` holds 10 HMAC'd one-time codes. `/api/me/2fa`: state,
  `enroll` (password), `confirm` (returns the recovery codes once), `recovery-codes` (password + code), `disable`
  (password + code or recovery). Sign-in: the guard answers POST /api/auth/login itself only when the password is
  RIGHT and 2FA is on: 401 `{code: mfa_required, challenge}`, no session. A wrong password still goes to the plugin,
  so nothing reveals 2FA. `POST /api/auth/2fa/challenge` returns the token via the plugin's exported `IssueToken`,
  and sets the session cookie only when the CSRF header matches (no login CSRF); `SESSION_DRIVER=cookie` only.
  Delete account asks for the code too. The shared client (`login(email, pw, {code})`, `isMfaRequired`) and panel
  handle it for the extension.
- **Self-monitoring** (MH-129, `internal/monitor`): the API uses the Go SDK customers use
  (`github.com/fadymondy/mahaam-go`, public). `MAHAAM_DSN` set → an outermost recover reports a panicking request
  and answers 500. The kernel has no recovery, so a panic used to drop the connection. A slog bridge (`a.Log`,
  `k.Log`) files every Error record: the log message plus the error as the title, attributes as extra, throttled
  to one report per message per 5 min per process, so the API reporting to its own intake can't loop. The server
  dedups repeats into one card. Unset = inert.
- **Board realtime** (MH-351, `internal/work/broadcast.go`): `task.created|updated|moved|deleted|commented`,
  `issue.created|updated|moved|commented` and `project.updated` (with `tasks_total`/`tasks_done`) on `/api/w/events`.
  Task, comment and project events come from `record()`, queued in the transaction and sent after commit. Issue
  events come from `reports.OnChange` after each write. Payloads are ids only (`project_id`, `task_id`/`key`, `action`,
  `actor_id`), so an event is a cue to refetch through the reads that apply access. Recipients are managers+ and
  members with full access to the project (`fullAccessSQL`, one query per event); task-grant-only members and clients
  get none. At most once, no replay: clients refetch on reconnect (the web does, in `useLiveStream`).
- **Live Activities and widgets** (MH-355, `internal/push/live_activity.go`): `live_activity_tokens` per device
  (`update` = the running activity's token, `start` = the iOS 17.2+ push-to-start token), set via `POST/DELETE
  /api/me/devices/{token}/live-activity`. timer.started updates the running activity or starts one; timer.stopped
  ends it. It goes through FCM's `apns.live_activity_token` (no extra credential), coalesced per person over 500 ms
  so a stop-then-start switch becomes one update. content-state is `{started_at (unix), label, project, key}` and
  `LIVE_ACTIVITY_ATTRIBUTES_TYPE` names the Swift type. Widgets: `GET /api/w/widgets/projects` (progress + running
  timer, one request), plus a background (content-available) push on project.updated, throttled per person
  (`WIDGET_REFRESH_SECONDS`, default 600). The throttle is taken only by a push that actually reaches a phone.
- **Native push** (MH-352, `internal/push/native.go`): `devices` (owner pool; one row per install, UNIQUE push token,
  so a phone that changes hands moves rather than receiving both people's notifications). `POST /api/me/devices`
  (with `previous_token` for FCM's token rotation) and `DELETE /api/me/devices/{token}`. Every inbox notification that
  goes to Web Push also goes to the user's phones through the FCM HTTP v1 API. The service-account JWT bearer grant
  is written by hand rather than with Google's client library, and the access token is cached per process. The payload
  data is workspace_id, workspace_slug, kind, project_id, key, notification_id and url; the title is rendered in the
  device's locale; collapse is by kind and key. UNREGISTERED and 404 delete the device. Off unless
  `FCM_PROJECT_ID` + `FCM_SERVICE_ACCOUNT` are set.
- **Enforcement**: one helper, `internal/limits` (`Check`, `CheckStorage`, `Feature`, `Integration`, `CountCall`),
  called in the domain functions REST and MCP share: invitations/accept, `CreateProject`, `CreateClient` + client
  import, `CreateTeam`, `CreateTask`, `reports.Create` (every issue: app, portal, requests, embed, MCP, integration
  imports), MCP tokens, feedback keys, attachments and screenshots, and the vault / KPI / AI usage / customer portal /
  integration entry points. The public embed answers 402 `quota_exceeded`; the widget shows "not available".
  Admin actions (admin MCP `add_member`) are not limited.
- **Metering**: `workspace_usage` (per workspace per month): `issues_created`/`tasks_created` from SECURITY DEFINER
  triggers; `api_calls` counted in memory (guard workspace tier + user MCP) and flushed every minute; `peaks`. The
  per-minute rate is per process. Report: `GET /api/w/plan` (owner/admin), the admin panel, MCP `workspace_usage` /
  `estimate_bill`: usage vs quota and estimate = base fee + overage.
- **Migrations**: `internal/db/schema/platform.sql`, `internal/db/post/19d_platform.sql`, `19e_billing.sql`, run by
  `go run ./cmd/migrate` as the owner role — no superuser needed. **Existing workspaces move to `unlimited` once**
  (marker `platform_meta.plans_grandfathered`); new ones get `PLAN_DEFAULT` (default `free`). The platform workspace
  is always `unlimited`.
- **Audit**: every admin change is appended to `admin_audit` in the same transaction (`via` rest / mcp / webhook).
- **Admin MCP** (new scopes `admin:users:write`, `admin:plans:read`, `admin:plans:write`, `admin:stats:read`):
  `platform_stats`, `list_plans`, `update_plan`, `set_workspace_plan`, `suspend_workspace`, `suspend_user`,
  `workspace_usage`, `estimate_bill`, `billing_status`; `update_workspace` changes plans through the same audited path.
- Verification: `TestPlatformAdmin`, `TestPolarBilling`, `internal/limits` and `internal/billing/polar` unit tests,
  the isolation sweep.

## Billing (Polar)

> **Switched off (2026-10-21).** Polar offboarded the organization, so `POLAR_BILLING_ENABLED` defaults to off:
> checkout, the customer portal, `polar-sync` and the 15-minute usage push answer "billing unavailable" (503) and
> paid plans are not offered. Nothing was deleted; set `POLAR_BILLING_ENABLED=true` to bring it back. The webhook
> stays mounted so subscriptions Polar cancels still move their workspaces back to the free plan.

Polar (polar.sh, merchant of record, org `3x1io`) sells the paid plans (`internal/billing/polar`). Env only:
`POLAR_ACCESS_TOKEN`, `POLAR_API_URL`, `POLAR_WEBHOOK_SECRET`, `POLAR_SUCCESS_URL`. Everything Mahaam creates is
named "Mahaam …" and tagged `metadata {"app":"mahaam", …}`; the org's other products, meters and webhooks are never
treated as Mahaam's or changed.

- **Sync** (`go run ./cmd/mahaam-admin polar-sync [--dry-run]`, or Admin → Plans → Sync to Polar): one meter per
  overage-billed limit key (event `mahaam.usage`, filter `app=mahaam` + `key=<limit>`, sum of `units`) and one product
  per paid plan (monthly fixed base price + a metered price per overage key, `unit_price_minor` per billing unit). Ids
  go to `plans.polar_product_id` / `polar_price_ids` and `polar_meters`. Idempotent; a dry run calls no write endpoint.
- **Checkout**: Settings → Plan → Upgrade → `POST /api/w/billing/checkout {plan}` (owner/admin) → Polar checkout
  (`external_customer_id` = workspace id, owner email, metadata) → redirect. "Manage billing" → `POST
  /api/w/billing/portal`.
- **Webhook** `POST /api/billing/polar/webhook` (public, exact path in the guard): Standard Webhooks signature,
  5-minute window, deduplicated in `polar_webhook_events`. `subscription.*` / `order.paid` set the plan and
  `billing_status`; canceled keeps the plan until `billing_period_end` (then the job moves it to `free`); revoked →
  `free` at once.
- **Usage**: job `mahaam.billing.polar` (every 15 min) pushes overage billing units per workspace/month/key to
  `/v1/events/ingest` as deltas against `polar_usage_sent`; `external_id` carries the cumulative total, so a retry is
  deduplicated by Polar.
- **One-time setup**: 1) `go run ./cmd/migrate`; 2) `go run ./cmd/mahaam-admin polar-sync --dry-run`, review, then
  `polar-sync`; 3) create the webhook in the Polar dashboard for `https://console.mahaam.app/api/billing/polar/webhook`
  (subscription.created/active/updated/canceled/uncanceled/revoked, order.paid) — or run
  `polar-sync --webhook https://console.mahaam.app/api/billing/polar/webhook`, which prints the secret once;
  4) set `POLAR_WEBHOOK_SECRET` and restart the API.
- Tested against a fake Polar server only. The meter filter property names and the customer-session endpoint follow
  Polar's docs; check them on the first dry run / sync.

## Tenancy

- `workspaces`, `workspace_members` (owner/admin/manager/member/client), `invitations`;
  `workspace_id` on every tenant row. Web routes `/[locale]/w/{slug}`; the API reads
  `X-Workspace-ID` (id or slug). Not a member → **404**, no session → **401**.
- One default-deny guard (`internal/server/guard.go`) wraps every route incl. plugin routes.
  Generated CRUD sits in the workspace tier **and** behind `authz.Generated`
  (`internal/authz/can.go`), which is itself default-deny per table. Tenancy tables are
  read-only through generated CRUD; membership changes go through `/api/w/*` and `/api/me/*`.
- **RLS**: two pools. `DATABASE_URL` = owner (migrations, auth, tenant resolution, admin MCP,
  explicit predicates everywhere). `APP_DATABASE_URL` = `mahaam_app` (no superuser, no
  BYPASSRLS, owns nothing, no grant on `users`/`admin_mcp_tokens`). Every ORM/generated query
  runs on the app pool, whose connection wrapper (`internal/tenant/rlsdb.go`) runs
  `set_config('app.workspace_id', …)` before each statement. Boot refuses to start if the app
  role could bypass RLS.

## MCP

- **User MCP** `POST /api/mcp` — `mgy_` tokens owned by a user in a workspace, SHA-256 hashed,
  explicit scopes (no wildcard), narrowed to the user's *current* role on every call; same
  `tenant.Scope`, authz and RLS as the browser. Tools (P0): `whoami`, `list_members`,
  `list_feedback`, `get_feedback`, `comment_feedback`, `update_feedback_status`. P3/P5: `time_summary`, `budget_status`,
  `timesheet` (`reports:read`), `profitability` (`reports:finance`). Tools (P1, `internal/mcp/work_tools.go`):
  `list_projects`, `get_project` (`projects:read`); `create_project`, `update_project`,
  `archive_project` (`projects:write`, manager+); `list_tasks`, `get_task` (`tasks:read`);
  `create_task`, `update_task`, `move_task`, `assign_task`, `comment_task`,
  `toggle_checklist_item` (`tasks:write`); `list_clients`, `get_client` (`clients:read`);
  `create_client`, `update_client` (`clients:write`). Tasks accept `MG-123`, `123` or the id;
  projects/clients an id or exact name; people an email, id or `me`. Agent writes land in the
  activity feed as the token's user "via MCP", with the token id recorded.
- **Admin MCP** `POST /api/admin/mcp` — `mga_` tokens, only for platform admins
  (`users.roles` contains `admin`, re-checked per call). Tools: `list_issues`, `get_issue`,
  `create_issue`, `update_issue`, `comment_issue`, `start_issue`, `finish_issue`,
  `list_workspaces`, `get_workspace`, `update_workspace`, `add_member`, `set_member_role`,
  `remove_member`, `list_users`, `get_user`.
- Transport ported from fadymondy.com-v2 `internal/mcp`; its opt-in scope weakness (FM-22) is
  inverted: a tool without a scope fails the build (`scopes_test.go`) and is denied at dispatch.
  Protocol `2024-11-05`, also negotiates `2025-03-26` / `2025-06-18`.

## Issues / feedback

`reports` + `report_comments` (fadymondy.com-v2's columns + `workspace_id`, `project_id`),
keys `MG-n` allocated by the server per workspace. The in-app "Report a problem" dialog is the
shared `fadymondy.com-v2/packages/feedback-sdk` (synced copy in `web/lib/feedback`, never edited
by hand) posting to `POST /api/feedback`; reports land in the `platform` workspace and are
triaged through the admin MCP.

## togo framework notes (found building P0, CLI 0.2.31 / togo v0.21.0)

1. `make:resource` in a `--db postgres` project still writes **SQLite** DDL
   (`randomblob`, `datetime`), `?` placeholders in sqlc queries, `engine: sqlite` in
   `sqlc.yaml`, and no Atlas HCL — while `togo.resources.yaml` records the right `pg:` types.
   The scaffold's `togo migrate` then runs that DDL against Postgres. Schema files here are
   hand-written Postgres; `cmd/migrate` is our own.
2. On Postgres + `database/sql`, sqlc emits `sql.Null*`, but the generated resources/ORM/
   GraphQL expect pointers → overrides in `sqlc.yaml`; generated code also expects `PageURL`
   → `initialisms: [id, url]`.
3. Nullable timestamps are `String` in the generated GraphQL but `*time.Time` in Go
   (gqlgen: "String is incompatible with *time.Time").
4. Generated Huma create bodies make every nullable field a **required** key (no `omitempty`),
   and put `validate:"required"` on int/bool fields so `0`/`false` are rejected. Fixed in the
   handler fragments.
5. `togo generate` swallows gqlgen's failure; the cause was `golang.org/x/tools` v0.30 vs
   go1.27 ("package context without types") → bumped to v0.50.
6. `togo new` installs `auth-dev` (admin session for an empty POST in any non-production env)
   and `dashboard`; there is no uninstall command (plugins.gen.go hand-edited). The scaffold's
   `/events` SSE broadcasts every generated row to every subscriber and `/api/_meta/resources`
   dumps the schema — both left unmounted. Kernel `LoadConfig` never reads `.env`
   (`internal/envfile`).
7. The ORM holds a concrete `*sql.DB` (no executor interface), so per-request
   `SET LOCAL` in a transaction is impossible for generated code — hence the per-statement
   connection wrapper. `db-postgres` exposes no pgx hooks.

Found building P1:

8. `togo generate` prints "Codegen complete" and exits 0 when gqlgen or the OpenAPI gate fails
   ("! openapi failed (continuing)"). Grep its output; don't trust the last line.
9. `make:resource` GraphQL fragments type nullable timestamps/dates as `String` against Go
   `*time.Time`, so gqlgen demands field resolvers and the gate fails — retyped to `Time`. Its
   resolver for a field `ip` uses `input.Ip`, but gqlgen names it `IP`.
10. `make:resource` also scaffolds `web/app/<table>/page.tsx` and `web/lib/api/*.ts`; the latter
    shadows a Next app's own `lib/api.ts`. Deleted.
11. Huma v2.27 silently skips fields promoted through an **unexported** embedded struct — the
    path parameter arrives as `""`, no error. `internal/server/params_test.go` fails the build if
    any operation's `{param}` is unbound. (P0's embedded `wsHeader` has the same defect for its
    header — docs only, the guard reads the raw header.)
12. `togo-framework/settings` is linked transitively (queue → providers → settings) and its
    `init()` mounts GET/PUT/DELETE `/api/settings/{scope}/{key}` over one global table with no
    auth or tenancy. The guard blocks `/api/settings`.
13. Next 16 dev blocks `/_next/*` and HMR for any origin other than the one it started on: a page
    opened on `127.0.0.1` while the server runs as `localhost` never hydrates. Both are in
    `allowedDevOrigins` (`web/next.config.mjs`).

Found building P2:

14. `togo install` ignores `--dry-run` (it ran `go get`, rewrote `plugins.gen.go` and `togo.yaml` and added
    `.claude/` files) and strips the hand-written header of `plugins.gen.go`. Re-add it after every install.
15. `make:resource` names a field `url` `uRL` in the GraphQL fragment; gqlgen then generates `URl` while the
    resolver uses `input.URL` — the OpenAPI gate fails (and `togo generate` still exits 0, note 8).
16. togo realtime cannot carry per-user data: the SSE broker broadcasts to everyone, and realtime-ws
    tickets are not bound to a user, so any ticket holder may subscribe to any `private-` channel.
17. The `togo-framework/queue` memory driver runs a dispatched job on its own goroutine, so scheduler jobs
    do run in-process; the kernel's `http.ListenAndServe` has no timeouts (fine for SSE, not for production).

Found building P3/P5:

18. togo `ratelimit`'s `Middleware` answers `text/plain` "rate limit exceeded" (an MCP client cannot parse it) and
    its in-memory store never evicts keys. Mahaam calls `Allow` and writes a JSON-RPC 429 itself.
19. togo `import-export` mounts `GET /api/export/{resource}` and `POST /api/import/{resource}` with no auth over a
    process-global registry (blocked in the guard); it writes every XLSX cell as text and does nothing about
    spreadsheet formula injection.
20. togo `mail`'s `log` driver records only recipient and subject, so nothing can be checked — Mahaam registers a
    `file` driver (`internal/mailer`).
21. `make:resource` types a nullable `date` field as `String!` in GraphQL and a non-pointer `time.Time` in the
    resource and handler (retyped).

Found building native sign-in:

22. `auth-oauth` v0.2.0's callback always redirects to a hard-coded `/dashboard` (oauth.go:147): it ignores
    `?next=`, and Mahaam has no `/dashboard`, so a Google/GitHub sign-in ended on the web's 404 and an app
    sign-in started in the system browser never got back to `/app-signin`. It also issued the session without
    checking suspension or 2FA. The guard wraps both routes (`internal/server/oauth_return.go`): the start
    route keeps a same-origin `next` in an HttpOnly cookie (`mahaam_oauth_next`, path `/api/auth/oauth/`,
    10 min); the callback's 302 to `/dashboard` is rewritten to `WEB_URL` + that path (or `/`). A suspended
    account's new session is withdrawn (→ `/login?error=account_suspended`); an account with 2FA gets no
    session either (→ `/login?error=mfa_required&next=…#mfa_challenge=<challenge>`, finished at
    `POST /api/auth/2fa/challenge`). A Google/GitHub sign-in counts as the first factor only. The plugin
    matches accounts by email and does not check Google's `verified_email`.

## Clients — mobile apps

`apps/mobile` is one Expo codebase (SDK 57, expo-router, TypeScript strict) that ships as two store apps. `APP_VARIANT`
chooses the app name, bundle id, icon, splash and which navigation tree gets mounted (`app.config.ts`):

| Variant | App | Bundle id | Who |
|---|---|---|---|
| `team` | Mahaam Team | `com.fadymondy.mahaam.team` | Staff. Screens: Today (timer with start/stop/switch), Tasks (my tasks in board order plus open issues, start a timer, task detail with checklist and comments), Log time, Timesheet, Inbox. A local reminder fires when a timer has run longer than the workspace's `reminder_running_hours`. |
| `client` | Mahaam Client | `com.fadymondy.mahaam.client` | Customers. Screens: projects with progress and hours, project page (issues with accept/reopen, requests, invoices), report an issue or make a request with a photo, invoices. |

```bash
cd apps/mobile && npm install        # standalone package; not part of the apps/ npm workspaces
npm run start:team                   # or start:client. API = EXPO_PUBLIC_API_URL, default http://<metro host>:8120
npm run typecheck && npm test        # jest-expo: API client auth dance, SSE parser, time/board logic, hooks
npm run export:web:team && npm run serve:web -- team      # web QA build on :8091, /api proxied to :8120
npm run export:web:client && npm run serve:web -- client  # :8092
npm run icons                        # regenerate icons and splash from the mark
```

- **Sign in with Apple** (iOS, App Store guideline 4.8): `POST /api/auth/apple {identity_token, nonce, name?,
  device_name?, locale?}`, public, no CSRF (a native call with no cookies), 30 per 15 min per IP. The app makes a
  random raw nonce, passes `sha256hex(raw)` (expo-crypto `digestStringAsync`, hex) as `nonce` to
  `AppleAuthentication.signInAsync` with the FULL_NAME and EMAIL scopes, and sends us the token and the RAW nonce.
  The server checks RS256 against Apple's JWKS (cached, refetched on an unknown `kid` at most every 30 s),
  `iss`, `aud` ∈ `APPLE_CLIENT_IDS`, `exp`, and `nonce == sha256hex(raw)`; each token is accepted once
  (`signin_nonces`). The person is Apple's `sub` in `user_identities`; the first time, a matching account is
  linked only on `email_verified`, else a passwordless account (`!sso`) is made with Apple's name (sent on the
  first authorization only) and the email marked verified (it may be a private relay address). Answers like
  login: `{token, user}` (plus `access_token`, a device PAT, when `device_name` is sent), 401 `mfa_required`
  with a `challenge` for `/api/auth/2fa/challenge`, 403 `account_suspended`; 400 `email_required`, 409
  `account_exists` (an unverified email that belongs to another account). `TestAppleSignIn`.
- **Accounts without a password** (Apple, Google, GitHub; `password_hash` `!sso`; App Store 5.1.1(v)):
  `GET /api/me/profile` carries `has_password`. Where a password account sends `password`, they send
  `email_code`, from `POST /api/me/reauth/code {locale?}` → 202 `{email, expires_in}` (a six-digit code mailed
  to the account's address, en/ar; `account_codes` purpose `reauth`: 10 min, 5 tries, one live code, spent by
  the one action; 5 per 15 min per user). Accepted by `POST /api/me/delete`, `/api/me/email`,
  `/api/me/2fa/enroll`, `/api/me/2fa/disable`, `/api/me/2fa/recovery-codes`; the 2FA code is still required
  when 2FA is on, and refusals that need nothing spent (missing 2FA code, sole owner, same address, 2FA already
  on/off) come before the code is spent. Errors: 403 `reauth_required` (no code sent), 403 `invalid_code`
  (wrong, expired, used, burned). Password accounts are unchanged, and asking for a code answers 409
  `has_password`. Setting a password is the forgot/reset flow. `TestPasswordlessAccount`.
- **Auth**: `POST /api/auth/login` with the double-submit CSRF token (`togo_csrf` cookie + `X-CSRF-Token`). After that,
  every call sends `Authorization: Bearer <jwt>` and `X-Workspace-ID`. The email and password are kept in
  expo-secure-store. On a 401, or when the JWT is about to expire, the client signs in again silently. Concurrent
  requests share a single re-login, and if that re-login fails the session is dropped. Login is rate-limited
  server-side, and a 429 does not sign the user out.
- **Web target**: the API's CORS list only names the Next app, and a browser can't set a cross-site CSRF cookie. So the
  web build must be served same-origin with `/api`, which is what `scripts/serve-web.mjs` does.
- **Realtime**: `/api/w/events` is streamed with fetch (`expo/fetch` on devices). When the stream is down, screens poll
  every 30 s. TanStack Query with an AsyncStorage persister keeps the last data available offline.
- **Portal**: the richer endpoints (`/api/w/portal/projects…`, `/requests`) are feature-detected. On a 404 the app
  falls back to `/api/w/projects` and the issue intake. `GET /api/w/invoices/{id}/print` answers 403 to customers, so
  the invoice screen shows the details in the app instead.
- **Build**: one app, `com.fadymondy.mahaam` (`eas.json` profiles development / preview / production). Pass
  `EXPO_PUBLIC_API_URL=https://console.mahaam.app` for anything that leaves this machine.

### Mobile updates — Codemagic Patch (OTA)

Over-the-air JS updates go through our self-hosted **Codemagic Patch** server
(`https://patch.fadymondy.com`), the same one the Fady Mondy and Health Debug apps use — not EAS
Update. The build-time half is `apps/mobile/plugins/with-app-updates.js`; the runtime half is
`apps/mobile/src/lib/updates.tsx` (check on launch and on foreground → download with a progress pill →
install `ON_NEXT_RESTART` → "Update ready — Restart now / Later"; a mandatory release offers no Later
and restarts itself after 10 s; the running bundle is confirmed so a release that fails to boot is
rolled back).

- **expo-updates stays installed but disabled** (the synced grid calls it for the RTL reload). With an
  `updates.url` it would own bundle loading and Patch bundles would never boot; the plugin refuses that.
- **Signed releases only.** `apps/mobile/patch-public-key.pem` (the public half, committed — the same
  key as the other apps) is compiled into the binary and the SDK rejects anything it did not sign. The
  private key lives only in Codemagic (`CODEMAGIC_PATCH_PRIVATE_KEY`, group `patch`). Never commit it.
- **Until the deployment keys are set, OTA is off**: the plugin is not applied and the app never calls
  the SDK.

**One-time setup (owner):**
1. On `patch.fadymondy.com` create two apps, `mahaam` (iOS) and `mahaam-android`, each with a
   `Staging` and a `Production` deployment (`cmpatch app add …` or the dashboard).
2. Put the four deployment keys (`cmpatch deployment list --app <app> --format table`, DEPLOYMENT_KEY)
   into `PATCH_KEYS` in `apps/mobile/plugins/with-app-updates.js` — they are public identifiers — then
   ship a store build (the keys are compiled into the binary).
3. Point a Codemagic app at this repo (it reads `/codemagic.yaml`) and attach the groups `patch` and
   `mahaam_env` (`EXPO_PUBLIC_API_URL`, …).

**Publishing an OTA:** run the `ota-release` workflow in Codemagic. It checks both deployments are
configured, prebuilds (for the native fingerprint), and runs `cmpatch release-react` for iOS and
Android against the `version` in `app.config.ts`, signing each release. `PATCH_MANDATORY=true` makes
it a required update. Anything native needs a store build and a new version instead.
- **Not done yet**: device builds, store submission and remote push notifications. Reminders are local notifications
  only. The apps use the system font because the shared woff2 files are web-only.

## Clients — tray app and Chrome extension

`apps/` is an npm workspace with the employee clients. They use the same REST API as the web app
(no new endpoints):

- `apps/shared` (`@mahaam/client`) is a typed fetch client. Its types are generated from the OpenAPI
  spec with `npm run gen:types`, which reads a running API on :8120 by default or `MAHAAM_OPENAPI`.
  It also holds the SSE parser, the brand tokens and mark, and the shared React panel (en/ar,
  light/dark).
- `apps/tray` is the Electron menu-bar/tray app. It has a popover with sign-in, workspace picker,
  running timer, Next up with one-click start, quick log, today's entries and notifications. The
  timer shows in the tray title on macOS and in the tooltip on Windows, and there is a global
  shortcut (`Ctrl/⌘+Alt+Shift+M`) plus open-at-login.
- `apps/extension` is the Chrome MV3 extension. It has the same popup, a toolbar badge with the
  running timer's minutes, and a page context menu ("File an issue" / "Log time") that pre-fills an
  issue with the page URL.

```bash
cd apps && npm install
npm test                      # client + SSE parser unit tests (vitest)
npm run typecheck
npm run dev:tray              # Vite + Electron; sign-in defaults to MAHAAM_API_URL (dev: http://localhost:8120)
npm run build:tray            # renderer + main/preload + build/icon.png
npm run package:tray          # electron-builder installers for the current OS (dmg/zip, nsis, AppImage/deb)
npm run dev:extension         # popup in a normal tab (chrome.* shim, /api proxied to MAHAAM_DEV_API)
npm run build:extension       # dist/ → chrome://extensions → Load unpacked
MAHAAM_API_URL=http://localhost:8120 npm run build:extension   # default server + its host permission
npm run e2e:tray              # E2E_EMAIL/E2E_PASSWORD, built app, real API
npm run e2e:extension         # needs Chromium or Chrome for Testing (branded Chrome ignores --load-extension)
```

**Auth.** Native clients call `POST /api/auth/login` and then use `Authorization: Bearer <jwt>` +
`X-Workspace-ID`. Bearer requests skip CSRF, but the login POST does not. The tray's main process
sends a random value as both `Cookie: togo_csrf` and `X-CSRF-Token`. The extension can't set
`Cookie`, so it calls `GET /api/auth/csrf` with credentials first and echoes the token back. The
JWT lasts 24h.
- **Tray:** "Keep me signed in" stores the password in the OS keychain (Electron `safeStorage`).
  The client then logs in again silently when the token is about to expire or gets a 401. On Linux
  with no keyring nothing secret is stored.
- **Extension:** sign-in mints a personal access token named for the browser and keeps only that,
  in `chrome.storage.session` (memory, gone when the browser closes). A 401 sends you back to
  sign-in. Google/GitHub accounts have no password (the auth plugin stores `!sso`), so the popup
  also offers "Continue with Mahaam in this browser": with host permission its requests carry the
  web app's session cookie, and `tokenFromBrowserSession` mints the PAT from it
  (`GET /api/auth/me`, then CSRF-checked `POST /api/auth/tokens`). No session → it opens the
  sign-in page.

**Realtime.** Realtime uses `/api/w/events` read through fetch streaming, because EventSource
can't send the Bearer header.
- **Tray:** the main process keeps the stream open.
- **Extension:** the popup streams while it is open. The service worker polls
  `/api/w/time/running` once a minute (`chrome.alarms`) to keep the badge current.

**API limits.** Issues have no assignee in the API, so Next up shows my open tasks (in progress
first, in board order) followed by open issues I reported or that are in progress. A timer can't
target an issue directly, so starting one on an issue uses the issue's project with the issue key
as its description.

**Security.**
- **Tray:** the renderer is sandboxed with `contextIsolation` and no `nodeIntegration`. It makes
  no network calls: everything goes through a preload bridge with a fixed channel list to the main
  process. Production CSP is `default-src 'none'`.
- **Extension:** permissions are `storage`, `alarms` and `contextMenus`, plus a host permission
  for the configured API origin only. Other origins are optional and requested at sign-in or in
  the options page.
