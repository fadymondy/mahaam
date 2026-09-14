# Managy

Project management and time tracking — a rebuild of `fadymondy/3x1projects` on
[ToGO](https://github.com/togo-framework) (Go: chi + Huma + gqlgen + sqlc + Postgres)
and Next.js 16 on the fadymondy.com grid. Plan: `fadymondy.com-v2/.setup/plans/imanage.md`
(renamed iManage → Managy on 2026-09-14).

**Status: P1 — local development only.** No deploy, no DNS. P0 (tenancy, RLS, MCP, feedback)
plus P1: clients, projects, teams, per-project statuses, tasks with board/list, checklist,
subtasks, labels, comments with @mentions, attachments and the activity feed.

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
make test-e2e   # boots the real stack on managy_test and sweeps EVERY route as
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
  `list_feedback`, `get_feedback`, `comment_feedback`. Tools (P1, `internal/mcp/work_tools.go`):
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
