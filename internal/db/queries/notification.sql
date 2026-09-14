-- Postgres queries for notifications. Tenant predicate required (internal/guards).

-- name: ListNotifications :many
SELECT * FROM notifications WHERE workspace_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT $3;
