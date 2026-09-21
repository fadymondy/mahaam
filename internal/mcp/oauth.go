// Package mcp's OAuth support lets a remote MCP connector (Claude.ai, ChatGPT, ...) "Connect"
// with just this server's URL and its own sign-in screen, instead of a human pasting a token.
//
// It implements the pieces the MCP Authorization spec (built on OAuth 2.1) requires:
//   - RFC 8414 authorization server metadata, RFC 9728 protected resource metadata
//   - RFC 7591 dynamic client registration — public clients only, no secret
//   - Authorization Code + PKCE (S256 mandatory), consent screen on the web app
//   - Refresh tokens, rotated on every use
//   - RFC 7009 revocation
//
// The one thing this flow does that nothing else in Mahaam does is get consent and mint a code.
// Everything after that — issuing the actual access token — is the same mcp_tokens row every
// other MCP token is (mintToken, in tokens.go), so it runs through the exact same auth, scope
// narrowing, project scoping and rate limiting every other MCP call already does. There is no
// second, parallel authorization path to keep in sync.
package mcp

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/togo-framework/auth"

	"github.com/fadymondy/mahaam/internal/app"
	"github.com/fadymondy/mahaam/internal/tenant"
	"github.com/fadymondy/mahaam/internal/workspaces"
)

const (
	AuthorizePath  = "/api/oauth/authorize"
	TokenPath      = "/api/oauth/token"
	RegisterPath   = "/api/oauth/register"
	RevokePath     = "/api/oauth/revoke"
	ASMetadataPath = "/.well-known/oauth-authorization-server"
	RSMetadataPath = "/.well-known/oauth-protected-resource"
)

// codeTTL / issuedTokenDays: an authorization code is single-use and very short-lived; the
// access token it produces is shorter-lived than a hand-minted one (90 days), since refresh
// rotation is how a real connection stays alive — a leaked access token alone goes stale fast.
const codeTTL = 2 * time.Minute
const issuedTokenDays = 30

// defaultOAuthScopes mirrors the web "Connect AI agent" dialog's default set: broad enough to be
// useful without asking a chat client to understand Mahaam's full scope catalogue up front.
var defaultOAuthScopes = []string{"projects:read", "tasks:read", "tasks:write", "issues:read", "issues:write", "time:read", "time:write"}

func appURL() string { return strings.TrimRight(os.Getenv("APP_URL"), "/") }
func webURL() string {
	if v := strings.TrimRight(os.Getenv("WEB_URL"), "/"); v != "" {
		return v
	}
	return appURL()
}

// ── RFC 8414 / RFC 9728 discovery ────────────────────────────────────────────────────────────

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// AuthServerMetadataHandler serves RFC 8414 metadata at /.well-known/oauth-authorization-server.
func AuthServerMetadataHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		base := appURL()
		writeJSON(w, http.StatusOK, map[string]any{
			"issuer":                                     base,
			"authorization_endpoint":                     base + AuthorizePath,
			"token_endpoint":                             base + TokenPath,
			"registration_endpoint":                      base + RegisterPath,
			"revocation_endpoint":                        base + RevokePath,
			"response_types_supported":                   []string{"code"},
			"grant_types_supported":                      []string{"authorization_code", "refresh_token"},
			"code_challenge_methods_supported":           []string{"S256"},
			"token_endpoint_auth_methods_supported":      []string{"none"},
			"revocation_endpoint_auth_methods_supported": []string{"none"},
			"scopes_supported":                           scopeNames(),
		})
	}
}

// ResourceMetadataHandler serves RFC 9728 metadata at /.well-known/oauth-protected-resource,
// pointing at the MCP endpoint and its authorization server.
func ResourceMetadataHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		base := appURL()
		writeJSON(w, http.StatusOK, map[string]any{
			"resource":              base + "/api/mcp",
			"authorization_servers": []string{base},
		})
	}
}

func scopeNames() []string {
	out := make([]string, len(UserScopes))
	for i, d := range UserScopes {
		out[i] = d.Scope
	}
	return out
}

// ── RFC 7591 dynamic client registration ────────────────────────────────────────────────────

