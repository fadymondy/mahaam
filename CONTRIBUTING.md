# Contributing to Mahaam

Thanks for wanting to help. This guide covers how to get a local setup running, the conventions
the codebase follows, and how a change gets merged.

## Ways to contribute

- Report a bug or request a feature through the [issue forms](https://github.com/fadymondy/mahaam/issues/new/choose).
- Pick up an issue labelled [`good first issue`](https://github.com/fadymondy/mahaam/labels/good%20first%20issue)
  or [`help wanted`](https://github.com/fadymondy/mahaam/labels/help%20wanted). Comment on it first so nobody
  duplicates the work.
- Improve the docs. Typos and unclear sentences are worth a PR.

Security problems are **not** issues. Follow [SECURITY.md](SECURITY.md) instead.

## Local setup

Requirements: Go (version in `go.mod`), Node.js 22+, Docker (for Postgres), and `sqlc` 1.31.

```bash
cp .env.example .env           # set the mahaam_app password and AUTH_SECRET
make db                        # Postgres 16 in Docker on :55460
make migrate                   # schema, app role, constraints, RLS (idempotent)
make api                       # API on :8110 (REST /api, GraphQL /graphql, MCP /api/mcp)
cd web && npm install && cd .. # first time only
make web                       # web on :3010
```

Open http://localhost:3010, register, and create a workspace. The engineering notes in
[docs/architecture.md](docs/architecture.md) explain tenancy, RLS and the MCP surface; read the
relevant section before touching those areas.

## Before you open a pull request

```bash
make generate            # sqlc -> gqlgen -> OpenAPI export; grep the output for errors
go vet ./...
make test                # unit tests + CI guards (MCP scopes, tenant predicates, authz)
cd web && npx tsc --noEmit && npm run build
cd apps && npm run typecheck   # if you touched apps/
```

UI changes must work in English and Arabic (RTL), light and dark. Add strings to both
`web/lang/*.en.json` and `web/lang/*.ar.json`.

## Conventions

- **Small, focused PRs.** One concern per PR; refactors separate from behaviour changes.
- **Branch names:** `feat/…`, `fix/…`, `docs/…`, `chore/…` off `master`.
- **Commit messages:** [Conventional Commits](https://www.conventionalcommits.org/) style
  (`feat: …`, `fix: …`, `docs: …`), imperative mood, explain *why* in the body.
- **Tests:** a bug fix comes with a test that fails without it; a feature comes with tests for its
  main path and its permission checks.
- **No secrets** in code, tests, fixtures or screenshots. Configuration goes in `.env`
  (documented in `.env.example`).
- **AI-assisted contributions are welcome.** Agents should read [AGENTS.md](AGENTS.md). You are
  responsible for every line you submit: review it, run it, and test it as if you wrote it.

## Developer Certificate of Origin (DCO)

Every commit must be signed off, certifying the [Developer Certificate of Origin](https://developercertificate.org/):
you wrote the change, or otherwise have the right to submit it under the project's license.

```bash
git commit -s -m "fix: describe the change"
```

This adds a `Signed-off-by: Your Name <you@example.com>` trailer that matches your Git identity.
Forgot? `git commit --amend -s` for the last commit, or `git rebase --signoff master` for a branch.

## License

Mahaam is licensed under the [GNU AGPL-3.0](LICENSE). By contributing you agree your contribution
is licensed under the same terms.

## Community

- **Questions and ideas:** [GitHub Discussions](https://github.com/fadymondy/mahaam/discussions)
- **Chat:** [Discord](https://discord.gg/a59RzxnB2H)
- **Bugs and feature requests:** [Issues](https://github.com/fadymondy/mahaam/issues/new/choose)

Everyone taking part is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
