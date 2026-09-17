-- Hand-written Postgres DDL (README note 1). FKs/indexes in 14_p6_constraints.sql, RLS in 24_rls_p6.sql.
--
-- One payment recorded against an invoice ("mark paid"). When the recorded payments cover the total,
-- internal/work flips the invoice to 'paid'. amount_minor is in the invoice's currency.
CREATE TABLE IF NOT EXISTS invoice_payments (
    id           text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    workspace_id text NOT NULL,
    invoice_id   text NOT NULL,
    amount_minor bigint NOT NULL CHECK (amount_minor > 0),
    paid_at      timestamptz NOT NULL DEFAULT now(),
    ref          text,
    created_by   text NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now()
);
