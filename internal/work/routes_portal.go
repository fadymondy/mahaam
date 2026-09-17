package work

import (
	"context"
	"net/http"
)

// KeyRef is the {key} path parameter for a feedback key. Exported so Huma binds
// it through the embedded struct.
type KeyRef struct {
	Key string `path:"key" doc:"Feedback key id"`
}

// FeedbackKeyList is the body of GET …/feedback-keys.
type FeedbackKeyList struct {
	Keys []FeedbackKey `json:"keys"`
}

// ContactList is the body of GET …/contacts.
type ContactList struct {
	Contacts []ClientContact `json:"contacts"`
}

// PortalInvoiceList is the body of GET /api/w/portal/invoices.
type PortalInvoiceList struct {
	Invoices []Invoice `json:"invoices"`
}

// portal mounts the P7 surface: the per-project feedback widget's public keys,
// the client-portal contact links, and the client's read-only invoice view. Every
// path is under /api/w/, so the guard's workspace tier (session + membership, 404
// otherwise) applies and the role checks live in the domain methods.
func (r routes) portal() {
	const keysTag = "Feedback widget"
	do(r, http.MethodGet, "/api/w/projects/{project}/feedback-keys", "w-list-feedback-keys",
		"A project's public feedback keys (manager+)", keysTag, 0, func(ctx context.Context, in *struct {
			WS
			ProjectRef
		}) (FeedbackKeyList, error) {
			list, err := r.sv.ListFeedbackKeys(ctx, in.Project)
			return FeedbackKeyList{Keys: list}, err
		})
	do(r, http.MethodPost, "/api/w/projects/{project}/feedback-keys", "w-create-feedback-key",
		"Mint a public feedback key for a project", keysTag, http.StatusCreated, func(ctx context.Context, in *struct {
			WS
			ProjectRef
			Body struct {
				Name           string   `json:"name,omitempty" maxLength:"100"`
				AllowedOrigins []string `json:"allowed_origins,omitempty" doc:"Origins allowed to POST (https://example.com); empty = none until set"`
			}
		}) (*FeedbackKey, error) {
			return r.sv.CreateFeedbackKey(ctx, in.Project, in.Body.Name, in.Body.AllowedOrigins)
		})
	do(r, http.MethodPatch, "/api/w/feedback-keys/{key}", "w-update-feedback-key",
		"Rename a key, toggle it active, or set its allowed origins", keysTag, 0, func(ctx context.Context, in *struct {
			WS
			KeyRef
			Body struct {
				Name           *string   `json:"name,omitempty" maxLength:"100"`
				Active         *bool     `json:"active,omitempty"`
				AllowedOrigins *[]string `json:"allowed_origins,omitempty"`
			}
		}) (*FeedbackKey, error) {
			return r.sv.UpdateFeedbackKey(ctx, in.Key, in.Body.Name, in.Body.Active, in.Body.AllowedOrigins)
		})
	none(r, http.MethodPost, "/api/w/feedback-keys/{key}/revoke", "w-revoke-feedback-key",
		"Revoke a public feedback key (the embed endpoint refuses it afterwards)", keysTag, func(ctx context.Context, in *struct {
			WS
			KeyRef
		}) error {
			return r.sv.RevokeFeedbackKey(ctx, in.Key)
		})

	const portalTag = "Client portal"
	do(r, http.MethodGet, "/api/w/clients/{client}/contacts", "w-list-client-contacts",
		"The portal accounts linked to a client (manager+)", portalTag, 0, func(ctx context.Context, in *struct {
			WS
			ClientRef
		}) (ContactList, error) {
			list, err := r.sv.ListClientContacts(ctx, in.Client)
			return ContactList{Contacts: list}, err
		})
	do(r, http.MethodPut, "/api/w/clients/{client}/contacts/{user}", "w-share-client",
		"Link a workspace member to a client as a portal contact", portalTag, 0, func(ctx context.Context, in *struct {
			WS
			ClientRef
			UserRef
		}) (*ClientContact, error) {
			return r.sv.ShareClient(ctx, in.Client, in.User)
		})
	none(r, http.MethodDelete, "/api/w/clients/{client}/contacts/{user}", "w-unshare-client",
		"Remove a portal contact from a client", portalTag, func(ctx context.Context, in *struct {
			WS
			ClientRef
			UserRef
		}) error {
			return r.sv.Unshare(ctx, in.Client, in.User)
		})
	do(r, http.MethodGet, "/api/w/portal/invoices", "w-portal-invoices",
		"The signed-in client's own invoices, read-only (drafts hidden)", portalTag, 0, func(ctx context.Context, _ *WS) (PortalInvoiceList, error) {
			list, err := r.sv.PortalInvoices(ctx)
			return PortalInvoiceList{Invoices: list}, err
		})
}
