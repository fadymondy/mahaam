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
InvoiceTools are the P6 invoice tools of the user MCP. They call the same internal/work functions as
the REST API (/api/w/invoices*), so an agent gets its human's rules exactly: manager+ only, status
transitions guarded, drafting from time locks the exact entries (immutable afterwards), voiding
releases them. Writes land in the activity feed "via MCP".

Scopes: invoices:read (list_invoices, get_invoice), invoices:write (draft_invoice_from_time,
update_invoice_status, record_payment) — both manager+.
*/
func InvoiceTools() []Tool {
	return []Tool{
		{
			Name:        "list_invoices",
			Description: "List invoices, newest first. Filter by client and/or status (draft, sent, paid, void).",
			Scope:       "invoices:read",
			InputSchema: schema(nil, map[string]any{
				"client": prop("string", "Client id or exact name"),
				"status": prop("string", "draft, sent, paid or void"),
				"limit":  prop("integer", "Default 100"),
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				sv := work.New(a)
				list, err := sv.ListInvoices(ctx, work.InvoiceFilter{ClientID: str(args, "client"), Status: str(args, "status"), Limit: intArg(args, "limit", 100)})
				if err != nil {
					return "", toolErr(err)
				}
				if len(list) == 0 {
					return "No invoices match.", nil
				}
				var b strings.Builder
				for i := range list {
					b.WriteString(invoiceLine(&list[i]) + "\n")
				}
				fmt.Fprintf(&b, "\n%d invoice%s.", len(list), plural(len(list), "", "s"))
				return b.String(), nil
			},
		},
		{
			Name:        "get_invoice",
			Description: "One invoice in full: its lines, totals, tax and payments.",
			Scope:       "invoices:read",
			InputSchema: schema([]string{"invoice"}, map[string]any{"invoice": prop("string", "Invoice number (INV-2026-000001) or id")}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				iv, err := work.New(a).GetInvoice(ctx, str(decodeArgs(raw), "invoice"))
				if err != nil {
					return "", toolErr(err)
				}
				return invoiceDetail(iv), nil
			},
		},
		{
			Name: "draft_invoice_from_time",
			Description: "Draft an invoice from a client's unbilled, billable time. Gathers finished entries (in the client " +
				"currency) with no invoice yet, groups them into lines by project (or task), snapshots the rate on each entry, " +
				"and locks those entries onto the draft (they become immutable). It also bills the client's unbilled AI usage " +
				"(at cost + the project's AI markup) and every due subscription period, unless include_ai / include_subscriptions " +
				"is false. VAT is a rate (e.g. 0.14).",
			Scope: "invoices:write",
			InputSchema: schema([]string{"client"}, map[string]any{
				"client":                prop("string", "Client id or exact name"),
				"from":                  prop("string", "YYYY-MM-DD (workspace timezone); default no lower bound"),
				"to":                    prop("string", "YYYY-MM-DD (workspace timezone); default today"),
				"project_ids":           arrProp("Limit to these projects (ids or names)"),
				"group_by":              prop("string", "project (default) or task"),
				"tax_rate":              prop("string", "VAT as a fraction, e.g. 0.14; default 0"),
				"due_date":              prop("string", "YYYY-MM-DD"),
				"notes":                 prop("string", "Notes on the invoice"),
				"include_ai":            prop("boolean", "Bill unbilled AI usage (default true)"),
				"include_subscriptions": prop("boolean", "Bill due subscription periods (default true)"),
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				in := work.DraftInput{ClientID: str(args, "client"), From: str(args, "from"), To: str(args, "to"),
					ProjectIDs: strList(args, "project_ids"), GroupBy: str(args, "group_by"),
					TaxRate: optStr(args, "tax_rate"), DueDate: str(args, "due_date"), Notes: str(args, "notes")}
				for k, dst := range map[string]**bool{"include_ai": &in.IncludeAI, "include_subscriptions": &in.IncludeSubscriptions} {
					if v, ok := args[k].(bool); ok {
						v := v
						*dst = &v
					}
				}
				iv, err := work.New(a).DraftFromTime(ctx, in)
				if err != nil {
					return "", toolErr(err)
				}
				return "Drafted:\n" + invoiceDetail(iv), nil
			},
		},
		{
			Name:        "update_invoice_status",
			Description: "Move an invoice through draft → sent → paid | void. Illegal transitions are refused; voiding releases the invoice's locked time entries; marking paid needs the total covered by payments.",
			Scope:       "invoices:write",
			InputSchema: schema([]string{"invoice", "status"}, map[string]any{
				"invoice": prop("string", "Invoice number or id"),
				"status":  prop("string", "sent, paid or void"),
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				iv, err := work.New(a).SetInvoiceStatus(ctx, str(args, "invoice"), str(args, "status"))
				if err != nil {
					return "", toolErr(err)
				}
				return fmt.Sprintf("%s is now %s.", iv.Number, iv.Status), nil
			},
		},
		{
			Name:        "record_payment",
			Description: "Record a payment against a sent invoice (amount in minor units, the invoice currency). When payments cover the total, the invoice flips to paid.",
			Scope:       "invoices:write",
			InputSchema: schema([]string{"invoice", "amount_minor"}, map[string]any{
				"invoice":      prop("string", "Invoice number or id"),
				"amount_minor": prop("integer", "Amount in minor units (e.g. 15000 = 150.00)"),
				"paid_at":      prop("string", "RFC 3339; default now"),
				"ref":          prop("string", "A reference (transfer id, cheque no.)"),
			}),
			Run: func(ctx context.Context, a *app.App, raw json.RawMessage) (string, error) {
				args := decodeArgs(raw)
				var amt int64
				if v := optInt(args, "amount_minor"); v != nil {
					amt = *v
				}
				iv, err := work.New(a).RecordPayment(ctx, str(args, "invoice"), work.PaymentInput{
					AmountMinor: amt, PaidAt: str(args, "paid_at"), Ref: str(args, "ref")})
				if err != nil {
					return "", toolErr(err)
				}
				return fmt.Sprintf("Recorded %s %s on %s. Paid %s of %s. Status: %s.",
					iv.Currency, work.Money(amt), iv.Number, work.Money(iv.PaidMinor), work.Money(iv.TotalMinor), iv.Status), nil
			},
		},
	}
}

func arrProp(desc string) map[string]any {
	return map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": desc}
}

func invoiceLine(iv *work.Invoice) string {
	client := ""
	if iv.ClientName != nil {
		client = "  " + *iv.ClientName
	}
	return fmt.Sprintf("%s  %s%s  %s %s  (%s)  id=%s", iv.Number, iv.Status, client, iv.Currency, work.Money(iv.TotalMinor), iv.IssueDate, iv.ID)
}

func invoiceDetail(iv *work.InvoiceDetail) string {
	var b strings.Builder
	b.WriteString(invoiceLine(&iv.Invoice) + "\n")
	for _, l := range iv.Lines {
		fmt.Fprintf(&b, "  - %s  %sh × %s = %s\n", l.Description, l.Quantity, work.Money(l.UnitMinor), work.Money(l.AmountMinor))
	}
	fmt.Fprintf(&b, "  Subtotal %s %s", iv.Currency, work.Money(iv.SubtotalMinor))
	fmt.Fprintf(&b, "  · VAT (%s) %s", iv.TaxRate, work.Money(iv.TaxMinor))
	fmt.Fprintf(&b, "  · Total %s", work.Money(iv.TotalMinor))
	if iv.PaidMinor > 0 {
		fmt.Fprintf(&b, "  · Paid %s", work.Money(iv.PaidMinor))
	}
	return b.String()
}
