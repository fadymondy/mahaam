-- Postgres queries for task_statuses. Tenant predicate required (internal/guards). The domain code
-- lives in internal/work; this keeps sqlc typed against the real schema.

-- name: ListTaskStatusesByWorkspace :many
SELECT * FROM task_statuses WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT $2;
