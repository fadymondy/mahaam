package integrations

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"

	"github.com/fadymondy/mahaam/internal/tenant"
)

/*
Jira import (Jira Cloud REST v3). Auth is Basic <email>:<API token>. Issues are paged through
POST /rest/api/3/search/jql (the enhanced search — Atlassian removed the old /rest/api/3/search)
with nextPageToken, and each is upserted into reports:

	status      statusCategory.key: new → todo, indeterminate → in_progress, done → done
	issue type  Bug → bug, Story → story, Epic → epic, (New) Feature / Improvement → feature, else task
	priority    Highest/Blocker/Critical → highest, High/Major → high, Medium → medium,
	            Low/Minor → low, Lowest/Trivial → lowest
	body        the description's Atlassian Document Format flattened to text

The base URL is server-side-requested with a stored credential, so it is constrained: https,
a hostname (no IP literal, no localhost), and *.atlassian.net unless the host is listed in
JIRA_ALLOWED_HOSTS (comma-separated, for Jira on a custom domain).
*/

var jiraKeyRe = regexp.MustCompile(`^[A-Z][A-Z0-9_]{0,49}$`)

const jiraMaxIssues = 5000

func validateJiraURL(raw string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Host == "" {
		return "", invalid("base_url must be your Jira site, e.g. https://your-site.atlassian.net")
	}
	if u.Scheme != "https" {
		return "", invalid("base_url must use https")
	}
	host := strings.ToLower(u.Hostname())
	if net.ParseIP(host) != nil || host == "localhost" || strings.HasSuffix(host, ".local") || strings.HasSuffix(host, ".internal") {
		return "", invalid("base_url must be a public Jira host")
	}
	allowed := strings.HasSuffix(host, ".atlassian.net")
	for _, h := range strings.Split(os.Getenv("JIRA_ALLOWED_HOSTS"), ",") {
		if h = strings.ToLower(strings.TrimSpace(h)); h != "" && h == host {
			allowed = true
		}
	}
	if !allowed {
		return "", invalid("base_url must be an *.atlassian.net site (a custom Jira domain must be listed in JIRA_ALLOWED_HOSTS)")
	}
	return "https://" + u.Host, nil
}

type jiraClient struct {
	base, email, token string
	http               *http.Client
}

type jiraIssue struct {
	ID     string `json:"id"`
	Key    string `json:"key"`
	Fields struct {
		Summary     string          `json:"summary"`
		Description json.RawMessage `json:"description"`
		Status      struct {
			Name           string `json:"name"`
			StatusCategory struct {
				Key string `json:"key"`
			} `json:"statusCategory"`
		} `json:"status"`
		IssueType struct {
			Name string `json:"name"`
		} `json:"issuetype"`
		Priority *struct {
			Name string `json:"name"`
		} `json:"priority"`
	} `json:"fields"`
}

type jiraPage struct {
	Issues        []jiraIssue `json:"issues"`
	NextPageToken string      `json:"nextPageToken"`
	IsLast        *bool       `json:"isLast"`
}

func (c *jiraClient) search(ctx context.Context, jql, next string) (*jiraPage, error) {
	body := map[string]any{
		"jql":        jql,
		"maxResults": 100,
		"fields":     []string{"summary", "description", "status", "issuetype", "priority"},
	}
	if next != "" {
		body["nextPageToken"] = next
	}
	b, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.base+"/rest/api/3/search/jql", bytes.NewReader(b))
	if err != nil {
		return nil, err
	}
	req.SetBasicAuth(c.email, c.token)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	res, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("Jira unreachable: %w", err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 32<<20))
	if res.StatusCode/100 != 2 {
		var e struct {
			ErrorMessages []string `json:"errorMessages"`
		}
		_ = json.Unmarshal(raw, &e)
		msg := res.Status
		if len(e.ErrorMessages) > 0 {
			msg = strings.Join(e.ErrorMessages, "; ")
		}
		if res.StatusCode == http.StatusUnauthorized || res.StatusCode == http.StatusForbidden {
			msg = "Jira refused the credentials (check the email and API token): " + msg
		}
		return nil, &UpstreamError{Status: res.StatusCode, Msg: "Jira: " + msg}
	}
	var page jiraPage
	if err := json.Unmarshal(raw, &page); err != nil {
		return nil, fmt.Errorf("Jira: unexpected response: %w", err)
	}
	return &page, nil
}

