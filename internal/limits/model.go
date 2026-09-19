package limits

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"
)

// Policy values.
const (
	Block   = "block"
	Overage = "overage"
)

// Rule is one limit on a plan (or a workspace override).
type Rule struct {
	Limit          *int64 `json:"limit" required:"false"` // nil = unlimited
	Policy         string `json:"policy" required:"false" doc:"block (hard cap) or overage (allowed, billed per unit)"`
	UnitPriceMinor int64  `json:"unit_price_minor" required:"false"` // per unit_size over the limit (overage policy)
	UnitSize       int64  `json:"unit_size" required:"false"`
}

// Features are the plan's feature gates.
type Features struct {
	AIUsageTracking bool     `json:"ai_usage_tracking" required:"false"`
	Integrations    []string `json:"integrations" required:"false"`
	CustomerPortal  bool     `json:"customer_portal" required:"false"`
	Vault           bool     `json:"vault" required:"false"`
	KPI             bool     `json:"kpi" required:"false"`
}

// AllFeatures is what a workspace gets when nothing restricts it.
func AllFeatures() Features {
	return Features{AIUsageTracking: true, Integrations: append([]string{}, Integrations...), CustomerPortal: true, Vault: true, KPI: true}
}

// Has reports whether feature key is enabled ("github" etc. check the integrations list).
func (f Features) Has(key string) bool {
	switch key {
	case FeatureAIUsage:
		return f.AIUsageTracking
	case FeaturePortal:
		return f.CustomerPortal
	case FeatureVault:
		return f.Vault
	case FeatureKPI:
		return f.KPI
	}
	for _, i := range f.Integrations {
		if i == key {
			return true
		}
	}
	return false
}

// Overrides are a workspace's deviations from its plan: a rule per limit key replaces the plan's
// rule for that key; features merge key by key.
type Overrides struct {
	Limits   map[string]Rule            `json:"limits" required:"false"`
	Features map[string]json.RawMessage `json:"features" required:"false"`
}

// Plan is a row of `plans`.
type Plan struct {
	Key           string          `json:"key"`
	NameEn        string          `json:"name_en"`
	NameAr        string          `json:"name_ar" required:"false"`
	DescriptionEn string          `json:"description_en" required:"false"`
	DescriptionAr string          `json:"description_ar" required:"false"`
	Currency      string          `json:"currency" required:"false"`
	BaseFeeMinor  int64           `json:"base_fee_minor" required:"false"`
	PriceLabelEn  string          `json:"price_label_en" required:"false"`
	PriceLabelAr  string          `json:"price_label_ar" required:"false"`
	Active        bool            `json:"active" required:"false"`
	Sort          int             `json:"sort" required:"false"`
	Limits        map[string]Rule `json:"limits" required:"false"`
	Features      Features        `json:"features" required:"false"`
	Workspaces    int             `json:"workspaces" required:"false"`
}

// Effective is a workspace's plan with its overrides applied.
type Effective struct {
	WorkspaceID        string
	Plan               Plan
	Status             string
	Rules              map[string]Rule // every catalog key present (unlimited when unset)
	Overridden         map[string]bool
	Features           Features
	FeaturesOverridden []string
}

// Normalize fills a rule's defaults: policy block, unit size from the catalog, a rate is always a
// hard cap, negative numbers are clamped.
func (r Rule) Normalize(key string) Rule {
	if r.Policy != Overage {
		r.Policy = Block
	}
	d, _ := DefOf(key)
	if d.Kind == KindRate {
		r.Policy = Block
	}
	if r.UnitSize <= 0 {
		r.UnitSize = d.DefaultUnit
		if r.UnitSize <= 0 {
			r.UnitSize = 1
		}
	}
	if r.UnitPriceMinor < 0 {
		r.UnitPriceMinor = 0
	}
	if r.Limit != nil && *r.Limit < 0 {
		z := int64(0)
		r.Limit = &z
	}
	return r
}

// ValidateRules checks a limits map from an admin: known keys only, known policies.
func ValidateRules(m map[string]Rule) error {
	for k, r := range m {
		if _, ok := DefOf(k); !ok {
			return fmt.Errorf("unknown limit %q", k)
		}
		if r.Policy != "" && r.Policy != Block && r.Policy != Overage {
			return fmt.Errorf("%s: policy must be block or overage", k)
		}
		if r.Limit != nil && *r.Limit < 0 {
			return fmt.Errorf("%s: the limit cannot be negative", k)
		}
		if r.UnitPriceMinor < 0 || r.UnitSize < 0 {
			return fmt.Errorf("%s: prices and unit sizes cannot be negative", k)
		}
	}
	return nil
}

// NormalizeFeatures drops unknown integrations and sorts them.
func NormalizeFeatures(f Features) Features {
	out := []string{}
	seen := map[string]bool{}
	for _, i := range f.Integrations {
		i = strings.ToLower(strings.TrimSpace(i))
		if ValidIntegration(i) && !seen[i] {
			seen[i] = true
			out = append(out, i)
		}
	}
	sort.Strings(out)
	f.Integrations = out
	return f
}