func randomID(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// validRedirectURI: https, or http(s) to loopback (native/local apps, per OAuth 2.1 for public
// clients). No fragments — a fragment could be used to smuggle data past the redirect.
func validRedirectURI(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil || u.Fragment != "" {
		return false
	}
	if u.Scheme == "https" {
		return u.Host != ""
	}
	if u.Scheme == "http" {
		h := u.Hostname()
		return h == "localhost" || h == "127.0.0.1" || h == "::1"
	}
	return false
}

// RegisterClientHandler implements RFC 7591: any caller may register a public client (no
// secret) as long as every redirect_uri it offers passes validRedirectURI. This is deliberately
// open — it is how ChatGPT, Claude.ai and similar connectors register themselves with zero setup
// on the Mahaam side — the access boundary is the consent screen and PKCE, not client secrecy.
func RegisterClientHandler(sysDB *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", "POST")
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
			return
		}
		var in struct {
			ClientName   string   `json:"client_name"`
			RedirectURIs []string `json:"redirect_uris"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&in); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_client_metadata", "error_description": "malformed JSON"})
			return
		}
		if len(in.RedirectURIs) == 0 || len(in.RedirectURIs) > 10 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_redirect_uri", "error_description": "provide 1-10 redirect_uris"})
			return
		}
		for _, u := range in.RedirectURIs {
			if !validRedirectURI(u) {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_redirect_uri", "error_description": "redirect_uris must be https, or http to a loopback address"})
				return
			}
		}
		name := strings.TrimSpace(in.ClientName)
		if name == "" {
			name = "MCP client"
		}
		if len(name) > 120 {
			name = name[:120]
		}
		clientID := "mcpc_" + randomID(16)
		raw, _ := json.Marshal(in.RedirectURIs)
		if _, err := sysDB.ExecContext(r.Context(), `
			INSERT INTO oauth_clients (client_id, client_name, redirect_uris) VALUES ($1, $2, $3)`,
			clientID, name, string(raw)); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "server_error"})
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{
			"client_id":                  clientID,
			"client_name":                name,
			"redirect_uris":              in.RedirectURIs,
			"token_endpoint_auth_method": "none",
			"grant_types":                []string{"authorization_code", "refresh_token"},
			"response_types":             []string{"code"},
		})
	}
}

type oauthClient struct {
	clientID, name string
	redirectURIs   []string
}

func loadClient(ctx context.Context, sysDB *sql.DB, clientID string) (*oauthClient, error) {
	var c oauthClient
	var raw string
	err := sysDB.QueryRowContext(ctx, `SELECT client_id, client_name, redirect_uris FROM oauth_clients WHERE client_id = $1`, clientID).
		Scan(&c.clientID, &c.name, &raw)
	if err != nil {
		return nil, err
	}
	_ = json.Unmarshal([]byte(raw), &c.redirectURIs)
	return &c, nil
}

func redirectAllowed(c *oauthClient, redirectURI string) bool {
	for _, u := range c.redirectURIs {
		if u == redirectURI {
			return true
		}
	}
	return false
}

// ── Authorization endpoint: validate, then hand off to the web app's consent screen ────────

// AuthorizeHandler validates the request (client, redirect_uri, PKCE) and, if all of that is
// trustworthy, redirects the browser to the Next.js consent page carrying the same params —
// which is what actually authenticates the human (the web app's session, not this endpoint) and
// renders a normal sign-in screen if they aren't. Errors that mean the redirect_uri itself can't
// be trusted are shown directly here, never bounced anywhere — that's how open-redirect bugs in
// OAuth servers happen.
func AuthorizeHandler(sysDB *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		clientID := q.Get("client_id")
		redirectURI := q.Get("redirect_uri")
		c, err := loadClient(r.Context(), sysDB, clientID)
		if err != nil {
			http.Error(w, "unknown client_id", http.StatusBadRequest)
			return
		}
		if redirectURI == "" || !redirectAllowed(c, redirectURI) {
			http.Error(w, "redirect_uri does not match a URI registered for this client", http.StatusBadRequest)
			return
		}
		// From here on, the redirect_uri is trusted: further problems are reported to the client
		// via that URI's error query params, per RFC 6749 §4.1.2.1, not shown inline.
		fail := func(errCode, desc string) {
			u, _ := url.Parse(redirectURI)
			qs := u.Query()
			qs.Set("error", errCode)
			if desc != "" {
				qs.Set("error_description", desc)
			}
			if s := q.Get("state"); s != "" {
				qs.Set("state", s)
			}
			u.RawQuery = qs.Encode()
			http.Redirect(w, r, u.String(), http.StatusFound)
		}
		if q.Get("response_type") != "code" {
			fail("unsupported_response_type", "only response_type=code is supported")
			return
		}
		if q.Get("code_challenge") == "" || q.Get("code_challenge_method") != "S256" {
			fail("invalid_request", "PKCE with code_challenge_method=S256 is required")
			return
		}
		dest, _ := url.Parse(webURL() + "/oauth/authorize")
		dest.RawQuery = q.Encode()
		http.Redirect(w, r, dest.String(), http.StatusFound)
	}
}

// ── PKCE ─────────────────────────────────────────────────────────────────────────────────────

func pkceMatch(verifier, challenge string) bool {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:]) == challenge
}

// ── Consent (Huma, account-level, signed-in — the web app calls these) ─────────────────────

// consentScope / consentWorkspace are named (not anonymous) so Huma's reflection-based OpenAPI
// naming doesn't collide with an unrelated anonymous struct elsewhere with the same shape.
type consentScope struct {
	Scope       string `json:"scope"`
	Description string `json:"description"`
}

type consentWorkspace struct {
	ID   string `json:"id"`
	Slug string `json:"slug"`
	Name string `json:"name"`
	Role string `json:"role"`
}

type oauthConsentInfo struct {
	Body struct {
		ClientName string             `json:"client_name"`
		Scopes     []consentScope     `json:"scopes"`
		Workspaces []consentWorkspace `json:"workspaces"`
	}
}

func requestedScopes(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return defaultOAuthScopes
	}
	seen := map[string]bool{}
	out := []string{}
	for _, s := range strings.Fields(raw) {
		if _, known := userScope(s); known && !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	if len(out) == 0 {
		return defaultOAuthScopes
	}
	return out
}

func accountIdentity(ctx context.Context) (*auth.Identity, error) {
	id, ok := auth.IdentityFrom(ctx)
	if !ok || id == nil {
		return nil, huma.Error401Unauthorized("unauthorized")
	}
	return id, nil
}

// RegisterOAuthConsent mounts the two account-level routes the consent page calls: what to show,
// and what to do when the human allows or denies it. Both require a signed-in session (tierSignedIn
// in guard.go) — the OAuth flow's "who is authorizing this" is the web app's own session, not a
// new credential.
func RegisterOAuthConsent(api huma.API, a *app.App) {
	huma.Register(api, huma.Operation{
		OperationID: "oauth-consent-info", Method: http.MethodGet, Path: "/api/oauth/consent",
		Summary: "What a remote MCP client is asking for, and which workspaces you can grant it", Tags: []string{"MCP"},
	}, func(ctx context.Context, in *struct {
		ClientID string `query:"client_id" required:"true"`
		Scope    string `query:"scope,omitempty"`
	}) (*oauthConsentInfo, error) {
		if _, err := accountIdentity(ctx); err != nil {
			return nil, err
		}
		c, err := loadClient(ctx, a.SysDB, in.ClientID)
		if err != nil {
			return nil, huma.Error400BadRequest("unknown client_id")
		}
		id, _ := accountIdentity(ctx)
		list, err := workspaces.MyWorkspaces(ctx, a.SysDB, id.ID)
		if err != nil {
			return nil, huma.Error500InternalServerError("could not list workspaces")
		}
		out := &oauthConsentInfo{}
		out.Body.ClientName = c.name
		for _, sc := range requestedScopes(in.Scope) {
			d, _ := userScope(sc)
			out.Body.Scopes = append(out.Body.Scopes, consentScope{Scope: sc, Description: d.Description})
		}
		for _, ws := range list {
			out.Body.Workspaces = append(out.Body.Workspaces, consentWorkspace{ID: ws.ID, Slug: ws.Slug, Name: ws.Name, Role: ws.Role})
		}
		return out, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "oauth-consent-decide", Method: http.MethodPost, Path: "/api/oauth/consent",
		Summary: "Grant or deny a remote MCP client's connection request", Tags: []string{"MCP"},
	}, func(ctx context.Context, in *struct {
		Body struct {
			ClientID            string `json:"client_id"`
			RedirectURI         string `json:"redirect_uri"`
			CodeChallenge       string `json:"code_challenge"`
			CodeChallengeMethod string `json:"code_challenge_method"`
			State               string `json:"state,omitempty"`
			Scope               string `json:"scope,omitempty"`
			WorkspaceID         string `json:"workspace_id"`
			Allow               bool   `json:"allow"`
		}
	}) (*struct {
		Body struct {
			RedirectTo string `json:"redirect_to"`
		}
	}, error) {
		id, err := accountIdentity(ctx)
		if err != nil {
			return nil, err
		}
		c, err := loadClient(ctx, a.SysDB, in.Body.ClientID)
		if err != nil || !redirectAllowed(c, in.Body.RedirectURI) {
			return nil, huma.Error400BadRequest("unknown client or redirect_uri")
		}
		dest, _ := url.Parse(in.Body.RedirectURI)
		qs := dest.Query()
		if in.Body.State != "" {
			qs.Set("state", in.Body.State)
		}
		if !in.Body.Allow {
			qs.Set("error", "access_denied")
			dest.RawQuery = qs.Encode()
			out := &struct {
				Body struct {
					RedirectTo string `json:"redirect_to"`
				}
			}{}
			out.Body.RedirectTo = dest.String()
			return out, nil
		}
		if in.Body.CodeChallenge == "" || in.Body.CodeChallengeMethod != "S256" {
			return nil, huma.Error400BadRequest("PKCE with code_challenge_method=S256 is required")
		}
		s, err := tenant.Resolve(ctx, a.SysDB, id.ID, in.Body.WorkspaceID)
		if err != nil {
			return nil, huma.Error403Forbidden("you are not a member of that workspace")
		}
		scopes := Effective(s.Role, requestedScopes(in.Body.Scope))
		if len(scopes) == 0 {
			return nil, huma.Error403Forbidden("your role in that workspace cannot hold any of the requested scopes")
		}
		code := "mcpg_" + randomID(24)
		rawScopes, _ := json.Marshal(scopes)
		_, err = a.SysDB.ExecContext(ctx, `
			INSERT INTO oauth_codes (code_hash, client_id, redirect_uri, code_challenge, workspace_id, user_id, scopes, expires_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
			HashToken(code), in.Body.ClientID, in.Body.RedirectURI, in.Body.CodeChallenge, s.WorkspaceID, id.ID, string(rawScopes), time.Now().Add(codeTTL))
		if err != nil {
			return nil, huma.Error500InternalServerError("could not create the authorization code")
		}
		qs.Set("code", code)
		dest.RawQuery = qs.Encode()
		out := &struct {
			Body struct {
				RedirectTo string `json:"redirect_to"`
			}
		}{}
		out.Body.RedirectTo = dest.String()
		return out, nil
	})
}

