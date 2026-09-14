-- Postgres queries for team_members. Tenant predicate required (internal/guards). The domain code
-- lives in internal/work; this keeps sqlc typed against the real schema.

-- name: ListTeamMembersByWorkspace :many
SELECT * FROM team_members WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT $2;
