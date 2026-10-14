// PostToolUse on the Mahaam issue lifecycle tools.
//
//   start_issue            mark where in the transcript this issue's work began
//   review_issue, finish_issue, request_approval
//                          sum the tokens spent since the mark, per model, and bank them on the
//                          issue with record_issue_usage: directly when MAHAAM_TOKEN is set (a
//                          token with the ai:record scope), else by asking Claude to call the
//                          tool with the exact numbers
//   record_issue_usage     Claude reported it: move the mark so nothing is counted twice
import { callTool, emit, keyOf, lineCount, loadState, readInput, saveState, usageSince } from "./lib.mjs"

const input = await readInput()
const tool = String(input.tool_name || "").split("__").pop()
const sid = input.session_id || "default"
const key = keyOf(input)
if (!key || !input.transcript_path) emit()

const state = loadState(sid)
const now = lineCount(input.transcript_path)

if (tool === "start_issue") {
  state.issues[key] ??= { from: now }
  saveState(sid, state)
  emit()
}

if (tool === "record_issue_usage") {
  state.issues[key] = { from: now }
  saveState(sid, state)
  emit()
}

// An ending: bank what was spent since the mark (the whole session when the issue was started
// in another one).
const from = state.issues[key]?.from ?? 0
let rows = []
try {
  rows = Object.entries(usageSince(input.transcript_path, from)).filter(([, r]) => r.requests > 0)
} catch {
  emit()
}
if (!rows.length) emit()

if (process.env.MAHAAM_TOKEN) {
  const done = []
  for (const [model, r] of rows) {
    try {
      await callTool("record_issue_usage", { key, model, source: "claude-code", ...r })
      done.push(`${model} $${r.cost}`)
    } catch (err) {
      emit({ systemMessage: `Mahaam: could not record AI usage on ${key}: ${err.message}` })
    }
  }
  state.issues[key] = { from: now }
  saveState(sid, state)
  emit({ systemMessage: `Mahaam: banked AI usage on ${key} (${done.join(", ")}).` })
}

const calls = rows.map(([model, r]) => JSON.stringify({ key, model, source: "claude-code", ...r })).join("\n")
emit({
  hookSpecificOutput: {
    hookEventName: "PostToolUse",
    additionalContext:
      `Mahaam: bank this session's AI spend on ${key}. Call record_issue_usage once per line below with exactly ` +
      `these arguments, then carry on:\n${calls}`,
  },
})
