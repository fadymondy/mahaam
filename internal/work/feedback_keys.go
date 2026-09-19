package work

import (
	"context"
	"crypto/rand"
	"database/sql"
	"database/sql/driver"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/fadymondy/mahaam/internal/authz"
	"github.com/fadymondy/mahaam/internal/limits"
)

// pqStringArray is a Postgres text[] usable as both a query parameter (Valuer)
// and a scan target (Scanner) over the database/sql pgx-stdlib driver, so the
// feedback-keys code needs no array-type dependency. Elements are quoted, and
// backslash and double-quote are escaped, per Postgres array literal syntax.
type pqStringArray []string

func (a pqStringArray) Value() (driver.Value, error) {
	if a == nil {
		return "{}", nil
	}
	parts := make([]string, len(a))
	for i, s := range a {
		s = strings.ReplaceAll(s, `\`, `\\`)
		s = strings.ReplaceAll(s, `"`, `\"`)
		parts[i] = `"` + s + `"`
	}
	return "{" + strings.Join(parts, ",") + "}", nil
}

func (a *pqStringArray) Scan(src any) error {
	var s string
	switch v := src.(type) {
	case nil:
		*a = nil
		return nil
	case string:
		s = v
	case []byte:
		s = string(v)
	default:
		return fmt.Errorf("pqStringArray: cannot scan %T", src)
	}
	s = strings.TrimSpace(s)
	if s == "{}" || s == "" {
		*a = []string{}
		return nil
	}
	s = strings.TrimPrefix(strings.TrimSuffix(s, "}"), "{")
	out := []string{}
	var buf strings.Builder
	inQuote, esc := false, false
	flush := func() { out = append(out, buf.String()); buf.Reset() }
	for _, r := range s {
		switch {
		case esc:
			buf.WriteRune(r)
			esc = false
		case r == '\\':
			esc = true
		case r == '"':
			inQuote = !inQuote
		case r == ',' && !inQuote:
			flush()
		default:
			buf.WriteRune(r)
		}
	}
	flush()
	*a = out
	return nil
}

/*
Per-project public feedback keys. The embeddable Feedback SDK authenticates to the
public POST /api/feedback/embed endpoint with one of these keys and NOTHING else —
no workspace header, no session. A key is therefore deliberately low-power: it can
only file an issue into the one project it belongs to, from an allowed origin, and
it is revocable. Because it is public (it ships in a <script> a client pastes onto
their site) it is stored in the clear, not hashed.

Minting, rotating, revoking and reading keys are manager+ (feedback_keys:manage /
:read) on a project the manager can see.
*/

// KeyPrefixPFK marks a public feedback key: pfk_<32 hex>.
const KeyPrefixPFK = "pfk_"

// FeedbackKey is a per-project public key as returned to the settings UI. The
// public_key is not a secret, so it is always shown (unlike an MCP token).
type FeedbackKey struct {
	ID             string       `json:"id"`
	ProjectID      string       `json:"project_id"`
	Name           string       `json:"name"`
	PublicKey      string       `json:"public_key"`
	Active         bool         `json:"active"`
	AllowedOrigins []string     `json:"allowed_origins"`
	Widget         WidgetConfig `json:"widget" doc:"How the launcher looks on the customer's site"`
	LastUsedAt     *time.Time   `json:"last_used_at"`
	RevokedAt      *time.Time   `json:"revoked_at"`
	CreatedAt      time.Time    `json:"created_at"`
}

func genPublicKey() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return KeyPrefixPFK + hex.EncodeToString(b)
}

// normalizeOrigins validates and canonicalises the allowed-origin list. "*" (any
// origin) is kept as-is but discouraged; every other entry must be a scheme+host
// origin (no path), lower-cased, deduplicated.
func normalizeOrigins(in []string) ([]string, error) {
	seen := map[string]bool{}
	out := []string{}
	for _, raw := range in {
		o := strings.TrimSpace(raw)
		if o == "" {
			continue
		}
		if o == "*" {
			if !seen["*"] {
				seen["*"] = true
				out = append(out, "*")
			}
			continue
		}
		u, err := url.Parse(o)
		if err != nil || u.Scheme == "" || u.Host == "" {
			return nil, invalid("%q is not an origin (use https://example.com)", raw)
		}
		norm := strings.ToLower(u.Scheme + "://" + u.Host)
		if !seen[norm] {
			seen[norm] = true
			out = append(out, norm)
		}
	}
	return out, nil
}

