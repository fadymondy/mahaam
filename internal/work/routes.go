package work

import (
	"context"
	"io"
	"net/http"
	"net/url"

	"github.com/danielgtaylor/huma/v2"

	"github.com/fadymondy/mahaam/internal/app"
)

/*
Register mounts the P1 REST surface. Every path is under /api/w/, so the guard puts it in the
workspace tier (session + membership of X-Workspace-ID, 404 otherwise) and generatedAuthz
passes it through to the checks in this package. `a` may be nil (OpenAPI export).

Every type embedded in an input struct (WS, TaskRef, …) is EXPORTED on purpose: Huma v2.27
silently skips fields promoted through an UNEXPORTED embedded struct — no registration error,
no 422, the handler just gets "" (here: "not found"). internal/server/params_test.go fails the
build if any operation loses a path parameter.
*/
func Register(api huma.API, a *app.App) {
	sv := New(a)
	r := routes{api: api, sv: sv}
	r.clients()
	r.teams()
	r.projects()
	r.tasks()
	r.labels()
	r.activity()
	r.time()          // P2: timer, entries, timesheets, settings, rates
	r.notifications() // P2: the in-app inbox
	r.reports()       // P5: reports, exports, budgets, saved views, notification settings
	r.invoices()      // P6: invoices from unbilled time, status, payments, export, print
	r.portal()        // P7: feedback-widget keys, client-portal contact links, client invoice view
	r.vault()         // project vault: secrets + memory
	r.access()        // label / task access grants, project labels
	r.clientImport()  // customer import (CSV/XLSX/vCard/Google/WhatsApp) + the project report document
	r.billing()       // AI usage + project subscriptions (billed on invoices)
	r.kpi()           // employee KPI, manager reviews, per-user GitHub accounts
	r.catalogue()     // per-project agents and skills
	r.monitorKeys()   // per-project backend error-monitoring DSN keys
	r.sync()          // delta sync for offline clients: rows + tombstones since a cursor
	r.widgets()       // MH-355: project progress + the running timer, for home-screen widgets
	r.viewAs()        // MH-1159: owners/admins view the workspace as a member (read-only)
}

type routes struct {
	api huma.API
	sv  *Service
}

// Resp is the output wrapper for a JSON body.
type Resp[T any] struct{ Body T }

type WS struct {
	WorkspaceID string `header:"X-Workspace-ID" doc:"Workspace id or slug. Non-members get 404."`
}

// Path references, embedded next to WS. Exported so Huma binds them (see above).
type (
	ClientRef struct {
		Client string `path:"client" doc:"Client id or exact name"`
	}
	TeamRef struct {
		Team string `path:"team"`
	}
	ProjectRef struct {
		Project string `path:"project"`
	}
	TaskRef struct {
		Task string `path:"task" doc:"MG-12, 12 or the task id"`
	}
	StatusRef struct {
		Status string `path:"status"`
	}
	LabelRef struct {
		Label string `path:"label"`
	}
	ItemRef struct {
		Item string `path:"item"`
	}
	CommentRef struct {
		Comment string `path:"comment"`
	}
	FileRef struct {
		Attachment string `path:"attachment"`
	}
	UserRef struct {
		User string `path:"user"`
	}
)

func (r routes) fail(err error) error {
	if e, ok := AsError(err); ok {
		return huma.NewError(e.Status, e.Msg)
	}
	if r.sv.Log != nil {
		r.sv.Log.Error("work", "err", err)
	}
	return huma.Error500InternalServerError("something went wrong")
}

func do[I, O any](r routes, method, path, id, summary, tag string, status int, h func(context.Context, *I) (O, error)) {
	huma.Register(r.api, huma.Operation{
		OperationID: id, Method: method, Path: path, Summary: summary, Tags: []string{tag}, DefaultStatus: status,
	}, func(ctx context.Context, in *I) (*Resp[O], error) {
		out, err := h(ctx, in)
		if err != nil {
			return nil, r.fail(err)
		}
		return &Resp[O]{Body: out}, nil
	})
}

func none[I any](r routes, method, path, id, summary, tag string, h func(context.Context, *I) error) {
	huma.Register(r.api, huma.Operation{
		OperationID: id, Method: method, Path: path, Summary: summary, Tags: []string{tag}, DefaultStatus: http.StatusNoContent,
	}, func(ctx context.Context, in *I) (*struct{}, error) {
		if err := h(ctx, in); err != nil {
			return nil, r.fail(err)
		}
		return &struct{}{}, nil
	})
}

