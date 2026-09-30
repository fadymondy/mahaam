package mcp

import (
	"slices"

	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/fadymondy/mahaam/internal/work"
	"net/http"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"

	"github.com/fadymondy/mahaam/internal/app"
	"github.com/fadymondy/mahaam/internal/authz"
	"github.com/fadymondy/mahaam/internal/limits"
	"github.com/fadymondy/mahaam/internal/platform"
	"github.com/fadymondy/mahaam/internal/tenant"
)

// Token prefixes. Distinct, so neither server can be handed the other's token
// and so a leaked token is recognisable in a log or a secret scanner. New tokens
// carry the Mahaam prefixes; the Managy ones are still accepted, so every token
// minted before the rename keeps working (hasPrefix below checks both).
const (
	UserPrefix  = "mhm_"
	AdminPrefix = "mha_"
	// Legacy (Managy) prefixes, accepted forever.
	oldUserPrefix  = "mgy_"
	oldAdminPrefix = "mga_"
)

// isUserToken / isAdminToken accept the current prefix and the legacy one.
func isUserToken(t string) bool {
	return strings.HasPrefix(t, UserPrefix) || strings.HasPrefix(t, oldUserPrefix)
}

func isAdminToken(t string) bool {
	return strings.HasPrefix(t, AdminPrefix) || strings.HasPrefix(t, oldAdminPrefix)
}

// HashToken is the only form a token is stored in.
func HashToken(plain string) string {
	sum := sha256.Sum256([]byte(plain))
	return hex.EncodeToString(sum[:])
}

// NewToken returns a plaintext token and its visible prefix (prefix + 8 chars).
func NewToken(prefix string) (plain, visible string) {
	b := make([]byte, 24)
	_, _ = rand.Read(b)
	plain = prefix + hex.EncodeToString(b)
	return plain, plain[:len(prefix)+8]
}

func parseScopes(raw string) []string {
	var list []string
	if json.Unmarshal([]byte(raw), &list) != nil {
		return nil
	}
	return list
}

// mintToken inserts a new mcp_tokens row and returns the plaintext (shown once) and the row.
// Shared by POST /api/w/mcp_tokens and the OAuth token endpoint (internal/mcp/oauth.go), which
// is the ONLY new thing the OAuth flow introduces: everything after this point — auth,
// tenant.Resolve, scope narrowing, project scoping, rate limits — is the same code every other
// MCP token already runs through.
func mintToken(ctx context.Context, db *sql.DB, workspaceID, userID, name string, scopes, projectIDs []string, expires *time.Time) (plain string, out *tokenOut, err error) {
	plain, visible := NewToken(UserPrefix)
	rawScopes, _ := json.Marshal(scopes)
	rawProjects, _ := json.Marshal(projectIDs)
	t := &tokenOut{}
	err = db.QueryRowContext(ctx, `
		INSERT INTO mcp_tokens (workspace_id, user_id, name, token_hash, prefix, scopes, expires_at, project_ids)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING id, name, prefix, expires_at, last_used_at, revoked_at, created_at`,
		workspaceID, userID, name, HashToken(plain), visible, string(rawScopes), expires, string(rawProjects),
	).Scan(&t.ID, &t.Name, &t.Prefix, &t.ExpiresAt, &t.LastUsedAt, &t.RevokedAt, &t.CreatedAt)
	if err != nil {
		return "", nil, err
	}
	t.Scopes = scopes
	t.ProjectIDs = projectIDs
	return plain, t, nil
}

// authUser resolves a user MCP token to the SAME tenant.Scope a browser session
// gets — workspace, user, current role — so the tools run under the same authz
// and the same RLS. The token's stored scopes are narrowed by the role.
func authUser(r *http.Request, a *app.App, token string) (context.Context, []string, bool) {
	if !isUserToken(token) {
		return authHub(r, a, token) // a CircleXO-issued token, when that integration is on
	}
	ctx := r.Context()
	var id, workspaceID, userID, rawScopes, rawProjects string
	var expires, revoked *time.Time
	err := a.SysDB.QueryRowContext(ctx, `
		SELECT id, workspace_id, user_id, scopes, project_ids, expires_at, revoked_at
		FROM mcp_tokens WHERE token_hash = $1`, HashToken(token),
	).Scan(&id, &workspaceID, &userID, &rawScopes, &rawProjects, &expires, &revoked)
	if err != nil || revoked != nil || (expires != nil && time.Now().After(*expires)) {
		return nil, nil, false
	}
	// Membership is re-checked on every call: a removed member's token dies with
	// the membership, a demoted one's scopes shrink.
	s, dctx, err := admit(ctx, a, userID, workspaceID)
	if dctx != nil {
		return dctx, nil, true
	}
	if err != nil {
		return nil, nil, false
	}
	s.Via = "mcp"
	s.TokenID = id
	s.Scopes = Effective(s.Role, parseScopes(rawScopes))
	// A project-scoped token sees only its projects (and their issues); see tenant.Scope.
	s.ProjectIDs = parseScopes(rawProjects)

	_, _ = a.SysDB.ExecContext(ctx, `UPDATE mcp_tokens SET last_used_at = now() WHERE id = $1`, id)
	return tenant.With(ctx, s), s.Scopes, true
}

