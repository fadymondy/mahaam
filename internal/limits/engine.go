package limits

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// cacheTTL bounds how stale a workspace's plan can be in another process. Changes made through
// this process (admin REST / MCP) invalidate at once.
const cacheTTL = 30 * time.Second

type cached struct {
	e  *Effective
	at time.Time
}

var (
	mu     sync.RWMutex
	sys    *sql.DB
	logger *slog.Logger
	cache  = map[string]cached{}
	now    = time.Now // tests move the clock
)

// Init hands the engine the owner pool and starts the API-call flusher. Safe to call again (a
// test process boots the stack more than once): the latest pool wins.
func Init(ctx context.Context, db *sql.DB, log *slog.Logger) {
	mu.Lock()
	sys, logger = db, log
	cache = map[string]cached{}
	mu.Unlock()
	startFlusher(ctx)
}

func pool() *sql.DB {
	mu.RLock()
	defer mu.RUnlock()
	return sys
}

// Invalidate drops a workspace's cached plan (all workspaces when ws is empty).
func Invalidate(ws string) {
	mu.Lock()
	defer mu.Unlock()
	if ws == "" {
		cache = map[string]cached{}
		return
	}
	delete(cache, ws)
}

// DefaultPlan is the plan a new workspace starts on: PLAN_DEFAULT when it names an active plan,
// else free.
func DefaultPlan(ctx context.Context, db *sql.DB) string {
	want := strings.TrimSpace(os.Getenv("PLAN_DEFAULT"))
	if want == "" {
		want = "free"
	}
	var ok bool
	if db != nil {
		_ = db.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM plans WHERE key = $1 AND active)`, want).Scan(&ok)
	}
	if !ok {
		return "free"
	}
	return want
}

// ---- plans ------------------------------------------------------------------------------------

const planCols = `p.key, p.name_en, p.name_ar, p.description_en, p.description_ar, p.currency, p.base_fee_minor,
	p.price_label_en, p.price_label_ar, p.active, p.sort, p.limits, p.features`

type scanner interface{ Scan(dest ...any) error }

func scanPlan(row scanner, extra ...any) (*Plan, error) {
	p := &Plan{}
	var rawLimits, rawFeatures []byte
	dest := append([]any{&p.Key, &p.NameEn, &p.NameAr, &p.DescriptionEn, &p.DescriptionAr, &p.Currency, &p.BaseFeeMinor,
		&p.PriceLabelEn, &p.PriceLabelAr, &p.Active, &p.Sort, &rawLimits, &rawFeatures}, extra...)
	if err := row.Scan(dest...); err != nil {
		return nil, err
	}
	p.Limits = map[string]Rule{}
	if len(rawLimits) > 0 {
		if err := json.Unmarshal(rawLimits, &p.Limits); err != nil {
			return nil, fmt.Errorf("plan %s limits: %w", p.Key, err)
		}
	}
	for k, r := range p.Limits {
		p.Limits[k] = r.Normalize(k)
	}
	if len(rawFeatures) > 0 {
		if err := json.Unmarshal(rawFeatures, &p.Features); err != nil {
			return nil, fmt.Errorf("plan %s features: %w", p.Key, err)
		}
	}
	p.Features = NormalizeFeatures(p.Features)
	return p, nil
}

// fillCatalog gives a plan an explicit rule for every catalog key (unlimited where unset), so a
// client can render and edit the full grid.
func fillCatalog(p *Plan) {
	for _, d := range Catalog {
		if _, ok := p.Limits[d.Key]; !ok {
			p.Limits[d.Key] = Rule{Policy: Block}.Normalize(d.Key)
		}
	}
}

// ListPlans returns every plan with its workspace count, in display order.
func ListPlans(ctx context.Context, db *sql.DB) ([]Plan, error) {
	rows, err := db.QueryContext(ctx, `SELECT `+planCols+`, (SELECT count(*) FROM workspaces w WHERE w.plan = p.key)
		FROM plans p ORDER BY p.sort, p.key`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Plan{}
	for rows.Next() {
		var n int
		p, err := scanPlan(rows, &n)
		if err != nil {
			return nil, err
		}
		p.Workspaces = n
		fillCatalog(p)
		out = append(out, *p)
	}
	return out, rows.Err()
}

// GetPlan reads one plan.
func GetPlan(ctx context.Context, db *sql.DB, key string) (*Plan, error) {
	var n int
	p, err := scanPlan(db.QueryRowContext(ctx, `SELECT `+planCols+`, (SELECT count(*) FROM workspaces w WHERE w.plan = p.key)
		FROM plans p WHERE p.key = $1`, key), &n)
	if err != nil {
		return nil, err
	}
	p.Workspaces = n
	fillCatalog(p)
	return p, nil
}

// SavePlan inserts or updates a plan (create=true refuses an existing key).
func SavePlan(ctx context.Context, db *sql.DB, p Plan, create bool) (*Plan, error) {
	p.Key = strings.ToLower(strings.TrimSpace(p.Key))
	if p.Key == "" || strings.TrimSpace(p.NameEn) == "" {
		return nil, errors.New("a key and an English name are required")
	}
	if p.Limits == nil {
		p.Limits = map[string]Rule{}
	}
	if err := ValidateRules(p.Limits); err != nil {
		return nil, err
	}
	for k, r := range p.Limits {
		p.Limits[k] = r.Normalize(k)
	}
	if p.BaseFeeMinor < 0 {
		return nil, errors.New("the base fee cannot be negative")
	}
	p.Features = NormalizeFeatures(p.Features)
	if p.Currency = strings.ToUpper(strings.TrimSpace(p.Currency)); p.Currency == "" {
		p.Currency = "USD"
	}
	if strings.TrimSpace(p.NameAr) == "" {
		p.NameAr = p.NameEn
	}
	limits, _ := json.Marshal(p.Limits)
	features, _ := json.Marshal(p.Features)
	args := []any{p.Key, p.NameEn, p.NameAr, p.DescriptionEn, p.DescriptionAr, p.Currency, p.BaseFeeMinor,
		p.PriceLabelEn, p.PriceLabelAr, p.Active, p.Sort, string(limits), string(features)}
	var err error
	if create {
		_, err = db.ExecContext(ctx, `INSERT INTO plans (key, name_en, name_ar, description_en, description_ar, currency, base_fee_minor,
			price_label_en, price_label_ar, active, sort, limits, features)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb)`, args...)
	} else {
		var res sql.Result
		res, err = db.ExecContext(ctx, `UPDATE plans SET name_en = $2, name_ar = $3, description_en = $4, description_ar = $5,
			currency = $6, base_fee_minor = $7, price_label_en = $8, price_label_ar = $9, active = $10, sort = $11,
			limits = $12::jsonb, features = $13::jsonb, updated_at = now() WHERE key = $1`, args...)
		if err == nil {
			if n, _ := res.RowsAffected(); n == 0 {
				return nil, sql.ErrNoRows
			}
		}
	}
	if err != nil {
		return nil, err
	}
	Invalidate("")
	return GetPlan(ctx, db, p.Key)
}

// ---- effective limits ----------------------------------------------------------------------------

// Load reads a workspace's plan + overrides (uncached).
func Load(ctx context.Context, db *sql.DB, ws string) (*Effective, error) {
	var rawOverrides []byte
	var status string
	p, err := scanPlan(db.QueryRowContext(ctx, `SELECT `+planCols+`, w.plan_overrides, w.status
		FROM workspaces w JOIN plans p ON p.key = w.plan WHERE w.id = $1`, ws), &rawOverrides, &status)
	if err != nil {
		return nil, err
	}
	var o Overrides
	if len(rawOverrides) > 0 {
		_ = json.Unmarshal(rawOverrides, &o)
	}
	e, err := Merge(*p, o)
	if err != nil {
		return nil, err
	}
	e.WorkspaceID, e.Status = ws, status
	return e, nil
}

// For returns a workspace's effective limits, cached for cacheTTL. nil (allow everything) before
// Init.
func For(ctx context.Context, ws string) (*Effective, error) {
	if ws == "" {
		return nil, nil
	}
	mu.RLock()
	c, ok := cache[ws]
	mu.RUnlock()
	if ok && now().Sub(c.at) < cacheTTL {
		return c.e, nil
	}
	db := pool()
	if db == nil {
		return nil, nil
	}
	e, err := Load(ctx, db, ws)
	if err != nil {
		return nil, err
	}
	mu.Lock()
	cache[ws] = cached{e: e, at: now()}
	mu.Unlock()
	return e, nil
}

// ---- checks -----------------------------------------------------------------------------------

// Check refuses adding n of key when a block-policy limit would be exceeded. An overage rule
// allows it and records the month's high-water mark (what the overage is billed on).
func Check(ctx context.Context, ws, key string, n int64) error {
	e, err := For(ctx, ws)
	if err != nil || e == nil {
		return err
	}
	r := e.Rule(key)
	if r.Limit == nil {
		return nil
	}
	db := pool()
	usage, err := Usage(ctx, db, ws, key)
	if err != nil {
		return err
	}
	if !r.Allows(usage, n) {
		return limitError(e, key, *r.Limit)
	}
	if d, _ := DefOf(key); d.Kind == KindCount || d.Kind == KindData {
		recordPeak(ctx, db, ws, key, usage+n)
	}
	return nil
}

// CheckStorage refuses storing addBytes more when the storage limit is a hard cap.
func CheckStorage(ctx context.Context, ws string, addBytes int64) error {
	e, err := For(ctx, ws)
	if err != nil || e == nil {
		return err
	}
	r := e.Rule(StorageMB)
	if r.Limit == nil {
		return nil
	}
	db := pool()
	used, err := StorageBytes(ctx, db, ws)
	if err != nil {
		return err
	}
	if r.Policy == Block && used+addBytes > *r.Limit*mib {
		return limitError(e, StorageMB, *r.Limit)
	}
	recordPeak(ctx, db, ws, StorageMB, ceilMB(used+addBytes))
	return nil
}

// Feature refuses when the plan does not include feature key (ai_usage_tracking,
// customer_portal, vault, kpi).
func Feature(ctx context.Context, ws, key string) error {
	e, err := For(ctx, ws)
	if err != nil || e == nil {
		return err
	}
	if !e.Features.Has(key) {
		return featureError(e, key)
	}
	return nil
}

// Integration refuses when the plan does not include provider (github, jira, linear).
func Integration(ctx context.Context, ws, provider string) error {
	return Feature(ctx, ws, strings.ToLower(provider))
}

// As reports whether err is (or wraps) a refusal.
func As(err error) (*Exceeded, bool) {
	var x *Exceeded
	if errors.As(err, &x) {
		return x, true
	}
	return nil, false
}

// ---- usage ------------------------------------------------------------------------------------

const mib = 1 << 20

func ceilMB(b int64) int64 { return (b + mib - 1) / mib }

var countSQL = map[string]string{
	// Seats: active staff plus pending staff invitations (customers are free).
	Members: `SELECT (SELECT count(*) FROM workspace_members WHERE workspace_id = $1 AND status = 'active' AND role <> 'client')
	               + (SELECT count(*) FROM invitations WHERE workspace_id = $1 AND accepted_at IS NULL AND expires_at > now() AND role <> 'client')`,
	Projects:     `SELECT count(*) FROM projects WHERE workspace_id = $1 AND archived_at IS NULL`,
	Clients:      `SELECT count(*) FROM clients WHERE workspace_id = $1`,
	Tasks:        `SELECT count(*) FROM tasks WHERE workspace_id = $1`,
	Issues:       `SELECT count(*) FROM reports WHERE workspace_id = $1`,
	Teams:        `SELECT count(*) FROM teams WHERE workspace_id = $1`,
	FeedbackKeys: `SELECT count(*) FROM project_feedback_keys WHERE workspace_id = $1 AND revoked_at IS NULL`,
	MCPTokens:    `SELECT count(*) FROM mcp_tokens WHERE workspace_id = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`,
}

var monthlyCol = map[string]string{IssuesMonth: "issues_created", TasksMonth: "tasks_created", APICallsMonth: "api_calls"}

// Usage is the current usage of key for workspace ws (this month for the monthly keys; MB for
// storage; this minute's calls for the rate).
func Usage(ctx context.Context, db *sql.DB, ws, key string) (int64, error) {
	if q, ok := countSQL[key]; ok {
		var n int64
		err := db.QueryRowContext(ctx, q, ws).Scan(&n)
		return n, err
	}
	switch key {
	case StorageMB:
		b, err := StorageBytes(ctx, db, ws)
		return ceilMB(b), err
	case APIRateMinute:
		return int64(meterMinute(ws)), nil
	}
	if col, ok := monthlyCol[key]; ok {
		var n int64
		err := db.QueryRowContext(ctx, `SELECT COALESCE((SELECT `+col+` FROM workspace_usage WHERE workspace_id = $1 AND period = $2), 0)`,
			ws, PeriodOf(now())).Scan(&n)
		if key == APICallsMonth {
			n += pendingCalls(ws)
		}
		return n, err
	}
	return 0, fmt.Errorf("unknown limit %q", key)
}

// storageDir is where screenshots live (the same STORAGE_DIR as internal/reports).
func storageDir() string {
	if d := os.Getenv("STORAGE_DIR"); d != "" {
		return d
	}
	return "storage"
}

// StorageBytes is what a workspace stores: task attachments (sizes recorded) plus issue and
// request screenshots (files under STORAGE_DIR, measured).
func StorageBytes(ctx context.Context, db *sql.DB, ws string) (int64, error) {
	var total int64
	if err := db.QueryRowContext(ctx, `SELECT COALESCE(sum(size), 0)::bigint FROM attachments WHERE workspace_id = $1`, ws).Scan(&total); err != nil {
		return 0, err
	}
	rows, err := db.QueryContext(ctx, `SELECT screenshot FROM reports WHERE workspace_id = $1 AND screenshot IS NOT NULL AND screenshot <> ''`, ws)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	dir := storageDir()
	for rows.Next() {
		var p string
		if rows.Scan(&p) != nil {
			continue
		}
		clean := filepath.Clean(filepath.FromSlash(p))
		if strings.HasPrefix(clean, "..") || filepath.IsAbs(clean) {
			continue
		}
		if st, err := os.Stat(filepath.Join(dir, clean)); err == nil {
			total += st.Size()
		}
	}
	return total, rows.Err()
}

// recordPeak raises the month's high-water mark for key (best effort).
func recordPeak(ctx context.Context, db *sql.DB, ws, key string, v int64) {
	if db == nil {
		return
	}
	_, err := db.ExecContext(ctx, `
		INSERT INTO workspace_usage AS u (workspace_id, period, peaks) VALUES ($1, $2, jsonb_build_object($3::text, $4::bigint))
		ON CONFLICT (workspace_id, period) DO UPDATE SET
			peaks = u.peaks || jsonb_build_object($3::text, GREATEST(COALESCE((u.peaks->>$3)::bigint, 0), $4::bigint)),
			updated_at = now()
		WHERE COALESCE((u.peaks->>$3)::bigint, -1) < $4::bigint`, ws, PeriodOf(now()), key, v)
	if err != nil && logger != nil {
		logger.Warn("limits: peak not recorded", "workspace", ws, "key", key, "err", err)
	}
}
