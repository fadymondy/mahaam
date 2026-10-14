package integrations

import (
	"context"
	"net/http"
	"net/url"
	"os"
	"strings"

	"github.com/danielgtaylor/huma/v2"
	"github.com/togo-framework/togo"

	"github.com/fadymondy/mahaam/internal/app"
	"github.com/fadymondy/mahaam/internal/work"
)

/*
Register mounts the workspace-tier REST surface, all under /api/w/projects/{project}/…, so the
guard resolves session + membership first and the project must be visible (404 otherwise):

	GET    …/integrations                      list (integrations:read)
	PUT    …/integrations/jira | /linear       connect / reconfigure (integrations:manage)
	DELETE …/integrations/{provider}           disconnect
	POST   …/integrations/{provider}/sync      import now
	GET    …/integrations/github/install       the GitHub App install URL (signed state)
	GET    …/integrations/github/repos         repositories the installation can access
	PUT    …/integrations/github/repo          link one
	GET    …/github/{commits,pulls,runs,deployments,workflows}
	POST   …/github/deploy                     workflow_dispatch (github:deploy)
	POST   …/github/issues                     file a GitHub issue from an MG issue (github:issues)
	GET    …/integrations/hosbah/methods       which ways to connect (CircleXO, Hosbah OAuth) the caller has
	POST   …/integrations/hosbah/authorize     the OAuth authorization URL (+ a nonce cookie)
	POST   …/integrations/hosbah/apps          the apps the pending CircleXO sign-in can see
	PUT    …/integrations/hosbah               link one app (Hosbah mints an app token)
	GET    …/hosting                           the linked app + recent deployments (integrations:read)
	POST   …/hosting/deploy                    deploy it (integrations:manage)

and the customer side, under /api/w/portal/projects/{project}/… (portal:read):

	GET    …/hosting                           name, status, domains, whether the caller can open the panel
	POST   …/hosting/panel                     a one-time auto-login link into the app's hosting panel

Mount adds the two PUBLIC endpoints (guard allowlist): the install callback and the webhook.
*/
func Register(api huma.API, a *app.App) {
	sv := New(a)
	const tag = "Integrations"
	type P struct {
		work.WS
		work.ProjectRef
	}
	type Prov struct {
		work.WS
		work.ProjectRef
		Provider string `path:"provider" doc:"github, jira, linear or hosbah"`
	}

	reg(api, sv, http.MethodGet, "/api/w/projects/{project}/integrations", "w-list-integrations", "Project integrations", tag, 0,
		func(ctx context.Context, in *P) (IntegrationList, error) {
			l, err := sv.List(ctx, in.Project)
			return IntegrationList{Integrations: l}, err
		})
	reg(api, sv, http.MethodPut, "/api/w/projects/{project}/integrations/jira", "w-connect-jira", "Connect Jira import", tag, 0,
		func(ctx context.Context, in *struct {
			P
			Body JiraInput
		}) (*Integration, error) {
			return sv.ConnectJira(ctx, in.Project, in.Body)
		})
	reg(api, sv, http.MethodPut, "/api/w/projects/{project}/integrations/linear", "w-connect-linear", "Connect Linear import", tag, 0,
		func(ctx context.Context, in *struct {
			P
			Body LinearInput
		}) (*Integration, error) {
			return sv.ConnectLinear(ctx, in.Project, in.Body)
		})
	huma.Register(api, huma.Operation{OperationID: "w-disconnect-integration", Method: http.MethodDelete,
		Path: "/api/w/projects/{project}/integrations/{provider}", Summary: "Disconnect an integration", Tags: []string{tag}, DefaultStatus: http.StatusNoContent},
		func(ctx context.Context, in *Prov) (*struct{}, error) {
			if err := sv.Disconnect(ctx, in.Project, in.Provider); err != nil {
				return nil, sv.fail(err)
			}
			return &struct{}{}, nil
		})
	reg(api, sv, http.MethodPost, "/api/w/projects/{project}/integrations/{provider}/sync", "w-sync-integration", "Sync an integration now", tag, 0,
		func(ctx context.Context, in *Prov) (*SyncResult, error) {
			return sv.Sync(ctx, in.Project, in.Provider)
		})
	reg(api, sv, http.MethodGet, "/api/w/projects/{project}/integrations/github/install", "w-github-install", "GitHub App install URL", tag, 0,
		func(ctx context.Context, in *struct {
			P
			Locale string `query:"locale" doc:"en or ar — where the callback sends the browser back"`
		}) (InstallLink, error) {
			u, err := sv.InstallURL(ctx, in.Project, in.Locale)
			return InstallLink{URL: u}, err
		})
	reg(api, sv, http.MethodGet, "/api/w/projects/{project}/integrations/github/repos", "w-github-repos", "Repositories the installation can access", tag, 0,
		func(ctx context.Context, in *P) (RepoList, error) {
			l, err := sv.Repos(ctx, in.Project)
			return RepoList{Repos: l}, err
		})
	reg(api, sv, http.MethodPut, "/api/w/projects/{project}/integrations/github/repo", "w-github-link-repo", "Link a repository", tag, 0,
		func(ctx context.Context, in *struct {
			P
			Body struct {
				Repo string `json:"repo" doc:"owner/name"`
			}
		}) (*Integration, error) {
			return sv.LinkRepo(ctx, in.Project, in.Body.Repo)
		})

	reg(api, sv, http.MethodPost, "/api/w/projects/{project}/integrations/hosbah/apps", "w-hosbah-apps", "Hosbah apps the CircleXO sign-in can see", tag, 0,
		func(ctx context.Context, in *struct {
			P
			Body HosbahAppsInput
		}) (HosbahAppList, error) {
			l, err := sv.HosbahApps(ctx, in.Project, in.Body)
			return HosbahAppList{Apps: l}, err
		})
	reg(api, sv, http.MethodPut, "/api/w/projects/{project}/integrations/hosbah", "w-connect-hosbah", "Link a Hosbah app", tag, 0,
		func(ctx context.Context, in *struct {
			P
			Body HosbahInput
		}) (*Integration, error) {
			return sv.ConnectHosbah(ctx, in.Project, in.Body)
		})

	reg(api, sv, http.MethodGet, "/api/w/projects/{project}/integrations/hosbah/methods", "w-hosbah-methods", "Ways to connect Hosbah", tag, 0,
		func(ctx context.Context, in *P) (*HosbahMethods, error) {
			return sv.HosbahConnectMethods(ctx, in.Project)
		})
	huma.Register(api, huma.Operation{
		OperationID: "w-hosbah-authorize", Method: http.MethodPost, Path: "/api/w/projects/{project}/integrations/hosbah/authorize",
		Summary: "Start connecting Hosbah (OAuth)", Tags: []string{tag},
	}, func(ctx context.Context, in *struct {
		P
		Body struct {
			Via    string `json:"via" enum:"circlexo,hosbah" doc:"Through the CircleXO account or Hosbah's own OAuth"`
			Locale string `json:"locale,omitempty" enum:"en,ar," doc:"Where the callback returns to (default en)"`
		}
	}) (*hosbahStartOut, error) {
		st, err := sv.StartHosbahConnect(ctx, in.Project, in.Body.Via, in.Body.Locale)
		if err != nil {
			return nil, sv.fail(err)
		}
		out := &hosbahStartOut{SetCookie: *st.Cookie}
		out.Body.URL = st.URL
		return out, nil
	})

	const htag = "Hosting"
	reg(api, sv, http.MethodGet, "/api/w/projects/{project}/hosting", "w-hosting", "The project's Hosbah apps", htag, 0,
		func(ctx context.Context, in *P) (*Hosting, error) {
			return sv.Hosting(ctx, in.Project)
		})
	reg(api, sv, http.MethodPost, "/api/w/projects/{project}/hosting/deploy", "w-hosting-deploy", "Deploy one of the project's Hosbah apps", htag, http.StatusAccepted,
		func(ctx context.Context, in *struct {
			P
			App string `query:"app" doc:"The Hosbah app id (default: the first linked app)"`
		}) (*HosbahDeployment, error) {
			return sv.HostingDeploy(ctx, in.Project, in.App)
		})
	reg(api, sv, http.MethodGet, "/api/w/portal/projects/{project}/hosting", "w-portal-hosting", "The project's hosting, as its customer sees it", htag, 0,
		func(ctx context.Context, in *P) (*PortalHosting, error) {
			return sv.PortalHosting(ctx, in.Project)
		})
	reg(api, sv, http.MethodPost, "/api/w/portal/projects/{project}/hosting/panel", "w-portal-hosting-panel", "A one-time link into the hosting panel", htag, 0,
		func(ctx context.Context, in *struct {
			P
			Body struct {
				Locale string `json:"locale,omitempty" doc:"en or ar"`
				App    string `json:"app,omitempty" doc:"The Hosbah app id (default: the first linked app)"`
			}
		}) (*PanelLink, error) {
			return sv.PortalHostingPanel(ctx, in.Project, in.Body.Locale, in.Body.App)
		})

	const gtag = "GitHub"
	reg(api, sv, http.MethodGet, "/api/w/projects/{project}/github/commits", "w-github-commits", "Recent commits", gtag, 0,
		func(ctx context.Context, in *struct {
			P
			Branch string `query:"branch"`
			Since  string `query:"since" doc:"YYYY-MM-DD or RFC 3339"`
		}) (CommitList, error) {
			l, err := sv.Commits(ctx, in.Project, in.Branch, in.Since)
			return CommitList{Commits: l}, err
		})
	reg(api, sv, http.MethodGet, "/api/w/projects/{project}/github/pulls", "w-github-pulls", "Pull requests", gtag, 0,
		func(ctx context.Context, in *struct {
			P
			State string `query:"state" doc:"open (default), closed or all"`
		}) (PullList, error) {
			l, err := sv.Pulls(ctx, in.Project, in.State)
			return PullList{Pulls: l}, err
		})
	reg(api, sv, http.MethodGet, "/api/w/projects/{project}/github/runs", "w-github-runs", "Workflow runs", gtag, 0,
		func(ctx context.Context, in *P) (RunList, error) {
			l, err := sv.Runs(ctx, in.Project)
			return RunList{Runs: l}, err
		})
	reg(api, sv, http.MethodGet, "/api/w/projects/{project}/github/deployments", "w-github-deployments", "Deployments", gtag, 0,
		func(ctx context.Context, in *P) (DeploymentList, error) {
			l, err := sv.Deployments(ctx, in.Project)
			return DeploymentList{Deployments: l}, err
		})
	reg(api, sv, http.MethodGet, "/api/w/projects/{project}/github/workflows", "w-github-workflows", "Workflows", gtag, 0,
		func(ctx context.Context, in *P) (WorkflowList, error) {
			l, err := sv.Workflows(ctx, in.Project)
			return WorkflowList{Workflows: l}, err
		})
	huma.Register(api, huma.Operation{OperationID: "w-github-deploy", Method: http.MethodPost,
		Path: "/api/w/projects/{project}/github/deploy", Summary: "Trigger a deploy (workflow_dispatch)", Tags: []string{gtag}, DefaultStatus: http.StatusAccepted},
		func(ctx context.Context, in *struct {
			P
			Body DeployInput
		}) (*struct{}, error) {
			if err := sv.Deploy(ctx, in.Project, in.Body); err != nil {
				return nil, sv.fail(err)
			}
			return &struct{}{}, nil
		})
	reg(api, sv, http.MethodPost, "/api/w/projects/{project}/github/issues", "w-github-issue-from", "File a GitHub issue from a Mahaam issue", gtag, http.StatusCreated,
		func(ctx context.Context, in *struct {
			P
			Body struct {
				Issue string `json:"issue" doc:"MG-12 or the issue id"`
			}
		}) (LinkedIssue, error) {
			rep, u, err := sv.CreateIssueFrom(ctx, in.Project, in.Body.Issue)
			if err != nil {
				return LinkedIssue{}, err
			}
			return LinkedIssue{Key: rep.Key, URL: u}, nil
		})
}

