package work

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"os"
	"strings"
	"time"

	"github.com/fadymondy/mahaam/internal/authz"
)

/*
Per-project DSN keys for the Mahaam SDK, the backend error-monitoring packages published as
github.com/fadymondy/mahaam-go, @mahaam/sdk, mahaam-sdk and mahaam/sdk. Distinct from
project_feedback_keys: this key is never meant to
reach a browser, so there is no allowed-origins/CORS concept for it — the boundary is that it can
only file into the one project it belongs to, and it is revocable. Same manager+ permissions as
feedback keys (feedback_keys:read / :manage) — both are "configure this project's intake" in the
same sense, just one for a browser widget and one for a server's own error reporting.

The DSN a client is given is https://<public_key>@mcp.mahaam.app/monitor/<project_id> (see
MonitorDSN, below), which the SDK parses back into the public key and the ingest URL.
*/

// KeyPrefixMDSN marks a monitor DSN key: mdsn_<32 hex>.
const KeyPrefixMDSN = "mdsn_"

type MonitorKey struct {
	ID         string     `json:"id"`
	ProjectID  string     `json:"project_id"`
	Name       string     `json:"name"`
	PublicKey  string     `json:"public_key"`
	DSN        string     `json:"dsn" doc:"The full connection string an SDK's MAHAAM_DSN env var takes"`
	LastUsedAt *time.Time `json:"last_used_at"`
	RevokedAt  *time.Time `json:"revoked_at"`
	CreatedAt  time.Time  `json:"created_at"`
}

func genMonitorKey() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return KeyPrefixMDSN + hex.EncodeToString(b)
}

// MonitorDSN builds the connection string an SDK is configured with.
func MonitorDSN(publicKey, projectID string) string {
	return "https://" + publicKey + "@" + monitorHost() + "/monitor/" + projectID
}

func monitorHost() string {
	base := ""
	for _, name := range []string{"MCP_URL", "APP_URL"} {
		if val := strings.TrimSpace(os.Getenv(name)); val != "" {
			base = val
			break
		}
	}
	base = strings.TrimPrefix(strings.TrimPrefix(base, "https://"), "http://")
	if base == "" {
		return "console.mahaam.app"
	}
	return strings.TrimRight(base, "/")
}

func scanMonitorKeys(rows *sql.Rows) ([]MonitorKey, error) {
	out := []MonitorKey{}
	for rows.Next() {
		var k MonitorKey
		if err := rows.Scan(&k.ID, &k.ProjectID, &k.Name, &k.PublicKey, &k.LastUsedAt, &k.RevokedAt, &k.CreatedAt); err != nil {
			return nil, err
		}
		k.DSN = MonitorDSN(k.PublicKey, k.ProjectID)
		out = append(out, k)
	}
	return out, rows.Err()
}

// ListMonitorKeys returns a project's monitor keys (visible project, manager+).
func (sv *Service) ListMonitorKeys(ctx context.Context, projectRef string) ([]MonitorKey, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := require(s, authz.FeedbackKeysRead); err != nil {
		return nil, err
	}
	p, err := loadProject(ctx, sv.DB, s, strings.TrimSpace(projectRef))
	if err != nil {
		return nil, err
	}
	rows, err := sv.DB.QueryContext(ctx, `
		SELECT id, project_id, name, public_key, last_used_at, revoked_at, created_at
		FROM project_monitor_keys WHERE workspace_id = $1 AND project_id = $2 ORDER BY created_at DESC`,
		s.WorkspaceID, p.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanMonitorKeys(rows)
}

// CreateMonitorKey mints a new key for a project.
func (sv *Service) CreateMonitorKey(ctx context.Context, projectRef, name string) (*MonitorKey, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := require(s, authz.FeedbackKeysManage); err != nil {
		return nil, err
	}
	p, err := loadProject(ctx, sv.DB, s, strings.TrimSpace(projectRef))
	if err != nil {
		return nil, err
	}
	var k MonitorKey
	err = sv.tx(ctx, func(tx *sql.Tx) error {
		row := tx.QueryRowContext(ctx, `
			INSERT INTO project_monitor_keys (workspace_id, project_id, name, public_key, created_by)
			VALUES ($1, $2, $3, $4, $5)
			RETURNING id, project_id, name, public_key, last_used_at, revoked_at, created_at`,
			s.WorkspaceID, p.ID, truncate(strings.TrimSpace(name), 100), genMonitorKey(), s.UserID)
		if err := row.Scan(&k.ID, &k.ProjectID, &k.Name, &k.PublicKey, &k.LastUsedAt, &k.RevokedAt, &k.CreatedAt); err != nil {
			return err
		}
		k.DSN = MonitorDSN(k.PublicKey, k.ProjectID)
		return record(ctx, tx, s, entry{ProjectID: p.ID, Action: "monitor_key.created", SubjectType: "monitor_key", SubjectID: k.ID})
	})
	if err != nil {
		return nil, err
	}
	return &k, nil
}

// RevokeMonitorKey revokes a project's key (manager+).
func (sv *Service) RevokeMonitorKey(ctx context.Context, projectRef, id string) error {
	s, err := caller(ctx)
	if err != nil {
		return err
	}
	if err := require(s, authz.FeedbackKeysManage); err != nil {
		return err
	}
	p, err := loadProject(ctx, sv.DB, s, strings.TrimSpace(projectRef))
	if err != nil {
		return err
	}
	return sv.tx(ctx, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx, `
			UPDATE project_monitor_keys SET revoked_at = now()
			WHERE workspace_id = $1 AND project_id = $2 AND id = $3 AND revoked_at IS NULL`,
			s.WorkspaceID, p.ID, id)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return notFound("monitor key")
		}
		return record(ctx, tx, s, entry{ProjectID: p.ID, Action: "monitor_key.revoked", SubjectType: "monitor_key", SubjectID: id})
	})
}
