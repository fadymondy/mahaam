---
name: ai-cost
description: Record and review AI spend in Mahaam — per issue (tokens and cost of agent work) and per project (daily usage, markup, budget, what's unbilled). Use when the user asks "how much did the AI cost on this project/issue", "record our usage", "set the AI markup", or "are we over budget".
---

# AI cost

Two levels:

- **Per issue** — `record_issue_usage { key, model, input_tokens, output_tokens, cache_read_tokens,
  cache_write_tokens, requests, cost }` **adds** one session's spend to the issue and to its project's
  usage for the day. The plugin's hook does this automatically when an issue is closed; call it by
  hand only for work done outside Claude Code (say, a ChatGPT or API run), with that run's numbers.
- **Per project, per day** — `record_ai_usage { project, rows: [{ day, model, source, …, cost }] }`
  **replaces** a day's row per model/source (idempotent) — for daily exports from a provider console.
  Don't mix the two for the same spend, or it's counted twice.

Reading (manager+):
- `ai_usage_summary { project?, from?, to?, group_by: day|model|project|source }` — tokens, our cost,
  the billed amount after markup, and what is still unbilled.
- `budget_status { project }` — spend against the project's budget.
- `profitability { from, to, projects: [project] }` — revenue vs. time and AI cost.

Setting (manager+): `set_ai_markup { project, percent }` — billed = cost × (1 + markup).
Invoices drafted with `draft_invoice_from_time` include unbilled AI usage.

`cost` is a decimal string in the currency's units ("1.84"), USD by default. Invoiced rows are
locked; a correction goes on another day.