// admit is what every MCP caller passes, whatever kind of token it presented: the user is a
// current member of the workspace (else err), neither is suspended, and the workspace's plan
// allows another API call. It returns the tenant.Scope to fill in (Via, scopes, ...), or a
// denied context (dctx) to hand back as the refusal.
func admit(ctx context.Context, a *app.App, userID, workspaceID string) (s *tenant.Scope, dctx context.Context, err error) {
	s, err = tenant.Resolve(ctx, a.SysDB, userID, workspaceID)
	var susp *tenant.SuspendedError
	if errors.As(err, &susp) {
		return nil, withDeny(ctx, http.StatusForbidden, susp.Error()), nil
	}
	if err != nil {
		return nil, nil, err
	}
	// A suspended account's tokens stop with it.
	if u, err := platform.Load(ctx, a.SysDB, userID); err != nil {
		return nil, nil, err
	} else if u.Suspended() {
		return nil, withDeny(ctx, http.StatusForbidden, u.SuspendedMessage()), nil
	}
	// The plan's API quotas (internal/limits): per-minute rate and a block-policy monthly quota.
	if x, refused := limits.As(limits.CountCall(ctx, workspaceID)); refused {
		return nil, withDeny(ctx, x.Status, x.Msg), nil
	}
	return s, nil, nil
}

// ---- token management endpoints (Settings → Developer → MCP tokens) -----

type tokenOut struct {
	ID         string     `json:"id"`
	Name       string     `json:"name"`
	Prefix     string     `json:"prefix"`
	Scopes     []string   `json:"scopes"`
	ProjectIDs []string   `json:"project_ids" doc:"Projects the token is limited to; empty = every project you can see"`
	ExpiresAt  *time.Time `json:"expires_at"`
	LastUsedAt *time.Time `json:"last_used_at"`
	RevokedAt  *time.Time `json:"revoked_at"`
	CreatedAt  time.Time  `json:"created_at"`
}

type scopeOut struct {
	Scope       string `json:"scope"`
	Description string `json:"description"`
	MinRole     string `json:"min_role"`
	Allowed     bool   `json:"allowed"`
}

type wsHeader struct {
	WorkspaceID string `header:"X-Workspace-ID" doc:"Workspace id or slug. Non-members get 404."`
}

