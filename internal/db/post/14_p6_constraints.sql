-- P6 integrity: invoices, invoice_lines, invoice_payments, invoice_counters. Same model as the P1/P2
-- constraints: every reference between tenant rows is a composite (workspace_id, ref) foreign key, so
-- no invoice, line or payment can point into another workspace whatever the code does.

-- Targets for the composite keys.
CREATE UNIQUE INDEX IF NOT EXISTS clients_ws_id_uq  ON clients (workspace_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS invoices_ws_id_uq ON invoices (workspace_id, id);

-- One invoice number per workspace.
CREATE UNIQUE INDEX IF NOT EXISTS invoices_number_uq ON invoices (workspace_id, number);

DO $$
DECLARE
    fk text[];
BEGIN
    FOREACH fk SLICE 1 IN ARRAY ARRAY[
        ['invoices_workspace_fk',  'invoices',        'FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE'],
        ['invoices_client_fk',     'invoices',        'FOREIGN KEY (workspace_id, client_id) REFERENCES clients (workspace_id, id)'],
        ['invoices_creator_fk',    'invoices',        'FOREIGN KEY (created_by) REFERENCES users (id)'],
        ['invoice_lines_ws_fk',    'invoice_lines',   'FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE'],
        ['invoice_lines_inv_fk',   'invoice_lines',   'FOREIGN KEY (workspace_id, invoice_id) REFERENCES invoices (workspace_id, id) ON DELETE CASCADE'],
        ['invoice_pay_ws_fk',      'invoice_payments','FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE'],
        ['invoice_pay_inv_fk',     'invoice_payments','FOREIGN KEY (workspace_id, invoice_id) REFERENCES invoices (workspace_id, id) ON DELETE CASCADE'],
        ['invoice_pay_creator_fk', 'invoice_payments','FOREIGN KEY (created_by) REFERENCES users (id)'],
        ['invoice_counters_ws_fk', 'invoice_counters','FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE'],
        -- A time entry's reserved invoice link, now a real FK: releasing an invoice's rows is a
        -- plain UPDATE in internal/work, but if an invoice is ever deleted the entries are released.
        ['time_entries_invoice_fk', 'time_entries',   'FOREIGN KEY (workspace_id, invoice_id) REFERENCES invoices (workspace_id, id) ON DELETE SET NULL (invoice_id)']
    ] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = fk[1]) THEN
            EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s', fk[2], fk[1], fk[3]);
        END IF;
    END LOOP;
END $$;

-- Access paths, every one leading with workspace_id.
CREATE INDEX IF NOT EXISTS invoices_client_idx      ON invoices (workspace_id, client_id, issue_date DESC);
CREATE INDEX IF NOT EXISTS invoices_status_idx      ON invoices (workspace_id, status);
CREATE INDEX IF NOT EXISTS invoice_lines_inv_idx    ON invoice_lines (workspace_id, invoice_id, position);
CREATE INDEX IF NOT EXISTS invoice_payments_inv_idx ON invoice_payments (workspace_id, invoice_id, paid_at);
-- Which entries a given invoice locked (release on void, "unbilled" excludes invoiced).
CREATE INDEX IF NOT EXISTS time_entries_invoice_idx ON time_entries (workspace_id, invoice_id) WHERE invoice_id IS NOT NULL;
