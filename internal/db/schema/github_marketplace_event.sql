-- GitHub Marketplace purchase events (purchased/changed/pending_change/pending_change_cancelled/
-- cancelled): a platform table, NOT tenant data — no workspace RLS, no grant to the app role.
-- Read and written on the owner pool only (internal/billing/ghmarketplace), like platform.sql.
-- delivery_id dedupes GitHub's at-least-once redelivery.
CREATE TABLE IF NOT EXISTS github_marketplace_events (
    id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    delivery_id   text        NOT NULL UNIQUE,
    action        text        NOT NULL,
    account_login text        NOT NULL DEFAULT '',
    account_id    bigint,
    account_type  text        NOT NULL DEFAULT '',
    sender_login  text        NOT NULL DEFAULT '',
    plan_id       bigint,
    plan_name     text        NOT NULL DEFAULT '',
    unit_count    bigint,
    billing_cycle text        NOT NULL DEFAULT '',
    on_free_trial boolean     NOT NULL DEFAULT false,
    payload       jsonb       NOT NULL,
    -- Set once a human has matched the purchase to a workspace/plan; NULL = needs attention.
    handled_at    timestamptz,
    received_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS github_marketplace_events_unhandled ON github_marketplace_events (received_at) WHERE handled_at IS NULL;