// RegisterTokenRoutes mounts the user-token endpoints. `a` may be nil (OpenAPI).
func RegisterTokenRoutes(api huma.API, a *app.App) {
	huma.Register(api, huma.Operation{
		OperationID: "list-my-mcp-tokens", Method: http.MethodGet, Path: "/api/w/mcp_tokens",
		Summary: "My MCP tokens in this workspace, and the scopes I may grant", Tags: []string{"MCP"},
	}, func(ctx context.Context, _ *wsHeader) (*struct {
		Body struct {
			Tokens []tokenOut `json:"tokens"`
			Scopes []scopeOut `json:"scopes"`
		}
	}, error) {
		s, ok := tenant.From(ctx)
		if !ok {
			return nil, huma.Error404NotFound("workspace not found")
		}
		rows, err := a.SQLDB.QueryContext(ctx, `
			SELECT id, name, prefix, scopes, project_ids, expires_at, last_used_at, revoked_at, created_at
			FROM mcp_tokens WHERE workspace_id = $1 AND user_id = $2 ORDER BY created_at DESC`,
			s.WorkspaceID, s.UserID)
		if err != nil {
			return nil, huma.Error500InternalServerError("could not list tokens")
		}
		defer rows.Close()
		out := &struct {
			Body struct {
				Tokens []tokenOut `json:"tokens"`
				Scopes []scopeOut `json:"scopes"`
			}
		}{}
		out.Body.Tokens = []tokenOut{}
		for rows.Next() {
			var t tokenOut
			var raw, rawProjects string
			if err := rows.Scan(&t.ID, &t.Name, &t.Prefix, &raw, &rawProjects, &t.ExpiresAt, &t.LastUsedAt, &t.RevokedAt, &t.CreatedAt); err != nil {
				return nil, huma.Error500InternalServerError("could not list tokens")
			}
			t.Scopes = parseScopes(raw)
			t.ProjectIDs = parseScopes(rawProjects)
			out.Body.Tokens = append(out.Body.Tokens, t)
		}
		for _, d := range UserScopes {
			out.Body.Scopes = append(out.Body.Scopes, scopeOut{
				Scope: d.Scope, Description: d.Description, MinRole: string(d.MinRole),
				Allowed: authz.Role(s.Role).AtLeast(d.MinRole),
			})
		}
		return out, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "create-my-mcp-token", Method: http.MethodPost, Path: "/api/w/mcp_tokens",
		DefaultStatus: http.StatusCreated, Summary: "Mint an MCP token (plaintext returned once)", Tags: []string{"MCP"},
	}, func(ctx context.Context, in *struct {
		wsHeader
		Body struct {
			Name          string   `json:"name" minLength:"1" maxLength:"80"`
			Scopes        []string `json:"scopes" minItems:"1"`
			Projects      []string `json:"projects,omitempty" maxItems:"50" doc:"Limit the token to these projects (ids or exact names). Omit for every project you can see."`
			ExpiresInDays int      `json:"expires_in_days,omitempty" minimum:"0" maximum:"365" doc:"0 = never"`
		}
	}) (*struct {
		Body struct {
			Token     tokenOut `json:"token"`
			Plaintext string   `json:"plaintext"`
		}
	}, error) {
		s, ok := tenant.From(ctx)
		if !ok {
			return nil, huma.Error404NotFound("workspace not found")
		}
		if !authz.Can(s.Role, authz.TokensManageOwn) {
			return nil, huma.Error403Forbidden("your role cannot create MCP tokens")
		}
		if err := limits.Check(ctx, s.WorkspaceID, limits.MCPTokens, 1); err != nil {
			return nil, limitErr(err)
		}
		name := strings.TrimSpace(in.Body.Name)
		if name == "" {
			return nil, huma.Error422UnprocessableEntity("a name is required")
		}
		seen := map[string]bool{}
		scopes := []string{}
		for _, sc := range in.Body.Scopes {
			sc = strings.TrimSpace(sc)
			if seen[sc] {
				continue
			}
			seen[sc] = true
			if _, known := userScope(sc); !known {
				return nil, huma.Error422UnprocessableEntity("unknown scope: " + sc)
			}
			if !RoleMayHold(s.Role, sc) {
				return nil, huma.Error422UnprocessableEntity("your role cannot grant " + sc)
			}
			scopes = append(scopes, sc)
		}
		if len(scopes) == 0 {
			return nil, huma.Error422UnprocessableEntity("choose at least one scope")
		}
		var expires *time.Time
		if in.Body.ExpiresInDays > 0 {
			t := time.Now().Add(time.Duration(in.Body.ExpiresInDays) * 24 * time.Hour).UTC()
			expires = &t
		}
		projectIDs := []string{}
		for _, ref := range in.Body.Projects {
			if strings.TrimSpace(ref) == "" {
				continue
			}
			p, err := work.New(a).FindProject(ctx, ref)
			if err != nil {
				return nil, huma.Error422UnprocessableEntity("unknown project: " + ref)
			}
			if !slices.Contains(projectIDs, p.ID) {
				projectIDs = append(projectIDs, p.ID)
			}
		}

		plain, tok, err := mintToken(ctx, a.SQLDB, s.WorkspaceID, s.UserID, name, scopes, projectIDs, expires)
		if err != nil {
			return nil, huma.Error500InternalServerError("could not create the token")
		}
		out := &struct {
			Body struct {
				Token     tokenOut `json:"token"`
				Plaintext string   `json:"plaintext"`
			}
		}{}
		out.Body.Token = *tok
		out.Body.Plaintext = plain
		return out, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "revoke-mcp-token", Method: http.MethodDelete, Path: "/api/w/mcp_tokens/{id}",
		DefaultStatus: http.StatusNoContent, Summary: "Revoke an MCP token (your own; admins: any in the workspace)",
		Tags: []string{"MCP"},
	}, func(ctx context.Context, in *struct {
		wsHeader
		ID string `path:"id"`
	}) (*struct{}, error) {
		s, ok := tenant.From(ctx)
		if !ok {
			return nil, huma.Error404NotFound("workspace not found")
		}
		anyToken := authz.Can(s.Role, authz.TokensRevokeAny)
		res, err := a.SQLDB.ExecContext(ctx, `
			UPDATE mcp_tokens SET revoked_at = now(), updated_at = now()
			WHERE workspace_id = $1 AND id = $2 AND revoked_at IS NULL AND (user_id = $3 OR $4)`,
			s.WorkspaceID, in.ID, s.UserID, anyToken)
		if err != nil {
			return nil, huma.Error500InternalServerError("could not revoke the token")
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return nil, huma.Error404NotFound("token not found")
		}
		return &struct{}{}, nil
	})
}

// errNotFound is what tools return for anything outside the caller's reach.
var errNotFound = errors.New("not found")

var _ = sql.ErrNoRows

// limitErr turns a plan refusal (internal/limits) into its HTTP error; anything else is a 500.
func limitErr(err error) error {
	if x, ok := limits.As(err); ok {
		return huma.NewError(x.Status, x.Msg)
	}
	return huma.Error500InternalServerError("could not check the plan")
}
