-- Hand-written Postgres DDL (README note 1). FKs/indexes in 14_p6_constraints.sql, RLS in 24_rls_p6.sql.
--
-- One line of an invoice. Lines drafted from time carry source_time_entry_ids (the entries they
-- bill, as a JSON array of ids) so a line is traceable back to the locked entries; a hand-added line
-- leaves it null. quantity is hours (numeric, 4 dp for display), unit_minor the per-hour rate in
-- minor units, amount_minor = round(quantity * unit_minor) computed exactly from seconds in Go.
CREATE TABLE IF NOT EXISTS invoice_lines (
    id                    text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    workspace_id          text NOT NULL,
    invoice_id            text NOT NULL,
    description           text NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
    quantity              numeric(14,4) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    unit_minor            bigint NOT NULL DEFAULT 0 CHECK (unit_minor >= 0),
    amount_minor          bigint NOT NULL DEFAULT 0 CHECK (amount_minor >= 0),
    source_time_entry_ids jsonb,
    position              double precision NOT NULL DEFAULT 0,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now()
);
