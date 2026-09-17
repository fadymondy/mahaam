-- Hand-written Postgres DDL (togo 0.2.31 make:resource emits SQLite; README note 1).
-- FKs, uniques, indexes and RLS live in internal/db/post (15_p7_constraints.sql, 25_rls_p7.sql).
--
-- project_feedback_keys are the per-project public keys the embeddable Feedback
-- SDK authenticates with. The public_key (pfk_<random>) is the ONLY credential the
-- public POST /api/feedback/embed endpoint accepts — no workspace header, no JWT.
-- allowed_origins is the CORS/Origin allowlist ('*' means any origin, discouraged).
-- A key is looked up cross-workspace by public_key on the owner pool (the caller
-- has no session), so token_hash-style hashing is unnecessary: the key IS public,
-- its power is bounded to filing an issue into one project, and it is revocable.
CREATE TABLE IF NOT EXISTS project_feedback_keys (
    id              text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    workspace_id    text NOT NULL,
    project_id      text NOT NULL,
    name            text NOT NULL DEFAULT '',
    public_key      text NOT NULL,
    active          boolean NOT NULL DEFAULT true,
    allowed_origins text[] NOT NULL DEFAULT '{}',
    created_by      text,
    last_used_at    timestamptz,
    revoked_at      timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (public_key)
);
