// Package admin is the platform admin panel's domain: platform stats, users, workspaces (plans,
// overrides, suspension, deletion), plans and the audit log. The REST routes (/api/admin/*,
// routes.go) and the admin MCP tools (internal/mcp/admin_tools.go) call the same functions, and
// every change is appended to admin_audit with the acting admin.
//
// Everything is cross-tenant by definition and runs on the owner pool with explicit predicates.
// Access control is the request guard's admin tier (session + platform admin, 404 otherwise) and
// the admin MCP's token check; the functions here trust their Actor.
package admin

import (
	"github.com/togo-framework/togo"

	"context"
	"database/sql"
	"errors"
	"net/http"
	"strings"

	"github.com/fadymondy/mahaam/internal/platform"
	"github.com/fadymondy/mahaam/internal/work"
)

// Service carries the owner pool.
type Service struct {
	DB *sql.DB
	// Store is togo storage (attachments); nil in the OpenAPI export and in tools that never
	// delete a workspace.
	Store togo.Storage
}

// Actor is the platform admin acting.
type Actor struct {
	ID, Email, IP string
	Via           string // rest | mcp
}

func errStatus(status int, msg string) error { return work.NewError(status, msg) }

func notFound(what string) error { return errStatus(http.StatusNotFound, what+" not found") }

func invalid(msg string) error { return errStatus(http.StatusUnprocessableEntity, msg) }

// audit records an admin action (best effort is not good enough: a failure fails the call).
func (sv *Service) audit(ctx context.Context, q interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}, a Actor, action, targetType, targetID, targetLabel string, changes any) error {
	return platform.Audit(ctx, q, platform.Entry{ActorID: a.ID, ActorEmail: a.Email, Action: action,
		TargetType: targetType, TargetID: targetID, TargetLabel: targetLabel, Changes: changes, IP: a.IP, Via: a.Via})
}

func (sv *Service) tx(ctx context.Context, fn func(*sql.Tx) error) error {
	tx, err := sv.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback() //nolint:errcheck
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit()
}

// Page is a page request.
type Page struct {
	Page, PerPage int
}

func (p Page) norm(def int) (limit, offset int) {
	if p.PerPage <= 0 || p.PerPage > 200 {
		p.PerPage = def
	}
	if p.Page <= 0 {
		p.Page = 1
	}
	return p.PerPage, (p.Page - 1) * p.PerPage
}

func like(q string) string {
	q = strings.TrimSpace(q)
	q = strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(q)
	return "%" + q + "%"
}

var errNoRows = sql.ErrNoRows

func isNoRows(err error) bool { return errors.Is(err, errNoRows) }

type txExec = *sql.Tx