// ---- clients ---------------------------------------------------------------------

// ClientList is the body of GET /api/w/clients.
type ClientList struct {
	Clients []Client `json:"clients"`
}

func (r routes) clients() {
	const tag = "Clients"
	do(r, http.MethodGet, "/api/w/clients", "w-list-clients", "Clients", tag, 0, func(ctx context.Context, in *struct {
		WS
		Archived bool `query:"archived" doc:"Include archived clients"`
	}) (ClientList, error) {
		list, err := r.sv.ListClients(ctx, in.Archived)
		return ClientList{Clients: list}, err
	})
	do(r, http.MethodPost, "/api/w/clients", "w-create-client", "Create a client", tag, http.StatusCreated, func(ctx context.Context, in *struct {
		WS
		Body ClientInput
	}) (*Client, error) {
		return r.sv.CreateClient(ctx, in.Body)
	})
	do(r, http.MethodGet, "/api/w/clients/{client}", "w-get-client", "One client", tag, 0, func(ctx context.Context, in *struct {
		WS
		ClientRef
	}) (*Client, error) {
		return r.sv.GetClient(ctx, in.Client)
	})
	do(r, http.MethodPatch, "/api/w/clients/{client}", "w-update-client", "Change a client", tag, 0, func(ctx context.Context, in *struct {
		WS
		ClientRef
		Body ClientInput
	}) (*Client, error) {
		return r.sv.UpdateClient(ctx, in.Client, in.Body)
	})
	do(r, http.MethodPost, "/api/w/clients/{client}/archive", "w-archive-client", "Archive a client", tag, 0, func(ctx context.Context, in *struct {
		WS
		ClientRef
	}) (*Client, error) {
		return r.sv.SetClientArchived(ctx, in.Client, true)
	})
	do(r, http.MethodPost, "/api/w/clients/{client}/restore", "w-restore-client", "Restore an archived client", tag, 0, func(ctx context.Context, in *struct {
		WS
		ClientRef
	}) (*Client, error) {
		return r.sv.SetClientArchived(ctx, in.Client, false)
	})
}

// ---- teams -------------------------------------------------------------------------

// TeamList is the body of GET /api/w/teams.
type TeamList struct {
	Teams []Team `json:"teams"`
}

func (r routes) teams() {
	const tag = "Teams"
	do(r, http.MethodGet, "/api/w/teams", "w-list-teams", "Teams", tag, 0, func(ctx context.Context, _ *WS) (TeamList, error) {
		list, err := r.sv.ListTeams(ctx)
		return TeamList{Teams: list}, err
	})
	do(r, http.MethodPost, "/api/w/teams", "w-create-team", "Create a team", tag, http.StatusCreated, func(ctx context.Context, in *struct {
		WS
		Body TeamInput
	}) (*Team, error) {
		return r.sv.CreateTeam(ctx, in.Body)
	})
	do(r, http.MethodPatch, "/api/w/teams/{team}", "w-update-team", "Change a team (member_ids replaces its members)", tag, 0, func(ctx context.Context, in *struct {
		WS
		TeamRef
		Body TeamInput
	}) (*Team, error) {
		return r.sv.UpdateTeam(ctx, in.Team, in.Body)
	})
	none(r, http.MethodDelete, "/api/w/teams/{team}", "w-delete-team", "Delete a team", tag, func(ctx context.Context, in *struct {
		WS
		TeamRef
	}) error {
		return r.sv.DeleteTeam(ctx, in.Team)
	})
}

// ---- projects ------------------------------------------------------------------------

// ProjectList is the body of GET /api/w/projects.
type ProjectList struct {
	Projects []Project `json:"projects"`
}

