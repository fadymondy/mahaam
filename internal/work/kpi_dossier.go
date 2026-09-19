package work

import (
	"fmt"
	"strings"
)

/*
The KPI dossier: the member's KPI rendered as markdown for an AI (or a person) to write the
performance report from. Sections, tables and raw facts only — no scores, no adjectives, no
judgement: the writer draws conclusions, and every number here can be traced to a row.
*/

// KPIPrompt is the instruction the web's "Copy AI prompt" puts in front of the dossier.
const KPIPrompt = `You are writing a performance report for the employee described in the dossier below.
Use only the facts in the dossier; do not invent numbers, projects or events. Where data is missing
(for example no GitHub account is connected, or no AI usage was recorded), say so instead of guessing.
Structure: 1) summary, 2) delivery (tasks, issues, GitHub), 3) time and focus (hours, projects,
weekly pattern), 4) AI-assisted work (agent issues, MCP activity, AI usage), 5) what the manager
reviews say, 6) strengths, 7) areas to improve, 8) suggested goals for the next period.
Quote the manager reviews faithfully. Keep it factual and fair.`

func kpiHours(secs int64) string {
	if secs <= 0 {
		return "0:00"
	}
	m := secs / 60
	return fmt.Sprintf("%d:%02d", m/60, m%60)
}

func kpiMoney(minor int64, cur string) string {
	return fmt.Sprintf("%d.%02d %s", minor/100, minor%100, cur)
}

// kpiCell makes a value safe inside a markdown table cell.
func kpiCell(s string) string {
	s = strings.ReplaceAll(s, "\r", " ")
	s = strings.ReplaceAll(s, "\n", " ")
	s = strings.ReplaceAll(s, "|", "\\|")
	if strings.TrimSpace(s) == "" {
		return "—"
	}
	return s
}

