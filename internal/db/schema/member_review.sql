-- Hand-written Postgres DDL. FKs/indexes in post/18c_kpi_constraints.sql, RLS in post/29a_rls_kpi.sql.
--
-- member_reviews: a manager's written review of an employee for a period (the human input of the
-- employee KPI dossier). Managers+ write them; the employee reads their own.
CREATE TABLE IF NOT EXISTS member_reviews (
    id           text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    workspace_id text NOT NULL,
    user_id      text NOT NULL,
    author_id    text NOT NULL,
    period_start date NOT NULL,
    period_end   date NOT NULL,
    rating       smallint CHECK (rating IS NULL OR (rating BETWEEN 1 AND 5)),
    body         text NOT NULL CHECK (length(btrim(body)) > 0 AND length(body) <= 20000),
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CHECK (period_end >= period_start)
);
