// Shared helpers for the Mahaam hooks. No dependencies: Node 18+ only.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

export async function readInput() {
  let raw = ""
  for await (const chunk of process.stdin) raw += chunk
  try {
    return JSON.parse(raw || "{}")
  } catch {
    return {}
  }
}

/** Print hook JSON (if any) and exit 0: a hook must never break the session. */
export function emit(obj) {
  if (obj) process.stdout.write(JSON.stringify(obj))
  process.exit(0)
}

/** The repo's .mahaam.json, searched upwards from cwd. */
export function repoConfig(cwd) {
  let dir = cwd || process.cwd()
  for (;;) {
    const f = join(dir, ".mahaam.json")
    if (existsSync(f)) {
      try {
        return JSON.parse(readFileSync(f, "utf8"))
      } catch {
        return null
      }
    }
    const up = dirname(dir)
    if (up === dir) return null
    dir = up
  }
}

const stateDir = join(tmpdir(), "mahaam-claude")

/** Per-session marks: where in the transcript each issue's work began. */
export function loadState(sessionId) {
  try {
    return JSON.parse(readFileSync(join(stateDir, `${sessionId}.json`), "utf8"))
  } catch {
    return { issues: {} }
  }
}

export function saveState(sessionId, state) {
  mkdirSync(stateDir, { recursive: true })
  writeFileSync(join(stateDir, `${sessionId}.json`), JSON.stringify(state))
}

/**
 * USD per million tokens by model family: list prices, used to estimate cost. Cache reads
 * are 0.1x input and cache writes 1.25x. Override any family with
 * MAHAAM_PRICES='{"opus":{"in":5,"out":25}}'.
 */
const PRICES = {
  opus: { in: 5, out: 25 },
  fable: { in: 5, out: 25 },
  sonnet: { in: 3, out: 15 },
  haiku: { in: 1, out: 5 },
}

export function priceOf(model) {
  let table = PRICES
  try {
    if (process.env.MAHAAM_PRICES) table = { ...PRICES, ...JSON.parse(process.env.MAHAAM_PRICES) }
  } catch {}
  const m = String(model || "").toLowerCase()
  for (const [family, p] of Object.entries(table)) if (m.includes(family)) return p
  return table.sonnet
}

export function lineCount(transcriptPath) {
  try {
    return readFileSync(transcriptPath, "utf8").split("\n").length
  } catch {
    return 0
  }
}

/**
 * Sums assistant usage in a transcript from line `from` on, per model. Streamed chunks
 * of one message repeat its usage, so each message id counts once.
 */
export function usageSince(transcriptPath, from) {
  const lines = readFileSync(transcriptPath, "utf8").split("\n")
  const seen = new Set()
  const byModel = {}
  for (let i = from; i < lines.length; i++) {
    if (!lines[i]) continue
    let e
    try {
      e = JSON.parse(lines[i])
    } catch {
      continue
    }
    const msg = e.message
    if (e.type !== "assistant" || !msg?.usage || !msg.model || msg.model === "<synthetic>") continue
    const id = msg.id || `line-${i}`
    if (seen.has(id)) continue
    seen.add(id)
    const u = msg.usage
    const row = (byModel[msg.model] ??= { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, requests: 0 })
    row.input_tokens += u.input_tokens || 0
    row.output_tokens += u.output_tokens || 0
    row.cache_read_tokens += u.cache_read_input_tokens || 0
    row.cache_write_tokens += u.cache_creation_input_tokens || 0
    row.requests += 1
  }
  for (const [model, r] of Object.entries(byModel)) {
    const p = priceOf(model)
    const usd = (r.input_tokens * p.in + r.output_tokens * p.out + r.cache_read_tokens * p.in * 0.1 + r.cache_write_tokens * p.in * 1.25) / 1e6
    r.cost = usd.toFixed(2)
  }
  return byModel
}

/** Calls a Mahaam MCP tool over JSON-RPC with MAHAAM_TOKEN and returns its text. */
export async function callTool(name, args) {
  const base = (process.env.MAHAAM_URL || "https://console.mahaam.app").replace(/\/$/, "")
  const res = await fetch(`${base}/api/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.MAHAAM_TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  })
  const out = await res.json().catch(() => ({}))
  const text = out?.result?.content?.[0]?.text ?? out?.error?.message ?? `HTTP ${res.status}`
  if (!res.ok || out.error || out?.result?.isError) throw new Error(text)
  return text
}

/** The issue key a lifecycle tool call was about. */
export function keyOf(input) {
  const key = input.tool_input?.key
  if (key) return String(key)
  return (JSON.stringify(input.tool_response ?? "").match(/[A-Z]{2,6}-\d+/) || [])[0]
}
