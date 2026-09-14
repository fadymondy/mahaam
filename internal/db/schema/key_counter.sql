-- Hand-written Postgres DDL (togo 0.2.31 make:resource emits SQLite; README note 1).
-- FKs, uniques, indexes and RLS live in internal/db/post (11_p1_constraints.sql, 21_rls_p1.sql).
-- One MG-<n> sequence per workspace, shared by tasks and reports so a key is never ambiguous.
-- Allocation is one INSERT ... ON CONFLICT DO UPDATE ... RETURNING (row-locked, race-free).
CREATE TABLE IF NOT EXISTS key_counters (
    workspace_id text PRIMARY KEY,
    value        bigint NOT NULL,
    updated_at   timestamptz NOT NULL DEFAULT now()
);
