package work

import (
	"context"
	"database/sql"
	"strings"
	"time"

	"github.com/fadymondy/mahaam/internal/authz"
	"github.com/fadymondy/mahaam/internal/limits"
)

// Team is a group of workspace members. Attaching a team to a project gives its members the
// project's access.
type Team struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	Description  *string   `json:"description"`
	Color        string    `json:"color"`
	MemberIDs    []string  `json:"member_ids"`
	ProjectCount int       `json:"project_count"`
	CreatedAt    time.Time `json:"created_at"`
}

const teamCols = `tm.id, tm.name, tm.description, tm.color,
	COALESCE((SELECT string_agg(x.user_id, ',' ORDER BY x.created_at) FROM team_members x
	          WHERE x.workspace_id = tm.workspace_id AND x.team_id = tm.id), ''),
	(SELECT count(*) FROM project_teams pt WHERE pt.workspace_id = tm.workspace_id AND pt.team_id = tm.id),
	tm.created_at`

func scanTeam(r scanner) (*Team, error) {
	t := &Team{}
	var members string
	err := r.Scan(&t.ID, &t.Name, &t.Description, &t.Color, &members, &t.ProjectCount, &t.CreatedAt)
	t.MemberIDs = splitIDs(members)
	return t, err
}

// TeamInput creates or patches a team. MemberIDs, when sent, replaces the membership.
type TeamInput struct {
	Name        *string   `json:"name,omitempty" maxLength:"80"`
	Description *string   `json:"description,omitempty" maxLength:"500"`
	Color       *string   `json:"color,omitempty"`
	MemberIDs   *[]string `json:"member_ids,omitempty"`
}

// ListTeams lists the workspace's teams.
func (sv *Service) ListTeams(ctx context.Context) ([]Team, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := require(s, authz.TeamsRead); err != nil {
		return nil, err
	}
	rows, err := sv.DB.QueryContext(ctx, `SELECT `+teamCols+` FROM teams tm WHERE tm.workspace_id = $1 ORDER BY lower(tm.name)`, s.WorkspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Team{}
	for rows.Next() {
		t, err := scanTeam(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *t)
	}
	return out, rows.Err()
}

func loadTeam(ctx context.Context, q querier, ws, id string) (*Team, error) {
	t, err := scanTeam(q.QueryRowContext(ctx, `SELECT `+teamCols+` FROM teams tm WHERE tm.workspace_id = $1 AND tm.id = $2`, ws, strings.TrimSpace(id)))
	if err == sql.ErrNoRows {
		return nil, notFound("team")
	}
	return t, err
}

// activeMembers checks that every id is an active member of the workspace.
func activeMembers(ctx context.Context, q querier, ws string, ids []string) error {
	if len(ids) == 0 {
		return nil
	}
	rows, err := q.QueryContext(ctx, `SELECT user_id FROM workspace_members
		WHERE workspace_id = $1 AND status = 'active' AND user_id = ANY(string_to_array($2, ','))`, ws, strings.Join(ids, ","))
	if err != nil {
		return err
	}
	defer rows.Close()
	ok := map[string]bool{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return err
		}
		ok[id] = true
	}
	for _, id := range ids {
		if !ok[id] {
			return invalid("%s is not an active member of this workspace", id)
		}
	}
	return rows.Err()
}

func setTeamMembers(ctx context.Context, tx *sql.Tx, ws, teamID string, ids []string) (added, removed []string, err error) {
	rows, err := tx.QueryContext(ctx, `SELECT user_id FROM team_members WHERE workspace_id = $1 AND team_id = $2`, ws, teamID)
	if err != nil {
		return nil, nil, err
	}
	have := map[string]bool{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, nil, err
		}
		have[id] = true
	}
	rows.Close()
	want := map[string]bool{}
	for _, id := range ids {
		want[id] = true
		if !have[id] {
			added = append(added, id)
		}
	}
	for id := range have {
		if !want[id] {
			removed = append(removed, id)
		}
	}
	for _, id := range added {
		if _, err := tx.ExecContext(ctx, `INSERT INTO team_members (workspace_id, team_id, user_id) VALUES ($1, $2, $3)`, ws, teamID, id); err != nil {
			return nil, nil, err
		}
	}
	if len(removed) > 0 {
		if _, err := tx.ExecContext(ctx, `DELETE FROM team_members WHERE workspace_id = $1 AND team_id = $2
			AND user_id = ANY(string_to_array($3, ','))`, ws, teamID, strings.Join(removed, ",")); err != nil {
			return nil, nil, err
		}
	}
	return added, removed, nil
}

