-- Postgres queries for project_teams. Tenant predicate required (internal/guards). The domain code
-- lives in internal/work; this keeps sqlc typed against the real schema.

-- name: ListProjectTeamsByWorkspace :many
SELECT * FROM project_teams WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT $2;
