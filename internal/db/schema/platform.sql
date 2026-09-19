-- Platform tables: plans and limits, metered usage, platform user flags and the admin audit.
-- These are NOT tenant tables: no workspace RLS policy, no grant to the app role. They are read
-- and written on the owner pool only (internal/limits, internal/admin). Seeds, the workspace
-- columns (plan status, overrides) and the usage triggers are in internal/db/post/19d_platform.sql.

-- A plan is a set of quotas. limits is keyed by the catalog in internal/limits/catalog.go:
--   {"projects": {"limit": 2, "policy": "block", "unit_price_minor": 0, "unit_size": 1}, ...}
-- limit null (or the key absent) = unlimited. policy block = hard cap; overage = allowed and
-- billed per unit_size at unit_price_minor (pay-as-you-go). features holds the feature gates.
CREATE TABLE IF NOT EXISTS plans (
    key            text PRIMARY KEY CHECK (key ~ '^[a-z0-9][a-z0-9_-]{0,39}$'),
    name_en        text        NOT NULL,
    name_ar        text        NOT NULL,
    description_en text        NOT NULL DEFAULT '',
    description_ar text        NOT NULL DEFAULT '',
    currency       text        NOT NULL DEFAULT 'USD',
    base_fee_minor bigint      NOT NULL DEFAULT 0 CHECK (base_fee_minor >= 0),
    price_label_en text        NOT NULL DEFAULT '',
    price_label_ar text        NOT NULL DEFAULT '',
    limits         jsonb       NOT NULL DEFAULT '{}'::jsonb,
    features       jsonb       NOT NULL DEFAULT '{}'::jsonb,
    active         boolean     NOT NULL DEFAULT true,
    sort           integer     NOT NULL DEFAULT 0,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Metered usage, one row per workspace per calendar month (UTC). Monthly counters are bumped by
-- triggers (issues, tasks) and by the API meter (api_calls, flushed from memory every minute);
-- peaks holds the month's high-water marks of the count limits and storage_mb.
CREATE TABLE IF NOT EXISTS workspace_usage (
    workspace_id   text        NOT NULL,
    period         date        NOT NULL,
    issues_created bigint      NOT NULL DEFAULT 0,
    tasks_created  bigint      NOT NULL DEFAULT 0,
    api_calls      bigint      NOT NULL DEFAULT 0,
    peaks          jsonb       NOT NULL DEFAULT '{}'::jsonb,
    updated_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, period)
);

-- Platform-level flags on a user account (the auth plugin owns `users`; its ORM reads that table
-- whole, so Mahaam keeps its own columns here). sessions_valid_after: a session token issued
-- before it is refused (force sign-out).
CREATE TABLE IF NOT EXISTS platform_users (
    user_id              text PRIMARY KEY,
    suspended_at         timestamptz,
    suspended_reason     text,
    sessions_valid_after timestamptz,
    last_seen_at         timestamptz,
    updated_at           timestamptz NOT NULL DEFAULT now()
);

-- Append-only record of what platform admins did (REST and admin MCP).
CREATE TABLE IF NOT EXISTS admin_audit (
    id           text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    actor_id     text        NOT NULL,
    actor_email  text        NOT NULL DEFAULT '',
    action       text        NOT NULL,
    target_type  text        NOT NULL DEFAULT '',
    target_id    text        NOT NULL DEFAULT '',
    target_label text        NOT NULL DEFAULT '',
    changes      jsonb,
    ip           text        NOT NULL DEFAULT '',
    via          text        NOT NULL DEFAULT 'rest',
    at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_audit_at_idx ON admin_audit (at DESC);

-- One-off data migrations already applied (so an idempotent migrate run does not repeat them).
CREATE TABLE IF NOT EXISTS platform_meta (
    key   text PRIMARY KEY,
    value text        NOT NULL DEFAULT '',
    at    timestamptz NOT NULL DEFAULT now()
);

-- Web Push (PWA) subscriptions, one per browser/device a user enabled notifications on. User-level,
-- not tenant data: owner pool only (internal/push). A subscription the push service reports gone
-- (404/410) is deleted on the next send.
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id         text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id    text        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint   text        NOT NULL UNIQUE,
    p256dh     text        NOT NULL,
    auth       text        NOT NULL,
    user_agent text        NOT NULL DEFAULT '',
    locale     text        NOT NULL DEFAULT 'en',
    created_at timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz
);
CREATE INDEX IF NOT EXISTS push_subscriptions_user ON push_subscriptions (user_id);
