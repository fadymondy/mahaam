package admin

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"time"
)

// PlanCount is how many workspaces are on a plan.
type PlanCount struct {
	Plan   string `json:"plan"`
	NameEn string `json:"name_en"`
	NameAr string `json:"name_ar"`
	Count  int    `json:"count"`
}

// SignupDay is one day of signups.
type SignupDay struct {
	Day        string `json:"day"`
	Users      int    `json:"users"`
	Workspaces int    `json:"workspaces"`
}

// Stats is the admin dashboard.
type Stats struct {
	Users               int         `json:"users"`
	Admins              int         `json:"admins"`
	SuspendedUsers      int         `json:"suspended_users"`
	Workspaces          int         `json:"workspaces"`
	SuspendedWorkspaces int         `json:"suspended_workspaces"`
	ActiveUsers7d       int         `json:"active_users_7d"`
	ActiveUsers30d      int         `json:"active_users_30d"`
	ActiveWorkspaces7d  int         `json:"active_workspaces_7d"`
	ActiveWorkspaces30d int         `json:"active_workspaces_30d"`
	Projects            int         `json:"projects"`
	Tasks               int         `json:"tasks"`
	Issues              int         `json:"issues"`
	TimeSeconds         int64       `json:"time_seconds"`
	StorageBytes        int64       `json:"storage_bytes"`
	Plans               []PlanCount `json:"plans"`
	Signups             []SignupDay `json:"signups"`
}

// PlatformStats computes the dashboard (the platform workspace itself is not counted).
func (sv *Service) PlatformStats(ctx context.Context) (*Stats, error) {
	s := &Stats{Plans: []PlanCount{}, Signups: []SignupDay{}}
	err := sv.DB.QueryRowContext(ctx, `SELECT
		(SELECT count(*) FROM users),
		(SELECT count(*) FROM users u WHERE `+adminRoleSQL+`),
		(SELECT count(*) FROM platform_users WHERE suspended_at IS NOT NULL),
		(SELECT count(*) FROM workspaces WHERE slug <> 'platform'),
		(SELECT count(*) FROM workspaces WHERE status = 'suspended'),
		(SELECT count(*) FROM platform_users WHERE last_seen_at > now() - interval '7 days'),
		(SELECT count(*) FROM platform_users WHERE last_seen_at > now() - interval '30 days'),
		(SELECT count(DISTINCT workspace_id) FROM activity_logs WHERE created_at > now() - interval '7 days'),
		(SELECT count(DISTINCT workspace_id) FROM activity_logs WHERE created_at > now() - interval '30 days'),
		(SELECT count(*) FROM projects),
		(SELECT count(*) FROM tasks),
		(SELECT count(*) FROM reports),
		(SELECT COALESCE(sum(duration_s), 0)::bigint FROM time_entries),
		(SELECT COALESCE(sum(size), 0)::bigint FROM attachments)`).Scan(
		&s.Users, &s.Admins, &s.SuspendedUsers, &s.Workspaces, &s.SuspendedWorkspaces,
		&s.ActiveUsers7d, &s.ActiveUsers30d, &s.ActiveWorkspaces7d, &s.ActiveWorkspaces30d,
		&s.Projects, &s.Tasks, &s.Issues, &s.TimeSeconds, &s.StorageBytes)
	if err != nil {
		return nil, err
	}
	s.StorageBytes += dirSize(filepath.Join(storageDir(), "feedback"))

	rows, err := sv.DB.QueryContext(ctx, `SELECT p.key, p.name_en, p.name_ar, count(w.id)
		FROM plans p LEFT JOIN workspaces w ON w.plan = p.key AND w.slug <> 'platform'
		GROUP BY p.key, p.name_en, p.name_ar, p.sort ORDER BY p.sort, p.key`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var c PlanCount
		if err := rows.Scan(&c.Plan, &c.NameEn, &c.NameAr, &c.Count); err != nil {
			rows.Close()
			return nil, err
		}
		s.Plans = append(s.Plans, c)
	}
	rows.Close()

	// Signups per day over the last 30 days (users.created_at is the auth plugin's RFC 3339 text).
	var raw []byte
	err = sv.DB.QueryRowContext(ctx, `
		WITH days AS (SELECT generate_series((now() AT TIME ZONE 'UTC')::date - 29, (now() AT TIME ZONE 'UTC')::date, interval '1 day')::date AS d)
		SELECT COALESCE(json_agg(json_build_object('day', to_char(d, 'YYYY-MM-DD'),
			'users', (SELECT count(*) FROM users WHERE left(created_at, 10) = to_char(d, 'YYYY-MM-DD')),
			'workspaces', (SELECT count(*) FROM workspaces WHERE (created_at AT TIME ZONE 'UTC')::date = d AND slug <> 'platform'))
			ORDER BY d), '[]') FROM days`).Scan(&raw)
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(raw, &s.Signups); err != nil {
		return nil, err
	}
	return s, nil
}

func storageDir() string {
	if d := os.Getenv("STORAGE_DIR"); d != "" {
		return d
	}
	return "storage"
}

func dirSize(dir string) int64 {
	var total int64
	_ = filepath.WalkDir(dir, func(_ string, d os.DirEntry, err error) error {
		if err == nil && !d.IsDir() {
			if info, err := d.Info(); err == nil {
				total += info.Size()
			}
		}
		return nil
	})
	return total
}

// AuditEntry is one row of the admin audit log.
type AuditEntry struct {
	ID          string          `json:"id"`
	ActorID     string          `json:"actor_id"`
	ActorEmail  string          `json:"actor_email"`
	Action      string          `json:"action"`
	TargetType  string          `json:"target_type"`
	TargetID    string          `json:"target_id"`
	TargetLabel string          `json:"target_label"`
	Changes     json.RawMessage `json:"changes"`
	IP          string          `json:"ip"`
	Via         string          `json:"via"`
	At          time.Time       `json:"at"`
}

// AuditFilter narrows the audit log (Q matches action, actor or target).
type AuditFilter struct {
	Q string
	Page
}

// Audit lists admin actions, newest first.
func (sv *Service) Audit(ctx context.Context, f AuditFilter) ([]AuditEntry, int, error) {
	where := ` WHERE ($1 = '' OR action ILIKE $2 OR actor_email ILIKE $2 OR target_label ILIKE $2 OR target_id = $1)`
	var total int
	if err := sv.DB.QueryRowContext(ctx, `SELECT count(*) FROM admin_audit`+where, f.Q, like(f.Q)).Scan(&total); err != nil {
		return nil, 0, err
	}
	limit, offset := f.norm(50)
	rows, err := sv.DB.QueryContext(ctx, `SELECT id, actor_id, actor_email, action, target_type, target_id, target_label,
		COALESCE(changes, 'null'::jsonb), ip, via, at FROM admin_audit`+where+` ORDER BY at DESC, id LIMIT $3 OFFSET $4`, f.Q, like(f.Q), limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []AuditEntry{}
	for rows.Next() {
		var e AuditEntry
		var changes []byte
		if err := rows.Scan(&e.ID, &e.ActorID, &e.ActorEmail, &e.Action, &e.TargetType, &e.TargetID, &e.TargetLabel, &changes, &e.IP, &e.Via, &e.At); err != nil {
			return nil, 0, err
		}
		e.Changes = changes
		out = append(out, e)
	}
	return out, total, rows.Err()
}
