-- Billing through Polar (internal/billing/polar). Platform tables and columns: owner pool only,
-- no app-role grant, no RLS. Nothing here needs a superuser.

-- Polar ids of a plan's product and prices (written by `mahaam-admin polar-sync`).
ALTER TABLE plans ADD COLUMN IF NOT EXISTS polar_product_id text;
-- {"base": "<price id>", "<limit key>": "<metered price id>", ...}
ALTER TABLE plans ADD COLUMN IF NOT EXISTS polar_price_ids jsonb NOT NULL DEFAULT '{}'::jsonb;

-- One Polar meter per metered limit key (shared by every plan's metered price for that key).
CREATE TABLE IF NOT EXISTS polar_meters (
    limit_key  text PRIMARY KEY,
    meter_id   text        NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- A workspace's subscription as Polar reports it (webhooks).
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS billing_status text;               -- active | past_due | canceled | revoked
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS billing_period_end timestamptz;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS billing_cancel_at_period_end boolean NOT NULL DEFAULT false;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS polar_customer_id text;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS polar_subscription_id text;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS billing_updated_at timestamptz;

-- Webhook deliveries already processed (Standard Webhooks `webhook-id`): a replay is a no-op.
CREATE TABLE IF NOT EXISTS polar_webhook_events (
    id          text PRIMARY KEY,
    type        text        NOT NULL,
    workspace_id text,
    received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS polar_webhook_events_at_idx ON polar_webhook_events (received_at DESC);

-- Usage already pushed to Polar's event ingest, per workspace, month and limit key, in billing
-- units. The push sends only the difference, and the event's external_id is derived from the
-- cumulative value, so a crash between send and record is deduplicated by Polar.
CREATE TABLE IF NOT EXISTS polar_usage_sent (
    workspace_id text        NOT NULL,
    period       date        NOT NULL,
    limit_key    text        NOT NULL,
    units_sent   bigint      NOT NULL DEFAULT 0,
    updated_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, period, limit_key)
);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'polar_usage_sent_ws_fk') THEN
        ALTER TABLE polar_usage_sent ADD CONSTRAINT polar_usage_sent_ws_fk FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE;
    END IF;
END $$;
