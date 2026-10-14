package server

import (
	"bytes"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/togo-framework/auth"
	"github.com/togo-framework/togo"

	"github.com/fadymondy/mahaam/internal/account"
	"github.com/fadymondy/mahaam/internal/app"
	"github.com/fadymondy/mahaam/internal/authz"
	"github.com/fadymondy/mahaam/internal/billing/ghmarketplace"
	"github.com/fadymondy/mahaam/internal/circlexo"
	"github.com/fadymondy/mahaam/internal/mcp"
	"github.com/fadymondy/mahaam/internal/limits"
	"github.com/fadymondy/mahaam/internal/mailer"
	"github.com/fadymondy/mahaam/internal/platform"
	"github.com/fadymondy/mahaam/internal/reports"
	"github.com/fadymondy/mahaam/internal/tenant"
)

/*
The request guard: one default-deny middleware around the whole router,
including routes plugins mount (auth, auth-oauth).

Tiers, decided by path before any handler runs:

	blocked    — plugin routes Mahaam does not offer; answered 404
	public     — anonymous; enumerated below
	signed-in  — any session; enumerated below (account-level, no workspace)
	admin      — /api/admin/* (not the admin MCP): session + platform admin; 404 to
	             everyone else (anonymous included), so the panel is not discoverable
	workspace  — EVERYTHING else under /api and /graphql: session + membership
	             of X-Workspace-ID (404 otherwise) + authz for generated CRUD

The workspace tier is the default, so a newly generated resource is closed
behind membership AND authz.Generated (itself default-deny) until someone opens
it deliberately. That is fadymondy.com's FM-63/FM-43 lesson applied from day one.
*/

type tier int

const (
	tierWorkspace tier = iota
	tierPublic
	tierSignedIn
	tierBlocked
	tierAdmin
)

