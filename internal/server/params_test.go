package server

import (
	"regexp"
	"sort"
	"strings"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
)

/*
TestEveryPathParamIsBound fails when an operation's path names a {param} that Huma did not
bind to an input field.

Huma v2.27 silently skips any field promoted through an UNEXPORTED embedded struct: the path
parameter is never bound, there is no registration error and no 422 — the handler just
receives "", which in Managy reads as "not found". It shipped once in P1 (every /api/w/*
input embedded lower-case `ws` / `taskRef` types) and was caught by the isolation sweep's
fixtures; this guard catches it at build time for every route, P0 included. (P0's embedded
`wsHeader` has the same defect for its X-Workspace-ID header parameter — harmless, the guard
middleware reads the raw header — so only the OpenAPI docs miss it.)
*/
func TestEveryPathParamIsBound(t *testing.T) {
	router := chi.NewMux()
	api := humachi.New(router, huma.DefaultConfig("Managy API", "0.1.0"))
	registerREST(api, nil)

	brace := regexp.MustCompile(`\{([^}]+)\}`)
	checked := 0
	for path, item := range api.OpenAPI().Paths {
		want := []string{}
		for _, m := range brace.FindAllStringSubmatch(path, -1) {
			want = append(want, m[1])
		}
		sort.Strings(want)
		for method, op := range map[string]*huma.Operation{
			"GET": item.Get, "POST": item.Post, "PUT": item.Put, "PATCH": item.Patch, "DELETE": item.Delete,
		} {
			if op == nil {
				continue
			}
			checked++
			got := []string{}
			for _, p := range op.Parameters {
				if p.In == "path" {
					got = append(got, p.Name)
				}
			}
			sort.Strings(got)
			if strings.Join(got, ",") != strings.Join(want, ",") {
				t.Errorf("%s %s binds path params [%s], the path declares [%s] — declare them at most one embedding level deep",
					method, path, strings.Join(got, ","), strings.Join(want, ","))
			}
		}
	}
	if checked < 60 {
		t.Fatalf("checked only %d operations — is registerREST still wired?", checked)
	}
	t.Logf("%d operations: every path parameter is bound", checked)
}
