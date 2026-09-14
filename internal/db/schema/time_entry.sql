-- Hand-written Postgres DDL (togo 0.2.31 make:resource emits SQLite; README note 1).
-- FKs, the invariants' index/exclusion and RLS live in internal/db/post (12_p2_constraints.sql,
-- 22_rls_p2.sql). The domain code is internal/work/time.go.
--
-- The time-tracking invariants (plan, "Time tracking, rebuilt around invariants"):
--   one_running_timer  unique partial index: one entry with ended_at IS NULL per (workspace, user)
--   no_overlap         gist exclusion (btree_gist): a person's entries never overlap in a workspace
--   duration_s         GENERATED from started_at/ended_at — never written, never wrong
-- Rates are SNAPSHOTS taken when the entry is started or logged (bill: task -> project -> member ->
-- workspace default; cost: member -> workspace default), in the workspace currency of that moment,
-- so editing a rate never rewrites history. Rounding is applied at report time only, never stored.
-- invoice_id / locked_at are reserved for P6 (invoices) and P5 (approval): a set value makes the
-- entry immutable (internal/work refuses edits and deletes).
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS time_entries (
    id              text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    workspace_id    text NOT NULL,
    user_id         text NOT NULL,
    project_id      text,
    task_id         text,
    client_id       text,
    description     text NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
    started_at      timestamptz NOT NULL,
    ended_at        timestamptz,
    duration_s      bigint GENERATED ALWAYS AS (
                        CASE WHEN ended_at IS NULL THEN NULL
                             ELSE floor(extract(epoch FROM ended_at - started_at))::bigint END) STORED,
    billable        boolean NOT NULL DEFAULT false,
    bill_rate_minor bigint CHECK (bill_rate_minor IS NULL OR bill_rate_minor >= 0),
    cost_rate_minor bigint CHECK (cost_rate_minor IS NULL OR cost_rate_minor >= 0),
    currency        text NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
    source          text NOT NULL DEFAULT 'timer' CHECK (source IN ('timer','manual','mcp','import')),
    invoice_id      text,
    locked_at       timestamptz,
    created_by      text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CHECK (ended_at IS NULL OR ended_at > started_at),
    CHECK (task_id IS NULL OR project_id IS NOT NULL)
);
