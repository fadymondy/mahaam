-- Hand-written Postgres DDL (README note 1). FKs/indexes in 18b_billing_constraints.sql, RLS in 29_rls_billing.sql.
--
-- AI consumption per project and day: tokens and what they cost us, pushed over MCP / REST
-- by agents or scripts (idempotent per project + day + provider + model + source). Billable
-- rows go onto the client's next drafted invoice at cost x (1 + the project's AI markup),
-- then carry invoice_id and are locked, like time entries.
CREATE TABLE IF NOT EXISTS ai_usage (
    id                  text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    workspace_id        text NOT NULL,
    project_id          text NOT NULL,
    day                 date NOT NULL,
    provider            text NOT NULL DEFAULT 'anthropic',
    model               text NOT NULL,
    source              text NOT NULL DEFAULT 'api',
    input_tokens        bigint NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
    output_tokens       bigint NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
    cache_read_tokens   bigint NOT NULL DEFAULT 0 CHECK (cache_read_tokens >= 0),
    cache_write_tokens  bigint NOT NULL DEFAULT 0 CHECK (cache_write_tokens >= 0),
    requests            bigint NOT NULL DEFAULT 0 CHECK (requests >= 0),
    cost_minor          bigint NOT NULL DEFAULT 0 CHECK (cost_minor >= 0),
    currency            text NOT NULL DEFAULT 'USD',
    billable            boolean NOT NULL DEFAULT true,
    user_id             text,
    note                text,
    invoice_id          text,
    locked_at           timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, project_id, day, provider, model, source)
);
