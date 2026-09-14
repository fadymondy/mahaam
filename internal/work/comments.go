package work

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"regexp"
	"strings"
	"time"

	"github.com/fadymondy/managy/internal/authz"
	"github.com/fadymondy/managy/internal/workspaces"
)

// Comment is one entry on a task's thread.
type Comment struct {
	ID         string     `json:"id"`
	TaskID     string     `json:"task_id"`
	AuthorID   string     `json:"author_id"`
	AuthorKind string     `json:"author_kind" doc:"user, or agent when written through an MCP token"`
	Body       string     `json:"body"`
	Mentions   []string   `json:"mentions" doc:"User ids mentioned with @handle"`
	EditedAt   *time.Time `json:"edited_at"`
	CreatedAt  time.Time  `json:"created_at"`
}

const maxComment = 10000

func scanComment(r scanner) (*Comment, error) {
	c := &Comment{}
	var mentions *string
	err := r.Scan(&c.ID, &c.TaskID, &c.AuthorID, &c.AuthorKind, &c.Body, &mentions, &c.EditedAt, &c.CreatedAt)
	c.Mentions = []string{}
	if mentions != nil {
		_ = json.Unmarshal([]byte(*mentions), &c.Mentions)
	}
	return c, err
}

const commentCols = `id, task_id, author_id, author_kind, body, mentions, edited_at, created_at`

/*
Mentions follow fadymondy.com's pattern — an @handle in the body plus a stored list — with
handles resolved against the workspace's members instead of a fixed agent name:

	@alice              the member whose email's local part is "alice" (when unique)
	@alice@example.com  the member with that email

Unknown or ambiguous handles are left as text. The stored list (user ids) is what the P5
notification inbox fans out from.
*/
var mentionRe = regexp.MustCompile(`(?:^|[^\w@.])@([A-Za-z0-9._%+-]+(?:@[A-Za-z0-9.-]+\.[A-Za-z]{2,})?)`)

// MentionHandles extracts the @handles in body, lower-cased, in order, without duplicates.
func MentionHandles(body string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, m := range mentionRe.FindAllStringSubmatch(body, -1) {
		h := strings.ToLower(strings.TrimRight(m[1], "."))
		if h != "" && !seen[h] {
			seen[h] = true
			out = append(out, h)
		}
	}
	return out
}

