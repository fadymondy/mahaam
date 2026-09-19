// Package server wires the togo kernel with both interfaces (Huma REST/OpenAPI
// and gqlgen GraphQL) and returns a ready App. It lives in its own package so
// both cmd/api (serve) and feature tests can boot the exact same stack.
package server

import (
	"context"
	"fmt"
	"github.com/fadymondy/mahaam/internal/push"
	"net/http"
	"runtime/debug"

	"github.com/99designs/gqlgen/graphql/handler"
	"github.com/99designs/gqlgen/graphql/playground"
	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/togo-framework/togo"

	"github.com/fadymondy/mahaam/internal/admin"
	"github.com/fadymondy/mahaam/internal/app"
	graphgen "github.com/fadymondy/mahaam/internal/graph/gen"
	"github.com/fadymondy/mahaam/internal/graph/resolvers"
	"github.com/fadymondy/mahaam/internal/integrations"
	"github.com/fadymondy/mahaam/internal/limits"
	"github.com/fadymondy/mahaam/internal/mcp"
	_ "github.com/fadymondy/mahaam/internal/plugins" // blank-imports installed plugins (togo install)
	"github.com/fadymondy/mahaam/internal/reports"
	"github.com/fadymondy/mahaam/internal/rest"
	"github.com/fadymondy/mahaam/internal/secretbox"
	"github.com/fadymondy/mahaam/internal/tenant"
	"github.com/fadymondy/mahaam/internal/work"
	"github.com/fadymondy/mahaam/internal/workspaces"
)

// Boot builds the kernel + app and mounts REST, GraphQL, MCP and health on the
// kernel router. It does not start listening — the caller calls Kernel.Serve.
func Boot() *app.App {
	k := togo.New()
	ctx := context.Background()
	a := app.New(ctx, k)

	// Fail closed: without the RLS-enforced app pool, generated CRUD would run
	// on the owner pool with no tenant isolation at all.
	if a.SysDB == nil || a.SQLDB == nil {
		panic("mahaam: DATABASE_URL (owner) and APP_DATABASE_URL (app role) are both required — see README")
	}
	// Secrets at rest (integration credentials): refuse to boot in production without MAHAAM_SECRET_KEY.
	if err := secretbox.Init(k.Log); err != nil {
		panic(err)
	}
	if err := tenant.VerifyAppRole(ctx, a.SQLDB); err != nil {
		panic(err)
	}
	if _, err := reports.EnsurePlatform(ctx, a); err != nil {
		panic(fmt.Errorf("mahaam: platform workspace: %w", err))
	}

	// Plans and quotas (internal/limits): the owner pool, plus the minute flusher of the API meter.
	limits.Init(ctx, a.SysDB, a.Log)

	installErrors()
	installGuard(k, a)
	// Client address + user agent for activity entries (RemoteAddr, never forwarding headers).
	k.UseMiddleware(work.MetaMiddleware)

	api := humachi.New(k.Router, huma.DefaultConfig("Mahaam API", "0.1.0"))
	registerREST(api, a)

	mcp.Mount(k, a)
	// P2: the per-user realtime stream (timer.started / timer.stopped / entry.changed / notification.*).
	// Under /api/w/, so the guard resolves session + membership first and the stream can only carry the
	// caller's own events (internal/live). The scaffold's global /events stays unmounted.
	k.Router.Get("/api/w/events", work.New(a).Events())
	installReminders(k, a)
	installBilling(k, a)      // Polar: PUBLIC webhook + the 15-minute usage push
	installIntegrations(k, a) // GitHub webhook + install callback (PUBLIC), Jira/Linear re-sync, GitHub mirror
	// Customer import: the Google Contacts OAuth redirect (PUBLIC, guard allowlist; signed state + nonce cookie).
	k.Router.Get(work.GoogleCallbackPath, work.New(a).GoogleCallback())
	// "Connect GitHub" for a member: the GitHub OAuth redirect (PUBLIC, guard allowlist; signed state + nonce cookie).
	k.Router.Get(work.GitHubUserCallbackPath, work.New(a).GitHubUserCallback())
	reports.MountFeedback(k, a)
	reports.MountEmbed(k, a)             // P7: PUBLIC per-project embed intake + the /embed/v1.js loader
	reports.MountPortalFile(k, a)        // P7: the client portal's multipart issue intake
	reports.MountPortalRequestFile(k, a) // roadmap 5: a customer files a request (multipart)
	reports.MountScreenshots(k, a)       // P8.5: an issue / request screenshot (staff, or the project's customer)

	gql := handler.NewDefaultServer(graphgen.NewExecutableSchema(graphgen.Config{
		Resolvers: &resolvers.Resolver{App: a},
	}))
	k.Router.Handle(k.Config.GraphQLPath, gql)
	k.Router.Handle("/graphql/play", playground.Handler("Mahaam GraphQL", k.Config.GraphQLPath))

	k.Router.Get("/api/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprintf(w, `{"status":"ok","service":"mahaam","togo":%q}`, togoVersion())
	})

	// Deliberately NOT mounted from the scaffold:
	//   /events               — one global SSE stream; would broadcast every
	//                           tenant's rows to every subscriber (see app.Emit).
	//   /api/_meta/resources  — the dashboard plugin's schema dump; no dashboard.
	return a
}

func registerREST(api huma.API, a *app.App) {
	rest.RegisterRoutes(api, a) // generated CRUD — behind the guard's workspace tier
	workspaces.Register(api, a)
	mcp.RegisterTokenRoutes(api, a)
	work.Register(api, a)                // P1: clients, teams, projects, tasks, labels, activity — /api/w/*
	reports.RegisterIssues(api, a)       // per-workspace issues — /api/w/issues/*
	reports.RegisterPortalIssues(api, a) // P7: the client's own filed issues — GET /api/w/portal/issues
	reports.RegisterPortalPanel(api, a)  // roadmap 5: customer panel + staff Requests inbox
	integrations.Register(api, a)        // /api/w/projects/{project}/integrations*, /github/*
	registerPush(api, a)                 // /api/me/push: Web Push for the installed app (PWA)
	admin.Register(api, a)               // /api/admin/* (platform admins), /api/me/platform, /api/w/plan
}

// togoVersion reports the togo framework version this app is built against.
func togoVersion() string {
	if info, ok := debug.ReadBuildInfo(); ok {
		for _, d := range info.Deps {
			if d.Path == "github.com/togo-framework/togo" {
				return d.Version
			}
		}
	}
	return "dev"
}

// OpenAPI returns the generated OpenAPI 3.1 document (used by `togo generate`).
func OpenAPI() ([]byte, error) {
	router := chi.NewMux()
	installErrors()
	api := humachi.New(router, huma.DefaultConfig("Mahaam API", "0.1.0"))
	registerREST(api, nil)
	return api.OpenAPI().YAML()
}

func registerPush(api huma.API, a *app.App) {
	if a == nil {
		push.Register(api, push.New(nil, nil))
		return
	}
	push.Register(api, push.New(a.SysDB, a.Log))
}
