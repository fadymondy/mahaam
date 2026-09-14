-- Postgres queries for reports (tenant predicate required).

-- name: GetReportByKey :one
SELECT * FROM reports WHERE workspace_id = $1 AND key = $2;

-- name: ListReports :many
SELECT * FROM reports WHERE workspace_id = $1 ORDER BY sort_order ASC, created_at DESC LIMIT $2 OFFSET $3;
