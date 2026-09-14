-- Postgres queries for tasks. Tenant predicate required (internal/guards). The domain code
-- lives in internal/work; this keeps sqlc typed against the real schema.

-- name: ListTasksByWorkspace :many
SELECT * FROM tasks WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT $2;