func (r routes) projects() {
	const tag = "Projects"
	do(r, http.MethodGet, "/api/w/projects", "w-list-projects", "Projects I can see", tag, 0, func(ctx context.Context, in *struct {
		WS
		Archived bool   `query:"archived" doc:"Archived projects instead of active ones"`
		Status   string `query:"status" enum:"planned,active,on_hold,completed,cancelled,"`
		Client   string `query:"client"`
		Q        string `query:"q"`
	}) (ProjectList, error) {
		list, err := r.sv.ListProjects(ctx, ProjectFilter{Archived: in.Archived, Status: in.Status, ClientID: in.Client, Q: in.Q})
		return ProjectList{Projects: list}, err
	})
	do(r, http.MethodPost, "/api/w/projects", "w-create-project", "Create a project (default statuses; you become its lead)", tag, http.StatusCreated, func(ctx context.Context, in *struct {
		WS
		Body ProjectInput
	}) (*ProjectDetail, error) {
		return r.sv.CreateProject(ctx, in.Body)
	})
	do(r, http.MethodGet, "/api/w/projects/{project}", "w-get-project", "One project with members, teams and statuses", tag, 0, func(ctx context.Context, in *struct {
		WS
		ProjectRef
	}) (*ProjectDetail, error) {
		return r.sv.GetProject(ctx, in.Project)
	})
	do(r, http.MethodPatch, "/api/w/projects/{project}", "w-update-project", "Change a project", tag, 0, func(ctx context.Context, in *struct {
		WS
		ProjectRef
		Body ProjectInput
	}) (*ProjectDetail, error) {
		return r.sv.UpdateProject(ctx, in.Project, in.Body)
	})
	do(r, http.MethodPost, "/api/w/projects/{project}/archive", "w-archive-project", "Archive a project (read-only afterwards)", tag, 0, func(ctx context.Context, in *struct {
		WS
		ProjectRef
	}) (*ProjectDetail, error) {
		return r.sv.SetProjectArchived(ctx, in.Project, true)
	})
	do(r, http.MethodPost, "/api/w/projects/{project}/restore", "w-restore-project", "Restore an archived project", tag, 0, func(ctx context.Context, in *struct {
		WS
		ProjectRef
	}) (*ProjectDetail, error) {
		return r.sv.SetProjectArchived(ctx, in.Project, false)
	})
	do(r, http.MethodPut, "/api/w/projects/{project}/members/{user}", "w-put-project-member", "Add a member to a project (or change their role)", tag, 0, func(ctx context.Context, in *struct {
		WS
		ProjectRef
		UserRef
		Body struct {
			Role string `json:"role,omitempty" enum:"lead,member," doc:"Default member"`
		}
	}) (*ProjectDetail, error) {
		return r.sv.AddProjectMember(ctx, in.Project, in.User, in.Body.Role)
	})
	do(r, http.MethodDelete, "/api/w/projects/{project}/members/{user}", "w-delete-project-member", "Remove a member from a project", tag, 0, func(ctx context.Context, in *struct {
		WS
		ProjectRef
		UserRef
	}) (*ProjectDetail, error) {
		return r.sv.RemoveProjectMember(ctx, in.Project, in.User)
	})
	do(r, http.MethodPut, "/api/w/projects/{project}/teams/{team}", "w-put-project-team", "Attach a team to a project", tag, 0, func(ctx context.Context, in *struct {
		WS
		ProjectRef
		TeamRef
	}) (*ProjectDetail, error) {
		return r.sv.AttachTeam(ctx, in.Project, in.Team)
	})
	do(r, http.MethodDelete, "/api/w/projects/{project}/teams/{team}", "w-delete-project-team", "Detach a team from a project", tag, 0, func(ctx context.Context, in *struct {
		WS
		ProjectRef
		TeamRef
	}) (*ProjectDetail, error) {
		return r.sv.DetachTeam(ctx, in.Project, in.Team)
	})
	do(r, http.MethodGet, "/api/w/projects/{project}/board", "w-project-board", "A project's statuses and tasks in board order", tag, 0, func(ctx context.Context, in *struct {
		WS
		ProjectRef
	}) (*Board, error) {
		return r.sv.ProjectBoard(ctx, in.Project)
	})
	do(r, http.MethodPost, "/api/w/projects/{project}/statuses", "w-create-status", "Add a status column", tag, http.StatusCreated, func(ctx context.Context, in *struct {
		WS
		ProjectRef
		Body StatusInput
	}) (*Status, error) {
		return r.sv.CreateStatus(ctx, in.Project, in.Body)
	})
	do(r, http.MethodPatch, "/api/w/statuses/{status}", "w-update-status", "Rename, recolour, re-categorise or reorder a status", tag, 0, func(ctx context.Context, in *struct {
		WS
		StatusRef
		Body StatusInput
	}) (*Status, error) {
		return r.sv.UpdateStatus(ctx, in.Status, in.Body)
	})
	none(r, http.MethodDelete, "/api/w/statuses/{status}", "w-delete-status", "Delete a status (its tasks move to move_to)", tag, func(ctx context.Context, in *struct {
		WS
		StatusRef
		MoveTo string `query:"move_to" doc:"Status to move this status's tasks to (required when it has any)"`
	}) error {
		return r.sv.DeleteStatus(ctx, in.Status, in.MoveTo)
	})
	do(r, http.MethodPost, "/api/w/projects/{project}/tasks", "w-create-task", "Create a task", "Tasks", http.StatusCreated, func(ctx context.Context, in *struct {
		WS
		ProjectRef
		Body TaskInput
	}) (*TaskDetail, error) {
		return r.sv.CreateTask(ctx, in.Project, in.Body)
	})
}

