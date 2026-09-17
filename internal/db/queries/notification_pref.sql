-- Postgres queries for notification_prefs. Tenant predicate required (internal/guards).

-- name: GetNotificationPref :one
SELECT * FROM notification_prefs WHERE workspace_id = $1 AND user_id = $2;