// all pages through the search and maps every issue.
func (c *jiraClient) all(ctx context.Context, jql string) ([]ExternalIssue, error) {
	out := []ExternalIssue{}
	next := ""
	for len(out) < jiraMaxIssues {
		page, err := c.search(ctx, jql, next)
		if err != nil {
			return nil, err
		}
		for _, it := range page.Issues {
			out = append(out, mapJira(c.base, it))
		}
		if page.NextPageToken == "" || (page.IsLast != nil && *page.IsLast) || len(page.Issues) == 0 {
			break
		}
		next = page.NextPageToken
	}
	return out, nil
}

func mapJira(base string, it jiraIssue) ExternalIssue {
	x := ExternalIssue{
		Source: "jira", ExternalID: it.ID, Key: it.Key, URL: base + "/browse/" + it.Key,
		Title: it.Fields.Summary, Body: adfText(it.Fields.Description),
		Status: jiraStatus(it.Fields.Status.StatusCategory.Key), IssueType: jiraType(it.Fields.IssueType.Name), Priority: "medium",
	}
	if it.Fields.Priority != nil {
		x.Priority = jiraPriority(it.Fields.Priority.Name)
	}
	return x
}

func jiraStatus(category string) string {
	switch strings.ToLower(category) {
	case "done":
		return "done"
	case "indeterminate":
		return "in_progress"
	case "new":
		return "todo"
	}
	return "backlog"
}

func jiraType(name string) string {
	switch strings.ToLower(strings.TrimSpace(name)) {
	case "bug", "defect":
		return "bug"
	case "story", "user story":
		return "story"
	case "epic":
		return "epic"
	case "feature", "new feature", "improvement", "enhancement":
		return "feature"
	}
	return "task"
}

func jiraPriority(name string) string {
	switch strings.ToLower(strings.TrimSpace(name)) {
	case "highest", "blocker", "critical", "urgent":
		return "highest"
	case "high", "major":
		return "high"
	case "low", "minor":
		return "low"
	case "lowest", "trivial":
		return "lowest"
	}
	return "medium"
}

// adfText flattens an Atlassian Document Format value to plain text (paragraphs on new lines).
// A plain string (Jira v2 / server) is returned as-is.
func adfText(raw json.RawMessage) string {
	if len(raw) == 0 || string(raw) == "null" {
		return ""
	}
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}
	var node map[string]any
	if json.Unmarshal(raw, &node) != nil {
		return ""
	}
	var b strings.Builder
	var walk func(n map[string]any)
	walk = func(n map[string]any) {
		switch n["type"] {
		case "text":
			if t, ok := n["text"].(string); ok {
				b.WriteString(t)
			}
		case "hardBreak":
			b.WriteString("\n")
		case "mention":
			if a, ok := n["attrs"].(map[string]any); ok {
				if t, ok := a["text"].(string); ok {
					b.WriteString(t)
				}
			}
		}
		if kids, ok := n["content"].([]any); ok {
			for _, k := range kids {
				if m, ok := k.(map[string]any); ok {
					walk(m)
				}
			}
		}
		switch n["type"] {
		case "paragraph", "heading", "listItem", "codeBlock", "blockquote", "rule":
			b.WriteString("\n")
		}
	}
	walk(node)
	return strings.TrimSpace(b.String())
}

func (sv *Service) syncJira(ctx context.Context, s *tenant.Scope, r *row, res *SyncResult) error {
	token, err := sv.secret(r)
	if err != nil {
		return err
	}
	base, err := validateJiraURL(r.cfg("base_url"))
	if err != nil {
		return err
	}
	jql := r.cfg("jql")
	if jql == "" {
		jql = fmt.Sprintf(`project = "%s" ORDER BY updated DESC`, r.cfg("project_key"))
	}
	c := &jiraClient{base: base, email: r.cfg("email"), token: token, http: sv.HTTP}
	issues, err := c.all(ctx, jql)
	if err != nil {
		return err
	}
	return sv.importAll(ctx, s, r, issues, res)
}

// importAll upserts a fetched batch and counts what happened.
func (sv *Service) importAll(ctx context.Context, s *tenant.Scope, r *row, issues []ExternalIssue, res *SyncResult) error {
	res.Fetched += len(issues)
	for _, x := range issues {
		created, _, err := sv.upsertIssue(ctx, s, r.ProjectID, x)
		if err != nil {
			return fmt.Errorf("importing %s: %w", x.Key, err)
		}
		if created {
			res.Created++
		} else {
			res.Updated++
		}
	}
	return nil
}
