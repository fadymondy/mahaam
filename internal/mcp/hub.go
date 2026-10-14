package mcp

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"slices"

	circlexo "github.com/circlexo/circlexo-go"
	sdkmcp "github.com/circlexo/circlexo-go/mcp"

	"github.com/fadymondy/mahaam/internal/app"
	hub "github.com/fadymondy/mahaam/internal/circlexo"
	"github.com/fadymondy/mahaam/internal/tenant"
)

/*
Federated MCP: /api/mcp also accepts an access token the CircleXO hub issued (the hub's MCP
gateway, or a client that got one from the hub's authorization server). It is verified against the
hub's JWKS with the audience set to Mahaam's app id (the SDK's Verifier), and then mapped to the
same tenant.Scope a Mahaam token gets:

	token subject -> Mahaam user      circlexo_user_links (the person must have signed in with
	                                  CircleXO once, or been synced from the org, so a link exists)
	token org_id  -> workspace        circlexo_org_links, ACTIVE only
	membership    -> role             workspace_members, re-read on every call (admit)

An unlinked user, an unknown or deinstalled org, or a non-member is refused (403), never guessed.
mgy_/mhm_ tokens are handled before this and are unchanged.

Scopes. The hub's gateway scopes (openid, profile, email, org, entitlements, ...) say nothing
about what an MCP tool may do, so they cannot be the tool scopes. Instead:
  - a token that names Mahaam tool scopes ("tasks:write") gets exactly those;
  - a token the hub gateway exchanged for an agent (it carries an act chain) gets hubAgentScopes,
    the working set the manifest declares (read and write of the work items, no member/team/rate
    administration);
  - any other hub token gets the read scopes only.
Whatever the source, Effective() narrows it to the user's current workspace role, so an agent
never exceeds its human.
*/

// hubAgentScopes is the tool scopes granted to a gateway-exchanged (agent) token.
var hubAgentScopes = []string{
	"members:read",
	"projects:read", "projects:write",
	"tasks:read", "tasks:write",
	"issues:read", "issues:write",
	"time:read", "time:write",
	"reports:read",
	"ai:record", "ai:read",
	"clients:read",
	"invoices:read", "invoices:write",
	"feedback:read", "feedback:write",
	"vault:read", "vault:write",
}

// authHub authenticates a CircleXO-issued access token. It reports ok=false (a plain 401) for a
// token that is not a valid hub token, or when the integration is off.
func authHub(r *http.Request, a *app.App, token string) (context.Context, []string, bool) {
	svc := hub.Current()
	if svc == nil {
		return nil, nil, false
	}
	ctx := r.Context()
	claims, err := svc.Verifier.VerifyAccessToken(ctx, token)
	if err != nil || claims.Subject == "" || claims.IsService() {
		return nil, nil, false
	}
	userID, err := svc.UserBySubject(ctx, claims.Subject)
	if errors.Is(err, sql.ErrNoRows) {
		return withDeny(ctx, http.StatusForbidden, "this CircleXO user has not signed in to Mahaam yet — sign in with CircleXO once"), nil, true
	}
	if err != nil {
		return nil, nil, false
	}
	if claims.OrgID == "" {
		return withDeny(ctx, http.StatusForbidden, "this token names no organization"), nil, true
	}
	link, err := svc.OrgByID(ctx, claims.OrgID)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && !link.Active) {
		return withDeny(ctx, http.StatusForbidden, "this organization is not connected to a Mahaam workspace"), nil, true
	}
	if err != nil {
		return nil, nil, false
	}

	s, dctx, err := admit(ctx, a, userID, link.WorkspaceID)
	if dctx != nil {
		return dctx, nil, true
	}
	if errors.Is(err, tenant.ErrNotMember) {
		return withDeny(ctx, http.StatusForbidden, "you are not a member of this workspace"), nil, true
	}
	if err != nil {
		return nil, nil, false
	}
	s.Via = "mcp"
	s.Scopes = Effective(s.Role, hubToolScopes(claims))
	caller := &sdkmcp.Caller{UserID: claims.Subject, OrgID: claims.OrgID, OrgRole: claims.OrgRole, Scopes: claims.Scopes(), AgentID: claims.AgentID, Via: claims.Actor, Claims: claims}
	s.Actors = caller.Actors()
	return tenant.With(sdkmcp.NewContext(ctx, caller), s), s.Scopes, true
}

// hubToolScopes is the Mahaam tool scopes a verified hub token stands for, before the role narrows
// them (see the comment at the top of this file).
func hubToolScopes(c *circlexo.Claims) []string {
	var named []string
	for _, sc := range c.Scopes() {
		if _, ok := userScope(sc); ok {
			named = append(named, sc)
		}
	}
	if len(named) > 0 {
		return named
	}
	if c.Actor != nil {
		return slices.Clone(hubAgentScopes)
	}
	var reads []string
	for _, d := range UserScopes {
		if len(d.Scope) > 5 && d.Scope[len(d.Scope)-5:] == ":read" {
			reads = append(reads, d.Scope)
		}
	}
	return reads
}
