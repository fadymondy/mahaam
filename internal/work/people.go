package work

import (
	"context"
	"sort"

	"github.com/fadymondy/mahaam/internal/authz"
)

// Person is one entry of the caller's people directory: a user on a project they can see.
type Person struct {
	UserID   string `json:"user_id"`
	Name     string `json:"name"`
	Initials string `json:"initials"`
}

// PeopleList is GET /api/w/people.
type PeopleList struct {
	People []Person `json:"people"`
}

/*
People is the directory of a caller who cannot list the workspace's members (a customer,
MH-1176): who is on the projects they can see — direct members, members of attached teams,
anyone assigned a task there, and the contacts of the same client — plus themselves. It is
what the project page uses to show names and to assign. Customer-facing names, never the
member list, roles or anyone outside those projects.
*/
func (sv *Service) People(ctx context.Context) (*PeopleList, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := require(s, authz.ProjectsRead); err != nil {
		return nil, err
	}
	args := []any{s.WorkspaceID}
	clause := visibleClause(s, &args)
	rows, err := sv.DB.QueryContext(ctx, `WITH vis AS (SELECT p.id, p.client_id FROM projects p WHERE p.workspace_id = $1 AND `+clause+`)
		SELECT DISTINCT u.user_id FROM (
			SELECT pm.user_id FROM project_members pm WHERE pm.workspace_id = $1 AND pm.project_id IN (SELECT id FROM vis)
			UNION SELECT tm.user_id FROM project_teams pt JOIN team_members tm
				ON tm.workspace_id = pt.workspace_id AND tm.team_id = pt.team_id
				WHERE pt.workspace_id = $1 AND pt.project_id IN (SELECT id FROM vis)
			UNION SELECT ta.user_id FROM task_assignees ta JOIN tasks t ON t.workspace_id = ta.workspace_id AND t.id = ta.task_id
				WHERE ta.workspace_id = $1 AND t.project_id IN (SELECT id FROM vis)
			UNION SELECT cc.user_id FROM client_contacts cc
				WHERE cc.workspace_id = $1 AND cc.client_id IN (SELECT client_id FROM vis WHERE client_id IS NOT NULL)
		) u JOIN workspace_members wm ON wm.workspace_id = $1 AND wm.user_id = u.user_id AND wm.status = 'active'`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := []string{s.UserID}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	names := sv.people(ctx, ids)
	out := &PeopleList{People: []Person{}}
	for _, id := range dedupe(ids) {
		if p, ok := names[id]; ok {
			out.People = append(out.People, Person{UserID: id, Name: p.Name, Initials: p.Initials})
		}
	}
	sort.Slice(out.People, func(i, j int) bool { return out.People[i].Name < out.People[j].Name })
	return out, nil
}
