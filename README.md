# Managy

Project management and time tracking — a rebuild of `fadymondy/3x1projects` on
[ToGO](https://github.com/togo-framework) (Go: chi + Huma + gqlgen + sqlc + Postgres)
and Next.js 16 on the fadymondy.com grid. Plan: `fadymondy.com-v2/.setup/plans/imanage.md`
(renamed iManage → Managy on 2026-09-14).

**Status: P5 — local development (public preview at https://managy-app.fadymondy.com via a tunnel to the dev servers).** No deploy, no DNS. P0 (tenancy, RLS, MCP, feedback)
plus P1: clients, projects, teams, per-project statuses, tasks with board/list, checklist,
subtasks, labels, comments with @mentions, attachments and the activity feed; P2: time tracking —
the timer, timesheets, rates, realtime sync and reminders; P3: MCP rate limits and report tools; P5: reports,
budgets, profitability, exports, saved views, notification events, email and the daily digest.

## Ports (local dev)

| What | Port |
|---|---|
| API (Go) | **8110** — REST `/api`, GraphQL `/graphql`, docs `/docs`, MCP `/api/mcp`, admin MCP `/api/admin/mcp` |
| Web (Next dev) | **3010** — proxies `/api/*` and `/graphql` to 8110 |
| Postgres (docker compose, container `managy-postgres`) | **55460** — databases `managy`, `managy_test` |

## Run it

```bash
cp .env.example .env           # set the managy_app password and AUTH_SECRET
make db                        # Postgres on :55460
make migrate                   # schema, app role, FKs, RLS (idempotent)
make api                       # :8110
make web                       # :3010  (first time: cd web && npm install)
```

Open http://localhost:3010 → register → create a workspace.

Admin MCP bootstrap (after registering in the UI):

```bash
go run ./cmd/managy-admin promote you@example.com
go run ./cmd/managy-admin token you@example.com -name "claude" -scopes admin:issues:read,admin:issues:write
```

User MCP tokens are minted in the app: Workspace → MCP tokens.

## Tests

```bash
make test       # unit + CI guards: every MCP tool has a scope; every sqlc query on a
                # tenant table carries workspace_id = $n; authz matrix; slugs
make test-e2e   # boots the real stack on managy_test: the route sweep, TestTimeTracking, TestReports, TestMCPSession; sweeps EVERY route as
                # anonymous / non-member / other-workspace member (+ MCP checks)
make grid-check # generated grid + feedback-sdk copies match fadymondy.com-v2
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
- **Activity** (`activity_logs`): written by Managy in the transaction of the change; the actor
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
  user colours are palette keys mapped to `app/styles/managy-palette.css`.

Browser check (headless Chrome, fresh profile; counts animation frames first): with the API and
web running, `cd web && node e2e/p1-verify.mjs` — drag-and-drop persists across reload, the
Claude-style MCP flow lands on the board, the side-over's checklist / @mention / upload /
activity work, and board + side-over are screenshotted in en/ar × light/dark (`web/e2e/shots/`).

## P2 — time tracking

- **Invariants in Postgres** (`internal/db/schema/time_entry.sql`, `internal/db/post/12_p2_constraints.sql`):
  `one_running_timer` (unique partial index on `(workspace_id, user_id) WHERE ended_at IS NULL`),
  `no_overlap` (gist exclusion, btree_gist), `duration_s` GENERATED, `source` timer|manual|mcp|import,
  `invoice_id` / `locked_at` reserved (a set value makes the entry immutable). Deviations from the plan:
  `no_overlap` also keys on `workspace_id` (a cross-tenant constraint leaks another workspace's rows and
  contradicts the per-workspace running index); `user_id` references `users`, not `workspace_members`
  (removing a member deletes the membership row — a composite key would cascade billing history away or
  block the removal; membership is checked on every write instead). The task reference is
  `(workspace_id, project_id, task_id)`, so a task always belongs to the entry's project.
- **Start stops the running timer in the same transaction**, serialised per person by
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
  `private-` channel by name. Fan-out is in-process (one API instance; several need LISTEN/NOTIFY).
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
timesheet, a 23:00–01:00 manual entry, en/ar × light/dark at 1440 and 390; `WEB_ORIGIN=https://managy-app.fadymondy.com`
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
  `cd web && node e2e/p3-mcp.mjs` (`WEB_ORIGIN=https://managy-app.fadymondy.com` for the preview; on this machine Node
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

## Tenancy

- `workspaces`, `workspace_members` (owner/admin/manager/member/client), `invitations`;
  `workspace_id` on every tenant row. Web routes `/[locale]/w/{slug}`; the API reads
  `X-Workspace-ID` (id or slug). Not a member → **404**, no session → **401**.
- One default-deny guard (`internal/server/guard.go`) wraps every route incl. plugin routes.
  Generated CRUD sits in the workspace tier **and** behind `authz.Generated`
  (`internal/authz/can.go`), which is itself default-deny per table. Tenancy tables are
  read-only through generated CRUD; membership changes go through `/api/w/*` and `/api/me/*`.
- **RLS**: two pools. `DATABASE_URL` = owner (migrations, auth, tenant resolution, admin MCP,
  explicit predicates everywhere). `APP_DATABASE_URL` = `managy_app` (no superuser, no
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
    its in-memory store never evicts keys. Managy calls `Allow` and writes a JSON-RPC 429 itself.
19. togo `import-export` mounts `GET /api/export/{resource}` and `POST /api/import/{resource}` with no auth over a
    process-global registry (blocked in the guard); it writes every XLSX cell as text and does nothing about
    spreadsheet formula injection.
20. togo `mail`'s `log` driver records only recipient and subject, so nothing can be checked — Managy registers a
    `file` driver (`internal/mailer`).
21. `make:resource` types a nullable `date` field as `String!` in GraphQL and a non-pointer `time.Time` in the
    resource and handler (retyped).
