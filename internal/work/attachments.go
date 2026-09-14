package work

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"path/filepath"
	"strings"
	"time"
	"unicode"

	"github.com/fadymondy/managy/internal/authz"
)

// MaxAttachment is the largest file a task accepts.
const MaxAttachment = 25 << 20

// Attachment is a file on a task. The bytes live in togo storage; they are only ever served
// through the authorised download endpoint, never by path.
type Attachment struct {
	ID          string    `json:"id"`
	TaskID      string    `json:"task_id"`
	FileName    string    `json:"file_name"`
	ContentType string    `json:"content_type"`
	Size        int64     `json:"size"`
	UploadedBy  string    `json:"uploaded_by"`
	CreatedAt   time.Time `json:"created_at"`
}

const attachmentCols = `id, task_id, file_name, content_type, size, uploaded_by, created_at`

func scanAttachment(r scanner, path *string) (*Attachment, error) {
	a := &Attachment{}
	dest := []any{&a.ID, &a.TaskID, &a.FileName, &a.ContentType, &a.Size, &a.UploadedBy, &a.CreatedAt}
	if path != nil {
		dest = append(dest, path)
	}
	return a, r.Scan(dest...)
}

// ListAttachments lists a task's files, newest first.
func (sv *Service) ListAttachments(ctx context.Context, ref string) ([]Attachment, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	t, err := loadTask(ctx, sv.DB, s, ref)
	if err != nil {
		return nil, err
	}
	rows, err := sv.DB.QueryContext(ctx, `SELECT `+attachmentCols+` FROM attachments WHERE workspace_id = $1 AND task_id = $2
		ORDER BY created_at DESC`, s.WorkspaceID, t.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Attachment{}
	for rows.Next() {
		a, err := scanAttachment(rows, nil)
		if err != nil {
			return nil, err
		}
		out = append(out, *a)
	}
	return out, rows.Err()
}

// cleanFileName keeps a display name safe: base name only, no control characters, bounded.
func cleanFileName(name string) string {
	name = filepath.Base(strings.ReplaceAll(name, "\\", "/"))
	name = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) || r == '"' {
			return -1
		}
		return r
	}, name)
	name = strings.TrimSpace(name)
	if name == "" || name == "." || name == "/" {
		name = "file"
	}
	if r := []rune(name); len(r) > 200 {
		name = string(r[len(r)-200:])
	}
	return name
}

func (sv *Service) removeFiles(paths []string) {
	if sv.Store == nil {
		return
	}
	for _, p := range paths {
		if err := sv.Store.Delete(p); err != nil && sv.Log != nil {
			sv.Log.Warn("attachment file not removed", "path", p, "err", err)
		}
	}
}

// AddAttachment stores a file on a task.
func (sv *Service) AddAttachment(ctx context.Context, ref, name, contentType string, data []byte) (*Attachment, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	t, p, err := sv.writableTask(ctx, s, ref)
	if err != nil {
		return nil, err
	}
	if sv.Store == nil {
		return nil, &Error{http.StatusServiceUnavailable, "file storage is not configured"}
	}
	if len(data) == 0 {
		return nil, invalid("the file is empty")
	}
	if len(data) > MaxAttachment {
		return nil, &Error{http.StatusRequestEntityTooLarge, "files are limited to 25 MB"}
	}
	name = cleanFileName(name)
	contentType = strings.TrimSpace(strings.ToLower(contentType))
	if contentType == "" || contentType == "application/octet-stream" {
		contentType = http.DetectContentType(data)
	}
	id := newID()
	path := "attachments/" + s.WorkspaceID + "/" + id
	if err := sv.Store.Put(path, data); err != nil {
		return nil, err
	}
	var a *Attachment
	err = sv.tx(ctx, func(tx *sql.Tx) error {
		var err error
		a, err = scanAttachment(tx.QueryRowContext(ctx, `INSERT INTO attachments (id, workspace_id, task_id, file_name, content_type, size, storage_path, uploaded_by)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING `+attachmentCols,
			id, s.WorkspaceID, t.ID, name, contentType, int64(len(data)), path, s.UserID), nil)
		if err != nil {
			return err
		}
		return record(ctx, tx, s, entry{ProjectID: p.ID, TaskID: t.ID, Action: "attachment.added", SubjectType: "attachment", SubjectID: id,
			Changes: map[string]any{"key": t.Key, "file": name, "size": len(data)}})
	})
	if err != nil {
		sv.removeFiles([]string{path})
		return nil, err
	}
	return a, nil
}

func (sv *Service) attachment(ctx context.Context, id string) (*Attachment, string, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, "", err
	}
	var path string
	a, err := scanAttachment(sv.DB.QueryRowContext(ctx, `SELECT `+attachmentCols+`, storage_path FROM attachments
		WHERE workspace_id = $1 AND id = $2`, s.WorkspaceID, strings.TrimSpace(id)), &path)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, "", notFound("attachment")
	}
	if err != nil {
		return nil, "", err
	}
	// Access follows the task's project.
	if _, err := loadTask(ctx, sv.DB, s, a.TaskID); err != nil {
		return nil, "", notFound("attachment")
	}
	return a, path, nil
}

// OpenAttachment returns a file's metadata and bytes.
func (sv *Service) OpenAttachment(ctx context.Context, id string) (*Attachment, []byte, error) {
	a, path, err := sv.attachment(ctx, id)
	if err != nil {
		return nil, nil, err
	}
	if sv.Store == nil {
		return nil, nil, &Error{http.StatusServiceUnavailable, "file storage is not configured"}
	}
	data, err := sv.Store.Get(path)
	if err != nil {
		return nil, nil, &Error{http.StatusGone, "the file is missing from storage"}
	}
	return a, data, nil
}

// DeleteAttachment removes a file (its uploader, a manager or the project lead).
func (sv *Service) DeleteAttachment(ctx context.Context, id string) error {
	s, err := caller(ctx)
	if err != nil {
		return err
	}
	a, path, err := sv.attachment(ctx, id)
	if err != nil {
		return err
	}
	t, p, err := sv.writableTask(ctx, s, a.TaskID)
	if err != nil {
		return err
	}
	if a.UploadedBy != s.UserID && !authz.Can(s.Role, authz.ProjectsManage) && !canManage(ctx, sv.DB, s, p.ID) {
		return forbidden("only the uploader, a manager or the project lead can remove this file")
	}
	err = sv.tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `DELETE FROM attachments WHERE workspace_id = $1 AND id = $2`, s.WorkspaceID, a.ID); err != nil {
			return err
		}
		return record(ctx, tx, s, entry{ProjectID: p.ID, TaskID: t.ID, Action: "attachment.removed", SubjectType: "attachment", SubjectID: a.ID,
			Changes: map[string]any{"key": t.Key, "file": a.FileName}})
	})
	if err != nil {
		return err
	}
	sv.removeFiles([]string{path})
	return nil
}
