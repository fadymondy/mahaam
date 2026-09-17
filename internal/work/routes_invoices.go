package work

import (
	"context"
	"net/http"
	"net/url"

	"github.com/danielgtaylor/huma/v2"
)

/*
P6 REST: /api/w/invoices*. Every path is under /api/w/, so the guard puts it in the workspace tier
(session + active membership of X-Workspace-ID, 404 otherwise); the checks (manager+ for read and
write, status transitions, locks) live in the domain functions (invoices.go), shared with the MCP
invoice tools. The client-scoped list and the unbilled figure hang off /api/w/clients/{client}.
*/

type InvoiceRef struct {
	Invoice string `path:"invoice" doc:"Invoice number (INV-2026-000001) or id"`
}

// InvoiceListBody is the body of GET /api/w/invoices.
type InvoiceListBody struct {
	Invoices []Invoice `json:"invoices"`
}

func (r routes) invoices() {
	const tag = "Invoices"
	do(r, http.MethodGet, "/api/w/invoices", "w-list-invoices", "Invoices (managers and up), filterable by client and status", tag, 0, func(ctx context.Context, in *struct {
		WS
		Client string `query:"client" doc:"Client id or exact name"`
		Status string `query:"status" enum:"draft,sent,paid,void,"`
		Limit  int    `query:"limit" minimum:"0" maximum:"500"`
	}) (InvoiceListBody, error) {
		list, err := r.sv.ListInvoices(ctx, InvoiceFilter{ClientID: in.Client, Status: in.Status, Limit: in.Limit})
		return InvoiceListBody{Invoices: list}, err
	})
	do(r, http.MethodPost, "/api/w/invoices/from-time", "w-draft-invoice", "Draft an invoice from a client's unbilled time (locks those entries)", tag, http.StatusCreated, func(ctx context.Context, in *struct {
		WS
		Body DraftInput
	}) (*InvoiceDetail, error) {
		return r.sv.DraftFromTime(ctx, in.Body)
	})
	do(r, http.MethodGet, "/api/w/invoices/{invoice}", "w-get-invoice", "One invoice with its lines and payments", tag, 0, func(ctx context.Context, in *struct {
		WS
		InvoiceRef
	}) (*InvoiceDetail, error) {
		return r.sv.GetInvoice(ctx, in.Invoice)
	})
	do(r, http.MethodPatch, "/api/w/invoices/{invoice}", "w-update-invoice-status", "Change status: draft→sent→paid|void (illegal transitions refused; void releases the entries)", tag, 0, func(ctx context.Context, in *struct {
		WS
		InvoiceRef
		Body struct {
			Status string `json:"status" enum:"draft,sent,paid,void"`
		}
	}) (*InvoiceDetail, error) {
		return r.sv.SetInvoiceStatus(ctx, in.Invoice, in.Body.Status)
	})
	do(r, http.MethodPost, "/api/w/invoices/{invoice}/payments", "w-record-payment", "Record a payment (flips to paid when the total is covered)", tag, http.StatusCreated, func(ctx context.Context, in *struct {
		WS
		InvoiceRef
		Body PaymentInput
	}) (*InvoiceDetail, error) {
		return r.sv.RecordPayment(ctx, in.Invoice, in.Body)
	})
	none(r, http.MethodDelete, "/api/w/invoices/{invoice}", "w-delete-invoice", "Delete a draft invoice (releases its entries)", tag, func(ctx context.Context, in *struct {
		WS
		InvoiceRef
	}) error {
		return r.sv.DeleteInvoice(ctx, in.Invoice)
	})
	huma.Register(r.api, huma.Operation{
		OperationID: "w-export-invoice", Method: http.MethodGet, Path: "/api/w/invoices/{invoice}/export",
		Summary: "Export an invoice's line items (CSV or XLSX)", Tags: []string{tag},
	}, func(ctx context.Context, in *struct {
		WS
		InvoiceRef
		Format string `query:"format" enum:"csv,xlsx,"`
		Lang   string `query:"lang" enum:"en,ar,"`
	}) (*fileOut, error) {
		f, err := r.sv.ExportInvoice(ctx, in.Invoice, in.Format, in.Lang)
		if err != nil {
			return nil, r.fail(err)
		}
		return &fileOut{
			ContentType: f.ContentType,
			Disposition: "attachment; filename*=UTF-8''" + url.PathEscape(f.Name),
			NoSniff:     "nosniff",
			Body:        f.Data,
		}, nil
	})
	huma.Register(r.api, huma.Operation{
		OperationID: "w-print-invoice", Method: http.MethodGet, Path: "/api/w/invoices/{invoice}/print",
		Summary: "A clean, printable HTML invoice", Tags: []string{tag},
	}, func(ctx context.Context, in *struct {
		WS
		InvoiceRef
		Lang string `query:"lang" enum:"en,ar,"`
	}) (*htmlOut, error) {
		html, err := r.sv.InvoicePrintHTML(ctx, in.Invoice, in.Lang)
		if err != nil {
			return nil, r.fail(err)
		}
		return &htmlOut{ContentType: "text/html; charset=utf-8", Body: []byte(html)}, nil
	})

	// Client-scoped: fills the client page's reserved Invoices slot and turns its "unbilled value"
	// into a real figure (billable time with invoice_id NULL, in the client currency).
	do(r, http.MethodGet, "/api/w/clients/{client}/invoices", "w-client-invoices", "One client's invoices", tag, 0, func(ctx context.Context, in *struct {
		WS
		ClientRef
	}) (InvoiceListBody, error) {
		list, err := r.sv.ListClientInvoices(ctx, in.Client)
		return InvoiceListBody{Invoices: list}, err
	})
	do(r, http.MethodGet, "/api/w/clients/{client}/unbilled", "w-client-unbilled", "A client's unbilled billable time and its value", tag, 0, func(ctx context.Context, in *struct {
		WS
		ClientRef
	}) (*Unbilled, error) {
		return r.sv.ClientUnbilled(ctx, in.Client)
	})
}

// htmlOut serves an HTML page from a Huma operation.
type htmlOut struct {
	ContentType string `header:"Content-Type"`
	Body        []byte
}
