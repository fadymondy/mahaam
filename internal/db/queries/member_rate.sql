-- Postgres queries for member_rates. Tenant predicate required (internal/guards).

-- name: ListMemberRates :many
SELECT * FROM member_rates WHERE workspace_id = $1 AND user_id = $2 ORDER BY effective_from DESC;
