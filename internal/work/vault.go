package work

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/fadymondy/mahaam/internal/authz"
	"github.com/fadymondy/mahaam/internal/limits"
	"github.com/fadymondy/mahaam/internal/secretbox"
	"github.com/fadymondy/mahaam/internal/tenant"
)

/*
The project vault: a project's SECRETS and its MEMORY, one table (project_vault_items).

  - memory: plain markdown notes about the project (decisions, access paths, conventions,
    who to call). Members+ on a visible project read and write them; RecallVault searches
    them (Postgres full-text, 'simple' config, plus a substring fallback), which is what
    an agent calls before it starts work — the project's own cabrain namespace.
  - secret: a credential. The value is sealed with internal/secretbox (AES-256-GCM,
    MAHAAM_SECRET_KEY) and NEVER returned by a list or a search: members see the title and
    a non-secret hint (username, URL, env var name). Storing, changing and revealing need
    manager+ or the project's lead, and every reveal is recorded in the activity feed
    (vault.secret_revealed, with the actor and "via MCP" when an agent asked).

Clients never see the vault (vault:read is member+).
*/

// VaultItem is one entry. Value is set only by RevealVaultSecret.
type VaultItem struct {
	ID             string     `json:"id"`
	ProjectID      string     `json:"project_id"`
	Kind           string     `json:"kind" doc:"secret or memory"`
	Title          string     `json:"title"`
	Body           string     `json:"body" doc:"memory: the note (markdown); secret: a non-secret hint"`
	Tags           []string   `json:"tags"`
	HasValue       bool       `json:"has_value" doc:"a secret with a stored value"`
	Value          *string    `json:"value,omitempty" doc:"only on reveal"`
	CreatedBy      *string    `json:"created_by"`
	UpdatedBy      *string    `json:"updated_by"`
	LastRevealedAt *time.Time `json:"last_revealed_at"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
}

// VaultInput creates (Kind, Title required) or patches an item. Value is the plaintext
// secret; it is sealed before it touches the database.
type VaultInput struct {
	Kind  *string   `json:"kind,omitempty" enum:"secret,memory"`
	Title *string   `json:"title,omitempty" maxLength:"200"`
	Body  *string   `json:"body,omitempty" maxLength:"50000"`
	Tags  *[]string `json:"tags,omitempty" maxItems:"20"`
	Value *string   `json:"value,omitempty" maxLength:"20000" doc:"secret only; write-only"`
}

// VaultFilter narrows ListVault.
type VaultFilter struct {
	Kind, Q, Tag string
	Limit        int
}

const vaultCols = `id, project_id, kind, title, body, tags, sealed_value IS NOT NULL, created_by, updated_by,
	last_revealed_at, created_at, updated_at`

func scanVault(row interface{ Scan(...any) error }) (*VaultItem, error) {
	v := &VaultItem{}
	var tags pqStringArray
	err := row.Scan(&v.ID, &v.ProjectID, &v.Kind, &v.Title, &v.Body, &tags, &v.HasValue, &v.CreatedBy, &v.UpdatedBy,
		&v.LastRevealedAt, &v.CreatedAt, &v.UpdatedAt)
	v.Tags = tags
	if v.Tags == nil {
		v.Tags = []string{}
	}
	return v, err
}

// vaultProject loads a visible project for a vault action and checks the role.
func (sv *Service) vaultProject(ctx context.Context, projectRef, action string) (*tenant.Scope, *Project, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, nil, err
	}
	if err := require(s, authz.VaultRead); err != nil {
		return nil, nil, err
	}
	if err := feature(ctx, s, limits.FeatureVault); err != nil {
		return nil, nil, err
	}
	p, err := sv.FindProject(ctx, projectRef)
	if err != nil {
		return nil, nil, err
	}
	if action != "" {
		if err := require(s, action); err != nil {
			return nil, nil, err
		}
	}
	return s, p, nil
}

func (sv *Service) requireSecrets(ctx context.Context, s *tenant.Scope, projectID string) error {
	if authz.Can(s.Role, authz.VaultSecrets) || canManage(ctx, sv.DB, s, projectID) {
		return nil
	}
	return forbidden("only managers or the project lead can manage the project's secrets")
}

// ListVault lists a project's items (secret values never included), newest first.
func (sv *Service) ListVault(ctx context.Context, projectRef string, f VaultFilter) ([]VaultItem, error) {
	s, p, err := sv.vaultProject(ctx, projectRef, "")
	if err != nil {
		return nil, err
	}
	q := `SELECT ` + vaultCols + ` FROM project_vault_items WHERE workspace_id = $1 AND project_id = $2`
	args := []any{s.WorkspaceID, p.ID}
	if f.Kind != "" {
		args = append(args, f.Kind)
		q += " AND kind = $3"
	}
	if f.Tag != "" {
		args = append(args, f.Tag)
		q += " AND $" + itoa(len(args)) + " = ANY (tags)"
	}
	if t := strings.TrimSpace(f.Q); t != "" {
		args = append(args, t)
		n := itoa(len(args))
		q += ` AND (to_tsvector('simple', title || ' ' || body || ' ' || array_to_string(tags, ' ')) @@ plainto_tsquery('simple', $` + n + `)
			OR title ILIKE '%' || $` + n + ` || '%' OR body ILIKE '%' || $` + n + ` || '%')`
	}
	if f.Limit <= 0 || f.Limit > 500 {
		f.Limit = 200
	}
	args = append(args, f.Limit)
	q += " ORDER BY updated_at DESC LIMIT $" + itoa(len(args))
	rows, err := sv.DB.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []VaultItem{}
	for rows.Next() {
		v, err := scanVault(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *v)
	}
	return out, rows.Err()
}

// RecallVault ranks a project's MEMORY by relevance to a question (full-text rank, then
// recency) — the agent's "what do we know about this project" call.
func (sv *Service) RecallVault(ctx context.Context, projectRef, query string, limit int) ([]VaultItem, error) {
	s, p, err := sv.vaultProject(ctx, projectRef, "")
	if err != nil {
		return nil, err
	}
	if limit <= 0 || limit > 50 {
		limit = 8
	}
	query = strings.TrimSpace(query)
	rows, err := sv.DB.QueryContext(ctx, `SELECT `+vaultCols+` FROM project_vault_items
		WHERE workspace_id = $1 AND project_id = $2 AND kind = 'memory'
		  AND ($3 = '' OR to_tsvector('simple', title || ' ' || body || ' ' || array_to_string(tags, ' ')) @@ websearch_to_tsquery('simple', $3)
		       OR title ILIKE '%' || $3 || '%' OR body ILIKE '%' || $3 || '%')
		ORDER BY ts_rank(to_tsvector('simple', title || ' ' || body || ' ' || array_to_string(tags, ' ')), websearch_to_tsquery('simple', $3)) DESC,
		         updated_at DESC
		LIMIT $4`, s.WorkspaceID, p.ID, query, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []VaultItem{}
	for rows.Next() {
		v, err := scanVault(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *v)
	}
	return out, rows.Err()
}

func cleanTags(in []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, t := range in {
		t = strings.ToLower(strings.TrimSpace(t))
		if t == "" || len(t) > 40 || seen[t] {
			continue
		}
		seen[t] = true
		out = append(out, t)
	}
	return out
}

// CreateVaultItem adds a memory note (member+) or a secret (manager+ / project lead).
func (sv *Service) CreateVaultItem(ctx context.Context, projectRef string, in VaultInput) (*VaultItem, error) {
	s, p, err := sv.vaultProject(ctx, projectRef, authz.VaultWrite)
	if err != nil {
		return nil, err
	}
	kind, _ := trimmed(in.Kind)
	if kind != "secret" && kind != "memory" {
		return nil, invalid("kind must be secret or memory")
	}
	title, _ := trimmed(in.Title)
	if title == "" {
		return nil, invalid("a vault item needs a title")
	}
	body := ""
	if in.Body != nil {
		body = strings.TrimSpace(*in.Body)
	}
	var tags []string
	if in.Tags != nil {
		tags = cleanTags(*in.Tags)
	}
	var sealed any
	if kind == "secret" {
		if err := sv.requireSecrets(ctx, s, p.ID); err != nil {
			return nil, err
		}
		if in.Value == nil || *in.Value == "" {
			return nil, invalid("a secret needs a value")
		}
		v, err := secretbox.Seal([]byte(*in.Value))
		if err != nil {
			return nil, err
		}
		sealed = v
	} else if in.Value != nil && *in.Value != "" {
		return nil, invalid("a memory has no value — put the note in body")
	}
	var v *VaultItem
	err = sv.tx(ctx, func(tx *sql.Tx) error {
		var err error
		v, err = scanVault(tx.QueryRowContext(ctx, `INSERT INTO project_vault_items
			(workspace_id, project_id, kind, title, body, tags, sealed_value, created_by, updated_by)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8) RETURNING `+vaultCols,
			s.WorkspaceID, p.ID, kind, truncate(title, 200), body, pqStringArray(tags), sealed, s.UserID))
		if err != nil {
			return err
		}
		return record(ctx, tx, s, entry{ProjectID: p.ID, Action: "vault." + kind + "_created", SubjectType: "vault_item", SubjectID: v.ID,
			Changes: map[string]any{"title": v.Title}})
	})
	return v, err
}

func (sv *Service) loadVaultItem(ctx context.Context, s *tenant.Scope, id string) (*VaultItem, error) {
	if err := feature(ctx, s, limits.FeatureVault); err != nil {
		return nil, err
	}
	v, err := scanVault(sv.DB.QueryRowContext(ctx, `SELECT `+vaultCols+` FROM project_vault_items
		WHERE workspace_id = $1 AND id = $2`, s.WorkspaceID, strings.TrimSpace(id)))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, notFound("vault item")
	}
	if err != nil {
		return nil, err
	}
	// The item's project must be visible to the caller, or it does not exist for them.
	if _, err := loadProject(ctx, sv.DB, s, v.ProjectID); err != nil {
		return nil, notFound("vault item")
	}
	return v, nil
}

// GetVaultItem returns one item (never the secret value).
func (sv *Service) GetVaultItem(ctx context.Context, id string) (*VaultItem, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := require(s, authz.VaultRead); err != nil {
		return nil, err
	}
	return sv.loadVaultItem(ctx, s, id)
}

// UpdateVaultItem patches title, body, tags, or (secrets) the value.
func (sv *Service) UpdateVaultItem(ctx context.Context, id string, in VaultInput) (*VaultItem, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := require(s, authz.VaultWrite); err != nil {
		return nil, err
	}
	v, err := sv.loadVaultItem(ctx, s, id)
	if err != nil {
		return nil, err
	}
	if v.Kind == "secret" {
		if err := sv.requireSecrets(ctx, s, v.ProjectID); err != nil {
			return nil, err
		}
	}
	if in.Kind != nil && *in.Kind != v.Kind {
		return nil, invalid("the kind of a vault item cannot change")
	}
	p := newPatch()
	changed := []string{}
	if in.Title != nil {
		t := strings.TrimSpace(*in.Title)
		if t == "" {
			return nil, invalid("a vault item needs a title")
		}
		p.set("title", truncate(t, 200))
		changed = append(changed, "title")
	}
	if in.Body != nil {
		p.set("body", strings.TrimSpace(*in.Body))
		changed = append(changed, "body")
	}
	if in.Tags != nil {
		p.set("tags", pqStringArray(cleanTags(*in.Tags)))
		changed = append(changed, "tags")
	}
	if in.Value != nil {
		if v.Kind != "secret" {
			return nil, invalid("a memory has no value — put the note in body")
		}
		if *in.Value == "" {
			return nil, invalid("a secret needs a value")
		}
		sealed, err := secretbox.Seal([]byte(*in.Value))
		if err != nil {
			return nil, err
		}
		p.set("sealed_value", sealed)
		changed = append(changed, "value")
	}
	if p.empty() {
		return v, nil
	}
	p.set("updated_by", s.UserID)
	err = sv.tx(ctx, func(tx *sql.Tx) error {
		if err := p.update(ctx, tx, "project_vault_items", s.WorkspaceID, v.ID); err != nil {
			return err
		}
		return record(ctx, tx, s, entry{ProjectID: v.ProjectID, Action: "vault." + v.Kind + "_updated", SubjectType: "vault_item", SubjectID: v.ID,
			Changes: map[string]any{"fields": changed}})
	})
	if err != nil {
		return nil, err
	}
	return sv.loadVaultItem(ctx, s, v.ID)
}

// DeleteVaultItem removes an item.
func (sv *Service) DeleteVaultItem(ctx context.Context, id string) error {
	s, err := caller(ctx)
	if err != nil {
		return err
	}
	if err := require(s, authz.VaultWrite); err != nil {
		return err
	}
	v, err := sv.loadVaultItem(ctx, s, id)
	if err != nil {
		return err
	}
	if v.Kind == "secret" {
		if err := sv.requireSecrets(ctx, s, v.ProjectID); err != nil {
			return err
		}
	}
	return sv.tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `DELETE FROM project_vault_items WHERE workspace_id = $1 AND id = $2`, s.WorkspaceID, v.ID); err != nil {
			return err
		}
		return record(ctx, tx, s, entry{ProjectID: v.ProjectID, Action: "vault." + v.Kind + "_deleted", SubjectType: "vault_item", SubjectID: v.ID,
			Changes: map[string]any{"title": v.Title}})
	})
}

// RevealVaultSecret decrypts one secret for the caller and records the reveal.
func (sv *Service) RevealVaultSecret(ctx context.Context, id string) (*VaultItem, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := require(s, authz.VaultRead); err != nil {
		return nil, err
	}
	v, err := sv.loadVaultItem(ctx, s, id)
	if err != nil {
		return nil, err
	}
	if v.Kind != "secret" {
		return nil, invalid("only a secret can be revealed")
	}
	if err := sv.requireSecrets(ctx, s, v.ProjectID); err != nil {
		return nil, err
	}
	var sealed string
	if err := sv.DB.QueryRowContext(ctx, `SELECT sealed_value FROM project_vault_items WHERE workspace_id = $1 AND id = $2`,
		s.WorkspaceID, v.ID).Scan(&sealed); err != nil {
		return nil, err
	}
	plain, err := secretbox.Open(sealed)
	if err != nil {
		return nil, errors.New("this secret cannot be decrypted with the current MAHAAM_SECRET_KEY")
	}
	err = sv.tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `UPDATE project_vault_items SET last_revealed_at = now() WHERE workspace_id = $1 AND id = $2`,
			s.WorkspaceID, v.ID); err != nil {
			return err
		}
		return record(ctx, tx, s, entry{ProjectID: v.ProjectID, Action: "vault.secret_revealed", SubjectType: "vault_item", SubjectID: v.ID,
			Changes: map[string]any{"title": v.Title}})
	})
	if err != nil {
		return nil, err
	}
	val := string(plain)
	now := time.Now().UTC()
	v.Value, v.LastRevealedAt = &val, &now
	return v, nil
}
