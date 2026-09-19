package work

import (
	"context"
	"database/sql"
	"errors"
	"sort"
	"strings"
	"time"

	"github.com/fadymondy/mahaam/internal/authz"
	"github.com/fadymondy/mahaam/internal/limits"
	"github.com/fadymondy/mahaam/internal/tenant"
	"github.com/fadymondy/mahaam/internal/workspaces"
)

/*
The employee KPI: raw facts about one member over a range of local days (workspace timezone),
from data Mahaam already has — nothing here is a judgement:

  - time        time_entries (ended entries, cut at local midnight): tracked / billable seconds,
                by project, by week, days tracked
  - tasks       task_assignees × tasks: completed in range (and how many after their due date),
                open assigned now, overdue now
  - issues      the agent issue loop, attributed through report_comments written as the agent
                by this member's MCP token (author_kind 'agent', author_id = the token's user):
                plans posted (started), handed to review, approvals requested, finished, agent
                seconds banked on those issues, @agent mentions answered
  - ai          ai_usage.user_id (who pushed it): tokens by model and project; cost only for
                callers who may read AI cost (ai_usage:read, manager+)
  - github      github_events whose author_login / author_email match the member's
                user_github_accounts row (attributed at query time, so a new mapping covers
                history): commits, pull requests (opened/updated, merged), deployments, runs
  - mcp         activity_logs by the member, and how many of those came via MCP (and from how
                many tokens)
  - reviews     member_reviews whose period overlaps the range: count, average rating, bodies

Access: kpi:read (member+) for your own; kpi:all (manager+) for anyone's and the team table;
kpi:review (manager+) to write reviews. Another workspace's user is a 404.
*/

// KPIQuery is the range. Default: the 1st of this month to today.
type KPIQuery struct {
	From string `json:"from,omitempty"`
	To   string `json:"to,omitempty"`
}

type KPIMember struct {
	UserID string `json:"user_id"`
	Email  string `json:"email"`
	Role   string `json:"role"`
}

type KPIKeyed struct {
	Key       string `json:"key" doc:"Project id, week start (YYYY-MM-DD), model, repo or action"`
	Name      string `json:"name"`
	Seconds   int64  `json:"seconds,omitempty"`
	Billable  int64  `json:"billable_s,omitempty"`
	Count     int64  `json:"count,omitempty"`
	Tokens    int64  `json:"tokens,omitempty"`
	CostMinor *int64 `json:"cost_minor,omitempty"`
	Commits   int64  `json:"commits,omitempty"`
	PRs       int64  `json:"pull_requests,omitempty"`
	Deploys   int64  `json:"deployments,omitempty"`
}

type KPITime struct {
	TrackedS    int64      `json:"tracked_s"`
	BillableS   int64      `json:"billable_s"`
	Entries     int        `json:"entries"`
	DaysTracked int        `json:"days_tracked"`
	ByProject   []KPIKeyed `json:"by_project"`
	ByWeek      []KPIKeyed `json:"by_week"`
}

type KPITaskRef struct {
	Key         string     `json:"key"`
	Title       string     `json:"title"`
	Project     string     `json:"project"`
	DueAt       *time.Time `json:"due_at"`
	CompletedAt *time.Time `json:"completed_at"`
}

type KPITasks struct {
	Completed     int          `json:"completed"`
	CompletedLate int          `json:"completed_late" doc:"Completed in range after their due date"`
	OpenAssigned  int          `json:"open_assigned" doc:"Assigned and not done, now"`
	Overdue       int          `json:"overdue" doc:"Open and past their due date, now"`
	CompletedList []KPITaskRef `json:"completed_list,omitempty"`
	OverdueList   []KPITaskRef `json:"overdue_list,omitempty"`
}

type KPIIssueRef struct {
	Key          string     `json:"key"`
	Title        string     `json:"title"`
	Status       string     `json:"status"`
	AgentSeconds int64      `json:"agent_seconds"`
	FinishedAt   *time.Time `json:"finished_at"`
}

type KPIIssues struct {
	Started          int           `json:"started" doc:"Plans posted (start_issue)"`
	Reviewed         int           `json:"reviewed" doc:"Handed to review (review_issue)"`
	Approvals        int           `json:"approvals_requested"`
	Finished         int           `json:"finished" doc:"Issues worked by the agent that were finished in range"`
	Worked           int           `json:"worked" doc:"Distinct issues with agent activity in range"`
	AgentSeconds     int64         `json:"agent_seconds" doc:"Agent time banked on the issues worked"`
	AgentComments    int           `json:"agent_comments"`
	MentionsAnswered int           `json:"mentions_answered"`
	List             []KPIIssueRef `json:"list,omitempty"`
}

type KPIAI struct {
	InputTokens  int64      `json:"input_tokens"`
	OutputTokens int64      `json:"output_tokens"`
	CacheTokens  int64      `json:"cache_tokens"`
	Requests     int64      `json:"requests"`
	CostMinor    *int64     `json:"cost_minor" doc:"Only for callers who may read AI cost (manager+)"`
	Currency     string     `json:"currency"`
	ByModel      []KPIKeyed `json:"by_model,omitempty"`
	ByProject    []KPIKeyed `json:"by_project,omitempty"`
}

