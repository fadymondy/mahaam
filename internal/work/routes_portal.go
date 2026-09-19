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
				Name           *string       `json:"name,omitempty" maxLength:"100"`
				Active         *bool         `json:"active,omitempty"`
				AllowedOrigins *[]string     `json:"allowed_origins,omitempty"`
				Widget         *WidgetConfig `json:"widget,omitempty" doc:"The launcher's look; replaces the stored one"`
			}
		}) (*FeedbackKey, error) {
			return r.sv.UpdateFeedbackKey(ctx, in.Key, in.Body.Name, in.Body.Active, in.Body.AllowedOrigins, in.Body.Widget)
		})
	do(r, http.MethodGet, "/api/w/projects/{project}/feedback-install", "w-feedback-install",
		"Install guides for the Feedback SDK (html, laravel, node, next, go, python, and an AI-agent prompt)", keysTag, 0, func(ctx context.Context, in *struct {
			WS
			ProjectRef
			Key string `query:"key" doc:"Key id or pfk_…; default the newest active key"`
		}) (*FeedbackInstall, error) {
			return r.sv.GetFeedbackInstall(ctx, in.Project, in.Key)
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

// VaultRef is the {item} path parameter for a vault item. Exported so Huma binds it.
type VaultRef struct {
	Item string `path:"item" doc:"Vault item id"`
}

// VaultList is the body of GET …/vault.
type VaultList struct {
	Items []VaultItem `json:"items"`
}

// vault mounts the project vault: secrets (sealed; revealed one at a time, recorded) and
// memory (notes, searchable). internal/work/vault.go holds the rules.
func (r routes) vault() {
	const tag = "Project vault"
	do(r, http.MethodGet, "/api/w/projects/{project}/vault", "w-list-vault",
		"A project's vault items (secret values are never listed)", tag, 0, func(ctx context.Context, in *struct {
			WS
			ProjectRef
			Kind  string `query:"kind" enum:"secret,memory," doc:"secret or memory"`
			Q     string `query:"q" doc:"Search title, body and tags"`
			Tag   string `query:"tag"`
			Limit int    `query:"limit" doc:"Default 200"`
		}) (VaultList, error) {
			list, err := r.sv.ListVault(ctx, in.Project, VaultFilter{Kind: in.Kind, Q: in.Q, Tag: in.Tag, Limit: in.Limit})
			return VaultList{Items: list}, err
		})
	do(r, http.MethodGet, "/api/w/projects/{project}/vault/recall", "w-recall-vault",
		"The project's memory ranked by relevance to a question", tag, 0, func(ctx context.Context, in *struct {
			WS
			ProjectRef
			Q     string `query:"q" doc:"What you want to know"`
			Limit int    `query:"limit" doc:"Default 8"`
		}) (VaultList, error) {
			list, err := r.sv.RecallVault(ctx, in.Project, in.Q, in.Limit)
			return VaultList{Items: list}, err
		})
	do(r, http.MethodPost, "/api/w/projects/{project}/vault", "w-create-vault-item",
		"Add a memory note (member+) or a secret (manager+ or the project lead)", tag, http.StatusCreated, func(ctx context.Context, in *struct {
			WS
			ProjectRef
			Body VaultInput
		}) (*VaultItem, error) {
			return r.sv.CreateVaultItem(ctx, in.Project, in.Body)
		})
	do(r, http.MethodGet, "/api/w/vault/{item}", "w-get-vault-item",
		"One vault item (never the secret value)", tag, 0, func(ctx context.Context, in *struct {
			WS
			VaultRef
		}) (*VaultItem, error) {
			return r.sv.GetVaultItem(ctx, in.Item)
		})
	do(r, http.MethodPatch, "/api/w/vault/{item}", "w-update-vault-item",
		"Change a vault item's title, body, tags or (secret) value", tag, 0, func(ctx context.Context, in *struct {
			WS
			VaultRef
			Body VaultInput
		}) (*VaultItem, error) {
			return r.sv.UpdateVaultItem(ctx, in.Item, in.Body)
		})
	none(r, http.MethodDelete, "/api/w/vault/{item}", "w-delete-vault-item",
		"Delete a vault item", tag, func(ctx context.Context, in *struct {
			WS
			VaultRef
		}) error {
			return r.sv.DeleteVaultItem(ctx, in.Item)
		})
	do(r, http.MethodPost, "/api/w/vault/{item}/reveal", "w-reveal-vault-secret",
		"Decrypt one secret (manager+ or the project lead); the reveal is recorded", tag, 0, func(ctx context.Context, in *struct {
			WS
			VaultRef
		}) (*VaultItem, error) {
			return r.sv.RevealVaultSecret(ctx, in.Item)
		})
}

// GrantRef is the {grant} path parameter. Exported so Huma binds it.
type GrantRef struct {
	Grant string `path:"grant" doc:"Access grant id"`
}

// GrantList is the body of GET /api/w/access-grants.
type GrantList struct {
	Grants []Grant `json:"grants"`
}

// ProjectLabelList is the body of GET/PUT …/project-labels.
type ProjectLabelList struct {
	Labels []ProjectLabel `json:"labels"`
}

// access mounts label → project → task access: project labels and grants (manager+).
func (r routes) access() {
	const tag = "Access"
	do(r, http.MethodGet, "/api/w/access-grants", "w-list-grants",
		"Access grants (label or task, to a user or team), optionally filtered", tag, 0, func(ctx context.Context, in *struct {
			WS
			SubjectType string `query:"subject_type" enum:"user,team,"`
			SubjectID   string `query:"subject_id"`
			ScopeType   string `query:"scope_type" enum:"label,task,"`
			ScopeID     string `query:"scope_id"`
		}) (GrantList, error) {
			list, err := r.sv.ListGrants(ctx, GrantFilter{SubjectType: in.SubjectType, SubjectID: in.SubjectID, ScopeType: in.ScopeType, ScopeID: in.ScopeID})
			return GrantList{Grants: list}, err
		})
	do(r, http.MethodPost, "/api/w/access-grants", "w-create-grant",
		"Give a user or team access to every project with a label, or to one task", tag, http.StatusCreated, func(ctx context.Context, in *struct {
			WS
			Body GrantInput
		}) (*Grant, error) {
			return r.sv.CreateGrant(ctx, in.Body)
		})
	none(r, http.MethodDelete, "/api/w/access-grants/{grant}", "w-delete-grant",
		"Revoke an access grant", tag, func(ctx context.Context, in *struct {
			WS
			GrantRef
		}) error {
			return r.sv.DeleteGrant(ctx, in.Grant)
		})
	do(r, http.MethodGet, "/api/w/projects/{project}/project-labels", "w-project-labels",
		"The labels a project carries (they decide label grants)", tag, 0, func(ctx context.Context, in *struct {
			WS
			ProjectRef
		}) (ProjectLabelList, error) {
			list, err := r.sv.ProjectLabels(ctx, in.Project)
			return ProjectLabelList{Labels: list}, err
		})
	do(r, http.MethodPut, "/api/w/projects/{project}/project-labels", "w-set-project-labels",
		"Replace the labels a project carries (manager+)", tag, 0, func(ctx context.Context, in *struct {
			WS
			ProjectRef
			Body struct {
				Labels []string `json:"labels" doc:"Label ids or exact names"`
			}
		}) (ProjectLabelList, error) {
			list, err := r.sv.SetProjectLabels(ctx, in.Project, in.Body.Labels)
			return ProjectLabelList{Labels: list}, err
		})
}
