package circlexo

import (
	"context"
	"database/sql"
	"errors"

	"github.com/circlexo/circlexo-go/entitlements"

	"github.com/fadymondy/mahaam/internal/limits"
)

// Hub feature keys, as declared in the manifest. `members` and `projects` are counted limits;
// `client_portal` is a plain feature.
const (
	featMembers  = "members"
	featProjects = "projects"
	featPortal   = "client_portal"
)

// overlay is the limits.Overlay: for a workspace with an ACTIVE org link the hub decides
// projects, members and the client portal (through the SDK's entitlements cache, which is what
// gives the fail-closed grace behaviour); every other limit keeps the workspace's Mahaam plan, and
// a workspace with no link — or an inactive one — is not touched at all.
//
// Fail closed: when the hub cannot confirm the org's entitlements, or says the org has none, the
// hub-governed limits are 0 and the portal is off. In the SDK's grace window (a stale copy while
// the hub is down) the last known entitlements apply but e.ReadOnly is set, so adding projects or
// members is refused while reading keeps working.
func (s *Service) overlay(ctx context.Context, ws string, e *limits.Effective) error {
	link, err := s.OrgByWorkspace(ctx, ws)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && !link.Active) {
		return nil
	}
	if err != nil {
		return err
	}
	e.Hub = true
	set, err := s.Ents.Get(ctx, link.OrgID, 0)
	if err != nil {
		// Unreachable with no usable copy, or the hub says the org does not have the app.
		set = nil
	}
	e.Plan.NameEn, e.Plan.NameAr = "CircleXO", "CircleXO"
	if set != nil && set.Plan != "" {
		e.Plan.NameEn, e.Plan.NameAr = "CircleXO ("+set.Plan+")", "CircleXO ("+set.Plan+")"
	}
	if set == nil || !set.Active {
		e.ReadOnly = true
	} else if set.ReadOnly {
		e.ReadOnly = true
	}
	for key, feat := range map[string]string{limits.Members: featMembers, limits.Projects: featProjects} {
		e.Rules[key] = hubRule(set, feat).Normalize(key)
		e.Overridden[key] = true
	}
	e.Features.CustomerPortal = set.Has(featPortal)
	return nil
}

// hubRule is the limit rule a hub feature stands for: off (or no entitlements at all) is 0, a
// feature with no limit is unlimited, otherwise the limit. It is always a hard cap; the hub, not
// Mahaam, bills any overage.
func hubRule(set *entitlements.Set, feature string) limits.Rule {
	if !set.Has(feature) {
		zero := int64(0)
		return limits.Rule{Limit: &zero, Policy: limits.Block}
	}
	f, _ := set.Feature(feature)
	return limits.Rule{Limit: f.Limit, Policy: limits.Block}
}
