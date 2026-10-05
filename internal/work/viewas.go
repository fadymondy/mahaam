package work

import (
	"context"
	"errors"
	"net/http"

	"github.com/fadymondy/mahaam/internal/tenant"
)

/*
View as (MH-1159): an owner or admin looks at the workspace through a team member's eyes.

	POST /api/w/members/{user}/view-as    check and record it; answers who you will see as

The viewing itself is the X-View-As header on every later request (tenant/viewas.go), which runs
read-only with the member's user and role. This endpoint is the explicit start: it checks the
same rule up front, so the web can say no before switching, and leaves a member.viewed_as entry
in the activity log.
*/

// ViewAsOut is who the caller now sees the workspace as.
type ViewAsOut struct {
	UserID string `json:"user_id"`
	Email  string `json:"email"`
	Role   string `json:"role"`
}

// StartViewAs checks that the caller may view the workspace as user and records it.
func (sv *Service) StartViewAs(ctx context.Context, user string) (*ViewAsOut, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if s.ImpersonatorID != "" {
		return nil, forbidden("exit view-as first")
	}
	v, err := tenant.ViewAs(ctx, sv.Sys, s, user)
	if errors.Is(err, tenant.ErrViewAsDenied) {
		return nil, forbidden("only owners and admins can view as a member, and never as a higher role")
	}
	if err != nil {
		return nil, err
	}
	err = record(ctx, sv.DB, s, entry{
		Action: "member.viewed_as", SubjectType: "user", SubjectID: v.UserID,
		Changes: map[string]any{"email": v.Email, "role": v.Role},
	})
	if err != nil {
		return nil, err
	}
	return &ViewAsOut{UserID: v.UserID, Email: v.Email, Role: v.Role}, nil
}

func (r routes) viewAs() {
	do(r, http.MethodPost, "/api/w/members/{user}/view-as", "w-member-view-as",
		"View the workspace as a member (owner/admin; read-only, sent as X-View-As)", "Tenancy", 0,
		func(ctx context.Context, in *struct {
			WS
			UserRef
		}) (*ViewAsOut, error) {
			return r.sv.StartViewAs(ctx, in.User)
		})
}
