package work

import (
	"context"
	"net/http"
	"time"
)

/*
GET /api/w/widgets/projects (MH-355): what a home-screen widget draws, in one small request.

Widgets reload on a timeline or after the silent push the server sends when progress changes
(internal/push/live_activity.go). Either way they have a few seconds of background time and a tight
memory budget, so this is the lean shape: progress per project, most recently changed first,
capped, and the caller's running timer. The same access rules as the projects list apply (it
calls ListProjects).
*/

// WidgetProject is one row of the project status widget.
type WidgetProject struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Color      string `json:"color"`
	TasksTotal int    `json:"tasks_total"`
	TasksDone  int    `json:"tasks_done"`
}

// WidgetTimer is the running timer, as the timer widget and the Live Activity draw it.
type WidgetTimer struct {
	StartedAt time.Time `json:"started_at"`
	Label     string    `json:"label"`
	Project   string    `json:"project"`
	Key       string    `json:"key"`
}

// Widgets is the body of GET /api/w/widgets/projects.
type Widgets struct {
	Projects []WidgetProject `json:"projects"`
	Timer    *WidgetTimer    `json:"timer" doc:"null when no timer runs"`
}

// widgetLimit caps the list: a large widget shows six rows.
const widgetLimit = 12

func (r routes) widgets() {
	do(r, http.MethodGet, "/api/w/widgets/projects", "w-widgets-projects", "Project progress and the running timer, for home-screen widgets", "Widgets", 0,
		func(ctx context.Context, in *struct{ WS }) (*Widgets, error) {
			list, err := r.sv.ListProjects(ctx, ProjectFilter{})
			if err != nil {
				return nil, r.fail(err)
			}
			out := &Widgets{Projects: []WidgetProject{}}
			for i, p := range list {
				if i == widgetLimit {
					break
				}
				out.Projects = append(out.Projects, WidgetProject{ID: p.ID, Name: p.Name, Color: p.Color,
					TasksTotal: p.Tasks.Todo + p.Tasks.Doing + p.Tasks.Done, TasksDone: p.Tasks.Done})
			}
			if e, err := r.sv.RunningTimer(ctx, ""); err == nil && e != nil {
				t := &WidgetTimer{StartedAt: e.StartedAt, Label: e.Description, Project: sval(e.ProjectName), Key: sval(e.TaskKey)}
				if t.Label == "" {
					t.Label = sval(e.TaskTitle)
				}
				out.Timer = t
			}
			return out, nil
		})
}
