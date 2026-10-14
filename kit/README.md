# Mahaam AI kit

Everything that connects AI assistants to Mahaam. Each piece talks to the same MCP endpoint
(`https://console.mahaam.app/api/mcp`), so browser users and agents share one authorization path.

| Folder | For | What it is |
|---|---|---|
| [`claude-plugin/`](claude-plugin/) | Claude Code | A plugin with the MCP server, skills, agents, and hooks that bank AI cost per issue. Install: `/plugin marketplace add fadymondy/mahaam-plugin`. |
| [`chatgpt/`](chatgpt/) | ChatGPT | An OAuth connector setup, project instructions, and prompt playbooks. |
| [`codex/`](codex/) | OpenAI Codex | MCP config plus the shared skills. |

The marketplace manifest for Claude Code is [`/.claude-plugin/marketplace.json`](../.claude-plugin/marketplace.json).
Check both manifests with `claude plugin validate .` from the repo root.