// Response bodies.
type (
	IntegrationList struct {
		Integrations []Integration `json:"integrations"`
	}
	InstallLink struct {
		URL string `json:"url"`
	}
	RepoList struct {
		Repos []Repo `json:"repos"`
	}
	CommitList struct {
		Commits []Commit `json:"commits"`
	}
	PullList struct {
		Pulls []Pull `json:"pulls"`
	}
	RunList struct {
		Runs []Run `json:"runs"`
	}
	DeploymentList struct {
		Deployments []Deployment `json:"deployments"`
	}
	WorkflowList struct {
		Workflows []Workflow `json:"workflows"`
	}
	hosbahStartOut struct {
		SetCookie http.Cookie `header:"Set-Cookie"`
		Body      struct {
			URL string `json:"url"`
		}
	}
	HosbahAppList struct {
		Apps []HosbahApp `json:"apps"`
	}
	LinkedIssue struct {
		Key string `json:"key"`
		URL string `json:"url"`
	}
)

func reg[I, O any](api huma.API, sv *Service, method, path, id, summary, tag string, status int, h func(context.Context, *I) (O, error)) {
	huma.Register(api, huma.Operation{OperationID: id, Method: method, Path: path, Summary: summary, Tags: []string{tag}, DefaultStatus: status},
		func(ctx context.Context, in *I) (*work.Resp[O], error) {
			out, err := h(ctx, in)
			if err != nil {
				return nil, sv.fail(err)
			}
			return &work.Resp[O]{Body: out}, nil
		})
}