type KPIGitEvent struct {
	Kind       string    `json:"kind"`
	Repo       string    `json:"repo"`
	Project    string    `json:"project"`
	Title      string    `json:"title"`
	Status     string    `json:"status"`
	URL        string    `json:"url"`
	OccurredAt time.Time `json:"occurred_at"`
}

type KPIGitHub struct {
	Connected    bool          `json:"connected" doc:"The member has a GitHub account mapped"`
	Login        string        `json:"login,omitempty"`
	Commits      int           `json:"commits"`
	PullRequests int           `json:"pull_requests" doc:"Pull requests opened or updated in range"`
	PRsMerged    int           `json:"prs_merged"`
	Deployments  int           `json:"deployments"`
	DeploysOK    int           `json:"deployments_succeeded"`
	WorkflowRuns int           `json:"workflow_runs"`
	ByProject    []KPIKeyed    `json:"by_project,omitempty"`
	ByRepo       []KPIKeyed    `json:"by_repo,omitempty"`
	Recent       []KPIGitEvent `json:"recent,omitempty"`
}

type KPIActivity struct {
	Actions    int        `json:"actions" doc:"Everything recorded in the activity feed as this member"`
	MCPActions int        `json:"mcp_actions" doc:"…of which via MCP (their agents)"`
	MCPTokens  int        `json:"mcp_tokens" doc:"Distinct MCP tokens used"`
	ByAction   []KPIKeyed `json:"by_action,omitempty" doc:"MCP actions by kind"`
}

// MemberReview is one manager review.
type MemberReview struct {
	ID          string    `json:"id"`
	UserID      string    `json:"user_id"`
	AuthorID    string    `json:"author_id"`
	AuthorEmail string    `json:"author_email"`
	PeriodStart string    `json:"period_start"`
	PeriodEnd   string    `json:"period_end"`
	Rating      *int      `json:"rating"`
	Body        string    `json:"body"`
	CreatedAt   time.Time `json:"created_at"`
}

type KPIReviews struct {
	Count     int            `json:"count"`
	AvgRating *float64       `json:"avg_rating"`
	Items     []MemberReview `json:"items,omitempty"`
}

// KPI is one member's dossier over a range.
type KPI struct {
	Member      KPIMember      `json:"member"`
	From        string         `json:"from"`
	To          string         `json:"to"`
	Timezone    string         `json:"timezone"`
	GitHub      *GitHubAccount `json:"github_account"`
	Time        KPITime        `json:"time"`
	Tasks       KPITasks       `json:"tasks"`
	Issues      KPIIssues      `json:"issues"`
	AI          KPIAI          `json:"ai"`
	Git         KPIGitHub      `json:"github"`
	Activity    KPIActivity    `json:"activity"`
	Reviews     KPIReviews     `json:"reviews"`
	Finance     bool           `json:"finance" doc:"AI cost is present"`
	GeneratedAt time.Time      `json:"generated_at"`
}

// TeamKPIRow is one member's headline numbers.
type TeamKPIRow struct {
	Member         KPIMember `json:"member"`
	GitHubLogin    string    `json:"github_login,omitempty"`
	TrackedS       int64     `json:"tracked_s"`
	BillableS      int64     `json:"billable_s"`
	DaysTracked    int       `json:"days_tracked"`
	TasksCompleted int       `json:"tasks_completed"`
	TasksOpen      int       `json:"tasks_open"`
	TasksOverdue   int       `json:"tasks_overdue"`
	IssuesFinished int       `json:"issues_finished"`
	AgentSeconds   int64     `json:"agent_seconds"`
	AITokens       int64     `json:"ai_tokens"`
	AICostMinor    *int64    `json:"ai_cost_minor"`
	Commits        int       `json:"commits"`
	PullRequests   int       `json:"pull_requests"`
	PRsMerged      int       `json:"prs_merged"`
	Deployments    int       `json:"deployments"`
	MCPActions     int       `json:"mcp_actions"`
	Reviews        int       `json:"reviews"`
	AvgRating      *float64  `json:"avg_rating"`
}

// TeamKPI is GET /api/w/kpi/team.
type TeamKPI struct {
	From     string       `json:"from"`
	To       string       `json:"to"`
	Timezone string       `json:"timezone"`
	Currency string       `json:"currency"`
	Finance  bool         `json:"finance"`
	Rows     []TeamKPIRow `json:"rows"`
}

// ---- range --------------------------------------------------------------------------------------

type kpiRange struct {
	conf       *timeConf
	start, end time.Time // local midnights, [start, end)
	from, to   string    // inclusive local dates
}

func (sv *Service) kpiRange(ctx context.Context, s *tenant.Scope, q KPIQuery) (*kpiRange, error) {
	if err := feature(ctx, s, limits.FeatureKPI); err != nil {
		return nil, err
	}
	conf, err := loadTimeConf(ctx, sv.DB, s.WorkspaceID)
	if err != nil {
		return nil, err
	}
	start, end, err := reportRange(q.From, q.To, conf, time.Now().UTC())
	if err != nil {
		return nil, err
	}
	return &kpiRange{conf: conf, start: start, end: end, from: start.Format("2006-01-02"), to: end.AddDate(0, 0, -1).Format("2006-01-02")}, nil
}