// KPIMarkdown renders one member's dossier.
func KPIMarkdown(k *KPI) string {
	var b strings.Builder
	p := func(format string, a ...any) { fmt.Fprintf(&b, format, a...) }

	p("# Employee KPI dossier — %s\n\n", k.Member.Email)
	p("- Member: %s (role: %s, id: %s)\n", k.Member.Email, k.Member.Role, k.Member.UserID)
	p("- Period: %s to %s (inclusive, timezone %s)\n", k.From, k.To, k.Timezone)
	if k.GitHub != nil {
		p("- GitHub: @%s (%s; %d e-mail address(es) used for attribution)\n", k.GitHub.Login, k.GitHub.ConnectedVia, len(k.GitHub.Emails))
	} else {
		p("- GitHub: not connected — GitHub activity cannot be attributed to this member\n")
	}
	p("- Generated: %s UTC\n\n", k.GeneratedAt.Format("2006-01-02 15:04"))

	p("## Headline\n\n| Metric | Value |\n|---|---:|\n")
	p("| Hours tracked | %s |\n| Billable hours | %s |\n| Days with tracked time | %d |\n", kpiHours(k.Time.TrackedS), kpiHours(k.Time.BillableS), k.Time.DaysTracked)
	p("| Tasks completed | %d |\n| Open assigned tasks (now) | %d |\n| Overdue tasks (now) | %d |\n", k.Tasks.Completed, k.Tasks.OpenAssigned, k.Tasks.Overdue)
	p("| Issues finished by their agent | %d |\n| Agent time on issues | %s |\n", k.Issues.Finished, kpiHours(k.Issues.AgentSeconds))
	p("| AI tokens | %d |\n", k.AI.InputTokens+k.AI.OutputTokens+k.AI.CacheTokens)
	if k.AI.CostMinor != nil {
		p("| AI cost | %s |\n", kpiMoney(*k.AI.CostMinor, k.AI.Currency))
	}
	p("| Commits | %d |\n| Pull requests (merged) | %d (%d) |\n| Deployments | %d |\n", k.Git.Commits, k.Git.PullRequests, k.Git.PRsMerged, k.Git.Deployments)
	p("| MCP actions (of all actions) | %d (of %d) |\n", k.Activity.MCPActions, k.Activity.Actions)
	p("| Manager reviews | %d |\n\n", k.Reviews.Count)

	p("## Time tracking\n\n")
	p("%d entries; %s tracked, %s billable, on %d day(s).\n\n", k.Time.Entries, kpiHours(k.Time.TrackedS), kpiHours(k.Time.BillableS), k.Time.DaysTracked)
	if len(k.Time.ByProject) > 0 {
		p("| Project | Hours | Billable |\n|---|---:|---:|\n")
		for _, r := range k.Time.ByProject {
			name := r.Name
			if r.Key == "" {
				name = "(no project)"
			}
			p("| %s | %s | %s |\n", kpiCell(name), kpiHours(r.Seconds), kpiHours(r.Billable))
		}
		p("\n")
	}
	if len(k.Time.ByWeek) > 0 {
		p("| Week starting | Hours | Billable |\n|---|---:|---:|\n")
		for _, r := range k.Time.ByWeek {
			p("| %s | %s | %s |\n", r.Key, kpiHours(r.Seconds), kpiHours(r.Billable))
		}
		p("\n")
	}

	p("## Tasks\n\n")
	p("Completed in period: %d (%d after their due date). Open and assigned now: %d; overdue now: %d.\n\n",
		k.Tasks.Completed, k.Tasks.CompletedLate, k.Tasks.OpenAssigned, k.Tasks.Overdue)
	taskTable := func(title string, list []KPITaskRef) {
		if len(list) == 0 {
			return
		}
		p("%s\n\n| Task | Title | Project | Due | Completed |\n|---|---|---|---|---|\n", title)
		for _, t := range list {
			due, done := "—", "—"
			if t.DueAt != nil {
				due = t.DueAt.UTC().Format("2006-01-02")
			}
			if t.CompletedAt != nil {
				done = t.CompletedAt.UTC().Format("2006-01-02")
			}
			p("| %s | %s | %s | %s | %s |\n", t.Key, kpiCell(t.Title), kpiCell(t.Project), due, done)
		}
		p("\n")
	}
	taskTable("Completed:", k.Tasks.CompletedList)
	taskTable("Overdue now:", k.Tasks.OverdueList)

	p("## Issues worked by their AI agent (MCP issue loop)\n\n")
	p("| Metric | Value |\n|---|---:|\n| Plans posted (started) | %d |\n| Handed to review | %d |\n| Approvals requested | %d |\n| Finished | %d |\n| Issues worked | %d |\n| Agent time banked | %s |\n| Agent comments | %d |\n| @agent mentions answered | %d |\n\n",
		k.Issues.Started, k.Issues.Reviewed, k.Issues.Approvals, k.Issues.Finished, k.Issues.Worked, kpiHours(k.Issues.AgentSeconds), k.Issues.AgentComments, k.Issues.MentionsAnswered)
	if len(k.Issues.List) > 0 {
		p("| Issue | Title | Status | Agent time |\n|---|---|---|---:|\n")
		for _, i := range k.Issues.List {
			p("| %s | %s | %s | %s |\n", i.Key, kpiCell(i.Title), i.Status, kpiHours(i.AgentSeconds))
		}
		p("\n")
	}

	p("## AI usage\n\n")
	if k.AI.InputTokens+k.AI.OutputTokens+k.AI.CacheTokens == 0 && k.AI.Requests == 0 {
		p("No AI usage was recorded by this member in the period.\n\n")
	} else {
		p("Input %d, output %d, cache %d tokens; %d requests", k.AI.InputTokens, k.AI.OutputTokens, k.AI.CacheTokens, k.AI.Requests)
		if k.AI.CostMinor != nil {
			p("; cost %s", kpiMoney(*k.AI.CostMinor, k.AI.Currency))
		}
		p(".\n\n")
		aiTable := func(title string, list []KPIKeyed) {
			if len(list) == 0 {
				return
			}
			p("| %s | Tokens |", title)
			if k.Finance {
				p(" Cost |\n|---|---:|---:|\n")
			} else {
				p("\n|---|---:|\n")
			}
			for _, r := range list {
				p("| %s | %d |", kpiCell(r.Name), r.Tokens)
				if k.Finance && r.CostMinor != nil {
					p(" %s |", kpiMoney(*r.CostMinor, k.AI.Currency))
				}
				p("\n")
			}
			p("\n")
		}
		aiTable("Model", k.AI.ByModel)
		aiTable("Project", k.AI.ByProject)
	}

	p("## GitHub\n\n")
	if !k.Git.Connected {
		p("No GitHub account is mapped to this member, so commits, pull requests and deployments are not attributed.\n\n")
	} else {
		p("| Metric | Value |\n|---|---:|\n| Commits | %d |\n| Pull requests opened/updated | %d |\n| Pull requests merged | %d |\n| Deployments (succeeded) | %d (%d) |\n| Workflow runs | %d |\n\n",
			k.Git.Commits, k.Git.PullRequests, k.Git.PRsMerged, k.Git.Deployments, k.Git.DeploysOK, k.Git.WorkflowRuns)
		gitTable := func(title string, list []KPIKeyed) {
			if len(list) == 0 {
				return
			}
			p("| %s | Commits | Pull requests | Deployments |\n|---|---:|---:|---:|\n", title)
			for _, r := range list {
				p("| %s | %d | %d | %d |\n", kpiCell(r.Name), r.Commits, r.PRs, r.Deploys)
			}
			p("\n")
		}
		gitTable("Project", k.Git.ByProject)
		gitTable("Repository", k.Git.ByRepo)
		if len(k.Git.Recent) > 0 {
			p("Recent events:\n\n| When | Kind | Repository | Title | Status |\n|---|---|---|---|---|\n")
			for _, e := range k.Git.Recent {
				p("| %s | %s | %s | %s | %s |\n", e.OccurredAt.UTC().Format("2006-01-02"), e.Kind, kpiCell(e.Repo), kpiCell(e.Title), kpiCell(e.Status))
			}
			p("\n")
		}
	}

	p("## Activity and MCP\n\n")
	p("%d action(s) recorded as this member, %d of them via MCP from %d token(s).\n\n", k.Activity.Actions, k.Activity.MCPActions, k.Activity.MCPTokens)
	if len(k.Activity.ByAction) > 0 {
		p("| MCP action | Count |\n|---|---:|\n")
		for _, a := range k.Activity.ByAction {
			p("| %s | %d |\n", kpiCell(a.Key), a.Count)
		}
		p("\n")
	}

	p("## Manager reviews\n\n")
	if k.Reviews.Count == 0 {
		p("No manager review covers this period.\n")
	} else {
		if k.Reviews.AvgRating != nil {
			p("%d review(s); average rating %.1f / 5.\n\n", k.Reviews.Count, *k.Reviews.AvgRating)
		} else {
			p("%d review(s); no ratings given.\n\n", k.Reviews.Count)
		}
		for _, r := range k.Reviews.Items {
			rating := "no rating"
			if r.Rating != nil {
				rating = fmt.Sprintf("rating %d/5", *r.Rating)
			}
			p("### %s to %s — by %s (%s)\n\n", r.PeriodStart, r.PeriodEnd, firstNonEmptyStr(r.AuthorEmail, r.AuthorID), rating)
			for _, line := range strings.Split(strings.TrimSpace(r.Body), "\n") {
				p("> %s\n", line)
			}
			p("\n")
		}
	}
	return b.String()
}

