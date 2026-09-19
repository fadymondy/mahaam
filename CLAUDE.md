# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Mahaam: project management and time tracking. It's built on the togo framework (Go: chi + Huma REST + gqlgen + sqlc + Postgres) with a Next.js 16 frontend in `web/`. `README.md` is the detailed design record. It has per-phase invariants (P0–P7) and a numbered list of **togo framework defects and workarounds**. Read the relevant section before you change tenancy, time tracking, reports, MCP or codegen. Project conventions are in `.claude/rules/conventions.md`.

## Commands

```bash
make db          # Postgres in docker (container mahaam-postgres, :55460; DBs mahaam, mahaam_test)
make migrate     # go run ./cmd/migrate — schema, app role, constraints, RLS (idempotent; our own, not `togo migrate`)
make api         # API on :8110 (REST /api, GraphQL /graphql, docs /docs, MCP /api/mcp, admin MCP /api/admin/mcp)
make web         # Next dev on :3010, proxies /api/* and /graphql to :8110
make generate    # togo generate: sqlc → gqlgen → atlas diff → OpenAPI export (compiles the whole program = integration gate)
make test        # go test ./... — unit tests + CI guards
make test-e2e    # real stack on mahaam_test: isolation sweep, TestTimeTracking, TestReports, TestMCPSession
make grid-check  # web/app/styles grid + web/lib/feedback must match ../fadymondy.com-v2 copies
make embed       # bundle the feedback widget → embed/dist/v1.js
cd web && npm run typecheck
```

Single test: `go test -count=1 ./internal/work -run TestName -v`. E2E tests in `internal/server` need `TEST_DATABASE_URL` and `TEST_APP_DATABASE_URL` (see the Makefile `test-e2e` target). Browser checks are Node scripts: `cd web && node e2e/<name>.mjs` with the API and web running. They wait for `load`, not `networkidle`, because the SSE stream keeps a request open.

Admin bootstrap: `go run ./cmd/mahaam-admin promote <email>`, then `go run ./cmd/mahaam-admin token <email> -name x -scopes ...`.

**`togo generate` exits 0 and prints "Codegen complete" even when gqlgen or the OpenAPI gate fails.** Grep its output for failures. Don't trust the last line.

## Architecture

- **One domain layer: `internal/work`.** REST routes under `/api/w/*` (`routes*.go`) and the MCP tools (`internal/mcp/*_tools.go`) call the same functions, so browser and agent share one authorization path. Generated togo CRUD (`internal/resources`, `internal/rest`, `internal/graph`) is read-only and manager+ via `authz.Generated` (`internal/authz/can.go`, default-deny per table). All writes go through `/api/w/*`, which validates and records activity.
- **Tenancy**: `workspace_id` on every tenant row. The API resolves `X-Workspace-ID` (id or slug). Not a member → 404, no session → 401, and a project you can't see → 404. One default-deny guard (`internal/server/guard.go`) wraps every route, plugin routes included. It also blocks unsafe plugin routes such as `/api/settings`, `/api/export`, and `/api/import`.
- **Two DB pools / RLS**: `DATABASE_URL` is the owner, used for migrations, auth, tenant resolution, admin MCP, and explicit predicates. `APP_DATABASE_URL` is `mahaam_app`, which has no BYPASSRLS. Every ORM/generated query runs on the app pool through `internal/tenant/rlsdb.go`, which sets `app.workspace_id` before each statement. Boot refuses to start if the app role could bypass RLS.
- **Integrity lives in Postgres**: composite FKs on `(workspace_id, ref)` and time-entry constraints (one running timer, no overlap, generated duration) are in `internal/db/schema/*.sql` and `internal/db/post/*.sql` (constraints and RLS, applied by `cmd/migrate`). Schema files are hand-written Postgres. `make:resource` emits SQLite DDL, so fix its output.
- **CI guards run under `make test`**: every MCP tool must declare a scope (`scopes_test.go`); every sqlc query on a tenant table must carry `workspace_id = $n`; the authz matrix; every Huma `{param}` must be bound (`internal/server/params_test.go`). Huma silently skips fields promoted through unexported embedded structs.
- **Activity** (`activity_logs`) is written in the same transaction as the change, and notifications derive from it. Don't use togo `audit`.
- **Realtime** is Mahaam's own `internal/live` (SSE at `/api/w/events`, one per user per workspace, in-process). togo realtime is deliberately not used.
- **MCP**: user tokens are `mgy_`: explicit scopes, no wildcard, narrowed to the user's current role on every call. Admin tokens are `mga_` and reserved for platform admins. Rate limiting calls togo `ratelimit`'s `Allow` directly and writes a JSON-RPC 429 response.
- **Money/time**: rates are snapshotted on the entry at creation. Days are cut at local midnight in the workspace timezone. Rounding is applied only at report time (`internal/work/reports.go`).
- **Web**: routes are `web/app/[locale]/w/{slug}/...`, with en/ar strings in `web/lang/*.{en,ar}.json`. The UI must work in en/ar × light/dark. `web/lib/feedback` and the grid styles are synced copies, so don't hand-edit them. **Next 16 differs from training data**: read `web/node_modules/next/dist/docs/` before writing Next code (`web/AGENTS.md`).

## Codegen ownership

- Add entities with `togo make:resource`; `togo.resources.yaml` is the source of truth. Expect to fix its known defects, which are listed in the README togo notes.
- Never hand-edit `*.gen.go` registries or `internal/**/gen/` (sqlc/gqlgen output). Exception: `plugins.gen.go` has a hand-written header that `togo install` strips, so re-add it after every install.
- Every resource is exposed over both GraphQL and REST/OpenAPI. Config comes from `togo.yaml` + `.env`, loaded by `internal/envfile` because the kernel doesn't read `.env`. Never hard-code URLs or connections.