func classify(r *http.Request) tier {
	path := r.URL.Path
	if !strings.HasPrefix(path, "/api/") && path != "/graphql" {
		return tierPublic // pages, docs, assets
	}

	for _, p := range []string{
		// auth-dev hands an admin session to an empty body (fadymondy.com FM-42).
		// The plugin is not installed; this stays as a tripwire.
		"/api/auth/dev/",
		// OTP sign-in: no delivery channel is wired in P0.
		"/api/auth/otp",
		// Magic links — the auth-mfa vulnerability class (fadymondy.com FM-81).
		"/api/auth/magic",
		// The auth plugin's own TOTP: it stores the secret in plain text, and nothing at sign-in
		// ever checked it. Mahaam's is /api/me/2fa/* and /api/auth/2fa/challenge (MH-341).
		"/api/auth/2fa/enroll",
		"/api/auth/2fa/verify",
		// auth v0.9.0 added the plugin's code-gated disable for that same TOTP; with enrolment
		// blocked there is nothing for it to disable. Mahaam's is /api/me/2fa/disable.
		"/api/auth/2fa/disable",
		// auth v0.10.0's admin API: user CRUD, impersonation, admin reset and magic links for any
		// account whose users.roles holds "admin", which is exactly a Mahaam platform admin. It
		// bypasses everything the panel does around those actions (suspension, sole-owner checks,
		// the admin audit), and a magic link is the vulnerability class blocked above. The
		// platform admin panel is /api/admin/* (internal/admin).
		"/api/auth/admin/",
		"/api/auth/impersonation/",
		// togo-framework/settings arrives transitively (queue -> providers -> settings) and its
		// init() mounts GET/PUT/DELETE /api/settings/{scope}/{key} over one GLOBAL table, the
		// scope taken from the path, with no authentication or tenant of its own. Workspace
		// settings, when they come, go through /api/w/* with the scope derived from the session.
		"/api/settings",
		// togo-framework/import-export mounts GET /api/export/{resource} and POST
		// /api/import/{resource} with no authentication, over a process-global resource registry
		// with no tenant. Mahaam registers no resources there and exports through
		// /api/w/report/export (session + membership + the report's own checks).
		"/api/export/",
		"/api/import/",
	} {
		if strings.HasPrefix(path, p) {
			return tierBlocked
		}
	}

	switch path {
	case "/api/health",
		// Both MCP transports authenticate with their own bearer tokens. Exact
		// matches: a prefix "/api/mcp" would also match /api/mcp_tokens.
		"/api/mcp",
		"/api/admin/mcp":
		return tierPublic
	case "/api/invitations/accept", "/api/feedback":
		return tierSignedIn
	case
		// The embeddable Feedback SDK's intake: PUBLIC on purpose — it authenticates
		// with a per-project public key and an Origin allowlist, never a session or a
		// workspace header (internal/reports/embed.go). It is CORS-guarded and
		// rate-limited there.
		"/api/feedback/embed",
		// The widget's look (colour, icon, text, shape) for a key: not a secret, read
		// before the launcher renders.
		"/api/feedback/embed/config",
		// GitHub integration (internal/integrations): the webhook authenticates with the
		// X-Hub-Signature-256 HMAC (GITHUB_WEBHOOK_SECRET) and nothing else; the App's setup
		// callback carries a state signed with MAHAAM_SECRET_KEY (plus, with the App's OAuth
		// credentials, proof the GitHub user can access the installation). Exact matches.
		"/api/integrations/github/webhook",
		"/api/integrations/github/callback",
		// Customer import from Google Contacts (internal/work/client_import_sources.go): the OAuth
		// redirect. It trusts only a state signed with MAHAAM_SECRET_KEY (workspace, user, expiry)
		// plus a matching HttpOnly nonce cookie set when that user started the import. Exact match.
		"/api/integrations/google/callback",
		// "Connect GitHub" for the signed-in member (internal/work/github_accounts.go): the OAuth
		// redirect. Same model as the Google one: a state signed with MAHAAM_SECRET_KEY (workspace,
		// user, expiry) plus a matching HttpOnly nonce cookie. Exact match.
		// Polar billing webhooks (internal/billing/polar): Standard Webhooks HMAC signature
		// (POLAR_WEBHOOK_SECRET), 5-minute timestamp window, deduplicated by webhook-id. Exact match.
		"/api/billing/polar/webhook",
		// GitHub Marketplace purchase events (internal/billing/ghmarketplace): same
		// X-Hub-Signature-256 HMAC scheme as the App's repo webhook, but its own secret
		// (GITHUB_MARKETPLACE_WEBHOOK_SECRET) — GitHub issues Marketplace and App webhook
		// secrets independently. Exact match.
		ghmarketplace.WebhookPath,
		// MCP OAuth (internal/mcp/oauth.go): authorize validates client_id/redirect_uri itself and
		// redirects to the web app's consent screen (which requires a session, tierSignedIn below,
		// via /api/oauth/consent); register/token/revoke are public per their RFCs — token exchange
		// is protected by PKCE, not by an API credential. Exact matches.
		mcp.AuthorizePath,
		mcp.RegisterPath,
		mcp.TokenPath,
		mcp.RevokePath,
		// CircleXO hub integration (internal/circlexo, all off unless CIRCLEXO_ISSUER is set): the
		// sign-in switch (no secrets), and the hub's event / provision / deprovision calls, which
		// authenticate by Standard Webhooks signature (CIRCLEXO_WEBHOOK_SECRET) and nothing else.
		// The /auth/circlexo/* and /sso/circlexo routes are outside /api and public already. Exact.
		circlexo.ConfigPath,
		circlexo.EventsPath,
		circlexo.ProvisionPath,
		circlexo.DeprovisionPath,
		"/api/integrations/github/user-callback":
		return tierPublic
	}
	// The platform admin panel's REST surface (internal/admin). The admin MCP is matched above.
	if strings.HasPrefix(path, "/api/admin/") {
		return tierAdmin
	}
	// Backend error-monitoring intake (internal/reports/monitor.go): PUBLIC on purpose, same model
	// as /api/feedback/embed — the only credential is the DSN's public key in the body, checked
	// against the {project} in the path. {project} is a path segment, so this is a prefix/suffix
	// check rather than one of the exact matches above.
	if strings.HasPrefix(path, "/api/monitor/") && strings.HasSuffix(path, "/envelope") {
		return tierPublic
	}
	// Personal access tokens (togo-framework/auth): how a desktop, mobile or extension client
	// holds something revocable instead of the user's password. Signed-in rather than public, so
	// accountGate runs and a suspended account cannot mint itself a token that outlives the
	// suspension. A PAT carries the user's own access and nothing more — the workspace Role still
	// comes from our own membership table, not from the plugin's Identity.
	//
	// Their "abilities" are not enforced anywhere in Mahaam, so refuseScopedToken below refuses to
	// issue one that claims to be scoped. MCP tokens (mgy_) remain the scoped token system.
	if path == "/api/auth/tokens" || strings.HasPrefix(path, "/api/auth/tokens/") {
		return tierSignedIn
	}
	// The auth plugin guards its own routes. Since auth v0.9.0 it also mounts POST
	// /api/auth/password/forgot, /api/auth/password/reset and /api/auth/2fa/challenge; Mahaam's own
	// handlers for those paths (internal/account) are registered after the kernel's providers run,
	// so they replace the plugin's on the shared chi tree (TestAuthPluginSurface).
	if strings.HasPrefix(path, "/api/auth/") {
		return tierPublic
	}
	if strings.HasPrefix(path, "/api/me/") {
		return tierSignedIn
	}
	// The OAuth consent screen: "who is authorizing this" is the web app's own session.
	if strings.HasPrefix(path, "/api/oauth/consent") {
		return tierSignedIn
	}
	// The invite preview: the unguessable token in the URL is the authorization.
	if r.Method == http.MethodGet && strings.HasPrefix(path, "/api/invitations/") &&
		!strings.Contains(strings.TrimPrefix(path, "/api/invitations/"), "/") {
		return tierPublic
	}
	return tierWorkspace
}