// ── Token endpoint (RFC 6749 §4.1.3 / §6): application/x-www-form-urlencoded, public ───────

type tokenResponse struct {
	AccessToken  string `json:"access_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int64  `json:"expires_in,omitempty"`
	RefreshToken string `json:"refresh_token,omitempty"`
	Scope        string `json:"scope"`
}

func tokenError(w http.ResponseWriter, code, desc string) {
	writeJSON(w, http.StatusBadRequest, map[string]string{"error": code, "error_description": desc})
}

// TokenHandler exchanges an authorization code (with its PKCE verifier) or a refresh token for a
// real mcp_tokens row — the same kind of token Settings → MCP tokens mints, just handed out
// through the OAuth dance instead of a copy-paste dialog.
func TokenHandler(sysDB *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", "POST")
			tokenError(w, "invalid_request", "use POST")
			return
		}
		if err := r.ParseForm(); err != nil {
			tokenError(w, "invalid_request", "could not parse form body")
			return
		}
		switch r.PostForm.Get("grant_type") {
		case "authorization_code":
			exchangeCode(w, r, sysDB)
		case "refresh_token":
			exchangeRefresh(w, r, sysDB)
		default:
			tokenError(w, "unsupported_grant_type", "use authorization_code or refresh_token")
		}
	}
}

func exchangeCode(w http.ResponseWriter, r *http.Request, sysDB *sql.DB) {
	code := r.PostForm.Get("code")
	if code == "" {
		tokenError(w, "invalid_request", "code is required")
		return
	}
	var clientID, redirectURI, codeChallenge, workspaceID, userID, rawScopes string
	var expiresAt time.Time
	// Looked up, not consumed yet: a wrong code_verifier or a client_id/redirect_uri mismatch
	// must fail without burning the code — the legitimate client (which has the real verifier)
	// still needs it to work. Only a genuinely successful exchange, below, deletes it.
	err := sysDB.QueryRowContext(r.Context(), `
		SELECT client_id, redirect_uri, code_challenge, workspace_id, user_id, scopes, expires_at
		FROM oauth_codes WHERE code_hash = $1`, HashToken(code),
	).Scan(&clientID, &redirectURI, &codeChallenge, &workspaceID, &userID, &rawScopes, &expiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		tokenError(w, "invalid_grant", "unknown or already-used code")
		return
	}
	if err != nil {
		tokenError(w, "server_error", "")
		return
	}
	if time.Now().After(expiresAt) {
		tokenError(w, "invalid_grant", "code expired")
		return
	}
	if r.PostForm.Get("client_id") != clientID || r.PostForm.Get("redirect_uri") != redirectURI {
		tokenError(w, "invalid_grant", "client_id or redirect_uri does not match the authorization request")
		return
	}
	if !pkceMatch(r.PostForm.Get("code_verifier"), codeChallenge) {
		tokenError(w, "invalid_grant", "code_verifier does not match")
		return
	}
	// Every check passed: consume it now, atomically, so a raced or replayed exchange of the
	// same code — including two legitimate-looking requests at once — succeeds at most once.
	if res, err := sysDB.ExecContext(r.Context(), `DELETE FROM oauth_codes WHERE code_hash = $1`, HashToken(code)); err != nil {
		tokenError(w, "server_error", "")
		return
	} else if n, _ := res.RowsAffected(); n == 0 {
		tokenError(w, "invalid_grant", "unknown or already-used code")
		return
	}
	c, err := loadClient(r.Context(), sysDB, clientID)
	if err != nil {
		tokenError(w, "invalid_grant", "unknown client")
		return
	}
	var scopes []string
	_ = json.Unmarshal([]byte(rawScopes), &scopes)
	expires := time.Now().Add(issuedTokenDays * 24 * time.Hour)
	plain, tok, err := mintToken(r.Context(), sysDB, workspaceID, userID, "OAuth: "+c.name, scopes, nil, &expires)
	if err != nil {
		tokenError(w, "server_error", "")
		return
	}
	refresh := "mcpr_" + randomID(32)
	if _, err := sysDB.ExecContext(r.Context(), `
		INSERT INTO oauth_refresh_tokens (token_hash, client_id, workspace_id, user_id, scopes, mcp_token_id)
		VALUES ($1, $2, $3, $4, $5, $6)`,
		HashToken(refresh), clientID, workspaceID, userID, rawScopes, tok.ID); err != nil {
		tokenError(w, "server_error", "")
		return
	}
	writeJSON(w, http.StatusOK, tokenResponse{
		AccessToken: plain, TokenType: "Bearer", ExpiresIn: int64(time.Until(expires).Seconds()),
		RefreshToken: refresh, Scope: strings.Join(scopes, " "),
	})
}

func exchangeRefresh(w http.ResponseWriter, r *http.Request, sysDB *sql.DB) {
	old := r.PostForm.Get("refresh_token")
	clientID := r.PostForm.Get("client_id")
	if old == "" {
		tokenError(w, "invalid_request", "refresh_token is required")
		return
	}
	var workspaceID, userID, rawScopes string
	var mcpTokenID sql.NullString
	err := sysDB.QueryRowContext(r.Context(), `
		SELECT workspace_id, user_id, scopes, mcp_token_id FROM oauth_refresh_tokens
		WHERE token_hash = $1 AND client_id = $2 AND revoked_at IS NULL`,
		HashToken(old), clientID,
	).Scan(&workspaceID, &userID, &rawScopes, &mcpTokenID)
	if errors.Is(err, sql.ErrNoRows) {
		tokenError(w, "invalid_grant", "unknown, revoked, or mismatched refresh_token")
		return
	}
	if err != nil {
		tokenError(w, "server_error", "")
		return
	}
	c, err := loadClient(r.Context(), sysDB, clientID)
	if err != nil {
		tokenError(w, "invalid_grant", "unknown client")
		return
	}
	// Rotation: the old refresh token and the access token it controlled both die here, even if
	// anything below fails — a refresh token is one-time-use, same as an authorization code.
	if _, err := sysDB.ExecContext(r.Context(), `UPDATE oauth_refresh_tokens SET revoked_at = now() WHERE token_hash = $1`, HashToken(old)); err != nil {
		tokenError(w, "server_error", "")
		return
	}
	if mcpTokenID.Valid {
		_, _ = sysDB.ExecContext(r.Context(), `UPDATE mcp_tokens SET revoked_at = now() WHERE id = $1`, mcpTokenID.String)
	}
	var scopes []string
	_ = json.Unmarshal([]byte(rawScopes), &scopes)
	expires := time.Now().Add(issuedTokenDays * 24 * time.Hour)
	plain, tok, err := mintToken(r.Context(), sysDB, workspaceID, userID, "OAuth: "+c.name, scopes, nil, &expires)
	if err != nil {
		tokenError(w, "server_error", "")
		return
	}
	next := "mcpr_" + randomID(32)
	if _, err := sysDB.ExecContext(r.Context(), `
		INSERT INTO oauth_refresh_tokens (token_hash, client_id, workspace_id, user_id, scopes, mcp_token_id)
		VALUES ($1, $2, $3, $4, $5, $6)`,
		HashToken(next), clientID, workspaceID, userID, rawScopes, tok.ID); err != nil {
		tokenError(w, "server_error", "")
		return
	}
	writeJSON(w, http.StatusOK, tokenResponse{
		AccessToken: plain, TokenType: "Bearer", ExpiresIn: int64(time.Until(expires).Seconds()),
		RefreshToken: next, Scope: strings.Join(scopes, " "),
	})
}

// ── Revocation (RFC 7009) ───────────────────────────────────────────────────────────────────

// RevokeHandler revokes either an access token (the mcp_tokens row it maps to) or a refresh
// token, scoped to the client_id that presents it. Per RFC 7009, an unknown token is not an
// error — it just means there is nothing left to revoke, so scanning for valid tokens this way
// tells an attacker nothing.
func RevokeHandler(sysDB *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", "POST")
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		if err := r.ParseForm(); err != nil {
			w.WriteHeader(http.StatusOK)
			return
		}
		token := r.PostForm.Get("token")
		clientID := r.PostForm.Get("client_id")
		if token != "" {
			if isUserToken(token) {
				_, _ = sysDB.ExecContext(r.Context(), `
					UPDATE mcp_tokens SET revoked_at = now() WHERE token_hash = $1
					  AND id IN (SELECT mcp_token_id FROM oauth_refresh_tokens WHERE client_id = $2)`,
					HashToken(token), clientID)
			} else {
				_, _ = sysDB.ExecContext(r.Context(), `
					UPDATE oauth_refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND client_id = $2`,
					HashToken(token), clientID)
			}
		}
		w.WriteHeader(http.StatusOK)
	}
}

// Mount adds every raw (non-Huma) public OAuth route. Called from internal/server/oauth.go;
// RegisterOAuthConsent (Huma, tierSignedIn) is mounted separately in registerREST.
func MountOAuth(router interface {
	Get(pattern string, h http.HandlerFunc)
	Post(pattern string, h http.HandlerFunc)
}, sysDB *sql.DB) {
	router.Get(ASMetadataPath, AuthServerMetadataHandler())
	router.Get(RSMetadataPath, ResourceMetadataHandler())
	router.Get(AuthorizePath, AuthorizeHandler(sysDB))
	router.Post(RegisterPath, RegisterClientHandler(sysDB))
	router.Post(TokenPath, TokenHandler(sysDB))
	router.Post(RevokePath, RevokeHandler(sysDB))
}
