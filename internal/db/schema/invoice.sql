-- Hand-written Postgres DDL (togo 0.2.31 make:resource emits SQLite; README note 1).
-- FKs, the per-workspace number sequence, indexes and RLS live in internal/db/post
-- (14_p6_constraints.sql, 24_rls_p6.sql). The domain code is internal/work/invoices.go.
--
-- P6 (plan: "Invoices from unbilled time"). Money is minor units (bigint), never float; VAT is a
-- rate (tax_rate, a fraction like 0.1400 = 14%), and every money value is in the invoice's currency,
-- snapshotted from the client/workspace when the draft is made. A draft gathers a client's unbilled,
-- billable time, locks those entries (sets time_entries.invoice_id + locked_at, which makes them
-- immutable), and voiding the invoice releases them again.
--
--   subtotal_minor  sum of the lines' amount_minor
--   tax_minor       round(subtotal_minor * tax_rate)   (half up, in internal/work)
--   total_minor     subtotal_minor + tax_minor
--   status          draft -> sent -> paid | void  (transitions guarded in internal/work)
CREATE TABLE IF NOT EXISTS invoices (
    id             text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    workspace_id   text NOT NULL,
    client_id      text NOT NULL,
    number         text NOT NULL,                       -- INV-2026-000001, per-workspace sequence
    status         text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','paid','void')),
    currency       text NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
    issue_date     date NOT NULL DEFAULT current_date,
    due_date       date,
    subtotal_minor bigint NOT NULL DEFAULT 0 CHECK (subtotal_minor >= 0),
    tax_rate       numeric(6,4) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0 AND tax_rate <= 10),
    tax_minor      bigint NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
    total_minor    bigint NOT NULL DEFAULT 0 CHECK (total_minor >= 0),
    notes          text,
    created_by     text NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);
