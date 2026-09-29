// SessionStart: tell Claude which Mahaam project this repo belongs to (.mahaam.json), so
// /mahaam:issues and plain requests ("log 2h on the login bug") land in the right project.
import { emit, readInput, repoConfig } from "./lib.mjs"

const input = await readInput()
const cfg = repoConfig(input.cwd)
if (!cfg?.project) emit()

const lines = [
  `This repo is linked to the Mahaam project "${cfg.project}"${cfg.workspace ? ` (workspace "${cfg.workspace}")` : ""}.`,
  "Use the Mahaam MCP tools with that project unless the user names another one.",
  "Work an issue with start_issue (plan first) and end it with review_issue, request_approval or finish_issue; the Mahaam plugin banks the issue's tokens and cost when it ends.",
]
if (cfg.strategy) lines.push(`The owner's default strategy for /mahaam:issues is "${cfg.strategy}".`)
emit({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: lines.join("\n") } })
