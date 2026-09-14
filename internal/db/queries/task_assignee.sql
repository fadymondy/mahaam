-- Postgres queries for task_assignees. Tenant predicate required (internal/guards). The domain code
-- lives in internal/work; this keeps sqlc typed against the real schema.

-- name: ListTaskAssigneesByWorkspace :many
SELECT * FROM task_assignees WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT $2;
