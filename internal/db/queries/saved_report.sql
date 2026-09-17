-- Postgres queries for saved_reports. Tenant predicate required (internal/guards).

-- name: ListSavedReports :many
SELECT * FROM saved_reports WHERE workspace_id = $1 AND (owner_id = $2 OR shared) ORDER BY lower(name);