// ---- tasks -------------------------------------------------------------------------------

// TaskList is the body of GET /api/w/tasks.
type TaskList struct {
	Tasks []Task `json:"tasks"`
}

// CommentList is the body of GET /api/w/tasks/{task}/comments.
type CommentList struct {
	Comments []Comment `json:"comments"`
}

// AttachmentList is the body of GET /api/w/tasks/{task}/attachments.
type AttachmentList struct {
	Attachments []Attachment `json:"attachments"`
}

type fileOut struct {
	ContentType string `header:"Content-Type"`
	Disposition string `header:"Content-Disposition"`
	NoSniff     string `header:"X-Content-Type-Options"`
	CSP         string `header:"Content-Security-Policy"`
	Body        []byte
}

type Limited struct {
	Limit int `query:"limit" minimum:"0" maximum:"200"`
}

func (r routes) tasks() {
	const tag = "Tasks"
	do(r, http.MethodGet, "/api/w/tasks", "w-list-tasks", "Tasks across the projects I can see", tag, 0, func(ctx context.Context, in *struct {
		WS
		Project  string `query:"project"`
		Status   string `query:"status"`
		Category string `query:"category" enum:"todo,doing,done,"`
		Assignee string `query:"assignee"`
		Label    string `query:"label"`
		Q        string `query:"q"`
		Limit    int    `query:"limit" minimum:"0" maximum:"2000"`
	}) (TaskList, error) {
		list, err := r.sv.ListTasks(ctx, TaskFilter{ProjectID: in.Project, StatusID: in.Status, Category: in.Category,
			AssigneeID: in.Assignee, LabelID: in.Label, Q: in.Q, Limit: in.Limit})
		return TaskList{Tasks: list}, err
	})
	do(r, http.MethodGet, "/api/w/overview", "w-overview", "Home dashboard aggregates: overdue, completed, tasks needing attention, project members", tag, 0, func(ctx context.Context, _ *WS) (*Overview, error) {
		return r.sv.Overview(ctx)
	})
	do(r, http.MethodGet, "/api/w/tasks/{task}", "w-get-task", "One task in full", tag, 0, func(ctx context.Context, in *struct {
		WS
		TaskRef
	}) (*TaskDetail, error) {
		return r.sv.GetTask(ctx, in.Task)
	})
	do(r, http.MethodPatch, "/api/w/tasks/{task}", "w-update-task", "Change a task", tag, 0, func(ctx context.Context, in *struct {
		WS
		TaskRef
		Body TaskInput
	}) (*TaskDetail, error) {
		return r.sv.UpdateTask(ctx, in.Task, in.Body)
	})
	none(r, http.MethodDelete, "/api/w/tasks/{task}", "w-delete-task", "Delete a task", tag, func(ctx context.Context, in *struct {
		WS
		TaskRef
	}) error {
		return r.sv.DeleteTask(ctx, in.Task)
	})
	do(r, http.MethodPost, "/api/w/tasks/{task}/move", "w-move-task", "Move a task to a status at a position (persists board order)", tag, 0, func(ctx context.Context, in *struct {
		WS
		TaskRef
		Body struct {
			Status string `json:"status" doc:"Status id or name"`
			Index  *int   `json:"index,omitempty" minimum:"0" doc:"0-based position in the column; omitted = the end"`
		}
	}) (*TaskDetail, error) {
		return r.sv.MoveTask(ctx, in.Task, in.Body.Status, in.Body.Index)
	})
	do(r, http.MethodPut, "/api/w/tasks/{task}/assignees", "w-set-assignees", "Replace a task's assignees", tag, 0, func(ctx context.Context, in *struct {
		WS
		TaskRef
		Body struct {
			UserIDs []string `json:"user_ids"`
		}
	}) (*TaskDetail, error) {
		return r.sv.SetAssignees(ctx, in.Task, in.Body.UserIDs)
	})
	do(r, http.MethodPut, "/api/w/tasks/{task}/labels", "w-set-labels", "Replace a task's labels", tag, 0, func(ctx context.Context, in *struct {
		WS
		TaskRef
		Body struct {
			LabelIDs []string `json:"label_ids"`
		}
	}) (*TaskDetail, error) {
		return r.sv.SetLabels(ctx, in.Task, in.Body.LabelIDs)
	})
	do(r, http.MethodPost, "/api/w/tasks/{task}/checklist", "w-add-checklist-item", "Add a checklist item", tag, http.StatusCreated, func(ctx context.Context, in *struct {
		WS
		TaskRef
		Body struct {
			Title string `json:"title" minLength:"1" maxLength:"500"`
		}
	}) (*ChecklistItem, error) {
		return r.sv.AddChecklistItem(ctx, in.Task, in.Body.Title)
	})
	do(r, http.MethodPatch, "/api/w/checklist/{item}", "w-update-checklist-item", "Rename or tick a checklist item", tag, 0, func(ctx context.Context, in *struct {
		WS
		ItemRef
		Body struct {
			Title *string `json:"title,omitempty" maxLength:"500"`
			Done  *bool   `json:"done,omitempty"`
		}
	}) (*ChecklistItem, error) {
		return r.sv.UpdateChecklistItem(ctx, in.Item, in.Body.Title, in.Body.Done)
	})
	none(r, http.MethodDelete, "/api/w/checklist/{item}", "w-delete-checklist-item", "Remove a checklist item", tag, func(ctx context.Context, in *struct {
		WS
		ItemRef
	}) error {
		return r.sv.DeleteChecklistItem(ctx, in.Item)
	})

	do(r, http.MethodGet, "/api/w/tasks/{task}/comments", "w-list-comments", "A task's comments, oldest first", tag, 0, func(ctx context.Context, in *struct {
		WS
		TaskRef
	}) (CommentList, error) {
		list, err := r.sv.ListComments(ctx, in.Task)
		return CommentList{Comments: list}, err
	})
	do(r, http.MethodPost, "/api/w/tasks/{task}/comments", "w-add-comment", "Comment on a task (@handle mentions a member)", tag, http.StatusCreated, func(ctx context.Context, in *struct {
		WS
		TaskRef
		Body struct {
			Body string `json:"body" minLength:"1" maxLength:"10000"`
		}
	}) (*Comment, error) {
		return r.sv.AddComment(ctx, in.Task, in.Body.Body)
	})
	do(r, http.MethodPatch, "/api/w/comments/{comment}", "w-edit-comment", "Edit your comment", tag, 0, func(ctx context.Context, in *struct {
		WS
		CommentRef
		Body struct {
			Body string `json:"body" minLength:"1" maxLength:"10000"`
		}
	}) (*Comment, error) {
		return r.sv.EditComment(ctx, in.Comment, in.Body.Body)
	})
	none(r, http.MethodDelete, "/api/w/comments/{comment}", "w-delete-comment", "Delete your comment (managers: any)", tag, func(ctx context.Context, in *struct {
		WS
		CommentRef
	}) error {
		return r.sv.DeleteComment(ctx, in.Comment)
	})

	do(r, http.MethodGet, "/api/w/tasks/{task}/attachments", "w-list-attachments", "A task's files", tag, 0, func(ctx context.Context, in *struct {
		WS
		TaskRef
	}) (AttachmentList, error) {
		list, err := r.sv.ListAttachments(ctx, in.Task)
		return AttachmentList{Attachments: list}, err
	})
	huma.Register(r.api, huma.Operation{
		OperationID: "w-add-attachment", Method: http.MethodPost, Path: "/api/w/tasks/{task}/attachments",
		Summary: "Attach a file to a task (multipart field \"file\", up to 25 MB)", Tags: []string{tag},
		DefaultStatus: http.StatusCreated, MaxBodyBytes: MaxAttachment + 1<<20,
	}, func(ctx context.Context, in *struct {
		WS
		TaskRef
		RawBody huma.MultipartFormFiles[struct {
			File huma.FormFile `form:"file" required:"true"`
		}]
	}) (*Resp[*Attachment], error) {
		if in.RawBody.Form == nil || len(in.RawBody.Form.File["file"]) == 0 {
			return nil, huma.Error422UnprocessableEntity("send the file in the multipart field \"file\"")
		}
		fh := in.RawBody.Form.File["file"][0]
		f, err := fh.Open()
		if err != nil {
			return nil, huma.Error400BadRequest("could not read the upload")
		}
		defer f.Close()
		data, err := io.ReadAll(io.LimitReader(f, MaxAttachment+1))
		if err != nil {
			return nil, huma.Error400BadRequest("could not read the upload")
		}
		a, err := r.sv.AddAttachment(ctx, in.Task, fh.Filename, fh.Header.Get("Content-Type"), data)
		if err != nil {
			return nil, r.fail(err)
		}
		return &Resp[*Attachment]{Body: a}, nil
	})
	huma.Register(r.api, huma.Operation{
		OperationID: "w-download-attachment", Method: http.MethodGet, Path: "/api/w/attachments/{attachment}",
		Summary: "Download a file (always as an attachment, never rendered inline)", Tags: []string{tag},
	}, func(ctx context.Context, in *struct {
		WS
		FileRef
	}) (*fileOut, error) {
		a, data, err := r.sv.OpenAttachment(ctx, in.Attachment)
		if err != nil {
			return nil, r.fail(err)
		}
		return &fileOut{
			ContentType: a.ContentType,
			Disposition: "attachment; filename*=UTF-8''" + url.PathEscape(a.FileName),
			NoSniff:     "nosniff",
			CSP:         "default-src 'none'; sandbox",
			Body:        data,
		}, nil
	})
	none(r, http.MethodDelete, "/api/w/attachments/{attachment}", "w-delete-attachment", "Remove a file", tag, func(ctx context.Context, in *struct {
		WS
		FileRef
	}) error {
		return r.sv.DeleteAttachment(ctx, in.Attachment)
	})
}

