package integrations

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"

	"github.com/fadymondy/mahaam/internal/tenant"
)

/*
Linear import over GraphQL (https://api.linear.app/graphql). Auth is the personal API key in
the Authorization header (no "Bearer"). The team is its id (UUID) or its key (ENG). Issues are
paged 100 at a time with pageInfo.endCursor and upserted into reports:

	status    state.type: backlog → backlog, unstarted/triage → todo, started → in_progress,
	          completed/canceled → done
	priority  0 (none) → medium, 1 urgent → highest, 2 high → high, 3 medium → medium, 4 low → low
	type      a "bug" label → bug, "feature"/"improvement" → feature, else task
*/

const linearURL = "https://api.linear.app/graphql"

const linearMaxIssues = 5000

var uuidRe = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

type linearClient struct {
	url, key string
	http     *http.Client
}

type linearIssue struct {
	ID          string  `json:"id"`
	Identifier  string  `json:"identifier"`
	Title       string  `json:"title"`
	Description *string `json:"description"`
	URL         string  `json:"url"`
	Priority    float64 `json:"priority"`
	State       struct {
		Type string `json:"type"`
		Name string `json:"name"`
	} `json:"state"`
	Labels struct {
		Nodes []struct {
			Name string `json:"name"`
		} `json:"nodes"`
	} `json:"labels"`
}

const linearQuery = `query MahaamImport($filter: IssueFilter, $after: String) {
  issues(first: 100, after: $after, filter: $filter, orderBy: updatedAt) {
    nodes { id identifier title description url priority state { type name } labels { nodes { name } } }
    pageInfo { hasNextPage endCursor }
  }
}`

func (c *linearClient) page(ctx context.Context, team, after string) ([]linearIssue, string, bool, error) {
	filter := map[string]any{"team": map[string]any{"key": map[string]any{"eq": strings.ToUpper(team)}}}
	if uuidRe.MatchString(team) {
		filter = map[string]any{"team": map[string]any{"id": map[string]any{"eq": team}}}
	}
	vars := map[string]any{"filter": filter}
	if after != "" {
		vars["after"] = after
	}
	b, _ := json.Marshal(map[string]any{"query": linearQuery, "variables": vars})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.url, bytes.NewReader(b))
	if err != nil {
		return nil, "", false, err
	}
	req.Header.Set("Authorization", c.key)
	req.Header.Set("Content-Type", "application/json")
	res, err := c.http.Do(req)
	if err != nil {
		return nil, "", false, fmt.Errorf("Linear unreachable: %w", err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 32<<20))
	var out struct {
		Data *struct {
			Issues struct {
				Nodes    []linearIssue `json:"nodes"`
				PageInfo struct {
					HasNextPage bool   `json:"hasNextPage"`
					EndCursor   string `json:"endCursor"`
				} `json:"pageInfo"`
			} `json:"issues"`
		} `json:"data"`
		Errors []struct {
			Message string `json:"message"`
		} `json:"errors"`
	}
	_ = json.Unmarshal(raw, &out)
	if len(out.Errors) > 0 || res.StatusCode/100 != 2 || out.Data == nil {
		msg := res.Status
		if len(out.Errors) > 0 {
			msg = out.Errors[0].Message
		}
		if res.StatusCode == http.StatusUnauthorized || res.StatusCode == http.StatusForbidden {
			msg = "Linear refused the API key: " + msg
		}
		return nil, "", false, &UpstreamError{Status: res.StatusCode, Msg: "Linear: " + msg}
	}
	pi := out.Data.Issues.PageInfo
	return out.Data.Issues.Nodes, pi.EndCursor, pi.HasNextPage, nil
}

func (c *linearClient) all(ctx context.Context, team string) ([]ExternalIssue, error) {
	out := []ExternalIssue{}
	after := ""
	for len(out) < linearMaxIssues {
		nodes, cursor, more, err := c.page(ctx, team, after)
		if err != nil {
			return nil, err
		}
		for _, n := range nodes {
			out = append(out, mapLinear(n))
		}
		if !more || cursor == "" {
			break
		}
		after = cursor
	}
	return out, nil
}

func mapLinear(n linearIssue) ExternalIssue {
	x := ExternalIssue{
		Source: "linear", ExternalID: n.ID, Key: n.Identifier, URL: n.URL, Title: n.Title, Body: deref(n.Description),
		Status: linearStatus(n.State.Type), Priority: linearPriority(int(n.Priority)), IssueType: "task",
	}
	for _, l := range n.Labels.Nodes {
		switch strings.ToLower(l.Name) {
		case "bug":
			x.IssueType = "bug"
		case "feature", "improvement", "enhancement":
			if x.IssueType == "task" {
				x.IssueType = "feature"
			}
		}
	}
	return x
}

func linearStatus(t string) string {
	switch strings.ToLower(t) {
	case "completed", "canceled", "cancelled":
		return "done"
	case "started":
		return "in_progress"
	case "unstarted", "triage":
		return "todo"
	}
	return "backlog"
}

func linearPriority(p int) string {
	switch p {
	case 1:
		return "highest"
	case 2:
		return "high"
	case 4:
		return "low"
	}
	return "medium"
}

func (sv *Service) syncLinear(ctx context.Context, s *tenant.Scope, r *row, res *SyncResult) error {
	key, err := sv.secret(r)
	if err != nil {
		return err
	}
	c := &linearClient{url: firstNonEmpty(sv.LinearURL, linearURL), key: key, http: sv.HTTP}
	issues, err := c.all(ctx, r.cfg("team_id"))
	if err != nil {
		return err
	}
	return sv.importAll(ctx, s, r, issues, res)
}
