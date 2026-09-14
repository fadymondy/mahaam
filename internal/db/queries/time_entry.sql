-- Postgres queries for time_entries. Tenant predicate required (internal/guards). The domain code
-- (start/stop/log, the invariants, rate snapshots, timesheets) lives in internal/work/time.go;
-- this keeps sqlc typed against the real schema.

-- name: GetTimeEntry :one
SELECT * FROM time_entries WHERE workspace_id = $1 AND id = $2;

-- name: RunningTimeEntry :one
SELECT * FROM time_entries WHERE workspace_id = $1 AND user_id = $2 AND ended_at IS NULL;

-- name: ListTimeEntriesInRange :many
SELECT * FROM time_entries
WHERE workspace_id = $1 AND user_id = $2 AND started_at < $3 AND (ended_at IS NULL OR ended_at > $4)
ORDER BY started_at;
