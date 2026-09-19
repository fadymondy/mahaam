package reports

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

/*
The agent lifecycle of an issue, ported from fadymondy.com-v2's issue tools and
its /issues skill, shared by the user MCP (a workspace's own issues) and the admin
MCP (platform issues):

	start_issue       plan required → comment "**Plan**", in_progress/open, started_at
	review_issue      note required → in_review, finished_at, banks agent_seconds,
	                  comment "**Ready for review.**"
	finish_issue      done/closed, closed_at + finished_at, banks agent_seconds
	request_approval  question required → waiting_approval, banks agent_seconds,
	                  clears started_at, comment "**Blocked — needs a decision.**"
	reorder_issue     before/after another issue; takes the anchor's status

The skill's plan-first rule is enforced here, not trusted to the prompt: fadymondy's
own start_issue accepted no plan although its skill required one.

Seconds are banked from started_at to now and started_at is cleared, so a clock
never runs twice: re-starting an issue after review or approval starts a new span.
*/

// ErrHumanOnly refuses agent work on an issue marked human_only.
var ErrHumanOnly = errors.New("marked human_only — an agent may not work it")

func bank(r *Report, now time.Time, fields map[string]any) {
	if r.StartedAt != nil {
		fields["agent_seconds"] = r.AgentSeconds + int64(now.Sub(*r.StartedAt).Seconds())
		fields["started_at"] = nil
	}
}

// Start moves an issue to in_progress with a posted plan and starts its clock.
func Start(ctx context.Context, db *sql.DB, r *Report, authorID, kind, plan string) error {
	if r.HumanOnly {
		return fmt.Errorf("%s is %w", r.Key, ErrHumanOnly)
	}
	plan = strings.TrimSpace(plan)
	if plan == "" {
		return errors.New("a plan is required: say what you will change and how you will verify it")
	}
	fields := map[string]any{"status": "in_progress", "state": "open", "closed_at": nil}
	if r.StartedAt == nil {
		fields["started_at"] = time.Now().UTC()
	}
	if err := Update(ctx, db, r, fields); err != nil {
		return err
	}
	return AddComment(ctx, db, r, authorID, kind, "**Plan**\n\n"+plan)
}

// Review hands finished work to a human: in_review with a note.
func Review(ctx context.Context, db *sql.DB, r *Report, authorID, kind, note string) error {
	note = strings.TrimSpace(note)
	if note == "" {
		return errors.New("a note is required: what changed and how it was verified")
	}
	now := time.Now().UTC()
	fields := map[string]any{"status": "in_review", "state": "open", "finished_at": now}
	bank(r, now, fields)
	if err := Update(ctx, db, r, fields); err != nil {
		return err
	}
	return AddComment(ctx, db, r, authorID, kind, "**Ready for review.**\n\n"+note)
}

// Finish closes an issue as done.
func Finish(ctx context.Context, db *sql.DB, r *Report, authorID, kind, resolution string) error {
	now := time.Now().UTC()
	fields := map[string]any{"status": "done", "state": "closed", "closed_at": now, "finished_at": now}
	bank(r, now, fields)
	if v := strings.TrimSpace(resolution); v != "" {
		fields["resolution"] = v
	}
	if err := Update(ctx, db, r, fields); err != nil {
		return err
	}
	if v := strings.TrimSpace(resolution); v != "" {
		return AddComment(ctx, db, r, authorID, kind, "**Done.**\n\n"+v)
	}
	return nil
}

// RequestApproval parks an issue on a question for a human.
func RequestApproval(ctx context.Context, db *sql.DB, r *Report, authorID, kind, question string) error {
	question = strings.TrimSpace(question)
	if question == "" {
		return errors.New("a question is required: what decision is needed")
	}
	fields := map[string]any{"status": "waiting_approval", "state": "open"}
	bank(r, time.Now().UTC(), fields)
	if err := Update(ctx, db, r, fields); err != nil {
		return err
	}
	return AddComment(ctx, db, r, authorID, kind, "**Blocked — needs a decision.**\n\n"+question)
}

