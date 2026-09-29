# Mahaam for ChatGPT

Connect ChatGPT to Mahaam's MCP server so you can manage projects, issues, tasks and time from a chat.
Mahaam's endpoint speaks the MCP authorization spec (OAuth 2.1 with dynamic client registration), so
ChatGPT only needs the URL. You sign in on Mahaam's own consent screen, and no token is pasted anywhere.

## 1. Add the connector

1. ChatGPT → **Settings → Apps & Connectors → Advanced settings** → turn on **Developer mode**.
   Business, Enterprise and Edu workspaces need an admin to allow custom connectors.
2. **Settings → Apps & Connectors → Create**:
   - **Name:** Mahaam
   - **Description:** Project management, issues, time tracking and AI cost for my team.
   - **MCP server URL:** `https://console.mahaam.app/api/mcp` (self-hosted: `https://<your-host>/api/mcp`)
   - **Authentication:** OAuth
3. **Create**. ChatGPT opens Mahaam's consent screen. Pick the workspace and **Allow**.

The connection gets the default scopes: `projects:read tasks:read tasks:write issues:read
issues:write time:read time:write`. It never exceeds your role in the workspace. Revoke it any time
under Mahaam → Workspace → MCP tokens.

## 2. Teach it how to work

To use Mahaam from a **ChatGPT Project**, paste [`instructions.md`](instructions.md) into the
project's **Instructions** and enable the Mahaam connector in the project. In a plain chat, choose
Mahaam from the **+ → Developer mode** menu and paste the instructions as your first message, or
add them to **Settings → Personalization → Custom instructions**.

[`prompts.md`](prompts.md) has ready-made prompts: standup, triage, log time, file a bug, client
update.

## What works, and what doesn't

| | ChatGPT | Claude Code plugin |
|---|---|---|
| Read and update projects, issues, tasks | ✅ | ✅ |
| Timers, log time, timesheets | ✅ | ✅ |
| Status reports, triage | ✅ | ✅ (with agents) |
| Implement issues in a repo | ❌ (no repo access) | ✅ |
| AI cost banked on each issue automatically | ❌ ChatGPT doesn't expose token counts | ✅ via hook |

ChatGPT asks before every tool that writes. That's expected: approve each one, or allow the
connector's write actions for the conversation.
