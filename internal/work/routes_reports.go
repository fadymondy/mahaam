package work

import (
	"context"
	"net/http"
	"net/url"
	"strings"

	"github.com/danielgtaylor/huma/v2"
)

/*
P5 REST: /api/w/report/* (time report, export, budgets, profitability), /api/w/projects/{project}/budget,
/api/w/saved-reports, /api/w/notification-settings. All under /api/w/ (the guard's workspace tier);
the role checks live in reports.go, saved.go and email.go and are shared with the MCP report tools.
*/

// ReportParams is a ReportQuery as query parameters (lists comma-separated).
type ReportParams struct {
	From     string `query:"from" doc:"YYYY-MM-DD (workspace timezone); default the 1st of this month"`
	To       string `query:"to" doc:"YYYY-MM-DD inclusive; default today"`
	GroupBy  string `query:"group_by" enum:"project,member,client,label,task,day,week," doc:"Default project"`
	Users    string `query:"users" doc:"Comma-separated user ids (managers)"`
	Projects string `query:"projects" doc:"Comma-separated project ids"`
	Clients  string `query:"clients" doc:"Comma-separated client ids"`
	Labels   string `query:"labels" doc:"Comma-separated label ids"`
	Billable string `query:"billable" enum:"billable,non_billable," doc:"Only billable or only non-billable"`
	Rounding int    `query:"rounding" minimum:"-1" maximum:"240" default:"-1" doc:"Minutes; -1 = the workspace setting"`
}

func (p ReportParams) Query() ReportQuery {
	q := ReportQuery{From: p.From, To: p.To, GroupBy: p.GroupBy, Billable: p.Billable,
		Users: []string{p.Users}, Projects: []string{p.Projects}, Clients: []string{p.Clients}, Labels: []string{p.Labels}}
	if p.Rounding >= 0 {
		r := p.Rounding
		q.Rounding = &r
	}
	return q
}

type SavedRef struct {
	Saved string `path:"saved" doc:"Saved report id"`
}

type exportOut struct {
	ContentType string `header:"Content-Type"`
	Disposition string `header:"Content-Disposition"`
	NoSniff     string `header:"X-Content-Type-Options"`
	Cache       string `header:"Cache-Control"`
	Body        []byte
}

func (r routes) reports() {
	const tag = "Reports"
	do(r, http.MethodGet, "/api/w/report/time", "w-time-report", "Tracked time grouped by project, member, client, label, task, day or week", tag, 0, func(ctx context.Context, in *struct {
		WS
		ReportParams
	}) (*TimeReport, error) {
		return r.sv.TimeReport(ctx, in.Query())
	})
	huma.Register(r.api, huma.Operation{
		OperationID: "w-export-report", Method: http.MethodGet, Path: "/api/w/report/export",
		Summary: "The report table as CSV or XLSX (togo import-export)", Tags: []string{tag},
	}, func(ctx context.Context, in *struct {
		WS
		ReportParams
		Kind   string `query:"kind" enum:"time,profitability," doc:"Default time"`
		By     string `query:"by" enum:"project,client," doc:"Profitability rows (default project)"`
		Format string `query:"format" enum:"csv,xlsx," doc:"Default csv"`
		Lang   string `query:"lang" enum:"en,ar," doc:"Column headers (default en)"`
	}) (*exportOut, error) {
		f, err := r.sv.ExportReport(ctx, in.Kind, in.Format, in.Lang, in.By, in.Query())
		if err != nil {
			return nil, r.fail(err)
		}
		return &exportOut{ContentType: f.ContentType, NoSniff: "nosniff", Cache: "no-store",
			Disposition: "attachment; filename*=UTF-8''" + url.PathEscape(f.Name), Body: f.Data}, nil
	})
	do(r, http.MethodGet, "/api/w/report/budgets", "w-budgets", "Budget burn of every project with a budget (money: managers)", tag, 0, func(ctx context.Context, _ *WS) (*BudgetList, error) {
		return r.sv.Budgets(ctx)
	})
	do(r, http.MethodGet, "/api/w/report/profitability", "w-profitability", "Billable value − cost per project and client (managers)", tag, 0, func(ctx context.Context, in *struct {
		WS
		ReportParams
	}) (*Profitability, error) {
		return r.sv.Profitability(ctx, in.Query())
	})
	do(r, http.MethodGet, "/api/w/projects/{project}/budget", "w-project-budget", "One project's budget burn", tag, 0, func(ctx context.Context, in *struct {
		WS
		ProjectRef
	}) (*Budget, error) {
		return r.sv.ProjectBudget(ctx, in.Project)
	})

	do(r, http.MethodGet, "/api/w/saved-reports", "w-saved-reports", "My saved report views and the shared ones", tag, 0, func(ctx context.Context, _ *WS) (*SavedReportList, error) {
		return r.sv.ListSavedReports(ctx)
	})
	do(r, http.MethodPost, "/api/w/saved-reports", "w-create-saved-report", "Save a report view (sharing: managers)", tag, http.StatusCreated, func(ctx context.Context, in *struct {
		WS
		Body SavedReportInput
	}) (*SavedReport, error) {
		return r.sv.CreateSavedReport(ctx, in.Body)
	})
	do(r, http.MethodGet, "/api/w/saved-reports/{saved}", "w-get-saved-report", "One saved view (mine or shared)", tag, 0, func(ctx context.Context, in *struct {
		WS
		SavedRef
	}) (*SavedReport, error) {
		return r.sv.savedReport(ctx, in.Saved)
	})
	do(r, http.MethodPatch, "/api/w/saved-reports/{saved}", "w-update-saved-report", "Change a saved view (its owner)", tag, 0, func(ctx context.Context, in *struct {
		WS
		SavedRef
		Body SavedReportInput
	}) (*SavedReport, error) {
		return r.sv.UpdateSavedReport(ctx, in.Saved, in.Body)
	})
	none(r, http.MethodDelete, "/api/w/saved-reports/{saved}", "w-delete-saved-report", "Delete a saved view (its owner)", tag, func(ctx context.Context, in *struct {
		WS
		SavedRef
	}) error {
		return r.sv.DeleteSavedReport(ctx, in.Saved)
	})

	const ntag = "Notifications"
	do(r, http.MethodGet, "/api/w/notification-settings", "w-notification-settings", "My notification settings and whether email is configured", ntag, 0, func(ctx context.Context, _ *WS) (*NotificationSettings, error) {
		return r.sv.GetNotificationSettings(ctx)
	})
	do(r, http.MethodPatch, "/api/w/notification-settings", "w-update-notification-settings", "Change my notification settings", ntag, 0, func(ctx context.Context, in *struct {
		WS
		Body NotificationSettingsInput
	}) (*NotificationSettings, error) {
		return r.sv.UpdateNotificationSettings(ctx, in.Body)
	})
}

var _ = strings.TrimSpace
