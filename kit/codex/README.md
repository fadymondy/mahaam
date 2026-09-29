# Mahaam for OpenAI Codex

Codex CLI and the IDE extension read MCP servers from `~/.codex/config.toml` and skills from
`~/.codex/skills/`. The skills use the same `SKILL.md` format as the Claude Code plugin, so they
are shared.

## 1. MCP server

Mint an `mgy_` token in Mahaam → Workspace → **MCP tokens**. Scopes: `issues:read issues:write
projects:read tasks:read tasks:write time:read time:write ai:record`. Export it:

```bash
export MAHAAM_TOKEN=mgy_...        # PowerShell: $env:MAHAAM_TOKEN = "mgy_..."
```

Then add [`config.toml`](config.toml) to `~/.codex/config.toml`.

## 2. Skills

```bash
mkdir -p ~/.codex/skills
for s in issues report-issue track-time ai-cost status setup; do
  cp -r kit/claude-plugin/skills/$s ~/.codex/skills/mahaam-$s
done
```

Codex picks them up automatically ("work the Mahaam issues for Acme Website").

## 3. Repo link

Add the [`.mahaam.json`](../claude-plugin/README.md#link-a-repo) file, and one line to the repo's
`AGENTS.md`:

```md
This repo is the Mahaam project "Acme Website". Work its issues with the mahaam-issues skill.
```

## AI cost

Codex has no hooks, so nothing records AI cost automatically. After an issue closes, ask Codex to call
`record_issue_usage` with the session's token counts from `/status`.