// ---- labels ---------------------------------------------------------------------------------

// LabelList is the body of GET /api/w/labels.
type LabelList struct {
	Labels []Label `json:"labels"`
}

func (r routes) labels() {
	const tag = "Labels"
	do(r, http.MethodGet, "/api/w/labels", "w-list-labels", "The workspace's labels", tag, 0, func(ctx context.Context, _ *WS) (LabelList, error) {
		list, err := r.sv.ListLabels(ctx)
		return LabelList{Labels: list}, err
	})
	do(r, http.MethodPost, "/api/w/labels", "w-create-label", "Create a label", tag, http.StatusCreated, func(ctx context.Context, in *struct {
		WS
		Body LabelInput
	}) (*Label, error) {
		return r.sv.CreateLabel(ctx, in.Body)
	})
	do(r, http.MethodPatch, "/api/w/labels/{label}", "w-update-label", "Rename or recolour a label", tag, 0, func(ctx context.Context, in *struct {
		WS
		LabelRef
		Body LabelInput
	}) (*Label, error) {
		return r.sv.UpdateLabel(ctx, in.Label, in.Body)
	})
	none(r, http.MethodDelete, "/api/w/labels/{label}", "w-delete-label", "Delete a label", tag, func(ctx context.Context, in *struct {
		WS
		LabelRef
	}) error {
		return r.sv.DeleteLabel(ctx, in.Label)
	})
}

