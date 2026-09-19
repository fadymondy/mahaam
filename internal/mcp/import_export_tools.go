package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/fadymondy/mahaam/internal/app"
	"github.com/fadymondy/mahaam/internal/work"
)

/*
ImportExportTools: customer import and report documents over MCP, calling the same internal/work
functions as the REST routes (same plan, same dedupe, same numbers).

	import_clients_preview, import_clients_commit   clients:write (manager+)
	export_time_report, export_project_report       reports:read — Markdown text an agent can
	                                                push anywhere (the lossless format for Arabic)

Content is passed as text: CSV (any Google Contacts CSV export too) or vCard. XLSX and the Google
OAuth flow are browser-only.
*/
func ImportExportTools() []Tool {
	importProps := map[string]any{
		"source":          map[string]any{"type": "string", "enum": []string{"csv", "google_csv", "vcard", "whatsapp_api"}, "description": "csv / google_csv / vcard take content; whatsapp_api reads the configured WhatsApp Business API"},
		"content":         prop("string", "The file's text (CSV or vCard)"),
		"mapping":         map[string]any{"type": "object", "additionalProperties": map[string]any{"type": "string"}, "description": "Column header → name, first_name, last_name, email, phone, company, notes or \"\" (ignore). Omitted columns keep the detected mapping."},
		"update_existing": prop("boolean", "Default true: rows matching a client by email or phone fill in what it lacks; false skips them"),
	}
	input := func(raw json.RawMessage) (work.ClientImportInput, error) {
		var in work.ClientImportInput
		if err := json.Unmarshal(raw, &in); err != nil {
			return in, fmt.Errorf("invalid arguments: %v", err)
		}
		if in.Source == "xlsx" || in.Source == "google" {
			return in, fmt.Errorf("%s imports are browser-only (Clients → Import); send CSV or vCard text here", in.Source)
		}
		return in, nil
	}
	return []Tool{
		{
			Name: "import_clients_preview",
			Description: "Preview a customer import (CSV, Google Contacts CSV, vCard / WhatsApp contacts export): detected header row and column mapping, " +
				"then per row create / update / skip / invalid with the reason and errors (row + column). Rows match existing clients by email or phone; " +
				"an update only fills in what the client lacks. Nothing is written.",
			Scope:       "clients:write",
			InputSchema: schema([]string{"source"}, importProps),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				in, err := input(raw)
				if err != nil {
					return "", err
				}
				p, err := work.New(a).PreviewClientImport(ctx, in)
				if err != nil {
					return "", toolErr(err)
				}
				var b strings.Builder
				if len(p.Headers) > 0 {
					fmt.Fprintf(&b, "Header row: %d. Mapping:\n", p.HeaderRow)
					for _, h := range p.Headers {
						f := p.Mapping[h]
						if f == "" {
							f = "(ignored)"
						}
						fmt.Fprintf(&b, "  %s → %s\n", h, f)
					}
				}
				b.WriteString(formatImportRows(p.Counts, p.Rows, "would"))
				b.WriteString("\nRun import_clients_commit with the same arguments to apply.")
				return b.String(), nil
			},
		},
		{
			Name:        "import_clients_commit",
			Description: "Apply a customer import (same arguments as import_clients_preview). Invalid rows are reported and skipped; the rest are created or updated, each recorded in the activity feed.",
			Scope:       "clients:write",
			InputSchema: schema([]string{"source"}, importProps),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				in, err := input(raw)
				if err != nil {
					return "", err
				}
				r, err := work.New(a).CommitClientImport(ctx, in)
				if err != nil {
					return "", toolErr(err)
				}
				return formatImportRows(r.Counts, r.Rows, "did"), nil
			},
		},
		{
			Name: "export_time_report",
			Description: "The time report as a Markdown document (the reports page's table, cell for cell, with its period, grouping, rounding and total). " +
				"Same filters as time_summary. A member's report is their own time; money columns need reports:finance.",
			Scope: "reports:read",
			InputSchema: schema(nil, map[string]any{
				"from":     prop("string", "YYYY-MM-DD (workspace timezone); default the 1st of this month"),
				"to":       prop("string", "YYYY-MM-DD inclusive; default today"),
				"group_by": map[string]any{"type": "string", "enum": work.ReportGroups},
				"users":    map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "Emails, ids or \"me\" (managers)"},
				"projects": map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "Project ids or names"},
				"clients":  map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "Client ids or names"},
				"labels":   map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "Label ids or names"},
				"billable": map[string]any{"type": "string", "enum": []string{"billable", "non_billable"}},
				"rounding": prop("integer", "Minutes (0 = none); default the workspace setting"),
				"lang":     map[string]any{"type": "string", "enum": []string{"en", "ar"}, "description": "Headings and column names (default en)"},
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				sv := work.New(a)
				args := decodeArgs(raw)
				q, err := reportQuery(ctx, a, sv, args)
				if err != nil {
					return "", err
				}
				f, err := sv.ExportReport(ctx, "time", "md", str(args, "lang"), "", q)
				if err != nil {
					return "", toolErr(err)
				}
				return string(f.Data), nil
			},
		},
		{
			Name: "export_project_report",
			Description: "A project report as a Markdown document: summary, progress (tasks by status, % done), budget burn, time by member and by week, " +
				"open issues and recent activity — the Overview's and reports page's numbers.",
			Scope: "reports:read",
			InputSchema: schema([]string{"project"}, map[string]any{
				"project": prop("string", "Project id or name"),
				"from":    prop("string", "YYYY-MM-DD; default the project's start"),
				"to":      prop("string", "YYYY-MM-DD; default today"),
				"lang":    map[string]any{"type": "string", "enum": []string{"en", "ar"}, "description": "Document language (default en)"},
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				f, _, err := work.New(a).ExportProjectReport(ctx, str(args, "project"), "md", str(args, "lang"), str(args, "from"), str(args, "to"))
				if err != nil {
					return "", toolErr(err)
				}
				return string(f.Data), nil
			},
		},
	}
}

func formatImportRows(c work.ImportCounts, rows []work.ImportRowResult, verb string) string {
	var b strings.Builder
	label := map[string]string{"would": "would be", "did": "were"}[verb]
	fmt.Fprintf(&b, "%d rows: %d %s created, %d %s updated, %d skipped, %d invalid.\n", c.Total, c.Create, label, c.Update, label, c.Skip, c.Invalid)
	for i, r := range rows {
		if i == 100 {
			fmt.Fprintf(&b, "… %d more rows\n", len(rows)-i)
			break
		}
		line := fmt.Sprintf("row %d: %s %q", r.Row, r.Action, r.Name)
		if r.Email != "" {
			line += " <" + r.Email + ">"
		}
		if r.Phone != "" {
			line += " " + r.Phone
		}
		if r.Match != "" {
			line += " (matched by " + r.Match + ")"
		}
		if len(r.Changes) > 0 {
			line += " fills " + strings.Join(r.Changes, ", ")
		}
		if r.Reason != "" {
			line += " — " + r.Reason
		}
		for _, e := range r.Errors {
			if e.Column != "" {
				line += fmt.Sprintf(" [%s: %s]", e.Column, e.Message)
			} else {
				line += " [" + e.Message + "]"
			}
		}
		b.WriteString(line + "\n")
	}
	return b.String()
}