func installGuard(k *togo.Kernel, a *app.App) {
	svc, ok := auth.FromKernel(k)
	if !ok {
		k.Log.Error("auth service unavailable — refusing to start with an unguarded API")
		panic("guard: auth service not registered")
	}

	trusted := trustedProxies()
	k.UseMiddleware(func(next http.Handler) http.Handler {
		acct := &account.Service{DB: a.SysDB, Mail: mailer.FromKernel(k), Log: a.Log}
		gate := accountGate(a, acct)
		signedIn := svc.Middleware(csrf(gate(next)))
		workspace := svc.Middleware(csrf(gate(tenant.Require(a.SysDB)(meter(generatedAuthz(next))))))
		admin := hideUnauthorized(svc.Middleware(csrf(gate(requirePlatformAdmin(a, next)))))
		me := svc.Middleware(gate(currentIdentity(a)))
		// Google/GitHub (auth-oauth): honour `next`, refuse suspended accounts, ask for the second
		// factor (oauth_return.go).
		oauthDone := oauthCallback(next, svc, a, acct)

		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			stripUntrustedForwarding(trusted, r) // proxies.go: forwarding headers are client-settable
			switch classify(r) {
			case tierBlocked:
				writeError(w, http.StatusNotFound, "not found")
			case tierPublic:
				switch {
				case r.URL.Path == "/api/feedback/embed" && r.Method == http.MethodOptions:
					// Before the auth plugin's CORS, which would answer with its own header list (MH-727).
					reports.EmbedPreflight(w, r)
					return
				case r.URL.Path == "/api/auth/login" && r.Method == http.MethodPost:
					// A suspended account cannot sign in (the plugin's handler knows nothing of it).
					if refuseSuspendedLogin(w, r, a) {
						return
					}
					// 2FA (MH-341): a right password for an account with a second factor gets a
					// challenge, not a session. A wrong one goes on to the plugin as always.
					if askSecondFactor(w, r, acct) {
						return
					}
				case r.URL.Path == "/api/auth/me":
					// The session probe: a suspended or signed-out-by-an-admin session fails here too.
					me.ServeHTTP(w, r)
					return
				case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, oauthPrefix):
					switch start, callback := oauthRoute(r.URL.Path); {
					case start:
						oauthStart(w, r)
					case callback:
						oauthDone.ServeHTTP(w, r)
						return
					}
				}
				// POST /api/auth/apple (account/apple.go) needs nothing here: it is a JSON call from a
				// native app with no cookies, so no CSRF applies (like /api/auth/app/token and
				// /api/auth/2fa/challenge), and it makes its own suspension and 2FA checks.
				next.ServeHTTP(w, r)
			case tierSignedIn:
				if r.URL.Path == "/api/auth/tokens" && r.Method == http.MethodPost && refuseScopedToken(w, r) {
					return
				}
				signedIn.ServeHTTP(w, r)
			case tierAdmin:
				admin.ServeHTTP(w, r)
			default:
				workspace.ServeHTTP(w, r)
			}
		})
	})
}

// currentIdentity answers GET /api/auth/me in place of the auth plugin's handler, which echoes the
// identity the token was issued with. That email is whatever the account had at sign-in: stale
// the moment it is changed (MH-343), and empty for a personal access token, whose identity
// carries none. Everything else about the identity is passed through untouched.
func currentIdentity(a *app.App) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, ok := auth.IdentityFrom(r.Context())
		if !ok || id == nil {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		out := *id
		if u, err := platform.Load(r.Context(), a.SysDB, id.ID); err == nil {
			out.Email = u.Email
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(out)
	})
}