// CreateTeam adds a team (managers and up).
func (sv *Service) CreateTeam(ctx context.Context, in TeamInput) (*Team, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := require(s, authz.TeamsWrite); err != nil {
		return nil, err
	}
	name, _ := trimmed(in.Name)
	if name == "" {
		return nil, invalid("a team needs a name")
	}
	if err := quota(ctx, s, limits.Teams, 1); err != nil {
		return nil, err
	}
	color, err := pickColor(in.Color, "teal")
	if err != nil {
		return nil, err
	}
	desc, _ := trimmed(in.Description)
	var members []string
	if in.MemberIDs != nil {
		members = dedupe(*in.MemberIDs)
	}
	if err := activeMembers(ctx, sv.DB, s.WorkspaceID, members); err != nil {
		return nil, err
	}
	var id string
	err = sv.tx(ctx, func(tx *sql.Tx) error {
		if err := tx.QueryRowContext(ctx, `INSERT INTO teams (workspace_id, name, description, color) VALUES ($1, $2, $3, $4) RETURNING id`,
			s.WorkspaceID, name, nullIfEmpty(desc), color).Scan(&id); err != nil {
			return err
		}
		if _, _, err := setTeamMembers(ctx, tx, s.WorkspaceID, id, members); err != nil {
			return err
		}
		return record(ctx, tx, s, entry{Action: "team.created", SubjectType: "team", SubjectID: id,
			Changes: map[string]any{"name": name, "members": len(members)}})
	})
	if err != nil {
		if e, ok := AsError(err); ok && e.Status == 409 {
			return nil, conflict("a team with that name already exists")
		}
		return nil, err
	}
	return loadTeam(ctx, sv.DB, s.WorkspaceID, id)
}

// UpdateTeam patches a team; MemberIDs replaces its membership.
func (sv *Service) UpdateTeam(ctx context.Context, id string, in TeamInput) (*Team, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := require(s, authz.TeamsWrite); err != nil {
		return nil, err
	}
	t, err := loadTeam(ctx, sv.DB, s.WorkspaceID, id)
	if err != nil {
		return nil, err
	}
	p := newPatch()
	if v, ok := trimmed(in.Name); ok {
		if v == "" {
			return nil, invalid("a team needs a name")
		}
		p.set("name", v)
	}
	if v, ok := trimmed(in.Description); ok {
		p.set("description", nullIfEmpty(v))
	}
	if in.Color != nil {
		c, err := pickColor(in.Color, t.Color)
		if err != nil {
			return nil, err
		}
		p.set("color", c)
	}
	var members []string
	if in.MemberIDs != nil {
		members = dedupe(*in.MemberIDs)
		if err := activeMembers(ctx, sv.DB, s.WorkspaceID, members); err != nil {
			return nil, err
		}
	}
	err = sv.tx(ctx, func(tx *sql.Tx) error {
		if !p.empty() {
			if err := p.update(ctx, tx, "teams", s.WorkspaceID, t.ID); err != nil {
				return err
			}
		}
		if in.MemberIDs != nil {
			added, removed, err := setTeamMembers(ctx, tx, s.WorkspaceID, t.ID, members)
			if err != nil {
				return err
			}
			if len(added) > 0 {
				p.changes["members_added"] = added
			}
			if len(removed) > 0 {
				p.changes["members_removed"] = removed
			}
		}
		if len(p.changes) == 0 {
			return nil
		}
		p.changes["name"] = firstString(p.changes["name"], t.Name)
		return record(ctx, tx, s, entry{Action: "team.updated", SubjectType: "team", SubjectID: t.ID, Changes: p.changes})
	})
	if err != nil {
		if e, ok := AsError(err); ok && e.Status == 409 {
			return nil, conflict("a team with that name already exists")
		}
		return nil, err
	}
	return loadTeam(ctx, sv.DB, s.WorkspaceID, t.ID)
}

// DeleteTeam removes a team; projects it was attached to lose that access path.
func (sv *Service) DeleteTeam(ctx context.Context, id string) error {
	s, err := caller(ctx)
	if err != nil {
		return err
	}
	if err := require(s, authz.TeamsWrite); err != nil {
		return err
	}
	t, err := loadTeam(ctx, sv.DB, s.WorkspaceID, id)
	if err != nil {
		return err
	}
	return sv.tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `DELETE FROM teams WHERE workspace_id = $1 AND id = $2`, s.WorkspaceID, t.ID); err != nil {
			return err
		}
		return record(ctx, tx, s, entry{Action: "team.deleted", SubjectType: "team", SubjectID: t.ID, Changes: map[string]any{"name": t.Name}})
	})
}
