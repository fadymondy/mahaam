// Where agents reach the MCP endpoint: configured, else the site itself (the web proxies /api to the API).
export const MCP_ORIGIN = process.env.NEXT_PUBLIC_MCP_ORIGIN || (typeof window !== "undefined" ? window.location.origin : "")