// accountGate runs after the auth plugin verified the session: a suspended account gets 403 on
// every call, a session issued before an admin's "sign out everywhere" gets 401, and activity is
// recorded for the platform stats.
func accountGate(a *app.App, acct *account.Service) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			id, ok := auth.IdentityFrom(r.Context())
			if !ok || id == nil {
				writeError(w, http.StatusUnauthorized, "unauthorized")
				return
			}
			u, err := platform.Load(r.Context(), a.SysDB, id.ID)
			if errors.Is(err, platform.ErrNoUser) {
				writeError(w, http.StatusUnauthorized, "unauthorized")
				return
			}
			if err != nil {
				writeError(w, http.StatusInternalServerError, "could not load the account")
				return
			}
			if u.Suspended() {
				writeCoded(w, http.StatusForbidden, u.SuspendedMessage(), "account_suspended")
				return
			}
			if platform.SessionRevoked(r.Context(), a.SysDB, u, r) {
				writeCoded(w, http.StatusUnauthorized, "your session was ended — sign in again", "session_revoked")
				return
			}
			// A hub sign-in the hub has since revoked (session.revoked): internal/circlexo.
			if hub := circlexo.Current(); hub != nil && circlexo.SessionEnded(r.Context(), hub, u.ID, r) {
				writeCoded(w, http.StatusUnauthorized, "your session was ended — sign in again", "session_revoked")
				return
			}
			// An anonymised account has no sessions (they all predate its deletion), so reaching
			// here means something is very wrong; refuse rather than serve a row that is no one.
			if u.DeletedAt != nil {
				writeError(w, http.StatusUnauthorized, "unauthorized")
				return
			}
			// A deletion is pending and this session survived it, so it was made after the
			// request: the person signed in again, which is how a deletion is cancelled (MH-344).
			if u.DeletionRequestedAt != nil {
				account.Cancel(r.Context(), acct, u.ID)
			}
			platform.TouchSeen(r.Context(), a.SysDB, u.ID)
			next.ServeHTTP(w, r)
		})
	}
}

// askSecondFactor answers a sign-in whose password is right for an account with 2FA on: 401
// {code: mfa_required, challenge}, and no session. Status 401 rather than 200 so that a client
// that predates 2FA fails as a failed sign-in instead of treating a missing token as success.
// The body is read and put back for the plugin.
func askSecondFactor(w http.ResponseWriter, r *http.Request, acct *account.Service) bool {
	body, err := io.ReadAll(io.LimitReader(r.Body, 64<<10))
	if err != nil {
		return false
	}
	r.Body = io.NopCloser(bytes.NewReader(body))
	var c struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if json.Unmarshal(body, &c) != nil || c.Email == "" || c.Password == "" {
		return false
	}
	challenge, needed := acct.LoginChallenge(r.Context(), c.Email, c.Password)
	if !needed {
		return false
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"error": "enter the code from your authenticator app", "code": "mfa_required",
		"mfa_required": true, "challenge": challenge, "methods": []string{"totp", "recovery_code"},
	})
	return true
}

// refuseSuspendedLogin answers 403 for a suspended account's sign-in and reports whether it did.
// The body is read and put back for the plugin.
func refuseSuspendedLogin(w http.ResponseWriter, r *http.Request, a *app.App) bool {
	body, err := io.ReadAll(io.LimitReader(r.Body, 64<<10))
	if err != nil {
		return false
	}
	r.Body = io.NopCloser(bytes.NewReader(body))
	var c struct {
		Email string `json:"email"`
	}
	if json.Unmarshal(body, &c) != nil || c.Email == "" {
		return false
	}
	if u, suspended := platform.SuspendedByEmail(r.Context(), a.SysDB, c.Email); suspended {
		writeCoded(w, http.StatusForbidden, u.SuspendedMessage(), "account_suspended")
		return true
	}
	return false
}

