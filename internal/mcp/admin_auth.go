package mcp

import (
	"context"
	"net/http"
	"time"

	"github.com/fadymondy/mahaam/internal/app"
	"github.com/fadymondy/mahaam/internal/platform"
	"github.com/fadymondy/mahaam/internal/tenant"
)

// adminCaller is who an admin MCP call acts as.
type adminCaller struct {
	UserID, Email, TokenID string
}

type adminKey struct{}

func callerFrom(ctx context.Context) adminCaller {
	c, _ := ctx.Value(adminKey{}).(adminCaller)
	return c
}

// authAdmin resolves an admin MCP token. Two conditions, both re-checked on
// every call: the token is live, AND its user is still a platform admin
// (users.roles contains "admin"). Losing the role kills every admin token the
// user holds. A user MCP token (mgy_) is refused here outright.
func authAdmin(r *http.Request, a *app.App, token string) (context.Context, []string, bool) {
	if !isAdminToken(token) {
		return nil, nil, false
	}
	ctx := r.Context()
	var id, userID, rawScopes, roles, email string
	var expires, revoked *time.Time
	err := a.SysDB.QueryRowContext(ctx, `
		SELECT t.id, t.user_id, t.scopes, t.expires_at, t.revoked_at, u.roles, u.email
		FROM admin_mcp_tokens t JOIN users u ON u.id = t.user_id
		WHERE t.token_hash = $1`, HashToken(token),
	).Scan(&id, &userID, &rawScopes, &expires, &revoked, &roles, &email)
	if err != nil || revoked != nil || (expires != nil && time.Now().After(*expires)) {
		return nil, nil, false
	}
	if !IsPlatformAdmin(roles) {
		return nil, nil, false
	}
	if u, err := platform.Load(ctx, a.SysDB, userID); err != nil || u.Suspended() {
		return nil, nil, false
	}
	scopes := []string{}
	for _, s := range parseScopes(rawScopes) {
		if adminScope(s) {
			scopes = append(scopes, s)
		}
	}
	_, _ = a.SysDB.ExecContext(ctx, `UPDATE admin_mcp_tokens SET last_used_at = now() WHERE id = $1`, id)
	return context.WithValue(ctx, adminKey{}, adminCaller{UserID: userID, Email: email, TokenID: id}), scopes, true
}

// IsPlatformAdmin reads the auth plugin's CSV roles column.
func IsPlatformAdmin(csv string) bool { return tenant.IsPlatformAdmin(csv) }