// ListFeedbackKeys returns a project's keys (visible project, manager+).
func (sv *Service) ListFeedbackKeys(ctx context.Context, projectRef string) ([]FeedbackKey, error) {
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
	rows, err := sv.DB.QueryContext(ctx, `SELECT id, project_id, name, public_key, active, allowed_origins,
		last_used_at, revoked_at, created_at, widget FROM project_feedback_keys
		WHERE workspace_id = $1 AND project_id = $2 ORDER BY created_at DESC`, s.WorkspaceID, p.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanKeys(rows)
}

func scanKeys(rows *sql.Rows) ([]FeedbackKey, error) {
	out := []FeedbackKey{}
	for rows.Next() {
		var k FeedbackKey
		var origins pqStringArray
		var widget []byte
		if err := rows.Scan(&k.ID, &k.ProjectID, &k.Name, &k.PublicKey, &k.Active, &origins,
			&k.LastUsedAt, &k.RevokedAt, &k.CreatedAt, &widget); err != nil {
			return nil, err
		}
		k.Widget = ParseWidget(widget)
		k.AllowedOrigins = origins
		out = append(out, k)
	}
	return out, rows.Err()
}

// CreateFeedbackKey mints a new active key for a project.
func (sv *Service) CreateFeedbackKey(ctx context.Context, projectRef, name string, origins []string) (*FeedbackKey, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := require(s, authz.FeedbackKeysManage); err != nil {
		return nil, err
	}
	if err := quota(ctx, s, limits.FeedbackKeys, 1); err != nil {
		return nil, err
	}
	p, err := loadProject(ctx, sv.DB, s, strings.TrimSpace(projectRef))
	if err != nil {
		return nil, err
	}
	ori, err := normalizeOrigins(origins)
	if err != nil {
		return nil, err
	}
	var k FeedbackKey
	err = sv.tx(ctx, func(tx *sql.Tx) error {
		var got pqStringArray
		var widget []byte
		row := tx.QueryRowContext(ctx, `
			INSERT INTO project_feedback_keys (workspace_id, project_id, name, public_key, allowed_origins, created_by)
			VALUES ($1, $2, $3, $4, $5, $6)
			RETURNING id, project_id, name, public_key, active, allowed_origins, last_used_at, revoked_at, created_at, widget`,
			s.WorkspaceID, p.ID, truncate(strings.TrimSpace(name), 100), genPublicKey(), pqStringArray(ori), s.UserID)
		if err := row.Scan(&k.ID, &k.ProjectID, &k.Name, &k.PublicKey, &k.Active, &got, &k.LastUsedAt, &k.RevokedAt, &k.CreatedAt, &widget); err != nil {
			return err
		}
		k.AllowedOrigins = got
		k.Widget = ParseWidget(widget)
		return record(ctx, tx, s, entry{ProjectID: p.ID, Action: "feedback_key.created", SubjectType: "feedback_key", SubjectID: k.ID})
	})
	if err != nil {
		return nil, err
	}
	return &k, nil
}

// UpdateFeedbackKey changes a key's name, active flag or allowed origins.
func (sv *Service) UpdateFeedbackKey(ctx context.Context, keyID string, name *string, active *bool, origins *[]string, widget *WidgetConfig) (*FeedbackKey, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := require(s, authz.FeedbackKeysManage); err != nil {
		return nil, err
	}
	p := newPatch()
	if name != nil {
		p.set("name", truncate(strings.TrimSpace(*name), 100))
	}
	if active != nil {
		p.set("active", *active)
		if *active {
			p.set("revoked_at", nil)
		}
	}
	if origins != nil {
		ori, err := normalizeOrigins(*origins)
		if err != nil {
			return nil, err
		}
		p.set("allowed_origins", pqStringArray(ori))
	}
	if widget != nil {
		w, err := widget.Normalize()
		if err != nil {
			return nil, err
		}
		b, _ := json.Marshal(w)
		p.set("widget", string(b))
	}
	if _, err := sv.getKey(ctx, keyID); err != nil {
		return nil, err
	}
	if p.empty() {
		return sv.getKey(ctx, keyID)
	}
	err = sv.tx(ctx, func(tx *sql.Tx) error {
		if err := p.update(ctx, tx, "project_feedback_keys", s.WorkspaceID, strings.TrimSpace(keyID)); err != nil {
			return err
		}
		return record(ctx, tx, s, entry{Action: "feedback_key.updated", SubjectType: "feedback_key", SubjectID: strings.TrimSpace(keyID)})
	})
	if err != nil {
		return nil, err
	}
	return sv.getKey(ctx, keyID)
}

// RevokeFeedbackKey deactivates a key. The embed endpoint refuses a revoked key.
func (sv *Service) RevokeFeedbackKey(ctx context.Context, keyID string) error {
	s, err := caller(ctx)
	if err != nil {
		return err
	}
	if err := require(s, authz.FeedbackKeysManage); err != nil {
		return err
	}
	return sv.tx(ctx, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx, `UPDATE project_feedback_keys
			SET active = false, revoked_at = now(), updated_at = now()
			WHERE workspace_id = $1 AND id = $2`, s.WorkspaceID, strings.TrimSpace(keyID))
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return notFound("feedback key")
		}
		return record(ctx, tx, s, entry{Action: "feedback_key.revoked", SubjectType: "feedback_key", SubjectID: strings.TrimSpace(keyID)})
	})
}

func (sv *Service) getKey(ctx context.Context, keyID string) (*FeedbackKey, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	var k FeedbackKey
	var origins pqStringArray
	var widget []byte
	err = sv.DB.QueryRowContext(ctx, `SELECT id, project_id, name, public_key, active, allowed_origins,
		last_used_at, revoked_at, created_at, widget FROM project_feedback_keys
		WHERE workspace_id = $1 AND id = $2`, s.WorkspaceID, strings.TrimSpace(keyID)).Scan(
		&k.ID, &k.ProjectID, &k.Name, &k.PublicKey, &k.Active, &origins, &k.LastUsedAt, &k.RevokedAt, &k.CreatedAt, &widget)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, notFound("feedback key")
	}
	if err != nil {
		return nil, err
	}
	k.AllowedOrigins = origins
	k.Widget = ParseWidget(widget)
	return &k, nil
}