// Merge applies overrides to a plan.
func Merge(p Plan, o Overrides) (*Effective, error) {
	e := &Effective{Plan: p, Rules: map[string]Rule{}, Overridden: map[string]bool{}, FeaturesOverridden: []string{}}
	for _, d := range Catalog {
		r, ok := p.Limits[d.Key]
		if !ok {
			r = Rule{Policy: Block}
		}
		if or, ok := o.Limits[d.Key]; ok {
			r = or
			e.Overridden[d.Key] = true
		}
		e.Rules[d.Key] = r.Normalize(d.Key)
	}
	f := p.Features
	f.Integrations = append([]string{}, p.Features.Integrations...)
	keys := make([]string, 0, len(o.Features))
	for k := range o.Features {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		raw := o.Features[k]
		switch k {
		case "integrations":
			var list []string
			if err := json.Unmarshal(raw, &list); err != nil {
				return nil, fmt.Errorf("features.integrations: %w", err)
			}
			f.Integrations = list
		case FeatureAIUsage, FeaturePortal, FeatureVault, FeatureKPI:
			var b bool
			if err := json.Unmarshal(raw, &b); err != nil {
				return nil, fmt.Errorf("features.%s: %w", k, err)
			}
			switch k {
			case FeatureAIUsage:
				f.AIUsageTracking = b
			case FeaturePortal:
				f.CustomerPortal = b
			case FeatureVault:
				f.Vault = b
			case FeatureKPI:
				f.KPI = b
			}
		default:
			continue
		}
		e.FeaturesOverridden = append(e.FeaturesOverridden, k)
	}
	e.Features = NormalizeFeatures(f)
	return e, nil
}

// Rule returns the effective rule for key (unlimited for an unknown key).
func (e *Effective) Rule(key string) Rule {
	if e == nil {
		return Rule{Policy: Block, UnitSize: 1}
	}
	if r, ok := e.Rules[key]; ok {
		return r
	}
	return Rule{Policy: Block, UnitSize: 1}
}

// Allows reports whether usage+n stays within r; an overage rule always allows.
func (r Rule) Allows(usage, n int64) bool {
	return r.Limit == nil || r.Policy == Overage || usage+n <= *r.Limit
}

// Over is how far usage is past the limit (0 when within it or unlimited).
func (r Rule) Over(usage int64) int64 {
	if r.Limit == nil || usage <= *r.Limit {
		return 0
	}
	return usage - *r.Limit
}

// OverageMinor is the billable amount for usage under r: whole units of unit_size over the limit,
// rounded up, at unit_price_minor. Block rules never bill.
func (r Rule) OverageMinor(usage int64) int64 {
	if r.Policy != Overage {
		return 0
	}
	over := r.Over(usage)
	if over == 0 || r.UnitPriceMinor == 0 {
		return 0
	}
	size := r.UnitSize
	if size <= 0 {
		size = 1
	}
	units := (over + size - 1) / size
	return units * r.UnitPriceMinor
}

// PeriodOf is the metering period (first day of the UTC month) containing t.
func PeriodOf(t time.Time) time.Time {
	t = t.UTC()
	return time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, time.UTC)
}

// ---- refusals ---------------------------------------------------------------------------------

// Exceeded is a refusal: a block-policy quota is used up, a feature is not on the plan, or the
// per-minute rate is exceeded. Its message is safe to show; Status is 402 (429 for the rate).
type Exceeded struct {
	Status int    `json:"-"`
	Code   string `json:"code"`
	Msg    string `json:"error"`
	Key    string `json:"key"`
}

func (e *Exceeded) Error() string  { return e.Msg }
func (e *Exceeded) GetStatus() int { return e.Status }

// upgradeHint ends every refusal.
const upgradeHint = "upgrade in Settings → Plan"

func planName(e *Effective) string {
	if e == nil || e.Plan.NameEn == "" {
		return "current"
	}
	return e.Plan.NameEn
}

// limitError builds the refusal for key.
func limitError(e *Effective, key string, limit int64) *Exceeded {
	d, _ := DefOf(key)
	noun := d.Noun
	if noun == "" {
		noun = key
	}
	var msg string
	switch d.Kind {
	case KindMonthly:
		msg = fmt.Sprintf("Your plan (%s) allows %d %s and this month's quota is used up — %s", planName(e), limit, noun, upgradeHint)
	case KindData:
		msg = fmt.Sprintf("Your plan (%s) includes %d %s and this would exceed it — %s", planName(e), limit, noun, upgradeHint)
	case KindRate:
		return &Exceeded{Status: http.StatusTooManyRequests, Code: "plan_rate", Key: key,
			Msg: fmt.Sprintf("Your plan (%s) allows %d %s — slow down or %s", planName(e), limit, noun, upgradeHint)}
	default:
		msg = fmt.Sprintf("Your plan (%s) allows %d %s — %s", planName(e), limit, noun, upgradeHint)
	}
	return &Exceeded{Status: http.StatusPaymentRequired, Code: "plan_limit", Key: key, Msg: msg}
}

func featureError(e *Effective, key string) *Exceeded {
	name := featureNames[key]
	if name == "" {
		name = key
	}
	return &Exceeded{Status: http.StatusPaymentRequired, Code: "plan_feature", Key: key,
		Msg: fmt.Sprintf("Your plan (%s) does not include %s — %s", planName(e), name, upgradeHint)}
}
