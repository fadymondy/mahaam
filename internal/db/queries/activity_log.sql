-- Postgres queries for activity_logs. Tenant predicate required (internal/guards). The domain code
-- lives in internal/work; this keeps sqlc typed against the real schema.

-- name: ListActivityLogsByWorkspace :many
SELECT * FROM activity_logs WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT $2;
