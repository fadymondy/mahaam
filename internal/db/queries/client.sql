-- Postgres queries for clients. Tenant predicate required (internal/guards). The domain code
-- lives in internal/work; this keeps sqlc typed against the real schema.

-- name: ListClientsByWorkspace :many
SELECT * FROM clients WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT $2;
