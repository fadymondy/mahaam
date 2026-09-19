package admin

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/fadymondy/mahaam/internal/limits"
)

// Plans lists every plan.
func (sv *Service) Plans(ctx context.Context) ([]limits.Plan, error) {
	return limits.ListPlans(ctx, sv.DB)
}

func planErr(err error) error {
	var pg *pgconn.PgError
	switch {
	case errors.As(err, &pg) && pg.Code == "23505":
		return errStatus(http.StatusConflict, "a plan with that key exists")
	case errors.As(err, &pg) && pg.Code == "23514":
		return invalid("the key must be 1–40 lowercase letters, digits, - or _")
	case isNoRows(err):
		return notFound("plan")
	case err != nil && !errors.As(err, &pg):
		return invalid(err.Error())
	}
	return err
}

// CreatePlan adds a plan.
func (sv *Service) CreatePlan(ctx context.Context, a Actor, p limits.Plan) (*limits.Plan, error) {
	if strings.TrimSpace(p.Key) == "new" {
		return nil, invalid(`"new" is reserved`)
	}
	out, err := limits.SavePlan(ctx, sv.DB, p, true)
	if err != nil {
		return nil, planErr(err)
	}
	if err := sv.audit(ctx, sv.DB, a, "plan.created", "plan", out.Key, out.NameEn, out); err != nil {
		return nil, err
	}
	return out, nil
}

// UpdatePlan replaces a plan's fields (its key stays). Every workspace on it picks the change up.
func (sv *Service) UpdatePlan(ctx context.Context, a Actor, key string, p limits.Plan) (*limits.Plan, error) {
	before, err := limits.GetPlan(ctx, sv.DB, strings.TrimSpace(key))
	if err != nil {
		return nil, planErr(err)
	}
	p.Key = before.Key
	out, err := limits.SavePlan(ctx, sv.DB, p, false)
	if err != nil {
		return nil, planErr(err)
	}
	if err := sv.audit(ctx, sv.DB, a, "plan.updated", "plan", out.Key, out.NameEn, map[string]any{"from": before, "to": out}); err != nil {
		return nil, err
	}
	return out, nil
}

// PatchPlan changes only the given limit rules and fields of a plan (the admin MCP's update_plan).
func (sv *Service) PatchPlan(ctx context.Context, a Actor, key string, rules map[string]limits.Rule, active *bool, baseFee *int64) (*limits.Plan, error) {
	p, err := limits.GetPlan(ctx, sv.DB, strings.TrimSpace(key))
	if err != nil {
		return nil, planErr(err)
	}
	if err := limits.ValidateRules(rules); err != nil {
		return nil, invalid(err.Error())
	}
	for k, r := range rules {
		p.Limits[k] = r
	}
	if active != nil {
		p.Active = *active
	}
	if baseFee != nil {
		p.BaseFeeMinor = *baseFee
	}
	return sv.UpdatePlan(ctx, a, key, *p)
}

// DeactivatePlan hides a plan from new assignments; workspaces already on it keep it.
func (sv *Service) DeactivatePlan(ctx context.Context, a Actor, key string) (*limits.Plan, error) {
	p, err := limits.GetPlan(ctx, sv.DB, strings.TrimSpace(key))
	if err != nil {
		return nil, planErr(err)
	}
	if p.Key == "unlimited" || p.Key == "free" {
		return nil, errStatus(http.StatusConflict, "the "+p.Key+" plan is built in and stays active")
	}
	p.Active = false
	return sv.UpdatePlan(ctx, a, key, *p)
}
