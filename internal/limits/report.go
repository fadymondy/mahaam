package limits

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"strings"
	"time"
)

// Item is one limit's usage in a period.
type Item struct {
	Key            string `json:"key"`
	Kind           Kind   `json:"kind"`
	Usage          int64  `json:"usage"`
	Limit          *int64 `json:"limit"`
	Policy         string `json:"policy"`
	Over           int64  `json:"over"`
	UnitSize       int64  `json:"unit_size"`
	UnitPriceMinor int64  `json:"unit_price_minor"`
	OverageMinor   int64  `json:"overage_minor"`
	Overridden     bool   `json:"overridden"`
}

// ReportWorkspace is the workspace a report is about.
type ReportWorkspace struct {
	ID              string  `json:"id"`
	Slug            string  `json:"slug"`
	Name            string  `json:"name"`
	Status          string  `json:"status"`
	SuspendedReason *string `json:"suspended_reason"`
}

// ReportPlan is the plan a report is priced on.
type ReportPlan struct {
	Key          string `json:"key"`
	NameEn       string `json:"name_en"`
	NameAr       string `json:"name_ar"`
	Currency     string `json:"currency"`
	BaseFeeMinor int64  `json:"base_fee_minor"`
}

// Report is a workspace's usage against its plan for one month, with the pay-as-you-go estimate
// (base fee + overage). It is the payment extension point: a Stripe / Paymob integration would
// turn EstimateMinor (per workspace, per closed period) into an invoice or a metered charge.
type Report struct {
	Workspace          ReportWorkspace `json:"workspace"`
	Plan               ReportPlan      `json:"plan"`
	Period             string          `json:"period"`
	Items              []Item          `json:"items"`
	Features           Features        `json:"features"`
	FeaturesOverridden []string        `json:"features_overridden"`
	BaseFeeMinor       int64           `json:"base_fee_minor"`
	OverageMinor       int64           `json:"overage_minor"`
	EstimateMinor      int64           `json:"estimate_minor"`
	Currency           string          `json:"currency"`
	UpgradeContact     string          `json:"upgrade_contact"`
}

// UpgradeContact is where "contact us to upgrade" points (PLAN_UPGRADE_CONTACT: an email or URL).
func UpgradeContact() string {
	if v := strings.TrimSpace(os.Getenv("PLAN_UPGRADE_CONTACT")); v != "" {
		return v
	}
	return "sales@mahaam.app"
}

// BuildReport computes ws's usage report for the month containing period. For the current month
// the count and storage limits use live usage (and raise the recorded peaks); for a past month
// they use the recorded peaks. Overage on count/storage limits is billed on the month's peak.
func BuildReport(ctx context.Context, db *sql.DB, ws string, period time.Time) (*Report, error) {
	e, err := Load(ctx, db, ws)
	if err != nil {
		return nil, err
	}
	period = PeriodOf(period)
	current := period.Equal(PeriodOf(now()))

	r := &Report{Period: period.Format("2006-01-02"), Currency: e.Plan.Currency, BaseFeeMinor: e.Plan.BaseFeeMinor,
		Features: e.Features, FeaturesOverridden: e.FeaturesOverridden, UpgradeContact: UpgradeContact(),
		Plan: ReportPlan{Key: e.Plan.Key, NameEn: e.Plan.NameEn, NameAr: e.Plan.NameAr, Currency: e.Plan.Currency, BaseFeeMinor: e.Plan.BaseFeeMinor}}
	if err := db.QueryRowContext(ctx, `SELECT id, slug, name, status, suspended_reason FROM workspaces WHERE id = $1`, ws).
		Scan(&r.Workspace.ID, &r.Workspace.Slug, &r.Workspace.Name, &r.Workspace.Status, &r.Workspace.SuspendedReason); err != nil {
		return nil, err
	}

	var monthly = map[string]int64{}
	peaks := map[string]int64{}
	var rawPeaks []byte
	var issues, tasks, calls int64
	err = db.QueryRowContext(ctx, `SELECT issues_created, tasks_created, api_calls, peaks FROM workspace_usage WHERE workspace_id = $1 AND period = $2`,
		ws, period).Scan(&issues, &tasks, &calls, &rawPeaks)
	if err != nil && err != sql.ErrNoRows {
		return nil, err
	}
	if len(rawPeaks) > 0 {
		_ = json.Unmarshal(rawPeaks, &peaks)
	}
	if current {
		calls += pendingCalls(ws)
	}
	monthly[IssuesMonth], monthly[TasksMonth], monthly[APICallsMonth] = issues, tasks, calls

	for _, d := range Catalog {
		rule := e.Rule(d.Key)
		it := Item{Key: d.Key, Kind: d.Kind, Limit: rule.Limit, Policy: rule.Policy, UnitSize: rule.UnitSize,
			UnitPriceMinor: rule.UnitPriceMinor, Overridden: e.Overridden[d.Key]}
		billed := int64(0)
		switch d.Kind {
		case KindMonthly:
			it.Usage = monthly[d.Key]
			billed = it.Usage
		case KindRate:
			if current {
				it.Usage = int64(meterMinute(ws))
			}
		default:
			if current {
				u, err := Usage(ctx, db, ws, d.Key)
				if err != nil {
					return nil, err
				}
				it.Usage = u
				if u > peaks[d.Key] && rule.Limit != nil {
					recordPeak(ctx, db, ws, d.Key, u)
					peaks[d.Key] = u
				}
			} else {
				it.Usage = peaks[d.Key]
			}
			billed = it.Usage
			if peaks[d.Key] > billed {
				billed = peaks[d.Key]
			}
		}
		it.Over = rule.Over(billed)
		it.OverageMinor = rule.OverageMinor(billed)
		r.OverageMinor += it.OverageMinor
		r.Items = append(r.Items, it)
	}
	r.EstimateMinor = r.BaseFeeMinor + r.OverageMinor
	return r, nil
}
