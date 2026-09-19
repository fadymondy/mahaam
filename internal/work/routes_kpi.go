package work

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"
)

/*
Employee KPI, manager reviews and per-user GitHub accounts (kpi.go, github_accounts.go):

	GET    /api/w/me/github                     your GitHub connection (+ whether OAuth is configured)
	GET    /api/w/me/github/connect             GitHub authorize URL + nonce cookie (kpi:read)
	DELETE /api/w/me/github                     disconnect yours
	GET    /api/w/members/{user}/github         a member's mapping (self, or kpi:all)
	PUT    /api/w/members/{user}/github         map a member to a login + e-mails (kpi:all)
	DELETE /api/w/members/{user}/github         remove a member's mapping (self, or kpi:all)
	GET    /api/w/members/{user}/kpi            the KPI JSON (self, or kpi:all)
	GET    /api/w/members/{user}/kpi/dossier    the markdown dossier + the AI prompt
	GET    /api/w/members/{user}/reviews        reviews (self, or kpi:all)
	POST   /api/w/members/{user}/reviews        add a review (kpi:review)
	DELETE /api/w/reviews/{review}              delete a review (kpi:review)
	GET    /api/w/kpi/team                      one headline row per employee (kpi:all)

{user} is a user id, an e-mail or "me". The OAuth callback is PUBLIC and mounted outside Huma
(internal/server, guard allowlist).
*/

// ReviewRef is the {review} path parameter. Exported so Huma binds it.
type ReviewRef struct {
	Review string `path:"review" doc:"Review id"`
}

// KPIRangeQuery is the from/to query. Exported so Huma binds it when embedded.
type KPIRangeQuery struct {
	From string `query:"from" doc:"YYYY-MM-DD, workspace timezone (default: the 1st of this month)"`
	To   string `query:"to" doc:"YYYY-MM-DD inclusive (default: today)"`
}

// KPIDossier is GET …/kpi/dossier.
type KPIDossier struct {
	Markdown string `json:"markdown"`
	Prompt   string `json:"prompt" doc:"An instruction to put in front of the dossier for an AI to write the report"`
}

// ReviewList is GET …/reviews.
type ReviewList struct {
	Reviews []MemberReview `json:"reviews"`
}

type githubConnectOut struct {
	SetCookie http.Cookie `header:"Set-Cookie"`
	Body      struct {
		URL string `json:"url"`
	}
}

func (r routes) kpi() {
	const tag = "KPI"
	do(r, http.MethodGet, "/api/w/me/github", "w-my-github", "Your GitHub connection", tag, 0, func(ctx context.Context, _ *WS) (*GitHubStatus, error) {
		return r.sv.GitHubAccountOf(ctx, "me")
	})
	huma.Register(r.api, huma.Operation{
		OperationID: "w-my-github-connect", Method: http.MethodGet, Path: "/api/w/me/github/connect",
		Summary: "Connect GitHub: the authorize URL (sets a nonce cookie for the callback)", Tags: []string{tag},
	}, func(ctx context.Context, in *struct {
		WS
		Locale string `query:"locale" enum:"en,ar," doc:"Where the callback returns to (default en)"`
	}) (*githubConnectOut, error) {
		st, err := r.sv.GitHubConnectURL(ctx, in.Locale)
		if err != nil {
			return nil, r.fail(err)
		}
		out := &githubConnectOut{SetCookie: *st.Cookie}
		out.Body.URL = st.URL
		return out, nil
	})
	none(r, http.MethodDelete, "/api/w/me/github", "w-my-github-disconnect", "Disconnect your GitHub account", tag, func(ctx context.Context, _ *WS) error {
		return r.sv.DisconnectGitHub(ctx, "me")
	})

	do(r, http.MethodGet, "/api/w/members/{user}/github", "w-member-github", "A member's GitHub mapping", tag, 0, func(ctx context.Context, in *struct {
		WS
		UserRef
	}) (*GitHubStatus, error) {
		return r.sv.GitHubAccountOf(ctx, in.User)
	})
	do(r, http.MethodPut, "/api/w/members/{user}/github", "w-set-member-github", "Map a member to a GitHub login + e-mails (manager+)", tag, 0, func(ctx context.Context, in *struct {
		WS
		UserRef
		Body GitHubMapping
	}) (*GitHubStatus, error) {
		return r.sv.SetMemberGitHub(ctx, in.User, in.Body)
	})
	none(r, http.MethodDelete, "/api/w/members/{user}/github", "w-delete-member-github", "Remove a member's GitHub mapping", tag, func(ctx context.Context, in *struct {
		WS
		UserRef
	}) error {
		return r.sv.DisconnectGitHub(ctx, in.User)
	})

	do(r, http.MethodGet, "/api/w/members/{user}/kpi", "w-member-kpi", "A member's KPI: time, tasks, agent issues, AI, GitHub, MCP, reviews", tag, 0, func(ctx context.Context, in *struct {
		WS
		UserRef
		KPIRangeQuery
	}) (*KPI, error) {
		return r.sv.MemberKPI(ctx, in.User, KPIQuery{From: in.From, To: in.To})
	})
	do(r, http.MethodGet, "/api/w/members/{user}/kpi/dossier", "w-member-kpi-dossier", "A member's KPI as a markdown dossier for an AI to write the report", tag, 0, func(ctx context.Context, in *struct {
		WS
		UserRef
		KPIRangeQuery
	}) (*KPIDossier, error) {
		k, err := r.sv.MemberKPI(ctx, in.User, KPIQuery{From: in.From, To: in.To})
		if err != nil {
			return nil, err
		}
		return &KPIDossier{Markdown: KPIMarkdown(k), Prompt: KPIPrompt}, nil
	})
	do(r, http.MethodGet, "/api/w/members/{user}/reviews", "w-member-reviews", "A member's reviews", tag, 0, func(ctx context.Context, in *struct {
		WS
		UserRef
		KPIRangeQuery
	}) (ReviewList, error) {
		list, err := r.sv.ListReviews(ctx, in.User, in.From, in.To)
		return ReviewList{Reviews: list}, err
	})
	do(r, http.MethodPost, "/api/w/members/{user}/reviews", "w-add-member-review", "Review an employee for a period (manager+)", tag, http.StatusCreated, func(ctx context.Context, in *struct {
		WS
		UserRef
		Body ReviewInput
	}) (*MemberReview, error) {
		return r.sv.AddReview(ctx, in.User, in.Body)
	})
	none(r, http.MethodDelete, "/api/w/reviews/{review}", "w-delete-member-review", "Delete a review (manager+)", tag, func(ctx context.Context, in *struct {
		WS
		ReviewRef
	}) error {
		return r.sv.DeleteReview(ctx, in.Review)
	})
	do(r, http.MethodGet, "/api/w/kpi/team", "w-team-kpi", "One headline KPI row per employee (manager+)", tag, 0, func(ctx context.Context, in *struct {
		WS
		KPIRangeQuery
	}) (*TeamKPI, error) {
		return r.sv.TeamKPIs(ctx, KPIQuery{From: in.From, To: in.To})
	})
}
