-- Customer import (clients from CSV / XLSX / Google Contacts / WhatsApp vCard): the one column the
-- imported contacts carry that clients did not have yet. name, email, phone and notes already exist
-- (internal/db/schema/client.sql). Dedupe is by email (case-insensitive) or phone (digits only),
-- matched in internal/work/client_import.go; these indexes keep that lookup cheap. Not unique:
-- existing workspaces may already hold duplicates, which the importer reports instead of failing.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS company text;
ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_company_len;
ALTER TABLE clients ADD CONSTRAINT clients_company_len CHECK (company IS NULL OR length(company) <= 160);
CREATE INDEX IF NOT EXISTS clients_ws_email_idx ON clients (workspace_id, lower(email)) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS clients_ws_phone_idx ON clients (workspace_id, regexp_replace(phone, '[^0-9]', '', 'g')) WHERE phone IS NOT NULL;
