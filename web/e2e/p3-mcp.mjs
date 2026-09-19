// P3 exit check against a running stack: a throwaway account mints an MCP token in the app, then a
// JSON-RPC client speaking the MCP streamable-HTTP protocol (what `claude mcp add --transport http`
// uses) creates a task, starts and stops a timer, pulls time_summary; an out-of-scope call must fail
// in-band; a burst must be rate limited with a JSON-RPC 429.
//
//   node e2e/p3-mcp.mjs                                          (http://localhost:3010)
//   WEB_ORIGIN=https://console.mahaam.app node e2e/p3-mcp.mjs
const ORIGIN = process.env.WEB_ORIGIN || "http://localhost:3010"
const BURST = Number(process.env.BURST || 130)
let cookie = ""
let csrf = ""

async function api(method, path, body, ws) {
  const headers = { "Content-Type": "application/json", Cookie: cookie }
  if (csrf) headers["X-CSRF-Token"] = csrf
  if (ws) headers["X-Workspace-ID"] = ws
  const res = await fetch(ORIGIN + path, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: "manual" })
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [kv] = c.split(";")
    const name = kv.split("=")[0]
    cookie = cookie.split("; ").filter((x) => x && !x.startsWith(name + "=")).concat(kv).join("; ")
  }
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text}`)
  return text ? JSON.parse(text) : null
}

let token = ""
let id = 0
async function rpc(method, params) {
  const res = await fetch(ORIGIN + "/api/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
  })
  return { status: res.status, headers: res.headers, body: await res.json().catch(() => null) }
}
async function tool(name, args = {}) {
  const r = await rpc("tools/call", { name, arguments: args })
  if (r.status !== 200 || r.body.error) throw new Error(`${name}: ${r.status} ${JSON.stringify(r.body)}`)
  return { text: r.body.result.content[0].text, isError: !!r.body.result.isError }
}
const ok = (cond, msg) => {
  if (!cond) throw new Error("FAIL: " + msg)
  console.log("  ok  " + msg)
}

const email = `p3-${Date.now()}@example.test`
console.log(`P3 MCP exit check on ${ORIGIN} as ${email}`)
csrf = (await api("GET", "/api/auth/csrf")).csrf_token
await api("POST", "/api/auth/register", { email, password: "correct-horse-p3" })
csrf = (await api("GET", "/api/auth/csrf")).csrf_token
const ws = (await api("POST", "/api/me/workspaces", { name: "P3 check " + Date.now() })).workspace.id
await api("POST", "/api/w/projects", { name: "Agent project", billing_mode: "hourly", budget_minutes: 120 }, ws)
const minted = await api("POST", "/api/w/mcp_tokens", {
  name: "claude-code", scopes: ["members:read", "projects:read", "tasks:read", "tasks:write", "time:read", "time:write", "reports:read"],
}, ws)
token = minted.plaintext

const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-code", version: "p3-check" } })
ok(init.status === 200 && init.body.result.protocolVersion === "2025-06-18", `initialize → ${init.body.result.serverInfo.name} ${init.body.result.protocolVersion}`)
await rpc("notifications/initialized")
const tools = (await rpc("tools/list", {})).body.result.tools.map((t) => t.name)
ok(["time_summary", "budget_status", "timesheet", "profitability", "update_feedback_status"].every((t) => tools.includes(t)), `tools/list: ${tools.length} tools`)

let r = await tool("create_task", { project: "Agent project", title: "Filed by the P3 check", assignees: ["me"] })
const key = r.text.match(/MG-\d+/)?.[0]
ok(!r.isError && key, `create_task → ${key}`)
r = await tool("start_timer", { task: key, description: "agent timer" })
ok(!r.isError, "start_timer → " + r.text.split("\n")[0])
await new Promise((res) => setTimeout(res, 1500))
r = await tool("stop_timer")
ok(!r.isError && r.text.includes("agent timer"), "stop_timer → " + r.text.split("\n")[0])
r = await tool("time_summary", { group_by: "task" })
ok(!r.isError && r.text.includes(key) && r.text.includes("Total:"), "time_summary:\n" + r.text.replace(/^/gm, "      "))
r = await tool("profitability")
ok(r.isError && r.text.includes("reports:finance"), "out of scope, in-band: " + r.text.split("\n")[0])

// A concurrent burst: over a slow link a sequential loop refills the bucket (120/min = one every 0.5s)
// as fast as it drains it, which is the limiter working, not failing.
const results = []
for (let sent = 0; sent < BURST; sent += 15) {
  results.push(...(await Promise.all(Array.from({ length: Math.min(15, BURST - sent) }, () => rpc("ping")))))
}
const n429 = results.filter((p) => p.status === 429).length
const first = results.findIndex((p) => p.status === 429)
const limited = first >= 0 ? { i: `${first + 1} of ${BURST} concurrent (${n429} refused)`, p: results[first] } : null
ok(limited, `rate limited on call ${limited?.i}:${limited?.p.status} code=${limited?.p.body?.error?.code} "${limited?.p.body?.error?.message}" Retry-After=${limited?.p.headers.get("retry-after")}`)
ok(limited.p.body.error.code === -32029, "429 carries a JSON-RPC error")
console.log("P3 exit check: PASS")