// refuseScopedToken rejects a personal access token that asks for "abilities".
//
// The auth plugin stores abilities and Mahaam checks them nowhere: a PAT minted with
// ["issues:read"] can do everything its owner can. Issuing it anyway would be the worst outcome —
// someone hands a narrow-looking token to a script believing it is limited, and it is not. So the
// request is refused rather than quietly over-granted.
//
// mgy_ MCP tokens are the scoped token system, and they are narrowed to the caller's current role
// on every call. A PAT is for a client that needs the user's own access without holding the user's
// password.
func refuseScopedToken(w http.ResponseWriter, r *http.Request) bool {
	body, err := io.ReadAll(io.LimitReader(r.Body, 64<<10))
	if err != nil {
		return false
	}
	r.Body = io.NopCloser(bytes.NewReader(body))
	var c struct {
		Abilities []string `json:"abilities"`
	}
	if json.Unmarshal(body, &c) != nil || len(c.Abilities) == 0 {
		return false
	}
	writeCoded(w, http.StatusUnprocessableEntity,
		"a personal access token carries your own access and cannot be narrowed — use an MCP token for a scoped one",
		"abilities_unsupported")
	return true
}

// meter counts every workspace-tier call against the plan's API quotas (internal/limits): the
// per-minute rate (429) and a block-policy monthly quota (402).
func meter(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s, ok := tenant.From(r.Context()); ok {
			if x, refused := limits.As(limits.CountCall(r.Context(), s.WorkspaceID)); refused {
				writeCoded(w, x.Status, x.Msg, x.Code)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

// requirePlatformAdmin lets only platform admins (users.roles contains admin, read fresh) through;
// everyone else gets the same 404 as an unknown route.
func requirePlatformAdmin(a *app.App, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, _ := auth.IdentityFrom(r.Context())
		if id == nil {
			writeError(w, http.StatusNotFound, "not found")
			return
		}
		u, err := platform.Load(r.Context(), a.SysDB, id.ID)
		if err != nil || !u.Admin {
			writeError(w, http.StatusNotFound, "not found")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// hideUnauthorized turns the auth plugin's 401 into a 404, so /api/admin/* looks like any unknown
// route to an anonymous caller.
func hideUnauthorized(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		next.ServeHTTP(&notFoundOn401{ResponseWriter: w}, r)
	})
}

type notFoundOn401 struct {
	http.ResponseWriter
	hidden bool
}

func (n *notFoundOn401) WriteHeader(code int) {
	if code == http.StatusUnauthorized {
		n.hidden = true
		writeError(n.ResponseWriter, http.StatusNotFound, "not found")
		return
	}
	n.ResponseWriter.WriteHeader(code)
}

func (n *notFoundOn401) Write(b []byte) (int, error) {
	if n.hidden {
		return len(b), nil
	}
	return n.ResponseWriter.Write(b)
}

func writeCoded(w http.ResponseWriter, status int, msg, code string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg, "code": code})
}

// csrf applies the auth plugin's double-submit rule to Mahaam's own routes:
// a cookie-authenticated unsafe request must echo the togo_csrf cookie in
// X-CSRF-Token. Bearer requests carry no ambient credential and are exempt.
func csrf(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet, http.MethodHead, http.MethodOptions:
			next.ServeHTTP(w, r)
			return
		}
		if h := r.Header.Get("Authorization"); len(h) > 7 && strings.EqualFold(h[:7], "Bearer ") {
			next.ServeHTTP(w, r)
			return
		}
		c, err := r.Cookie("togo_csrf")
		header := r.Header.Get("X-CSRF-Token")
		if err != nil || header == "" || subtle.ConstantTimeCompare([]byte(c.Value), []byte(header)) != 1 {
			writeError(w, http.StatusForbidden, "invalid csrf token")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// generatedAuthz runs after membership is established. Hand-written /api/w/*
// handlers check authz.Can themselves; everything else in the workspace tier
// is generated CRUD (or GraphQL) and is checked against authz.Generated.
func generatedAuthz(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s, _ := tenant.From(r.Context())
		path := r.URL.Path

		if path == "/graphql" {
			if !authz.Can(s.Role, authz.GraphQL) {
				writeError(w, http.StatusForbidden, "GraphQL needs the admin role in this workspace")
				return
			}
			next.ServeHTTP(w, r)
			return
		}
		if strings.HasPrefix(path, "/api/w/") {
			next.ServeHTTP(w, r)
			return
		}

		table := strings.SplitN(strings.TrimPrefix(path, "/api/"), "/", 2)[0]
		if _, known := authz.Generated[table]; !known {
			writeError(w, http.StatusNotFound, "not found")
			return
		}
		if !authz.CanTable(s.Role, table, r.Method) {
			writeError(w, http.StatusForbidden, "your role cannot do this through the generic API")
			return
		}
		next.ServeHTTP(w, r)
	})
}
