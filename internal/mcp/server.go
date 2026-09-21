// Package mcp exposes two Model Context Protocol servers:
//
//	POST /api/mcp        USER MCP  — tokens belong to a user in a workspace
//	POST /api/admin/mcp  ADMIN MCP — platform administration, admin-only tokens
//
// The transport is ported from fadymondy.com-v2's internal/mcp/server.go
// (streamable HTTP, one POST endpoint, JSON-RPC 2.0, SHA-256-hashed bearer
// tokens, best-effort last_used_at, in-band isError), with its opt-in scope
// weakness removed (FM-22): there a tool with an empty Scope was callable by
// any token. Here every tool MUST declare a scope from a closed list
// (scopes_test.go fails the build otherwise), and dispatch denies a tool whose
// scope is empty rather than allowing it — default-deny twice over.
package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/togo-framework/ratelimit"
	"github.com/togo-framework/togo"

	"github.com/fadymondy/mahaam/internal/app"
	"github.com/fadymondy/mahaam/internal/tenant"
)

// protocolVersion is the default MCP revision. Newer clients that ask for a
// revision in supportedVersions get it echoed back (the plan: keep 2024-11-05,
// accept 2025-06-18). This server only speaks request/response tools, which
// did not change shape between them.
const protocolVersion = "2024-11-05"

var supportedVersions = map[string]bool{"2024-11-05": true, "2025-03-26": true, "2025-06-18": true}

// Tool is one callable exposed over MCP.
type Tool struct {
	Name        string
	Description string
	// Scope is REQUIRED. A token must carry it (after narrowing to its user's
	// current role) to call the tool. Empty is a bug and is denied at dispatch.
	Scope       string
	InputSchema map[string]any
	// Run returns the text handed back to the model. ctx carries the caller:
	// tenant.Scope for the user server, adminCaller for the admin server.
	Run func(ctx context.Context, a *app.App, args json.RawMessage) (string, error)
}

// server is one MCP endpoint: a tool registry plus how its tokens authenticate.
type server struct {
	name  string
	tools []Tool
	// auth resolves the bearer token to a context carrying the caller and the
	// scopes in effect. ok=false => 401.
	auth func(r *http.Request, a *app.App, token string) (ctx context.Context, scopes []string, ok bool)
	// limit is nil when the ratelimit plugin is absent (and in unit tests).
	limit *limiter
}

type rpcRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type rpcResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Result  any             `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}

/*
Rate limiting (togo ratelimit, token bucket). Two buckets per endpoint:

	per token   MCP_RATE_PER_MINUTE (default 120) calls per minute per bearer token, keyed by the
	            token's hash — every call, valid token or not, so a burst is cut before any DB work
	per address MCP_AUTH_FAIL_PER_MINUTE (default 30) FAILED authentications per minute per client
	            address (RemoteAddr host, never X-Forwarded-For, which the client sets), so rotating
	            made-up tokens does not escape the per-token bucket

A limited call answers HTTP 429 with Retry-After and X-RateLimit-* headers and a JSON-RPC error
body (code -32029) — not the plugin's text/plain middleware body, which an MCP client cannot parse.
The plugin's Middleware is not used for that reason (README, framework note 18). The user and admin
endpoints have separate policies.
*/
const rpcRateLimited = -32029

type limiter struct {
	svc            *ratelimit.Service
	perToken, fail ratelimit.Policy
}

func envInt(name string, def int) int {
	if v, err := strconv.Atoi(strings.TrimSpace(os.Getenv(name))); err == nil && v > 0 {
		return v
	}
	return def
}

func newLimiter(svc *ratelimit.Service, name string) *limiter {
	if svc == nil {
		return nil
	}
	return &limiter{svc: svc,
		perToken: ratelimit.Rate(name, envInt("MCP_RATE_PER_MINUTE", 120), time.Minute),
		fail:     ratelimit.Rate(name+"-authfail", envInt("MCP_AUTH_FAIL_PER_MINUTE", 30), time.Minute),
	}
}

// take consumes one token of p for key; on refusal it writes the 429 and returns false.
func (l *limiter) take(w http.ResponseWriter, r *http.Request, p ratelimit.Policy, key string) bool {
	if l == nil {
		return true
	}
	ok, retry := l.svc.Allow(r.Context(), key, p)
	w.Header().Set("X-RateLimit-Limit", strconv.Itoa(p.Limit))
	if ok {
		return true
	}
	secs := int(retry/time.Second) + 1
	w.Header().Set("Retry-After", strconv.Itoa(secs))
	w.Header().Set("X-RateLimit-Remaining", "0")
	writeRPC(w, http.StatusTooManyRequests, rpcResponse{JSONRPC: "2.0", Error: &rpcError{Code: rpcRateLimited,
		Message: fmt.Sprintf("rate limit exceeded: at most %d requests per %s; retry in %ds", p.Limit, p.Window, secs)}})
	return false
}

func clientHost(r *http.Request) string {
	if h, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return h
	}
	return r.RemoteAddr
}

// Mount registers both MCP endpoints on the kernel router, rate-limited when the ratelimit plugin
// is installed (it is: togo.yaml, plugins.gen.go).
func Mount(k *togo.Kernel, a *app.App) {
	user := &server{name: "mahaam-mcp", tools: UserTools(), auth: authUser}
	admin := &server{name: "mahaam-admin-mcp", tools: AdminTools(), auth: authAdmin}
	if rl, ok := ratelimit.FromKernel(k); ok {
		user.limit = newLimiter(rl, "mcp")
		admin.limit = newLimiter(rl, "admin-mcp")
	} else {
		a.Log.Warn("ratelimit plugin not registered — the MCP endpoints are NOT rate limited")
	}
	k.Router.Handle("/api/mcp", user.handler(a))
	k.Router.Handle("/api/admin/mcp", admin.handler(a))
}

func bearer(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if len(h) < 8 || !strings.EqualFold(h[:7], "Bearer ") {
		return ""
	}
	return strings.TrimSpace(h[7:])
}

func (s *server) handler(a *app.App) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if req.Method != http.MethodPost {
			w.Header().Set("Allow", "POST")
			writeRPC(w, http.StatusMethodNotAllowed, rpcResponse{JSONRPC: "2.0",
				Error: &rpcError{Code: -32600, Message: "use POST"}})
			return
		}
		token := bearer(req)
		if s.limit != nil && !s.limit.take(w, req, s.limit.perToken, "t:"+HashToken(token)[:24]) {
			return
		}
		ctx, scopes, ok := s.auth(req, a, token)
		if !ok {
			if s.limit != nil && !s.limit.take(w, req, s.limit.fail, "ip:"+clientHost(req)) {
				return
			}
			auth := `Bearer realm="` + s.name + `"`
			if s.name == "mahaam-mcp" {
				// Points an OAuth-capable client (Claude.ai, ChatGPT, ...) at the discovery
				// metadata for the flow in oauth.go, so it can "Connect" with just this URL.
				auth += `, resource_metadata="` + mcpURL() + RSMetadataPath + `"`
			}
			w.Header().Set("WWW-Authenticate", auth)
			writeRPC(w, http.StatusUnauthorized, rpcResponse{JSONRPC: "2.0",
				Error: &rpcError{Code: -32001, Message: "invalid or missing MCP token"}})
			return
		}

		if d, ok := denied(ctx); ok {
			writeRPC(w, d.status, rpcResponse{JSONRPC: "2.0", Error: &rpcError{Code: rpcRefused, Message: d.msg}})
			return
		}

		var rpc rpcRequest
		if json.NewDecoder(http.MaxBytesReader(w, req.Body, 4<<20)).Decode(&rpc) != nil {
			writeRPC(w, http.StatusBadRequest, rpcResponse{JSONRPC: "2.0",
				Error: &rpcError{Code: -32700, Message: "parse error"}})
			return
		}
		res := s.dispatch(ctx, a, scopes, rpc)
		if len(rpc.ID) == 0 { // a notification gets no body, per JSON-RPC
			w.WriteHeader(http.StatusAccepted)
			return
		}
		writeRPC(w, http.StatusOK, res)
	})
}

func (s *server) dispatch(ctx context.Context, a *app.App, scopes []string, rpc rpcRequest) rpcResponse {
	reply := func(result any) rpcResponse { return rpcResponse{JSONRPC: "2.0", ID: rpc.ID, Result: result} }
	fail := func(code int, msg string) rpcResponse {
		return rpcResponse{JSONRPC: "2.0", ID: rpc.ID, Error: &rpcError{Code: code, Message: msg}}
	}
	inBand := func(text string, isErr bool) rpcResponse {
		out := map[string]any{"content": []map[string]any{{"type": "text", "text": text}}}
		if isErr {
			out["isError"] = true
		}
		return reply(out)
	}

	switch rpc.Method {
	case "initialize":
		var p struct {
			ProtocolVersion string `json:"protocolVersion"`
		}
		_ = json.Unmarshal(rpc.Params, &p)
		version := protocolVersion
		if supportedVersions[p.ProtocolVersion] {
			version = p.ProtocolVersion
		}
		return reply(map[string]any{
			"protocolVersion": version,
			"capabilities":    map[string]any{"tools": map[string]any{}},
			"serverInfo":      map[string]any{"name": s.name, "version": "0.1.0"},
		})
	case "ping", "notifications/initialized":
		return reply(map[string]any{})
	case "tools/list":
		return reply(map[string]any{"tools": s.schemas(ctx)})
	case "tools/call":
		var params struct {
			Name      string          `json:"name"`
			Arguments json.RawMessage `json:"arguments"`
		}
		if json.Unmarshal(rpc.Params, &params) != nil {
			return fail(-32602, "invalid params")
		}
		tool, ok := s.tool(params.Name)
		if !ok {
			return fail(-32602, "unknown tool: "+params.Name)
		}
		// Default-deny: an undeclared scope is never satisfied (FM-22 fixed).
		if tool.Scope == "" || !hasScope(scopes, tool.Scope) {
			return inBand(fmt.Sprintf(
				"%s needs the %q scope, which this token does not carry (it has: %s). "+
					"Mint a token with that scope to allow this.",
				tool.Name, tool.Scope, strings.Join(nonEmpty(scopes), ", ")), true)
		}
		text, err := tool.Run(ctx, a, params.Arguments)
		if err != nil {
			return inBand(err.Error(), true)
		}
		return inBand(text, false)
	default:
		return fail(-32601, "method not found: "+rpc.Method)
	}
}

func (s *server) tool(name string) (Tool, bool) {
	for _, t := range s.tools {
		if t.Name == name {
			return t, true
		}
	}
	return Tool{}, false
}

func (s *server) schemas(ctx context.Context) []map[string]any {
	// A workspace user sees only the tools their CURRENT role may ever hold a scope for (a client
	// lists the portal tools, not list_tasks). The admin server has no workspace role: all tools.
	role := ""
	if sc, ok := tenant.From(ctx); ok {
		role = sc.Role
	}
	out := make([]map[string]any, 0, len(s.tools))
	for _, t := range s.tools {
		if role != "" && !RoleMayHold(role, t.Scope) {
			continue
		}
		out = append(out, map[string]any{
			"name":        t.Name,
			"description": t.Description + " (scope: " + t.Scope + ")",
			"inputSchema": t.InputSchema,
		})
	}
	return out
}

func hasScope(scopes []string, want string) bool {
	for _, s := range scopes {
		if s == want {
			return true
		}
	}
	return false
}

func nonEmpty(s []string) []string {
	if len(s) == 0 {
		return []string{"none"}
	}
	return s
}

func writeRPC(w http.ResponseWriter, status int, res rpcResponse) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(res)
}

// ---- small arg helpers (fadymondy.com-v2 tools.go) ----------------------

func decodeArgs(raw json.RawMessage) map[string]any {
	out := map[string]any{}
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &out)
	}
	return out
}

func str(m map[string]any, k string) string {
	if v, ok := m[k].(string); ok {
		return strings.TrimSpace(v)
	}
	return ""
}

func intArg(m map[string]any, k string, def int) int {
	if v, ok := m[k].(float64); ok && v > 0 {
		return int(v)
	}
	return def
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

func firstLine(s string) string {
	s = strings.TrimSpace(s)
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		s = s[:i]
	}
	if len(s) > 120 {
		s = s[:120] + "…"
	}
	return s
}

func schema(required []string, props map[string]any) map[string]any {
	out := map[string]any{"type": "object", "properties": props}
	if len(required) > 0 {
		out["required"] = required
	}
	return out
}

func prop(typ, desc string) map[string]any {
	p := map[string]any{"type": typ}
	if desc != "" {
		p["description"] = desc
	}
	return p
}

// deny is an authenticated caller who may not act right now: a suspended workspace or account
// (403), or a plan quota / rate refusal (402 / 429). The token was valid, so this is not a 401.
type deny struct {
	status int
	msg    string
}

type denyKey struct{}

func withDeny(ctx context.Context, status int, msg string) context.Context {
	return context.WithValue(ctx, denyKey{}, deny{status: status, msg: msg})
}

func denied(ctx context.Context) (deny, bool) {
	d, ok := ctx.Value(denyKey{}).(deny)
	return d, ok
}

// rpcRefused is the JSON-RPC error code of a denied call.
const rpcRefused = -32003
