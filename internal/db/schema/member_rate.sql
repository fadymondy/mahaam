-- Hand-written Postgres DDL (togo 0.2.31 make:resource emits SQLite; README note 1).
-- Per-member, effective-dated rates in the workspace currency, minor units. The rate in force on a
-- day is the row with the latest effective_from <= that day (in the workspace timezone). Editing or
-- adding a row never touches time_entries: entries carry their own snapshot.
-- FKs, uniques and RLS: internal/db/post (12_p2_constraints.sql, 22_rls_p2.sql).
CREATE TABLE IF NOT EXISTS member_rates (
    id              text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    workspace_id    text NOT NULL,
    user_id         text NOT NULL,
    effective_from  date NOT NULL,
    bill_rate_minor bigint CHECK (bill_rate_minor IS NULL OR bill_rate_minor >= 0),
    cost_rate_minor bigint CHECK (cost_rate_minor IS NULL OR cost_rate_minor >= 0),
    currency        text NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
    created_by      text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CHECK (bill_rate_minor IS NOT NULL OR cost_rate_minor IS NOT NULL)
);
