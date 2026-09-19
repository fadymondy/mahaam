package work

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"

	"github.com/danielgtaylor/huma/v2"
)

/*
Customer import and report documents:

	GET  /api/w/clients/import/sources          which optional sources are configured (manager+)
	POST /api/w/clients/import/preview          parse + plan, nothing written (manager+)
	POST /api/w/clients/import/commit           re-plan + apply (manager+)
	POST /api/w/clients/import/google/start     Google consent URL + nonce cookie (manager+)
	GET  /api/w/projects/{project}/report       the project report as pdf | md | json (reports:read)

The Google OAuth callback is PUBLIC and mounted outside Huma (internal/server, guard allowlist).
The static /api/w/clients/import/* paths register before /api/w/clients/{client} matches them:
chi prefers static segments, and these are POSTs where {client} has only GET/PATCH.
*/

type googleStartOut struct {
	SetCookie http.Cookie `header:"Set-Cookie"`
	Body      struct {
		URL string `json:"url"`
	}
}

func (r routes) clientImport() {
	const tag = "Clients"
	do(r, http.MethodGet, "/api/w/clients/import/sources", "w-client-import-sources", "Customer import: configured sources and limits", tag, 0,
		func(ctx context.Context, _ *WS) (*ImportSourceStatus, error) {
			return r.sv.ClientImportSources(ctx)
		})
	huma.Register(r.api, huma.Operation{
		OperationID: "w-client-import-preview", Method: http.MethodPost, Path: "/api/w/clients/import/preview",
		Summary: "Customer import: parse, map and match rows (nothing is written)", Tags: []string{tag}, MaxBodyBytes: MaxImportBytes*2 + 1<<20,
	}, func(ctx context.Context, in *struct {
		WS
		Body ClientImportInput
	}) (*Resp[*ClientImportPreview], error) {
		out, err := r.sv.PreviewClientImport(ctx, in.Body)
		if err != nil {
			return nil, r.fail(err)
		}
		return &Resp[*ClientImportPreview]{Body: out}, nil
	})
	huma.Register(r.api, huma.Operation{
		OperationID: "w-client-import-commit", Method: http.MethodPost, Path: "/api/w/clients/import/commit",
		Summary: "Customer import: create / update clients; invalid rows are reported, the rest imported", Tags: []string{tag},
		MaxBodyBytes: MaxImportBytes*2 + 1<<20,
	}, func(ctx context.Context, in *struct {
		WS
		Body ClientImportInput
	}) (*Resp[*ClientImportResult], error) {
		out, err := r.sv.CommitClientImport(ctx, in.Body)
		if err != nil {
			return nil, r.fail(err)
		}
		return &Resp[*ClientImportResult]{Body: out}, nil
	})
	huma.Register(r.api, huma.Operation{
		OperationID: "w-client-import-google-start", Method: http.MethodPost, Path: "/api/w/clients/import/google/start",
		Summary: "Customer import: Google Contacts consent URL", Tags: []string{tag},
	}, func(ctx context.Context, in *struct {
		WS
		Locale string `query:"locale" enum:"en,ar," doc:"Where the callback returns to (default en)"`
	}) (*googleStartOut, error) {
		st, err := r.sv.StartGoogleImport(ctx, in.Locale)
		if err != nil {
			return nil, r.fail(err)
		}
		out := &googleStartOut{SetCookie: *st.Cookie}
		out.Body.URL = st.URL
		return out, nil
	})

	huma.Register(r.api, huma.Operation{
		OperationID: "w-project-report", Method: http.MethodGet, Path: "/api/w/projects/{project}/report",
		Summary: "Project report: summary, progress, budget, time by member / week, open issues, activity (pdf | md | json)",
		Tags:    []string{"Reports"},
	}, func(ctx context.Context, in *struct {
		WS
		ProjectRef
		Format string `query:"format" enum:"pdf,md,json," doc:"Default pdf"`
		Lang   string `query:"lang" enum:"en,ar," doc:"Document language (default en)"`
		From   string `query:"from" doc:"YYYY-MM-DD; default the project's start"`
		To     string `query:"to" doc:"YYYY-MM-DD; default today"`
	}) (*exportOut, error) {
		f, rep, err := r.sv.ExportProjectReport(ctx, in.Project, in.Format, in.Lang, in.From, in.To)
		if err != nil {
			return nil, r.fail(err)
		}
		if f == nil {
			body, err := json.Marshal(rep)
			if err != nil {
				return nil, r.fail(err)
			}
			return &exportOut{ContentType: "application/json", NoSniff: "nosniff", Cache: "no-store", Body: body}, nil
		}
		return &exportOut{ContentType: f.ContentType, NoSniff: "nosniff", Cache: "no-store",
			Disposition: "attachment; filename*=UTF-8''" + url.PathEscape(f.Name), Body: f.Data}, nil
	})
}
