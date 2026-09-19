-- Hand-written Postgres DDL (README note 1). FKs/indexes in 18b_billing_constraints.sql, RLS in 29_rls_billing.sql.
--
-- What a customer project subscribes to through us: infrastructure, AI, marketing tools,
-- domains, software, support ... with what it costs us and what we bill. Each billing period
-- becomes one subscription_charges row when an invoice is drafted (unique per period), so a
-- period is billed once; voiding the invoice deletes its charges and releases the periods.
CREATE TABLE IF NOT EXISTS project_subscriptions (
    id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    workspace_id  text NOT NULL,
    project_id    text NOT NULL,
    name          text NOT NULL CHECK (length(btrim(name)) > 0),
    category      text NOT NULL DEFAULT 'other'
                  CHECK (category IN ('infrastructure', 'ai', 'marketing', 'software', 'domain', 'support', 'other')),
    vendor        text,
    price_minor   bigint NOT NULL DEFAULT 0 CHECK (price_minor >= 0),
    cost_minor    bigint NOT NULL DEFAULT 0 CHECK (cost_minor >= 0),
    currency      text NOT NULL DEFAULT 'USD',
    interval      text NOT NULL DEFAULT 'month' CHECK (interval IN ('month', 'quarter', 'year', 'one_time')),
    starts_on     date NOT NULL DEFAULT current_date,
    ends_on       date,
    billable      boolean NOT NULL DEFAULT true,
    active        boolean NOT NULL DEFAULT true,
    notes         text,
    created_by    text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subscription_charges (
    id              text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    workspace_id    text NOT NULL,
    subscription_id text NOT NULL,
    project_id      text NOT NULL,
    period_start    date NOT NULL,
    period_end      date NOT NULL,
    amount_minor    bigint NOT NULL CHECK (amount_minor >= 0),
    currency        text NOT NULL,
    invoice_id      text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, subscription_id, period_start)
);