// TeamKPIMarkdown renders the team table.
func TeamKPIMarkdown(t *TeamKPI) string {
	var b strings.Builder
	fmt.Fprintf(&b, "# Team KPI — %s to %s (%s)\n\n", t.From, t.To, t.Timezone)
	if len(t.Rows) == 0 {
		b.WriteString("No active employees.\n")
		return b.String()
	}
	b.WriteString("| Member | Hours | Billable | Days | Tasks done | Open | Overdue | Issues finished | Agent time | AI tokens |")
	if t.Finance {
		b.WriteString(" AI cost |")
	}
	b.WriteString(" Commits | PRs (merged) | Deploys | MCP actions | Reviews (avg) |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|")
	if t.Finance {
		b.WriteString("---:|")
	}
	b.WriteString("---:|---:|---:|---:|---:|\n")
	for _, r := range t.Rows {
		fmt.Fprintf(&b, "| %s | %s | %s | %d | %d | %d | %d | %d | %s | %d |", kpiCell(r.Member.Email), kpiHours(r.TrackedS), kpiHours(r.BillableS), r.DaysTracked,
			r.TasksCompleted, r.TasksOpen, r.TasksOverdue, r.IssuesFinished, kpiHours(r.AgentSeconds), r.AITokens)
		if t.Finance {
			c := int64(0)
			if r.AICostMinor != nil {
				c = *r.AICostMinor
			}
			fmt.Fprintf(&b, " %s |", kpiMoney(c, t.Currency))
		}
		gh := fmt.Sprintf("%d", r.Commits)
		if r.GitHubLogin == "" {
			gh = "n/a"
		}
		avg := "—"
		if r.AvgRating != nil {
			avg = fmt.Sprintf("%.1f", *r.AvgRating)
		}
		fmt.Fprintf(&b, " %s | %d (%d) | %d | %d | %d (%s) |\n", gh, r.PullRequests, r.PRsMerged, r.Deployments, r.MCPActions, r.Reviews, avg)
	}
	b.WriteString("\n\"n/a\" commits: no GitHub account is mapped to that member.\n")
	return b.String()
}
