// Package limits is Mahaam's plan and quota engine: what a workspace's plan (plus its per-workspace
// overrides) allows, how much of it is used, and whether one more of something is allowed.
//
// Mahaam is pay-as-you-go: every limit has a policy. `block` is a hard cap (the call is refused
// with a 402 and a message naming the plan); `overage` lets the call through and bills what is
// over the limit per unit_size at unit_price_minor. A null limit is unlimited.
//
// Everything runs on the owner pool (plans, workspace_usage are platform tables the app role
// cannot read). The domain calls the package-level helpers (Check, CheckStorage, Feature,
// Integration, CountCall) with the workspace from tenant.Scope, so REST and MCP hit the same
// checks. Before Init (OpenAPI export, unit tests) every check allows.
package limits

// Kind groups the limit keys by how their usage is measured.
type Kind string

const (
	KindCount   Kind = "count"   // rows that exist now (members, projects, …)
	KindData    Kind = "data"    // stored bytes, in MB
	KindMonthly Kind = "monthly" // created this calendar month (UTC)
	KindRate    Kind = "rate"    // API calls per minute (always a hard cap)
)

// Limit keys.
const (
	Members       = "members"
	Projects      = "projects"
	Clients       = "clients"
	Tasks         = "tasks"
	Issues        = "issues"
	Teams         = "teams"
	FeedbackKeys  = "feedback_keys"
	MCPTokens     = "mcp_tokens"
	StorageMB     = "storage_mb"
	IssuesMonth   = "issues_per_month"
	TasksMonth    = "tasks_per_month"
	APICallsMonth = "api_calls_per_month"
	APIRateMinute = "api_rate_per_minute"
)

// Feature keys (booleans) and the integrations list.
const (
	FeatureAIUsage = "ai_usage_tracking"
	FeaturePortal  = "customer_portal"
	FeatureVault   = "vault"
	FeatureKPI     = "kpi"
)

// Integrations Mahaam offers (Features.Integrations is a subset).
var Integrations = []string{"github", "jira", "linear"}

// Def describes one limit key.
type Def struct {
	Key  string `json:"key"`
	Kind Kind   `json:"kind"`
	// DefaultUnit is the overage billing unit when a rule does not set one (1 GB = 1024 MB,
	// 100 issues, 1000 API calls).
	DefaultUnit int64 `json:"default_unit"`
	// Noun is the English noun used in refusal messages ("projects", "MB of storage").
	Noun string `json:"-"`
}

// Catalog is the closed list of limit keys, in display order.
var Catalog = []Def{
	{Members, KindCount, 1, "members"},
	{Projects, KindCount, 1, "projects"},
	{Clients, KindCount, 1, "clients"},
	{Tasks, KindCount, 1, "tasks"},
	{Issues, KindCount, 1, "issues"},
	{Teams, KindCount, 1, "teams"},
	{FeedbackKeys, KindCount, 1, "feedback keys"},
	{MCPTokens, KindCount, 1, "MCP tokens"},
	{StorageMB, KindData, 1024, "MB of storage"},
	{IssuesMonth, KindMonthly, 100, "new issues per month"},
	{TasksMonth, KindMonthly, 100, "new tasks per month"},
	{APICallsMonth, KindMonthly, 1000, "API calls per month"},
	{APIRateMinute, KindRate, 1, "API calls per minute"},
}

// FeatureKeys are the boolean feature gates.
var FeatureKeys = []string{FeatureAIUsage, FeaturePortal, FeatureVault, FeatureKPI}

var featureNames = map[string]string{
	FeatureAIUsage: "AI usage tracking",
	FeaturePortal:  "the customer portal",
	FeatureVault:   "the project vault",
	FeatureKPI:     "employee KPIs",
	"github":       "the GitHub integration",
	"jira":         "the Jira integration",
	"linear":       "the Linear integration",
}

// DefOf returns the catalog entry for key.
func DefOf(key string) (Def, bool) {
	for _, d := range Catalog {
		if d.Key == key {
			return d, true
		}
	}
	return Def{}, false
}

// ValidFeature reports whether key is a boolean feature gate.
func ValidFeature(key string) bool {
	for _, f := range FeatureKeys {
		if f == key {
			return true
		}
	}
	return false
}

// ValidIntegration reports whether p is an integration provider.
func ValidIntegration(p string) bool {
	for _, i := range Integrations {
		if i == p {
			return true
		}
	}
	return false
}
