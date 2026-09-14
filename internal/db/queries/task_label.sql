-- Postgres queries for task_labels. Tenant predicate required (internal/guards). The domain code
-- lives in internal/work; this keeps sqlc typed against the real schema.

-- name: ListTaskLabelsByWorkspace :many
SELECT * FROM task_labels WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT $2;
