-- Hand-written Postgres DDL (README note 1). RLS in 24_rls_p6.sql.
--
-- Per-workspace, per-year invoice number sequence. INSERT ... ON CONFLICT DO UPDATE takes the row
-- lock, so concurrent drafts serialise on it and never share a number (internal/work NextInvoiceNumber).
CREATE TABLE IF NOT EXISTS invoice_counters (
    workspace_id text NOT NULL,
    year         int  NOT NULL,
    value        bigint NOT NULL DEFAULT 0,
    updated_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, year)
);
