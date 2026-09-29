# Mahaam plugin for Claude Code

Work your Mahaam board from Claude Code. The plugin bundles:

| | |
|---|---|
| **MCP server** `mahaam` | Every Mahaam tool: projects, issues, tasks, time, clients, reports, vault. Connects with OAuth. |
| **Skills** | `/mahaam:setup`, `/mahaam:issues`, `/mahaam:report-issue`, `/mahaam:track-time`, `/mahaam:ai-cost`, `/mahaam:status` |
| **Agents** | `issue-worker` (one issue end to end), `triager` (backlog grooming, no code changes), `project-reporter` (read-only status) |
| **Hooks** | SessionStart: announces the repo's project. PostToolUse on the issue lifecycle: banks each issue's **tokens and cost**. |

## Install

```text
/plugin marketplace add fadymondy/mahaam
/plugin install mahaam@mahaam
```

Then run `/mcp`, choose **mahaam** and **Authenticate**. A browser opens Mahaam's consent screen:
pick the workspace and approve. Finally run `/mahaam:setup` to link the repo.

Self-hosted Mahaam: `export MAHAAM_URL=https://mahaam.example.com` before starting Claude Code.

## Link a repo

`/mahaam:setup` writes `.mahaam.json` at the repo root. You can commit it, because it holds no secret:

```json
{ "project": "Acme Website", "workspace": "acme", "strategy": "sequential" }
```

## Issues loop

```text
/mahaam:issues                        # the linked project, its default strategy
/mahaam:issues "Acme Website" parallel
/loop 10m /mahaam:issues drain        # keep working the board
```

Mahaam's clock runs while an issue is `todo` or `in_progress` and stops at review, approval or done,
whatever moved it. When an agent closes an issue, the hook adds up the session's tokens since
`start_issue`, per model, and banks them on the issue with `record_issue_usage`. Tokens and cost
then show on the issue card and page and in the project's AI usage and billing.

- With `MAHAAM_TOKEN` set (an `mgy_` token with `issues:read issues:write ai:record`), the hook
  records the usage itself.
- Without it, the hook passes the exact numbers to Claude, and Claude calls the tool. The OAuth
  connection then needs `ai:record`.

Cost is estimated from list prices per model family (USD per million tokens):

| Family | Input | Output |
|---|---|---|
| Opus, Fable | 5 | 25 |
| Sonnet | 3 | 15 |
| Haiku | 1 | 5 |

Cache reads are charged at 0.1× input and cache writes at 1.25× input. Override any family with
`MAHAAM_PRICES='{"sonnet":{"in":3,"out":15}}'`.

## Requirements

Claude Code with plugin support, and Node 18+ for the hooks. No other dependencies.