// Reorder places r just before or just after anchor on the board, taking the
// anchor's status. Board order is sort_order ASC; the column is renumbered in
// steps of 1000 in one transaction so there is always room.
func Reorder(ctx context.Context, db *sql.DB, r, anchor *Report, after bool) error {
	if r.ID == anchor.ID {
		return errors.New("an issue cannot be placed next to itself")
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	rows, err := tx.QueryContext(ctx, `SELECT id FROM reports
		WHERE workspace_id = $1 AND status = $2 AND id <> $3
		ORDER BY sort_order ASC, created_at DESC`, r.WorkspaceID, anchor.Status, r.ID)
	if err != nil {
		return err
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
	}
	rows.Close()
	order := make([]string, 0, len(ids)+1)
	for _, id := range ids {
		if id == anchor.ID && !after {
			order = append(order, r.ID)
		}
		order = append(order, id)
		if id == anchor.ID && after {
			order = append(order, r.ID)
		}
	}
	for i, id := range order {
		if _, err := tx.ExecContext(ctx, `UPDATE reports SET sort_order = $3, updated_at = now()
			WHERE workspace_id = $1 AND id = $2`, r.WorkspaceID, id, int64(i+1)*1000); err != nil {
			return err
		}
	}
	if anchor.Status != r.Status {
		state := "open"
		var closed any
		if anchor.Status == "done" {
			state, closed = "closed", time.Now().UTC()
		}
		if _, err := tx.ExecContext(ctx, `UPDATE reports SET status = $3, state = $4, closed_at = $5
			WHERE workspace_id = $1 AND id = $2`, r.WorkspaceID, r.ID, anchor.Status, state, closed); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// Mention is a human comment addressed to the agent that no agent comment on the
// same issue has answered since.
type Mention struct {
	Key, Title, Body, Author string
	At                       time.Time
}

// MentionHandles are the words that address the agent in a comment.
var MentionHandles = []string{"@agent", "@claude", "@ai"}

// Mentions lists unanswered mentions of the agent, oldest first (they outrank the
// board in the /issues loop). projectID limits to one project when set.
func Mentions(ctx context.Context, db *sql.DB, workspaceID, projectID string, limit int) ([]Mention, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	conds := make([]string, len(MentionHandles))
	args := []any{workspaceID, projectID, limit}
	for i, h := range MentionHandles {
		args = append(args, "%"+h+"%")
		conds[i] = fmt.Sprintf("c.body ILIKE $%d", len(args))
	}
	rows, err := db.QueryContext(ctx, `
		SELECT r.key, r.title, c.body, c.author_kind, c.created_at
		FROM report_comments c
		JOIN reports r ON r.workspace_id = c.workspace_id AND r.id = c.report_id
		WHERE c.workspace_id = $1 AND ($2 = '' OR r.project_id = $2)
		  AND c.author_kind <> 'agent' AND r.state = 'open'
		  AND (`+strings.Join(conds, " OR ")+`)
		  AND NOT EXISTS (SELECT 1 FROM report_comments a
		      WHERE a.workspace_id = c.workspace_id AND a.report_id = c.report_id
		        AND a.author_kind = 'agent' AND a.created_at > c.created_at)
		ORDER BY c.created_at ASC LIMIT $3`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Mention{}
	for rows.Next() {
		var m Mention
		if err := rows.Scan(&m.Key, &m.Title, &m.Body, &m.Author, &m.At); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// FormatMentions renders Mentions for an MCP answer.
func FormatMentions(ms []Mention) string {
	if len(ms) == 0 {
		return "No unanswered mentions."
	}
	var b strings.Builder
	fmt.Fprintf(&b, "%d unanswered mention(s) — these outrank the board:\n\n", len(ms))
	for _, m := range ms {
		fmt.Fprintf(&b, "%s  %s\n  %s, %s: %s\n", m.Key, m.Title, m.Author, m.At.Format(time.RFC3339), oneLine(m.Body, 300))
	}
	return b.String()
}

func oneLine(s string, n int) string {
	s = strings.Join(strings.Fields(s), " ")
	if len(s) > n {
		return s[:n] + "…"
	}
	return s
}