func (sv *Service) resolveMentions(ctx context.Context, ws, body string) []string {
	handles := MentionHandles(body)
	if len(handles) == 0 || sv.Sys == nil {
		return []string{}
	}
	members, err := workspaces.Members(ctx, sv.Sys, ws)
	if err != nil {
		return []string{}
	}
	byEmail, byLocal := map[string]string{}, map[string][]string{}
	for _, m := range members {
		if m.Status != "active" {
			continue
		}
		e := strings.ToLower(m.Email)
		byEmail[e] = m.UserID
		if i := strings.IndexByte(e, '@'); i > 0 {
			byLocal[e[:i]] = append(byLocal[e[:i]], m.UserID)
		}
	}
	seen := map[string]bool{}
	out := []string{}
	for _, h := range handles {
		id := byEmail[h]
		if id == "" && len(byLocal[h]) == 1 {
			id = byLocal[h][0]
		}
		if id != "" && !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	return out
}

// ListComments returns a task's thread, oldest first.
func (sv *Service) ListComments(ctx context.Context, ref string) ([]Comment, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	t, err := loadTask(ctx, sv.DB, s, ref)
	if err != nil {
		return nil, err
	}
	rows, err := sv.DB.QueryContext(ctx, `SELECT `+commentCols+` FROM task_comments
		WHERE workspace_id = $1 AND task_id = $2 ORDER BY created_at, id`, s.WorkspaceID, t.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Comment{}
	for rows.Next() {
		c, err := scanComment(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *c)
	}
	return out, rows.Err()
}

func excerpt(s string) string {
	s = strings.Join(strings.Fields(s), " ")
	if r := []rune(s); len(r) > 140 {
		return string(r[:140]) + "…"
	}
	return s
}

// AddComment posts on a task as the caller (author_kind agent when via MCP).
func (sv *Service) AddComment(ctx context.Context, ref, body string) (*Comment, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	t, p, err := sv.writableTask(ctx, s, ref)
	if err != nil {
		return nil, err
	}
	body = strings.TrimSpace(body)
	if body == "" {
		return nil, invalid("a comment cannot be empty")
	}
	if len(body) > maxComment {
		return nil, invalid("a comment is at most %d characters", maxComment)
	}
	kind := "user"
	if s.Via == "mcp" {
		kind = "agent"
	}
	mentions := sv.resolveMentions(ctx, s.WorkspaceID, body)
	raw, _ := json.Marshal(mentions)
	var c *Comment
	err = sv.tx(ctx, func(tx *sql.Tx) error {
		var err error
		c, err = scanComment(tx.QueryRowContext(ctx, `INSERT INTO task_comments (workspace_id, task_id, author_id, author_kind, body, mentions)
			VALUES ($1, $2, $3, $4, $5, $6) RETURNING `+commentCols, s.WorkspaceID, t.ID, s.UserID, kind, body, string(raw)))
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE tasks SET updated_at = now() WHERE workspace_id = $1 AND id = $2`, s.WorkspaceID, t.ID); err != nil {
			return err
		}
		changes := map[string]any{"key": t.Key, "title": t.Title, "excerpt": excerpt(body)}
		if len(mentions) > 0 {
			changes["mentions"] = mentions
		}
		return record(ctx, tx, s, entry{ProjectID: p.ID, TaskID: t.ID, Action: "comment.added", SubjectType: "comment", SubjectID: c.ID, Changes: changes})
	})
	if err != nil {
		return nil, err
	}
	return c, nil
}

func (sv *Service) comment(ctx context.Context, id string) (*Comment, *Task, *Project, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, nil, nil, err
	}
	c, err := scanComment(sv.DB.QueryRowContext(ctx, `SELECT `+commentCols+` FROM task_comments WHERE workspace_id = $1 AND id = $2`,
		s.WorkspaceID, strings.TrimSpace(id)))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil, nil, notFound("comment")
	}
	if err != nil {
		return nil, nil, nil, err
	}
	t, p, err := sv.writableTask(ctx, s, c.TaskID)
	if e, ok := AsError(err); ok && e.Status == 404 {
		return nil, nil, nil, notFound("comment")
	}
	if err != nil {
		return nil, nil, nil, err
	}
	return c, t, p, nil
}

// EditComment changes the caller's own comment.
func (sv *Service) EditComment(ctx context.Context, id, body string) (*Comment, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	c, t, p, err := sv.comment(ctx, id)
	if err != nil {
		return nil, err
	}
	if c.AuthorID != s.UserID {
		return nil, forbidden("you can only edit your own comments")
	}
	body = strings.TrimSpace(body)
	if body == "" {
		return nil, invalid("a comment cannot be empty")
	}
	if len(body) > maxComment {
		return nil, invalid("a comment is at most %d characters", maxComment)
	}
	raw, _ := json.Marshal(sv.resolveMentions(ctx, s.WorkspaceID, body))
	err = sv.tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `UPDATE task_comments SET body = $3, mentions = $4, edited_at = now(), updated_at = now()
			WHERE workspace_id = $1 AND id = $2`, s.WorkspaceID, c.ID, body, string(raw)); err != nil {
			return err
		}
		return record(ctx, tx, s, entry{ProjectID: p.ID, TaskID: t.ID, Action: "comment.edited", SubjectType: "comment", SubjectID: c.ID,
			Changes: map[string]any{"key": t.Key, "excerpt": excerpt(body)}})
	})
	if err != nil {
		return nil, err
	}
	c, _, _, err = sv.comment(ctx, c.ID)
	return c, err
}

// DeleteComment removes the caller's own comment (managers: anyone's).
func (sv *Service) DeleteComment(ctx context.Context, id string) error {
	s, err := caller(ctx)
	if err != nil {
		return err
	}
	c, t, p, err := sv.comment(ctx, id)
	if err != nil {
		return err
	}
	if c.AuthorID != s.UserID && !authz.Can(s.Role, authz.CommentsModerate) {
		return forbidden("you can only delete your own comments")
	}
	return sv.tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `DELETE FROM task_comments WHERE workspace_id = $1 AND id = $2`, s.WorkspaceID, c.ID); err != nil {
			return err
		}
		return record(ctx, tx, s, entry{ProjectID: p.ID, TaskID: t.ID, Action: "comment.deleted", SubjectType: "comment", SubjectID: c.ID,
			Changes: map[string]any{"key": t.Key, "author_id": c.AuthorID}})
	})
}
