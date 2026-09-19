package work

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"github.com/fadymondy/mahaam/internal/authz"
)

// Label is a workspace-wide tag for tasks.
type Label struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Color     string `json:"color"`
	TaskCount int    `json:"task_count"`
}

// LabelInput creates or patches a label.
type LabelInput struct {
	Name  *string `json:"name,omitempty" maxLength:"40"`
	Color *string `json:"color,omitempty"`
}

const labelCols = `l.id, l.name, l.color, (SELECT count(*) FROM task_labels x WHERE x.workspace_id = l.workspace_id AND x.label_id = l.id)`

func loadLabel(ctx context.Context, q querier, ws, id string) (*Label, error) {
	l := &Label{}
	err := q.QueryRowContext(ctx, `SELECT `+labelCols+` FROM labels l WHERE l.workspace_id = $1 AND l.id = $2`, ws, strings.TrimSpace(id)).
		Scan(&l.ID, &l.Name, &l.Color, &l.TaskCount)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, notFound("label")
	}
	return l, err
}

// ListLabels lists the workspace's labels.
func (sv *Service) ListLabels(ctx context.Context) ([]Label, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := require(s, authz.TasksRead); err != nil {
		return nil, err
	}
	rows, err := sv.DB.QueryContext(ctx, `SELECT `+labelCols+` FROM labels l WHERE l.workspace_id = $1 ORDER BY lower(l.name)`, s.WorkspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Label{}
	for rows.Next() {
		var l Label
		if err := rows.Scan(&l.ID, &l.Name, &l.Color, &l.TaskCount); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// CreateLabel adds a label (members and up, so a label can be made while tagging).
func (sv *Service) CreateLabel(ctx context.Context, in LabelInput) (*Label, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := require(s, authz.LabelsCreate); err != nil {
		return nil, err
	}
	name, _ := trimmed(in.Name)
	if name == "" {
		return nil, invalid("a label needs a name")
	}
	color, err := pickColor(in.Color, "slate")
	if err != nil {
		return nil, err
	}
	var id string
	err = sv.tx(ctx, func(tx *sql.Tx) error {
		if err := tx.QueryRowContext(ctx, `INSERT INTO labels (workspace_id, name, color) VALUES ($1, $2, $3) RETURNING id`,
			s.WorkspaceID, name, color).Scan(&id); err != nil {
			return err
		}
		return record(ctx, tx, s, entry{Action: "label.created", SubjectType: "label", SubjectID: id, Changes: map[string]any{"name": name}})
	})
	if e, ok := AsError(err); ok && e.Status == 409 {
		return nil, conflict("a label with that name already exists")
	}
	if err != nil {
		return nil, err
	}
	return loadLabel(ctx, sv.DB, s.WorkspaceID, id)
}

// UpdateLabel renames or recolours a label (managers and up).
func (sv *Service) UpdateLabel(ctx context.Context, id string, in LabelInput) (*Label, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := require(s, authz.LabelsManage); err != nil {
		return nil, err
	}
	l, err := loadLabel(ctx, sv.DB, s.WorkspaceID, id)
	if err != nil {
		return nil, err
	}
	p := newPatch()
	if v, ok := trimmed(in.Name); ok {
		if v == "" {
			return nil, invalid("a label needs a name")
		}
		p.set("name", v)
	}
	if in.Color != nil {
		c, err := pickColor(in.Color, l.Color)
		if err != nil {
			return nil, err
		}
		p.set("color", c)
	}
	if p.empty() {
		return l, nil
	}
	err = sv.tx(ctx, func(tx *sql.Tx) error {
		if err := p.update(ctx, tx, "labels", s.WorkspaceID, l.ID); err != nil {
			return err
		}
		p.changes["name"] = firstString(p.changes["name"], l.Name)
		return record(ctx, tx, s, entry{Action: "label.updated", SubjectType: "label", SubjectID: l.ID, Changes: p.changes})
	})
	if e, ok := AsError(err); ok && e.Status == 409 {
		return nil, conflict("a label with that name already exists")
	}
	if err != nil {
		return nil, err
	}
	return loadLabel(ctx, sv.DB, s.WorkspaceID, l.ID)
}

// DeleteLabel removes a label from the workspace and every task (managers and up).
func (sv *Service) DeleteLabel(ctx context.Context, id string) error {
	s, err := caller(ctx)
	if err != nil {
		return err
	}
	if err := require(s, authz.LabelsManage); err != nil {
		return err
	}
	l, err := loadLabel(ctx, sv.DB, s.WorkspaceID, id)
	if err != nil {
		return err
	}
	return sv.tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `DELETE FROM labels WHERE workspace_id = $1 AND id = $2`, s.WorkspaceID, l.ID); err != nil {
			return err
		}
		return record(ctx, tx, s, entry{Action: "label.deleted", SubjectType: "label", SubjectID: l.ID, Changes: map[string]any{"name": l.Name}})
	})
}
