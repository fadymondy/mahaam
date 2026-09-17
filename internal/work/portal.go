package work

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/fadymondy/managy/internal/authz"
	"github.com/fadymondy/managy/internal/tenant"
)

/*
The client portal link. A client-role member sees a RESTRICTED view of the
workspace: only the projects belonging to the client record their portal account
is a contact of (client_contacts), the issues they filed in those projects, and
their own invoices — never tasks, time, rates, members, other clients or internal
issues. Project visibility is enforced in visibleClause (projects.go); this file
manages the link and exposes helpers the portal REST layer and the reports package
use to resolve "the caller's client".

Choice (plan P7): a client_contacts link table over a clients.user_id column. A
client company has several people; a portal account represents exactly one client
per workspace (UNIQUE (workspace_id, user_id)). Sharing a client shares its whole
book of projects at once, with no per-project fan-out.
*/

// ClientContact is one portal account linked to a client.
type ClientContact struct {
	ID        string    `json:"id"`
	ClientID  string    `json:"client_id"`
	UserID    string    `json:"user_id"`
	Email     *string   `json:"email"`
	CreatedAt time.Time `json:"created_at"`
}

// VisibleProject returns a project the caller may see (visibleClause), or 404 —
// exported for the reports package, which files and lists portal issues against a
// project without importing work's unexported loader.
func (sv *Service) VisibleProject(ctx context.Context, ref string) (*Project, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := require(s, authz.ProjectsRead); err != nil {
		return nil, err
	}
	return loadProject(ctx, sv.DB, s, strings.TrimSpace(ref))
}

// PortalClientID returns the client the caller's portal account is a contact of.
// Only meaningful for a client-role member; anyone else gets 404 (they are not a
// portal contact of any client).
func (sv *Service) PortalClientID(ctx context.Context) (string, error) {
	s, err := caller(ctx)
	if err != nil {
		return "", err
	}
	return sv.portalClientID(ctx, s)
}

func (sv *Service) portalClientID(ctx context.Context, s *tenant.Scope) (string, error) {
	var id string
	err := sv.DB.QueryRowContext(ctx, `SELECT client_id FROM client_contacts
		WHERE workspace_id = $1 AND user_id = $2`, s.WorkspaceID, s.UserID).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return "", notFound("client")
	}
	return id, err
}

