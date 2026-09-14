-- Postgres queries for task_checklist_items. Tenant predicate required (internal/guards). The domain code
-- lives in internal/work; this keeps sqlc typed against the real schema.

-- name: ListTaskChecklistItemsByWorkspace :many
SELECT * FROM task_checklist_items WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT $2;
