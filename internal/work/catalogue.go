package work

import (
	"context"
	"database/sql"
	"errors"
	"regexp"
	"strings"

	"github.com/fadymondy/mahaam/internal/tenant"
)

/*
A project's catalogue of agents and skills (project_catalogue). It feeds the issue
Agent/Skill pickers and the @-mention list. Rows come from the UI (source "ui"), from a
user over MCP ("mcp"), or from a sync of a repo's .claude/ folder ("sync"). A sync with
replace=true only ever deletes "sync" rows, never hand-added ones.

Read: anyone who can see the project (FindProject, 404 otherwise). Write: whoever can
change the project (canManage: managers, or the project's lead).
*/

// CatalogueItem is one agent or skill of a project.
type CatalogueItem struct {
	ID          string `json:"id"`
	Kind        string `json:"kind" enum:"agent,skill"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Source      string `json:"source" enum:"ui,mcp,sync"`
}

// Catalogue is a project's agents and skills, each sorted by name.
type Catalogue struct {
	Agents []CatalogueItem `json:"agents"`
	Skills []CatalogueItem `json:"skills"`
}

// CatalogueEntry is one {name, description} of a sync payload.
type CatalogueEntry struct {
	Name        string `json:"name" minLength:"1" maxLength:"100"`
	Description string `json:"description,omitempty" maxLength:"2000"`
}

var catalogueName = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]*$`)

const maxCatalogueDescription = 2000

func cleanCatalogue(kind, name, description string) (string, string, string, error) {
	kind = strings.ToLower(strings.TrimSpace(kind))
	if err := oneOf("kind", kind, "agent", "skill"); err != nil {
		return "", "", "", err
	}
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 100 {
		return "", "", "", invalid("a %s needs a name of 1 to 100 characters", kind)
	}
	if !catalogueName.MatchString(name) {
		return "", "", "", invalid("%q is not a valid %s name: use letters, digits, '.', '_', ':' or '-', starting with a letter or digit", name, kind)
	}
	description = truncate(strings.TrimSpace(description), maxCatalogueDescription)
	return kind, name, description, nil
}

// catalogueProject resolves a visible project (404 otherwise); write=true also needs manage rights.
func (sv *Service) catalogueProject(ctx context.Context, projectRef string, write bool) (*tenant.Scope, *Project, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, nil, err
	}
	p, err := sv.FindProject(ctx, projectRef)
	if err != nil {
		return nil, nil, err
	}
	if write {
		if err := requireManage(ctx, sv.DB, s, p.ID); err != nil {
			return nil, nil, err
		}
	}
	return s, p, nil
}