// ListClientContacts returns the portal accounts linked to a client.
func (sv *Service) ListClientContacts(ctx context.Context, clientRef string) ([]ClientContact, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := require(s, authz.ClientContactsManage); err != nil {
		return nil, err
	}
	c, err := findClient(ctx, sv.DB, s.WorkspaceID, clientRef)
	if err != nil {
		return nil, err
	}
	rows, err := sv.DB.QueryContext(ctx, `SELECT id, client_id, user_id, created_at
		FROM client_contacts WHERE workspace_id = $1 AND client_id = $2 ORDER BY created_at`, s.WorkspaceID, c.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ClientContact{}
	for rows.Next() {
		var cc ClientContact
		if err := rows.Scan(&cc.ID, &cc.ClientID, &cc.UserID, &cc.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, cc)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	sv.fillContactEmails(ctx, out)
	return out, nil
}

// fillContactEmails looks the emails up on the owner pool (the app role has no
// grant on users), best-effort.
func (sv *Service) fillContactEmails(ctx context.Context, cs []ClientContact) {
	if sv.Sys == nil {
		return
	}
	for i := range cs {
		var email string
		if err := sv.Sys.QueryRowContext(ctx, `SELECT email FROM users WHERE id = $1`, cs[i].UserID).Scan(&email); err == nil && email != "" {
			e := email
			cs[i].Email = &e
		}
	}
}

// ShareClient links a workspace member to a client as a portal contact. The
// target must already be a member of the workspace; sharing does not create the
// account (invite the person as a `client` first). Idempotent.
func (sv *Service) ShareClient(ctx context.Context, clientRef, userRef string) (*ClientContact, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := require(s, authz.ClientContactsManage); err != nil {
		return nil, err
	}
	c, err := findClient(ctx, sv.DB, s.WorkspaceID, clientRef)
	if err != nil {
		return nil, err
	}
	userID, err := sv.resolvePortalUser(ctx, s, userRef)
	if err != nil {
		return nil, err
	}
	var cc ClientContact
	err = sv.tx(ctx, func(tx *sql.Tx) error {
		row := tx.QueryRowContext(ctx, `
			INSERT INTO client_contacts (workspace_id, client_id, user_id, created_by)
			VALUES ($1, $2, $3, $4)
			ON CONFLICT (workspace_id, user_id) DO UPDATE SET client_id = EXCLUDED.client_id
			RETURNING id, client_id, user_id, created_at`, s.WorkspaceID, c.ID, userID, s.UserID)
		if err := row.Scan(&cc.ID, &cc.ClientID, &cc.UserID, &cc.CreatedAt); err != nil {
			return err
		}
		return record(ctx, tx, s, entry{Action: "client.shared", SubjectType: "client", SubjectID: c.ID,
			Changes: map[string]any{"user_id": userID}})
	})
	if err != nil {
		return nil, err
	}
	sv.fillContactEmails(ctx, []ClientContact{cc})
	return &cc, nil
}

// Unshare removes a portal contact from a client.
func (sv *Service) Unshare(ctx context.Context, clientRef, userRef string) error {
	s, err := caller(ctx)
	if err != nil {
		return err
	}
	if err := require(s, authz.ClientContactsManage); err != nil {
		return err
	}
	c, err := findClient(ctx, sv.DB, s.WorkspaceID, clientRef)
	if err != nil {
		return err
	}
	userID, err := sv.resolvePortalUser(ctx, s, userRef)
	if err != nil {
		return err
	}
	return sv.tx(ctx, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx, `DELETE FROM client_contacts
			WHERE workspace_id = $1 AND client_id = $2 AND user_id = $3`, s.WorkspaceID, c.ID, userID)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return notFound("contact")
		}
		return record(ctx, tx, s, entry{Action: "client.unshared", SubjectType: "client", SubjectID: c.ID,
			Changes: map[string]any{"user_id": userID}})
	})
}

// PortalInvoices lists the caller's client's invoices, read-only, drafts hidden.
// Gated by being a portal contact (portalClientID), NOT by InvoicesRead — a client
// reads their own invoices without holding the manager-tier finance action.
func (sv *Service) PortalInvoices(ctx context.Context) ([]Invoice, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	clientID, err := sv.portalClientID(ctx, s)
	if err != nil {
		return nil, err
	}
	rows, err := sv.DB.QueryContext(ctx, `SELECT `+invoiceCols+
		`WHERE i.workspace_id = $1 AND i.client_id = $2 AND i.status <> 'draft'
		 ORDER BY i.issue_date DESC, i.number DESC LIMIT 500`, s.WorkspaceID, clientID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Invoice{}
	for rows.Next() {
		iv, err := scanInvoice(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *iv)
	}
	return out, rows.Err()
}

// resolvePortalUser resolves a member ref (user id, or an email via the owner
// pool) to a user id that is an active member of the workspace.
func (sv *Service) resolvePortalUser(ctx context.Context, s *tenant.Scope, ref string) (string, error) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return "", invalid("who is the contact?")
	}
	userID := ref
	if strings.Contains(ref, "@") && sv.Sys != nil {
		if err := sv.Sys.QueryRowContext(ctx, `SELECT id FROM users WHERE lower(email) = lower($1)`, ref).Scan(&userID); err != nil {
			return "", notFound("user")
		}
	}
	var ok bool
	if err := sv.DB.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM workspace_members
		WHERE workspace_id = $1 AND user_id = $2 AND status = 'active')`, s.WorkspaceID, userID).Scan(&ok); err != nil {
		return "", err
	}
	if !ok {
		return "", invalid("that person is not a member of this workspace — invite them as a client first")
	}
	return userID, nil
}
