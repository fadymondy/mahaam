package work

import (
	"context"
	"net/http"
)

// SubscriptionRef is the {subscription} path parameter. Exported so Huma binds it.
type SubscriptionRef struct {
	Subscription string `path:"subscription" doc:"Subscription id"`
}

// AIUsageList is the body of POST …/ai-usage.
type AIUsageList struct {
	Rows []AIUsage `json:"rows"`
}

// AIUsageSummaryBody is the body of GET /api/w/ai-usage.
type AIUsageSummaryBody struct {
	Rows []AIUsageRow `json:"rows"`
}

// SubscriptionList is the body of GET …/subscriptions.
type SubscriptionList struct {
	Subscriptions []Subscription `json:"subscriptions"`
}

// billing mounts AI usage and project subscriptions (billing_sources.go). Drafting an
// invoice (POST /api/w/invoices/from-time) bills both next to time.
func (r routes) billing() {
	const aiTag, subTag = "AI usage", "Subscriptions"
	do(r, http.MethodPost, "/api/w/projects/{project}/ai-usage", "w-record-ai-usage",
		"Push a project's AI usage (per day + model + source; a re-push replaces the day)", aiTag, 0, func(ctx context.Context, in *struct {
			WS
			ProjectRef
			Body struct {
				Rows []AIUsageInput `json:"rows" minItems:"1" maxItems:"500"`
			}
		}) (AIUsageList, error) {
			rows, err := r.sv.RecordAIUsage(ctx, in.Project, in.Body.Rows)
			return AIUsageList{Rows: rows}, err
		})
	do(r, http.MethodGet, "/api/w/ai-usage", "w-ai-usage-summary",
		"AI usage and cost by day, model, project or source (manager+)", aiTag, 0, func(ctx context.Context, in *struct {
			WS
			Project string `query:"project" doc:"Project id or name; empty = every project"`
			From    string `query:"from" doc:"YYYY-MM-DD"`
			To      string `query:"to" doc:"YYYY-MM-DD"`
			GroupBy string `query:"group_by" enum:"day,model,project,source," doc:"Default day"`
		}) (AIUsageSummaryBody, error) {
			rows, err := r.sv.AIUsageSummary(ctx, AIUsageFilter{ProjectRef: in.Project, From: in.From, To: in.To, GroupBy: in.GroupBy})
			return AIUsageSummaryBody{Rows: rows}, err
		})
	do(r, http.MethodGet, "/api/w/projects/{project}/ai-markup", "w-get-ai-markup",
		"A project's markup on AI cost, in basis points", aiTag, 0, func(ctx context.Context, in *struct {
			WS
			ProjectRef
		}) (map[string]int, error) {
			bp, err := r.sv.AIMarkup(ctx, in.Project)
			return map[string]int{"ai_markup_bp": bp}, err
		})
	do(r, http.MethodPut, "/api/w/projects/{project}/ai-markup", "w-set-ai-markup",
		"Set the markup on a project's AI cost when invoiced (percent)", aiTag, 0, func(ctx context.Context, in *struct {
			WS
			ProjectRef
			Body struct {
				Percent string `json:"percent" doc:"e.g. \"20\" for +20%"`
			}
		}) (map[string]int, error) {
			bp, err := r.sv.SetAIMarkup(ctx, in.Project, in.Body.Percent)
			return map[string]int{"ai_markup_bp": bp}, err
		})

	do(r, http.MethodGet, "/api/w/subscriptions", "w-list-subscriptions",
		"Project subscriptions (infrastructure, AI, marketing tools…), all or one project's", subTag, 0, func(ctx context.Context, in *struct {
			WS
			Project string `query:"project" doc:"Project id or name"`
		}) (SubscriptionList, error) {
			list, err := r.sv.ListSubscriptions(ctx, in.Project)
			return SubscriptionList{Subscriptions: list}, err
		})
	do(r, http.MethodPost, "/api/w/projects/{project}/subscriptions", "w-create-subscription",
		"Add a subscription to a project", subTag, http.StatusCreated, func(ctx context.Context, in *struct {
			WS
			ProjectRef
			Body SubscriptionInput
		}) (*Subscription, error) {
			return r.sv.CreateSubscription(ctx, in.Project, in.Body)
		})
	do(r, http.MethodPatch, "/api/w/subscriptions/{subscription}", "w-update-subscription",
		"Change a subscription", subTag, 0, func(ctx context.Context, in *struct {
			WS
			SubscriptionRef
			Body SubscriptionInput
		}) (*Subscription, error) {
			return r.sv.UpdateSubscription(ctx, in.Subscription, in.Body)
		})
	none(r, http.MethodDelete, "/api/w/subscriptions/{subscription}", "w-delete-subscription",
		"Delete a never-billed subscription (deactivate a billed one)", subTag, func(ctx context.Context, in *struct {
			WS
			SubscriptionRef
		}) error {
			return r.sv.DeleteSubscription(ctx, in.Subscription)
		})
}