// ---- activity ---------------------------------------------------------------------------------

// ActivityList is the body of the activity endpoints.
type ActivityList struct {
	Activity []Activity `json:"activity"`
}

func (r routes) activity() {
	const tag = "Activity"
	do(r, http.MethodGet, "/api/w/activity", "w-activity", "The workspace's activity (managers and up)", tag, 0, func(ctx context.Context, in *struct {
		WS
		Limited
	}) (ActivityList, error) {
		list, err := r.sv.WorkspaceActivity(ctx, in.Limit)
		return ActivityList{Activity: list}, err
	})
	do(r, http.MethodGet, "/api/w/projects/{project}/activity", "w-project-activity", "A project's activity", tag, 0, func(ctx context.Context, in *struct {
		WS
		ProjectRef
		Limited
	}) (ActivityList, error) {
		list, err := r.sv.ProjectActivity(ctx, in.Project, in.Limit)
		return ActivityList{Activity: list}, err
	})
	do(r, http.MethodGet, "/api/w/tasks/{task}/activity", "w-task-activity", "A task's activity", tag, 0, func(ctx context.Context, in *struct {
		WS
		TaskRef
		Limited
	}) (ActivityList, error) {
		list, err := r.sv.TaskActivity(ctx, in.Task, in.Limit)
		return ActivityList{Activity: list}, err
	})
}
