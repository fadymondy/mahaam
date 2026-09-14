-- Postgres queries for attachments. Tenant predicate required (internal/guards). The domain code
-- lives in internal/work; this keeps sqlc typed against the real schema.

-- name: ListAttachmentsByWorkspace :many
SELECT * FROM attachments WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT $2;