func (sv *Service) fail(err error) error {
	if e, ok := work.AsError(err); ok {
		return huma.NewError(e.Status, e.Msg)
	}
	sv.Log.Error("integrations", "err", err)
	return huma.Error500InternalServerError("something went wrong")
}

// Mount adds the public GitHub endpoints (allowlisted in internal/server/guard.go) and the Hosbah
// OAuth callback (outside /api, so public by the guard's first rule; the web app proxies it).
func Mount(k *togo.Kernel, a *app.App) {
	sv := New(a)
	k.Router.Get(HosbahCallbackPath, sv.HosbahCallback())
	k.Router.Post("/api/integrations/github/webhook", sv.WebhookHandler().ServeHTTP)
	k.Router.Get("/api/integrations/github/callback", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if q.Get("setup_action") == "request" {
			http.Error(w, "The installation was requested; an organization owner must approve it on GitHub, then start again from the project settings.", http.StatusAccepted)
			return
		}
		path, err := sv.CompleteInstall(r.Context(), q.Get("installation_id"), q.Get("state"), q.Get("code"))
		if err != nil {
			msg := "The GitHub installation could not be linked."
			status := http.StatusInternalServerError
			if e, ok := work.AsError(err); ok {
				msg, status = e.Msg, e.Status
			} else {
				sv.Log.Error("github callback", "err", err)
			}
			http.Error(w, msg, status)
			return
		}
		base := strings.TrimRight(os.Getenv("WEB_URL"), "/")
		if u, err := url.Parse(base); base != "" && (err != nil || u.Scheme == "" || u.Host == "") {
			base = ""
		}
		http.Redirect(w, r, base+path, http.StatusFound)
	})
}
