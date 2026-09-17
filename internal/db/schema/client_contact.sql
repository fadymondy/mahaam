-- Hand-written Postgres DDL (togo 0.2.31 make:resource emits SQLite; README note 1).
-- FKs, uniques, indexes and RLS live in internal/db/post (15_p7_constraints.sql, 25_rls_p7.sql).
--
-- client_contacts links a client-role workspace member (a person, in `users`)
-- to the clients row they represent. P7 chose a link table over clients.user_id:
-- a client company can have several portal contacts, while a portal user
-- represents exactly one client per workspace (UNIQUE (workspace_id, user_id)).
-- The client portal's project visibility is "projects whose client_id is the
-- client I am a contact of" — derived entirely from this row, never from
-- project_members, so an owner shares a client's whole book of projects at once.
CREATE TABLE IF NOT EXISTS client_contacts (
    id           text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    workspace_id text NOT NULL,
    client_id    text NOT NULL,
    user_id      text NOT NULL,
    created_by   text,
    created_at   timestamptz NOT NULL DEFAULT now()
);