// ---- headline numbers for a set of users (one grouped query per source) ---------------------------

type kpiAgg struct {
	time    map[string]*KPITime
	tasks   map[string]*KPITasks
	issues  map[string]*KPIIssues
	ai      map[string]*KPIAI
	git     map[string]*KPIGitHub
	act     map[string]*KPIActivity
	reviews map[string]*KPIReviews
}

func getOr[T any](m map[string]*T, k string) *T {
	if v, ok := m[k]; ok {
		return v
	}
	v := new(T)
	m[k] = v
	return v
}

// kpiEntry is an ended time entry overlapping the range.
type kpiEntry struct {
	UserID, ProjectID, ProjectName string
	Start, End                     time.Time
	Billable                       bool
}

// cutDays splits [a, b) at local midnights: seconds per local date.
func cutDays(a, b time.Time, loc *time.Location) map[string]int64 {
	out := map[string]int64{}
	for a.Before(b) {
		l := a.In(loc)
		next := time.Date(l.Year(), l.Month(), l.Day()+1, 0, 0, 0, 0, loc)
		stop := b
		if next.Before(b) {
			stop = next
		}
		out[l.Format("2006-01-02")] += int64(stop.Sub(a) / time.Second)
		a = stop
	}
	return out
}

func (sv *Service) kpiTime(ctx context.Context, ws string, users []string, r *kpiRange, byProject bool) (map[string]*KPITime, error) {
	rows, err := sv.DB.QueryContext(ctx, `SELECT e.user_id, COALESCE(e.project_id, ''), COALESCE(p.name, ''), e.started_at, e.ended_at, e.billable
		FROM time_entries e LEFT JOIN projects p ON p.workspace_id = e.workspace_id AND p.id = e.project_id
		WHERE e.workspace_id = $1 AND e.user_id = ANY(string_to_array($2, ',')) AND e.ended_at IS NOT NULL
		  AND e.started_at < $4 AND e.ended_at > $3`, ws, strings.Join(users, ","), r.start, r.end)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	type acc struct {
		t       *KPITime
		days    map[string]bool
		project map[string]*KPIKeyed
		week    map[string]*KPIKeyed
	}
	accs := map[string]*acc{}
	for rows.Next() {
		var e kpiEntry
		if err := rows.Scan(&e.UserID, &e.ProjectID, &e.ProjectName, &e.Start, &e.End, &e.Billable); err != nil {
			return nil, err
		}
		a, ok := accs[e.UserID]
		if !ok {
			a = &acc{t: &KPITime{}, days: map[string]bool{}, project: map[string]*KPIKeyed{}, week: map[string]*KPIKeyed{}}
			accs[e.UserID] = a
		}
		start, end := e.Start, e.End
		if start.Before(r.start) {
			start = r.start
		}
		if end.After(r.end) {
			end = r.end
		}
		a.t.Entries++
		for day, secs := range cutDays(start, end, r.conf.Loc) {
			if secs <= 0 {
				continue
			}
			a.days[day] = true
			a.t.TrackedS += secs
			bill := int64(0)
			if e.Billable {
				bill = secs
			}
			a.t.BillableS += bill
			if byProject {
				p := a.project[e.ProjectID]
				if p == nil {
					p = &KPIKeyed{Key: e.ProjectID, Name: e.ProjectName}
					a.project[e.ProjectID] = p
				}
				p.Seconds += secs
				p.Billable += bill
				wk := weekOf(day, r.conf.WeekStart)
				w := a.week[wk]
				if w == nil {
					w = &KPIKeyed{Key: wk, Name: wk}
					a.week[wk] = w
				}
				w.Seconds += secs
				w.Billable += bill
			}
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := map[string]*KPITime{}
	for uid, a := range accs {
		a.t.DaysTracked = len(a.days)
		a.t.ByProject, a.t.ByWeek = []KPIKeyed{}, []KPIKeyed{}
		for _, p := range a.project {
			a.t.ByProject = append(a.t.ByProject, *p)
		}
		sort.Slice(a.t.ByProject, func(i, j int) bool { return a.t.ByProject[i].Seconds > a.t.ByProject[j].Seconds })
		for _, w := range a.week {
			a.t.ByWeek = append(a.t.ByWeek, *w)
		}
		sort.Slice(a.t.ByWeek, func(i, j int) bool { return a.t.ByWeek[i].Key < a.t.ByWeek[j].Key })
		out[uid] = a.t
	}
	return out, nil
}

func (sv *Service) kpiAggregate(ctx context.Context, s *tenant.Scope, users []string, r *kpiRange, detail bool) (*kpiAgg, error) {
	ws, list := s.WorkspaceID, strings.Join(users, ",")
	ag := &kpiAgg{tasks: map[string]*KPITasks{}, issues: map[string]*KPIIssues{}, ai: map[string]*KPIAI{},
		git: map[string]*KPIGitHub{}, act: map[string]*KPIActivity{}, reviews: map[string]*KPIReviews{}}
	var err error
	if ag.time, err = sv.kpiTime(ctx, ws, users, r, detail); err != nil {
		return nil, err
	}
	finance := authz.Can(s.Role, authz.AIUsageRead)

	each := func(q string, args []any, scan func(sc scanner) error) error {
		rows, err := sv.DB.QueryContext(ctx, q, args...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			if err := scan(rows); err != nil {
				return err
			}
		}
		return rows.Err()
	}
	args := []any{ws, list, r.start, r.end}

	// Tasks.
	if err := each(`SELECT a.user_id,
			count(*) FILTER (WHERE t.completed_at >= $3 AND t.completed_at < $4),
			count(*) FILTER (WHERE t.completed_at >= $3 AND t.completed_at < $4 AND t.due_at IS NOT NULL AND t.completed_at > t.due_at),
			count(*) FILTER (WHERE t.completed_at IS NULL),
			count(*) FILTER (WHERE t.completed_at IS NULL AND t.due_at < now())
		FROM task_assignees a JOIN tasks t ON t.workspace_id = a.workspace_id AND t.id = a.task_id
		WHERE a.workspace_id = $1 AND a.user_id = ANY(string_to_array($2, ','))
		GROUP BY a.user_id`, args, func(sc scanner) error {
		var u string
		var t KPITasks
		if err := sc.Scan(&u, &t.Completed, &t.CompletedLate, &t.OpenAssigned, &t.Overdue); err != nil {
			return err
		}
		ag.tasks[u] = &t
		return nil
	}); err != nil {
		return nil, err
	}

	// Issues: the agent's comments by this member's tokens.
	if err := each(`SELECT c.author_id,
			count(*) FILTER (WHERE c.body LIKE '**Plan**%'),
			count(*) FILTER (WHERE c.body LIKE '**Ready for review.**%'),
			count(*) FILTER (WHERE c.body LIKE '**Blocked — needs a decision.**%'),
			count(*),
			count(*) FILTER (WHERE EXISTS (
				SELECT 1 FROM report_comments m
				WHERE m.workspace_id = c.workspace_id AND m.report_id = c.report_id AND m.author_kind <> 'agent'
				  AND m.created_at < c.created_at
				  AND (m.body ILIKE '%@agent%' OR m.body ILIKE '%@claude%' OR m.body ILIKE '%@ai%')
				  AND NOT EXISTS (SELECT 1 FROM report_comments p WHERE p.workspace_id = c.workspace_id AND p.report_id = c.report_id
				      AND p.author_kind = 'agent' AND p.created_at > m.created_at AND p.created_at < c.created_at)))
		FROM report_comments c
		WHERE c.workspace_id = $1 AND c.author_kind = 'agent' AND c.author_id = ANY(string_to_array($2, ','))
		  AND c.created_at >= $3 AND c.created_at < $4
		GROUP BY c.author_id`, args, func(sc scanner) error {
		var u string
		i := &KPIIssues{}
		if err := sc.Scan(&u, &i.Started, &i.Reviewed, &i.Approvals, &i.AgentComments, &i.MentionsAnswered); err != nil {
			return err
		}
		ag.issues[u] = i
		return nil
	}); err != nil {
		return nil, err
	}
	const workedCTE = `WITH mine AS (
			SELECT c.author_id AS u, c.report_id, bool_or(c.created_at >= $3 AND c.created_at < $4) AS in_range
			FROM report_comments c
			WHERE c.workspace_id = $1 AND c.author_kind = 'agent' AND c.author_id = ANY(string_to_array($2, ','))
			GROUP BY 1, 2),
		worked AS (
			SELECT m.u, r.key, r.title, r.status, r.agent_seconds, r.finished_at,
			       (r.status = 'done' AND r.finished_at >= $3 AND r.finished_at < $4) AS finished
			FROM mine m JOIN reports r ON r.workspace_id = $1 AND r.id = m.report_id
			WHERE m.in_range OR (r.finished_at >= $3 AND r.finished_at < $4))`
	if err := each(workedCTE+` SELECT u, count(*), count(*) FILTER (WHERE finished), COALESCE(sum(agent_seconds), 0)::bigint FROM worked GROUP BY u`, args,
		func(sc scanner) error {
			var u string
			var worked, finished int
			var secs int64
			if err := sc.Scan(&u, &worked, &finished, &secs); err != nil {
				return err
			}
			i := getOr(ag.issues, u)
			i.Worked, i.Finished, i.AgentSeconds = worked, finished, secs
			return nil
		}); err != nil {
		return nil, err
	}

	// AI usage pushed by the member.
	dayArgs := []any{ws, list, r.from, r.to}
	if err := each(`SELECT user_id, sum(input_tokens), sum(output_tokens), sum(cache_read_tokens + cache_write_tokens), sum(requests),
			sum(cost_minor), min(currency)
		FROM ai_usage WHERE workspace_id = $1 AND user_id = ANY(string_to_array($2, ',')) AND day >= $3::date AND day <= $4::date
		GROUP BY user_id`, dayArgs, func(sc scanner) error {
		var u string
		a := &KPIAI{}
		var cost int64
		if err := sc.Scan(&u, &a.InputTokens, &a.OutputTokens, &a.CacheTokens, &a.Requests, &cost, &a.Currency); err != nil {
			return err
		}
		if finance {
			a.CostMinor = &cost
		}
		ag.ai[u] = a
		return nil
	}); err != nil {
		return nil, err
	}

	// GitHub, attributed by login / e-mail at query time.
	if err := each(`SELECT g.user_id, g.login,
			count(e.id) FILTER (WHERE e.kind = 'commit'),
			count(e.id) FILTER (WHERE e.kind = 'pull_request'),
			count(e.id) FILTER (WHERE e.kind = 'pull_request' AND e.status = 'merged'),
			count(e.id) FILTER (WHERE e.kind = 'deployment'),
			count(e.id) FILTER (WHERE e.kind = 'deployment' AND e.status = 'success'),
			count(e.id) FILTER (WHERE e.kind = 'workflow_run')
		FROM user_github_accounts g
		LEFT JOIN github_events e ON e.workspace_id = g.workspace_id AND e.occurred_at >= $3 AND e.occurred_at < $4
		     AND ((e.author_login <> '' AND lower(e.author_login) = lower(g.login))
		       OR (e.author_email <> '' AND lower(e.author_email) = ANY(g.emails)))
		WHERE g.workspace_id = $1 AND g.user_id = ANY(string_to_array($2, ','))
		GROUP BY g.user_id, g.login`, args, func(sc scanner) error {
		var u string
		g := &KPIGitHub{Connected: true}
		if err := sc.Scan(&u, &g.Login, &g.Commits, &g.PullRequests, &g.PRsMerged, &g.Deployments, &g.DeploysOK, &g.WorkflowRuns); err != nil {
			return err
		}
		ag.git[u] = g
		return nil
	}); err != nil {
		return nil, err
	}

	// Activity feed entries as the member, and via MCP.
	if err := each(`SELECT actor_id, count(*), count(*) FILTER (WHERE actor_via = 'mcp'),
			count(DISTINCT CASE WHEN actor_via = 'mcp' THEN changes::jsonb->>'mcp_token_id' END)
		FROM activity_logs WHERE workspace_id = $1 AND actor_id = ANY(string_to_array($2, ',')) AND created_at >= $3 AND created_at < $4
		GROUP BY actor_id`, args, func(sc scanner) error {
		var u string
		a := &KPIActivity{}
		if err := sc.Scan(&u, &a.Actions, &a.MCPActions, &a.MCPTokens); err != nil {
			return err
		}
		ag.act[u] = a
		return nil
	}); err != nil {
		return nil, err
	}

	// Reviews whose period overlaps the range.
	if err := each(`SELECT user_id, count(*), avg(rating)::float8
		FROM member_reviews WHERE workspace_id = $1 AND user_id = ANY(string_to_array($2, ','))
		  AND period_start <= $4::date AND period_end >= $3::date
		GROUP BY user_id`, dayArgs, func(sc scanner) error {
		var u string
		rv := &KPIReviews{}
		if err := sc.Scan(&u, &rv.Count, &rv.AvgRating); err != nil {
			return err
		}
		ag.reviews[u] = rv
		return nil
	}); err != nil {
		return nil, err
	}

	if !detail || len(users) != 1 {
		return ag, nil
	}
	uid := users[0]

	// ---- one member: the breakdowns ----
	tk := getOr(ag.tasks, uid)
	taskList := func(where string) ([]KPITaskRef, error) {
		out := []KPITaskRef{}
		err := each(`SELECT t.key, t.title, p.name, t.due_at, t.completed_at
			FROM task_assignees a JOIN tasks t ON t.workspace_id = a.workspace_id AND t.id = a.task_id
			JOIN projects p ON p.workspace_id = t.workspace_id AND p.id = t.project_id
			WHERE a.workspace_id = $1 AND a.user_id = $2 AND `+where+` LIMIT 50`, []any{ws, uid, r.start, r.end}, func(sc scanner) error {
			var t KPITaskRef
			if err := sc.Scan(&t.Key, &t.Title, &t.Project, &t.DueAt, &t.CompletedAt); err != nil {
				return err
			}
			out = append(out, t)
			return nil
		})
		return out, err
	}
	if tk.CompletedList, err = taskList(`t.completed_at >= $3 AND t.completed_at < $4 ORDER BY t.completed_at`); err != nil {
		return nil, err
	}
	if tk.OverdueList, err = taskList(`t.completed_at IS NULL AND t.due_at < now() AND $3::timestamptz IS NOT NULL AND $4::timestamptz IS NOT NULL ORDER BY t.due_at`); err != nil {
		return nil, err
	}

	is := getOr(ag.issues, uid)
	is.List = []KPIIssueRef{}
	if err := each(workedCTE+` SELECT key, title, status, agent_seconds, finished_at FROM worked ORDER BY finished_at NULLS LAST, key LIMIT 50`,
		[]any{ws, uid, r.start, r.end}, func(sc scanner) error {
			var i KPIIssueRef
			if err := sc.Scan(&i.Key, &i.Title, &i.Status, &i.AgentSeconds, &i.FinishedAt); err != nil {
				return err
			}
			is.List = append(is.List, i)
			return nil
		}); err != nil {
		return nil, err
	}

	ai := getOr(ag.ai, uid)
	aiBy := func(key, name string) ([]KPIKeyed, error) {
		out := []KPIKeyed{}
		err := each(`SELECT `+key+`, `+name+`, sum(u.input_tokens + u.output_tokens + u.cache_read_tokens + u.cache_write_tokens), sum(u.cost_minor)
			FROM ai_usage u JOIN projects p ON p.workspace_id = u.workspace_id AND p.id = u.project_id
			WHERE u.workspace_id = $1 AND u.user_id = $2 AND u.day >= $3::date AND u.day <= $4::date
			GROUP BY 1, 2 ORDER BY 3 DESC`, []any{ws, uid, r.from, r.to}, func(sc scanner) error {
			var k KPIKeyed
			var cost int64
			if err := sc.Scan(&k.Key, &k.Name, &k.Tokens, &cost); err != nil {
				return err
			}
			if finance {
				k.CostMinor = &cost
			}
			out = append(out, k)
			return nil
		})
		return out, err
	}
	if ai.ByModel, err = aiBy("u.provider || '/' || u.model", "u.model"); err != nil {
		return nil, err
	}
	if ai.ByProject, err = aiBy("p.id", "p.name"); err != nil {
		return nil, err
	}

	if g, ok := ag.git[uid]; ok {
		const attributed = ` FROM user_github_accounts g
			JOIN github_events e ON e.workspace_id = g.workspace_id AND e.occurred_at >= $3 AND e.occurred_at < $4
			     AND ((e.author_login <> '' AND lower(e.author_login) = lower(g.login))
			       OR (e.author_email <> '' AND lower(e.author_email) = ANY(g.emails)))
			JOIN projects p ON p.workspace_id = e.workspace_id AND p.id = e.project_id
			WHERE g.workspace_id = $1 AND g.user_id = $2`
		gitBy := func(key, name string) ([]KPIKeyed, error) {
			out := []KPIKeyed{}
			err := each(`SELECT `+key+`, `+name+`, count(*) FILTER (WHERE e.kind = 'commit'), count(*) FILTER (WHERE e.kind = 'pull_request'),
					count(*) FILTER (WHERE e.kind = 'deployment')`+attributed+` GROUP BY 1, 2 ORDER BY 3 DESC, 4 DESC`,
				[]any{ws, uid, r.start, r.end}, func(sc scanner) error {
					var k KPIKeyed
					if err := sc.Scan(&k.Key, &k.Name, &k.Commits, &k.PRs, &k.Deploys); err != nil {
						return err
					}
					out = append(out, k)
					return nil
				})
			return out, err
		}
		if g.ByProject, err = gitBy("p.id", "p.name"); err != nil {
			return nil, err
		}
		if g.ByRepo, err = gitBy("e.repo", "e.repo"); err != nil {
			return nil, err
		}
		g.Recent = []KPIGitEvent{}
		if err := each(`SELECT e.kind, e.repo, p.name, e.title, e.status, e.url, e.occurred_at`+attributed+`
				AND e.kind IN ('pull_request', 'deployment', 'commit') ORDER BY e.occurred_at DESC LIMIT 30`,
			[]any{ws, uid, r.start, r.end}, func(sc scanner) error {
				var e KPIGitEvent
				if err := sc.Scan(&e.Kind, &e.Repo, &e.Project, &e.Title, &e.Status, &e.URL, &e.OccurredAt); err != nil {
					return err
				}
				g.Recent = append(g.Recent, e)
				return nil
			}); err != nil {
			return nil, err
		}
	}

	act := getOr(ag.act, uid)
	act.ByAction = []KPIKeyed{}
	if err := each(`SELECT action, count(*) FROM activity_logs
		WHERE workspace_id = $1 AND actor_id = $2 AND actor_via = 'mcp' AND created_at >= $3 AND created_at < $4
		GROUP BY action ORDER BY 2 DESC, 1 LIMIT 15`, []any{ws, uid, r.start, r.end}, func(sc scanner) error {
		var k KPIKeyed
		if err := sc.Scan(&k.Key, &k.Count); err != nil {
			return err
		}
		k.Name = k.Key
		act.ByAction = append(act.ByAction, k)
		return nil
	}); err != nil {
		return nil, err
	}

	rv := getOr(ag.reviews, uid)
	if rv.Items, err = sv.reviews(ctx, s, uid, r.from, r.to); err != nil {
		return nil, err
	}
	return ag, nil
}

// activeMembers lists active, non-client members (owner pool; the app role cannot read users).
func (sv *Service) activeMembers(ctx context.Context, ws string) ([]KPIMember, error) {
	if sv.Sys == nil {
		return nil, errors.New("work: owner pool unavailable")
	}
	list, err := workspaces.Members(ctx, sv.Sys, ws)
	if err != nil {
		return nil, err
	}
	out := []KPIMember{}
	for _, m := range list {
		if m.Status == "active" && m.Role != "client" {
			out = append(out, KPIMember{UserID: m.UserID, Email: m.Email, Role: m.Role})
		}
	}
	return out, nil
}

// MemberKPI is one member's dossier (yours with kpi:read; anyone's with kpi:all).
func (sv *Service) MemberKPI(ctx context.Context, userRef string, q KPIQuery) (*KPI, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := require(s, authz.KPIRead); err != nil {
		return nil, err
	}
	uid, err := sv.memberFor(ctx, s, userRef)
	if err != nil {
		return nil, err
	}
	r, err := sv.kpiRange(ctx, s, q)
	if err != nil {
		return nil, err
	}
	members, err := sv.activeMembers(ctx, s.WorkspaceID)
	if err != nil {
		return nil, err
	}
	k := &KPI{From: r.from, To: r.to, Timezone: r.conf.Timezone, Finance: authz.Can(s.Role, authz.AIUsageRead), GeneratedAt: time.Now().UTC()}
	for _, m := range members {
		if m.UserID == uid {
			k.Member = m
		}
	}
	if k.Member.UserID == "" {
		return nil, notFound("member")
	}
	if k.GitHub, err = sv.loadGitHubAccount(ctx, sv.DB, s.WorkspaceID, uid); err != nil {
		return nil, err
	}
	ag, err := sv.kpiAggregate(ctx, s, []string{uid}, r, true)
	if err != nil {
		return nil, err
	}
	k.Time = *getOr(ag.time, uid)
	if k.Time.ByProject == nil {
		k.Time.ByProject, k.Time.ByWeek = []KPIKeyed{}, []KPIKeyed{}
	}
	k.Tasks = *getOr(ag.tasks, uid)
	k.Issues = *getOr(ag.issues, uid)
	k.AI = *getOr(ag.ai, uid)
	if k.AI.Currency == "" {
		k.AI.Currency = r.conf.Currency
	}
	if k.Finance && k.AI.CostMinor == nil {
		zero := int64(0)
		k.AI.CostMinor = &zero
	}
	k.Git = *getOr(ag.git, uid)
	k.Activity = *getOr(ag.act, uid)
	k.Reviews = *getOr(ag.reviews, uid)
	return k, nil
}

// TeamKPIs is one headline row per active, non-client member (kpi:all).
func (sv *Service) TeamKPIs(ctx context.Context, q KPIQuery) (*TeamKPI, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := require(s, authz.KPIAll); err != nil {
		return nil, err
	}
	r, err := sv.kpiRange(ctx, s, q)
	if err != nil {
		return nil, err
	}
	members, err := sv.activeMembers(ctx, s.WorkspaceID)
	if err != nil {
		return nil, err
	}
	finance := authz.Can(s.Role, authz.AIUsageRead)
	out := &TeamKPI{From: r.from, To: r.to, Timezone: r.conf.Timezone, Currency: r.conf.Currency, Finance: finance, Rows: []TeamKPIRow{}}
	if len(members) == 0 {
		return out, nil
	}
	ids := make([]string, len(members))
	for i, m := range members {
		ids[i] = m.UserID
	}
	ag, err := sv.kpiAggregate(ctx, s, ids, r, false)
	if err != nil {
		return nil, err
	}
	for _, m := range members {
		u := m.UserID
		t, tk, is, ai, g, a, rv := getOr(ag.time, u), getOr(ag.tasks, u), getOr(ag.issues, u), getOr(ag.ai, u), getOr(ag.git, u), getOr(ag.act, u), getOr(ag.reviews, u)
		row := TeamKPIRow{Member: m, GitHubLogin: g.Login, TrackedS: t.TrackedS, BillableS: t.BillableS, DaysTracked: t.DaysTracked,
			TasksCompleted: tk.Completed, TasksOpen: tk.OpenAssigned, TasksOverdue: tk.Overdue, IssuesFinished: is.Finished, AgentSeconds: is.AgentSeconds,
			AITokens: ai.InputTokens + ai.OutputTokens + ai.CacheTokens, Commits: g.Commits, PullRequests: g.PullRequests, PRsMerged: g.PRsMerged,
			Deployments: g.Deployments, MCPActions: a.MCPActions, Reviews: rv.Count, AvgRating: rv.AvgRating}
		if finance {
			c := int64(0)
			if ai.CostMinor != nil {
				c = *ai.CostMinor
			}
			row.AICostMinor = &c
		}
		out.Rows = append(out.Rows, row)
	}
	return out, nil
}

// ---- reviews ------------------------------------------------------------------------------------

// ReviewInput is POST /api/w/members/{user}/reviews.
type ReviewInput struct {
	PeriodStart string `json:"period_start" doc:"YYYY-MM-DD"`
	PeriodEnd   string `json:"period_end" doc:"YYYY-MM-DD, inclusive"`
	Rating      *int   `json:"rating,omitempty" minimum:"1" maximum:"5" doc:"1–5, optional"`
	Body        string `json:"body" maxLength:"20000"`
}

func (sv *Service) reviews(ctx context.Context, s *tenant.Scope, uid, from, to string) ([]MemberReview, error) {
	if err := feature(ctx, s, limits.FeatureKPI); err != nil {
		return nil, err
	}
	args := []any{s.WorkspaceID, uid}
	where := ""
	if from != "" && to != "" {
		args = append(args, from, to)
		where = " AND period_start <= $4::date AND period_end >= $3::date"
	}
	rows, err := sv.DB.QueryContext(ctx, `SELECT id, user_id, author_id, to_char(period_start, 'YYYY-MM-DD'), to_char(period_end, 'YYYY-MM-DD'),
			rating, body, created_at
		FROM member_reviews WHERE workspace_id = $1 AND user_id = $2`+where+` ORDER BY period_end DESC, created_at DESC LIMIT 200`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	names := sv.memberNames(ctx, s.WorkspaceID)
	out := []MemberReview{}
	for rows.Next() {
		var m MemberReview
		var rating sql.NullInt64
		if err := rows.Scan(&m.ID, &m.UserID, &m.AuthorID, &m.PeriodStart, &m.PeriodEnd, &rating, &m.Body, &m.CreatedAt); err != nil {
			return nil, err
		}
		if rating.Valid {
			v := int(rating.Int64)
			m.Rating = &v
		}
		m.AuthorEmail = names[m.AuthorID]
		out = append(out, m)
	}
	return out, rows.Err()
}

// ListReviews is a member's reviews (your own with kpi:read; anyone's with kpi:all), optionally
// only those overlapping [from, to].
func (sv *Service) ListReviews(ctx context.Context, userRef, from, to string) ([]MemberReview, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := require(s, authz.KPIRead); err != nil {
		return nil, err
	}
	uid, err := sv.memberFor(ctx, s, userRef)
	if err != nil {
		return nil, err
	}
	for _, d := range []string{from, to} {
		if _, err := parseDay(d); err != nil {
			return nil, err
		}
	}
	if (from == "") != (to == "") {
		return nil, invalid("give both from and to, or neither")
	}
	return sv.reviews(ctx, s, uid, from, to)
}

// AddReview writes a manager's review of an employee (kpi:review). Nobody reviews themself.
func (sv *Service) AddReview(ctx context.Context, userRef string, in ReviewInput) (*MemberReview, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := require(s, authz.KPIReview); err != nil {
		return nil, err
	}
	if err := feature(ctx, s, limits.FeatureKPI); err != nil {
		return nil, err
	}
	uid, err := sv.memberFor(ctx, s, userRef)
	if err != nil {
		return nil, err
	}
	if uid == s.UserID {
		return nil, invalid("you cannot review yourself")
	}
	ps, err := parseDay(in.PeriodStart)
	if err != nil {
		return nil, err
	}
	pe, err := parseDay(in.PeriodEnd)
	if err != nil {
		return nil, err
	}
	if ps == nil || pe == nil {
		return nil, invalid("period_start and period_end are required (YYYY-MM-DD)")
	}
	if pe.Before(*ps) {
		return nil, invalid("period_end is before period_start")
	}
	body := strings.TrimSpace(in.Body)
	if body == "" {
		return nil, invalid("the review needs a body")
	}
	if in.Rating != nil && (*in.Rating < 1 || *in.Rating > 5) {
		return nil, invalid("rating is 1 to 5")
	}
	var id string
	err = sv.tx(ctx, func(tx *sql.Tx) error {
		if err := tx.QueryRowContext(ctx, `INSERT INTO member_reviews (workspace_id, user_id, author_id, period_start, period_end, rating, body)
			VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`, s.WorkspaceID, uid, s.UserID, ps.Format("2006-01-02"), pe.Format("2006-01-02"),
			in.Rating, body).Scan(&id); err != nil {
			return err
		}
		ch := map[string]any{"user_id": uid, "period_start": ps.Format("2006-01-02"), "period_end": pe.Format("2006-01-02")}
		if in.Rating != nil {
			ch["rating"] = *in.Rating
		}
		return record(ctx, tx, s, entry{Action: "member_review.added", SubjectType: "member_review", SubjectID: id, Changes: ch})
	})
	if err != nil {
		return nil, err
	}
	list, err := sv.reviews(ctx, s, uid, "", "")
	if err != nil {
		return nil, err
	}
	for _, m := range list {
		if m.ID == id {
			return &m, nil
		}
	}
	return nil, notFound("review")
}

// DeleteReview removes a review (kpi:review).
func (sv *Service) DeleteReview(ctx context.Context, id string) error {
	s, err := caller(ctx)
	if err != nil {
		return err
	}
	if err := require(s, authz.KPIReview); err != nil {
		return err
	}
	return sv.tx(ctx, func(tx *sql.Tx) error {
		var uid string
		err := tx.QueryRowContext(ctx, `DELETE FROM member_reviews WHERE workspace_id = $1 AND id = $2 RETURNING user_id`, s.WorkspaceID, strings.TrimSpace(id)).Scan(&uid)
		if errors.Is(err, sql.ErrNoRows) {
			return notFound("review")
		}
		if err != nil {
			return err
		}
		return record(ctx, tx, s, entry{Action: "member_review.deleted", SubjectType: "member_review", SubjectID: id, Changes: map[string]any{"user_id": uid}})
	})
}
