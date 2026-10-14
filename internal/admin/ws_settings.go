package admin

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/danielgtaylor/huma/v2"

	"github.com/fadymondy/mahaam/internal/account"
	"github.com/fadymondy/mahaam/internal/authz"
	"github.com/fadymondy/mahaam/internal/tenant"
	"github.com/fadymondy/mahaam/internal/work"
	"github.com/fadymondy/mahaam/internal/workspaces"
	"github.com/jackc/pgx/v5/pgconn"
)

type wsBody struct {
	Body workspaces.WorkspaceOut
}

// registerSettings mounts the workspace's own settings: name, slug and logo (owner/admin).
//
//	PATCH  /api/w/workspace        {name?, slug?}
//	POST   /api/w/workspace/logo   multipart "file"
//	DELETE /api/w/workspace/logo
func registerSettings(api huma.API, db *sql.DB) {
	const tag = "Tenancy"

	adminScope := func(ctx context.Context) (*tenant.Scope, error) {
		s, ok := tenant.From(ctx)
		var err error
		if !ok {
			return nil, huma.Error404NotFound("workspace not found")
		}
		if err != nil {
			return nil, err
		}
		if !authz.Role(s.Role).AtLeast(authz.Admin) {
			return nil, huma.Error403Forbidden("only workspace owners and admins can change workspace settings")
		}
		return s, nil
	}

	// apply runs one UPDATE plus its activity row in a single transaction and returns the summary.
	apply := func(ctx context.Context, s *tenant.Scope, set string, args []any, action string, changes map[string]any) (*wsBody, error) {
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			return nil, huma.Error500InternalServerError("could not save")
		}
		defer tx.Rollback() //nolint:errcheck
		args = append([]any{s.WorkspaceID}, args...)
		if _, err := tx.ExecContext(ctx, `UPDATE workspaces SET `+set+`, updated_at = now() WHERE id = $1`, args...); err != nil {
			if isUnique(err) {
				return nil, huma.Error409Conflict("that address is taken")
			}
			return nil, huma.Error500InternalServerError("could not save")
		}
		body, _ := json.Marshal(changes)
		m := work.MetaFrom(ctx)
		ua := m.UserAgent
		if len(ua) > 400 {
			ua = ua[:400]
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO activity_logs (workspace_id, actor_id, actor_via, action, subject_type, subject_id, changes, ip, user_agent)
			VALUES ($1, $2, 'session', $3, 'workspace', $1, $4, $5, $6)`,
			s.WorkspaceID, s.UserID, action, string(body), m.IP, ua); err != nil {
			return nil, huma.Error500InternalServerError("could not save")
		}
		out := workspaces.WorkspaceOut{Role: s.Role}
		if err := tx.QueryRowContext(ctx, `SELECT id, slug, name, locale, logo FROM workspaces WHERE id = $1`, s.WorkspaceID).
			Scan(&out.ID, &out.Slug, &out.Name, &out.Locale, &out.Logo); err != nil {
			return nil, huma.Error500InternalServerError("could not save")
		}
		if err := tx.Commit(); err != nil {
			return nil, huma.Error500InternalServerError("could not save")
		}
		return &wsBody{Body: out}, nil
	}

	huma.Register(api, huma.Operation{OperationID: "w-update-workspace", Method: http.MethodPatch, Path: "/api/w/workspace",
		Summary: "Rename the workspace or change its address (owner/admin)", Tags: []string{tag}},
		func(ctx context.Context, in *struct {
			work.WS
			Body struct {
				Name *string `json:"name,omitempty" maxLength:"200"`
				Slug *string `json:"slug,omitempty" maxLength:"100"`
			}
		}) (*wsBody, error) {
			s, err := adminScope(ctx)
			if err != nil {
				return nil, err
			}
			var sets []string
			var args []any
			changes := map[string]any{}
			if in.Body.Name != nil {
				name := strings.TrimSpace(*in.Body.Name)
				if name == "" || utf8.RuneCountInString(name) > 80 {
					return nil, huma.Error422UnprocessableEntity("the name must be 1–80 characters")
				}
				args = append(args, name)
				sets = append(sets, "name = $"+strconv.Itoa(len(args)+1))
				changes["name"] = name
			}
			if in.Body.Slug != nil {
				slug := strings.ToLower(strings.TrimSpace(*in.Body.Slug))
				if !workspaces.ValidSlug(slug) {
					return nil, huma.Error422UnprocessableEntity("the address must be 3–40 lowercase letters, digits or dashes, and not a reserved word")
				}
				args = append(args, slug)
				sets = append(sets, "slug = $"+strconv.Itoa(len(args)+1))
				changes["slug"] = slug
			}
			if len(sets) == 0 {
				return nil, huma.Error422UnprocessableEntity("nothing to change")
			}
			return apply(ctx, s, strings.Join(sets, ", "), args, "workspace.updated", changes)
		})

	huma.Register(api, huma.Operation{OperationID: "w-workspace-logo-upload", Method: http.MethodPost, Path: "/api/w/workspace/logo",
		Summary: "Upload the workspace logo (multipart field \"file\": JPEG, PNG or GIF, up to 10 MB; owner/admin)", Tags: []string{tag},
		MaxBodyBytes: 11 << 20},
		func(ctx context.Context, in *struct {
			work.WS
			RawBody huma.MultipartFormFiles[struct {
				File huma.FormFile `form:"file" required:"true"`
			}]
		}) (*wsBody, error) {
			s, err := adminScope(ctx)
			if err != nil {
				return nil, err
			}
			if in.RawBody.Form == nil || len(in.RawBody.Form.File["file"]) == 0 {
				return nil, huma.Error422UnprocessableEntity("send the logo in the multipart field \"file\"")
			}
			f, err := in.RawBody.Form.File["file"][0].Open()
			if err != nil {
				return nil, huma.Error400BadRequest("could not read the upload")
			}
			defer f.Close()
			url, err := account.AvatarDataURL(f)
			switch {
			case errors.Is(err, account.ErrAvatarFormat):
				return nil, huma.Error415UnsupportedMediaType(err.Error())
			case errors.Is(err, account.ErrAvatarSize):
				return nil, huma.NewError(http.StatusRequestEntityTooLarge, err.Error())
			case err != nil:
				return nil, huma.Error400BadRequest("could not read the picture")
			}
			return apply(ctx, s, "logo = $2", []any{url}, "workspace.logo_changed", map[string]any{"logo": "set"})
		})

	huma.Register(api, huma.Operation{OperationID: "w-workspace-logo-delete", Method: http.MethodDelete, Path: "/api/w/workspace/logo",
		Summary: "Remove the workspace logo (owner/admin)", Tags: []string{tag}},
		func(ctx context.Context, _ *work.WS) (*wsBody, error) {
			s, err := adminScope(ctx)
			if err != nil {
				return nil, err
			}
			return apply(ctx, s, "logo = NULL", nil, "workspace.logo_changed", map[string]any{"logo": "removed"})
		})
}

func isUnique(err error) bool {
	var pg *pgconn.PgError
	return errors.As(err, &pg) && pg.Code == "23505"
}
