---
name: setup
description: Connect this repo and Claude Code to Mahaam — sign in to the MCP server, pick the project, write .mahaam.json, and (optionally) a token so AI cost is banked automatically. Use when the user says "set up Mahaam", "connect this repo to Mahaam", or the Mahaam tools are missing.
---

# Set up Mahaam

Goal: the `mahaam` MCP tools answer, this repo knows its project, and AI cost gets banked on issues.

## 1. Is the server connected?

Call `whoami`. If it answers (user, workspace, role, scopes), skip to step 2.

If the Mahaam tools are missing or answer 401:

- **Sign in (recommended).** The plugin registers `mahaam` at `${MAHAAM_URL:-https://console.mahaam.app}/api/mcp`
  with OAuth. Tell the user to run `/mcp`, choose `mahaam`, and **Authenticate**: a browser opens
  Mahaam's consent screen, they pick the workspace and approve. The tools load on the next turn.
- **Or a token.** In Mahaam → Workspace settings → **MCP tokens**, mint an `mgy_…` token with the scopes
  they need (below), then:
  `claude mcp add --transport http mahaam https://console.mahaam.app/api/mcp --header "Authorization: Bearer mgy_…"`
  Never write the token into a file in the repo.

Self-hosted Mahaam: set `MAHAAM_URL` (e.g. `https://mahaam.example.com`) before starting Claude Code.

## 2. Pick the project

`list_projects`, and ask the user which project this repo belongs to if it isn't obvious from the
repo name or README. Offer to `create_project` if none fits.

## 3. Write `.mahaam.json` at the repo root

```json
{ "project": "Acme Website", "workspace": "acme", "strategy": "sequential" }
```

`project` is the exact name (or id). `strategy` is the default for `/mahaam:issues` (`sequential`,
`parallel`, `drain`, `mentions`, `triage`). It holds no secret, so it can be committed. The plugin's
SessionStart hook reads it, so every session starts in the right project.

## 4. Automatic AI cost (optional, recommended)

When an agent ends an issue (`review_issue`, `request_approval`, `finish_issue`), the plugin's hook
counts the session's tokens since `start_issue` and banks them on the issue with
`record_issue_usage`. Two ways it can do that:

- **`MAHAAM_TOKEN` set** in the user's environment (an `mgy_` token with `issues:read issues:write
  ai:record`): the hook records it by itself, silently.
- **Not set**: the hook hands Claude the exact numbers and Claude calls `record_issue_usage`. The
  OAuth connection must then include the `ai:record` scope (a workspace member or above can record).

Costs are estimated from list prices per model family. Override with
`MAHAAM_PRICES='{"opus":{"in":5,"out":25}}'` (USD per million tokens).

## 5. Scopes cheat sheet

| Work | Scopes |
|---|---|
| Issues loop | `issues:read issues:write projects:read` |
| Tasks | `tasks:read tasks:write` |
| Time | `time:read time:write` |
| AI cost | `ai:record` (write), `ai:read` (manager+, reports) |
| Clients/invoices | `clients:read`, `invoices:read` … (manager+) |

A token never exceeds its user's current role: a member's token can't read finance.

## 6. Confirm

Run `whoami` and `list_issues { project, state: "open" }` and tell the user what you see: the
workspace, their role, and how many open issues the project has.