func listCatalogue(ctx context.Context, q querier, ws, projectID string) (*Catalogue, error) {
	rows, err := q.QueryContext(ctx, `SELECT id, kind, name, description, source FROM project_catalogue
		WHERE workspace_id = $1 AND project_id = $2 ORDER BY lower(name), name`, ws, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := &Catalogue{Agents: []CatalogueItem{}, Skills: []CatalogueItem{}}
	for rows.Next() {
		var it CatalogueItem
		if err := rows.Scan(&it.ID, &it.Kind, &it.Name, &it.Description, &it.Source); err != nil {
			return nil, err
		}
		if it.Kind == "agent" {
			out.Agents = append(out.Agents, it)
		} else {
			out.Skills = append(out.Skills, it)
		}
	}
	return out, rows.Err()
}

// ListCatalogue lists a visible project's agents and skills.
func (sv *Service) ListCatalogue(ctx context.Context, projectRef string) (*Catalogue, error) {
	s, p, err := sv.catalogueProject(ctx, projectRef, false)
	if err != nil {
		return nil, err
	}
	return listCatalogue(ctx, sv.DB, s.WorkspaceID, p.ID)
}

func upsertCatalogue(ctx context.Context, tx *sql.Tx, s *tenant.Scope, projectID, kind, name, description, source string) (string, error) {
	var id string
	err := tx.QueryRowContext(ctx, `INSERT INTO project_catalogue (workspace_id, project_id, kind, name, description, source, created_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (workspace_id, project_id, kind, lower(name))
		DO UPDATE SET description = EXCLUDED.description, name = EXCLUDED.name, updated_at = now()
		RETURNING id`, s.WorkspaceID, projectID, kind, name, description, source, nullIfEmpty(s.UserID)).Scan(&id)
	return id, err
}

// AddCatalogueItem adds an agent or skill to a project, or updates the description of the one
// with that name (case-insensitive). source is "ui" or "mcp".
func (sv *Service) AddCatalogueItem(ctx context.Context, projectRef, kind, name, description, source string) (*CatalogueItem, error) {
	s, p, err := sv.catalogueProject(ctx, projectRef, true)
	if err != nil {
		return nil, err
	}
	kind, name, description, err = cleanCatalogue(kind, name, description)
	if err != nil {
		return nil, err
	}
	if source == "" {
		source = "ui"
	}
	if err := oneOf("source", source, "ui", "mcp", "sync"); err != nil {
		return nil, err
	}
	var id string
	err = sv.tx(ctx, func(tx *sql.Tx) error {
		if id, err = upsertCatalogue(ctx, tx, s, p.ID, kind, name, description, source); err != nil {
			return err
		}
		return record(ctx, tx, s, entry{ProjectID: p.ID, Action: "catalogue.added", SubjectType: "project_catalogue", SubjectID: id,
			Changes: map[string]any{"kind": kind, "name": name}})
	})
	if err != nil {
		return nil, err
	}
	it := &CatalogueItem{}
	err = sv.DB.QueryRowContext(ctx, `SELECT id, kind, name, description, source FROM project_catalogue
		WHERE workspace_id = $1 AND id = $2`, s.WorkspaceID, id).Scan(&it.ID, &it.Kind, &it.Name, &it.Description, &it.Source)
	return it, err
}

// DeleteCatalogueItem removes one item (by id) from a project's catalogue.
func (sv *Service) DeleteCatalogueItem(ctx context.Context, projectRef, id string) error {
	s, p, err := sv.catalogueProject(ctx, projectRef, true)
	if err != nil {
		return err
	}
	return sv.deleteCatalogue(ctx, s, p, `id = $3`, strings.TrimSpace(id))
}

// RemoveCatalogueItemByName removes an agent or skill by name (case-insensitive) — for MCP callers.
func (sv *Service) RemoveCatalogueItemByName(ctx context.Context, projectRef, kind, name string) error {
	s, p, err := sv.catalogueProject(ctx, projectRef, true)
	if err != nil {
		return err
	}
	kind = strings.ToLower(strings.TrimSpace(kind))
	if err := oneOf("kind", kind, "agent", "skill"); err != nil {
		return err
	}
	return sv.deleteCatalogue(ctx, s, p, `kind = $4 AND lower(name) = lower($3)`, strings.TrimSpace(name), kind)
}

func (sv *Service) deleteCatalogue(ctx context.Context, s *tenant.Scope, p *Project, where string, args ...any) error {
	return sv.tx(ctx, func(tx *sql.Tx) error {
		var id, kind, name string
		err := tx.QueryRowContext(ctx, `DELETE FROM project_catalogue WHERE workspace_id = $1 AND project_id = $2 AND `+where+`
			RETURNING id, kind, name`, append([]any{s.WorkspaceID, p.ID}, args...)...).Scan(&id, &kind, &name)
		if errors.Is(err, sql.ErrNoRows) {
			return notFound("catalogue item")
		}
		if err != nil {
			return err
		}
		return record(ctx, tx, s, entry{ProjectID: p.ID, Action: "catalogue.removed", SubjectType: "project_catalogue", SubjectID: id,
			Changes: map[string]any{"kind": kind, "name": name}})
	})
}

// SyncCatalogue upserts a repo's agents and skills (source "sync"). With replace, "sync" rows
// missing from the payload are deleted; "ui" and "mcp" rows are never touched by a replace.
func (sv *Service) SyncCatalogue(ctx context.Context, projectRef string, agents, skills []CatalogueEntry, replace bool) (*Catalogue, error) {
	s, p, err := sv.catalogueProject(ctx, projectRef, true)
	if err != nil {
		return nil, err
	}
	type item struct{ kind, name, description string }
	items := []item{}
	seen := map[string]bool{}
	for _, group := range []struct {
		kind string
		list []CatalogueEntry
	}{{"agent", agents}, {"skill", skills}} {
		for _, e := range group.list {
			k, n, d, err := cleanCatalogue(group.kind, e.Name, e.Description)
			if err != nil {
				return nil, err
			}
			key := k + "/" + strings.ToLower(n)
			if seen[key] {
				continue
			}
			seen[key] = true
			items = append(items, item{k, n, d})
		}
	}
	if len(items) > 500 {
		return nil, invalid("a sync carries at most 500 agents and skills")
	}
	removed := 0
	err = sv.tx(ctx, func(tx *sql.Tx) error {
		for _, it := range items {
			if _, err := upsertCatalogue(ctx, tx, s, p.ID, it.kind, it.name, it.description, "sync"); err != nil {
				return err
			}
		}
		if replace {
			keep := []string{}
			for k := range seen {
				keep = append(keep, k)
			}
			res, err := tx.ExecContext(ctx, `DELETE FROM project_catalogue WHERE workspace_id = $1 AND project_id = $2
				AND source = 'sync' AND NOT (kind || '/' || lower(name) = ANY ($3::text[]))`, s.WorkspaceID, p.ID, pqStringArray(keep))
			if err != nil {
				return err
			}
			n, _ := res.RowsAffected()
			removed = int(n)
		}
		return record(ctx, tx, s, entry{ProjectID: p.ID, Action: "catalogue.synced", SubjectType: "project", SubjectID: p.ID,
			Changes: map[string]any{"agents": len(agents), "skills": len(skills), "replace": replace, "removed": removed}})
	})
	if err != nil {
		return nil, err
	}
	return listCatalogue(ctx, sv.DB, s.WorkspaceID, p.ID)
}
