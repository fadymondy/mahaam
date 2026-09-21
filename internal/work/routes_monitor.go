package work

import (
	"context"
	"net/http"
)

// MonitorKeyRef is the {key} path parameter for a monitor key.
type MonitorKeyRef struct {
	Key string `path:"key" doc:"Monitor key id"`
}

// MonitorKeyList is the body of GET …/monitor-keys.
type MonitorKeyList struct {
	Keys []MonitorKey `json:"keys"`
}

// monitorKeys mounts DSN key management for the backend error-monitoring SDKs (distinct from the
// browser Feedback widget's project_feedback_keys — see monitor_keys.go). Ingest itself
// (POST /api/monitor/{project}/envelope) is unauthenticated-by-session (guard allowlist, public
// key in the body) and lives in internal/reports/monitor.go, not here.
func (r routes) monitorKeys() {
	const tag = "Error monitoring"
	do(r, http.MethodGet, "/api/w/projects/{project}/monitor-keys", "w-list-monitor-keys",
		"A project's error-monitoring DSN keys (manager+)", tag, 0, func(ctx context.Context, in *struct {
			WS
			ProjectRef
		}) (MonitorKeyList, error) {
			list, err := r.sv.ListMonitorKeys(ctx, in.Project)
			return MonitorKeyList{Keys: list}, err
		})
	do(r, http.MethodPost, "/api/w/projects/{project}/monitor-keys", "w-create-monitor-key",
		"Mint a DSN for a project's backend SDK (Go, Node, Laravel, Python)", tag, http.StatusCreated, func(ctx context.Context, in *struct {
			WS
			ProjectRef
			Body struct {
				Name string `json:"name,omitempty" maxLength:"100"`
			}
		}) (*MonitorKey, error) {
			return r.sv.CreateMonitorKey(ctx, in.Project, in.Body.Name)
		})
	do(r, http.MethodGet, "/api/w/projects/{project}/monitor-install", "w-monitor-install",
		"Install guides for the Mahaam SDK (go, node, python, php, and an AI-agent prompt)", tag, 0, func(ctx context.Context, in *struct {
			WS
			ProjectRef
			Key string `query:"key" doc:"Monitor key id; default the newest live key"`
		}) (*MonitorInstall, error) {
			return r.sv.GetMonitorInstall(ctx, in.Project, in.Key)
		})
	none(r, http.MethodDelete, "/api/w/projects/{project}/monitor-keys/{key}", "w-revoke-monitor-key",
		"Revoke a monitor DSN (the envelope endpoint refuses it afterwards)", tag, func(ctx context.Context, in *struct {
			WS
			ProjectRef
			MonitorKeyRef
		}) error {
			return r.sv.RevokeMonitorKey(ctx, in.Project, in.Key)
		})
}
