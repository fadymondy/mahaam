package work

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/fadymondy/managy/internal/authz"
)

/*
Member rates (effective-dated) and the workspace's time settings.

A member_rates row is a member's whole rate card from its effective day. The rate used for an
entry is resolved and COPIED onto the entry when the entry is created (time.go, resolveRates), so
adding, changing or deleting a row here never changes an existing entry. Rates are minor units of
the workspace currency. Managers read rates; admins set them.
*/

// MemberRate is one effective-dated rate card.
type MemberRate struct {
	ID            string    `json:"id"`
	UserID        string    `json:"user_id"`
	EffectiveFrom string    `json:"effective_from" doc:"YYYY-MM-DD, workspace timezone"`
	BillRateMinor *int64    `json:"bill_rate_minor"`
	CostRateMinor *int64    `json:"cost_rate_minor"`
	Currency      string    `json:"currency"`
	CreatedBy     string    `json:"created_by"`
	CreatedAt     time.Time `json:"created_at"`
}

// MemberRates is one member's current card and history (newest first).
type MemberRates struct {
	UserID  string       `json:"user_id"`
	Role    string       `json:"role"`
	Current *MemberRate  `json:"current" doc:"The card in force today, if any"`
	History []MemberRate `json:"history"`
}

// RateSheet is the rates page.
type RateSheet struct {
	Currency             string        `json:"currency"`
	Timezone             string        `json:"timezone"`
	Today                string        `json:"today"`
	DefaultBillRateMinor *int64        `json:"default_bill_rate_minor"`
	DefaultCostRateMinor *int64        `json:"default_cost_rate_minor"`
	Members              []MemberRates `json:"members"`
	CanManage            bool          `json:"can_manage"`
}

// Rates lists every active, non-client member's rates (managers and up).
func (sv *Service) Rates(ctx context.Context) (*RateSheet, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := require(s, authz.RatesRead); err != nil {
		return nil, err
	}
	conf, err := loadTimeConf(ctx, sv.DB, s.WorkspaceID)
	if err != nil {
		return nil, err
	}
	today := time.Now().In(conf.Loc).Format("2006-01-02")
	out := &RateSheet{Currency: conf.Currency, Timezone: conf.Timezone, Today: today, DefaultBillRateMinor: conf.DefaultBill,
		DefaultCostRateMinor: conf.DefaultCost, Members: []MemberRates{}, CanManage: authz.Can(s.Role, authz.RatesManage)}
	rows, err := sv.DB.QueryContext(ctx, `SELECT user_id, role FROM workspace_members
		WHERE workspace_id = $1 AND status = 'active' AND role <> 'client' ORDER BY created_at`, s.WorkspaceID)
	if err != nil {
		return nil, err
	}
	index := map[string]int{}
	for rows.Next() {
		m := MemberRates{History: []MemberRate{}}
		if err := rows.Scan(&m.UserID, &m.Role); err != nil {
			rows.Close()
			return nil, err
		}
		index[m.UserID] = len(out.Members)
		out.Members = append(out.Members, m)
	}
	rows.Close()
	rrows, err := sv.DB.QueryContext(ctx, `SELECT id, user_id, effective_from, bill_rate_minor, cost_rate_minor, currency, created_by, created_at
		FROM member_rates WHERE workspace_id = $1 ORDER BY user_id, effective_from DESC`, s.WorkspaceID)
	if err != nil {
		return nil, err
	}
	defer rrows.Close()
	for rrows.Next() {
		r, err := scanRate(rrows)
		if err != nil {
			return nil, err
		}
		i, ok := index[r.UserID]
		if !ok {
			continue
		}
		m := &out.Members[i]
		m.History = append(m.History, *r)
		if m.Current == nil && r.EffectiveFrom <= today {
			c := *r
			m.Current = &c
		}
	}
	return out, rrows.Err()
}

func scanRate(r scanner) (*MemberRate, error) {
	m := &MemberRate{}
	var day time.Time
	err := r.Scan(&m.ID, &m.UserID, &day, &m.BillRateMinor, &m.CostRateMinor, &m.Currency, &m.CreatedBy, &m.CreatedAt)
	m.EffectiveFrom = day.Format("2006-01-02")
	return m, err
}

// RateInput is a rate card from a day. Both rates are minor units; send at least one.
type RateInput struct {
	EffectiveFrom string `json:"effective_from,omitempty" doc:"YYYY-MM-DD (default: today, workspace timezone)"`
	BillRateMinor *int64 `json:"bill_rate_minor,omitempty" minimum:"0"`
	CostRateMinor *int64 `json:"cost_rate_minor,omitempty" minimum:"0"`
}

// SetMemberRate adds (or replaces, for the same day) a member's rate card. Admins and up.
func (sv *Service) SetMemberRate(ctx context.Context, userID string, in RateInput) (*MemberRate, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := require(s, authz.RatesManage); err != nil {
		return nil, err
	}
	userID = strings.TrimSpace(userID)
	var ok bool
	if err := sv.DB.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = $1
		AND user_id = $2 AND status = 'active' AND role <> 'client')`, s.WorkspaceID, userID).Scan(&ok); err != nil {
		return nil, err
	}
	if !ok {
		return nil, notFound("member")
	}
	if in.BillRateMinor == nil && in.CostRateMinor == nil {
		return nil, invalid("give a bill rate, a cost rate, or both")
	}
	conf, err := loadTimeConf(ctx, sv.DB, s.WorkspaceID)
	if err != nil {
		return nil, err
	}
	day := strings.TrimSpace(in.EffectiveFrom)
	if day == "" {
		day = time.Now().In(conf.Loc).Format("2006-01-02")
	} else if _, err := time.Parse("2006-01-02", day); err != nil {
		return nil, invalid("%q is not a date (YYYY-MM-DD)", day)
	}
	var id string
	err = sv.tx(ctx, func(tx *sql.Tx) error {
		if err := tx.QueryRowContext(ctx, `INSERT INTO member_rates (workspace_id, user_id, effective_from, bill_rate_minor,
			cost_rate_minor, currency, created_by) VALUES ($1, $2, $3::date, $4, $5, $6, $7)
			ON CONFLICT (workspace_id, user_id, effective_from) DO UPDATE
			SET bill_rate_minor = EXCLUDED.bill_rate_minor, cost_rate_minor = EXCLUDED.cost_rate_minor,
			    currency = EXCLUDED.currency, created_by = EXCLUDED.created_by, updated_at = now()
			RETURNING id`, s.WorkspaceID, userID, day, in.BillRateMinor, in.CostRateMinor, conf.Currency, s.UserID).Scan(&id); err != nil {
			return err
		}
		return record(ctx, tx, s, entry{Action: "rate.set", SubjectType: "member_rate", SubjectID: id, Changes: map[string]any{
			"user_id": userID, "effective_from": day, "bill_rate_minor": in.BillRateMinor, "cost_rate_minor": in.CostRateMinor}})
	})
	if err != nil {
		return nil, err
	}
	return scanRate(sv.DB.QueryRowContext(ctx, `SELECT id, user_id, effective_from, bill_rate_minor, cost_rate_minor, currency,
		created_by, created_at FROM member_rates WHERE workspace_id = $1 AND id = $2`, s.WorkspaceID, id))
}

// DeleteMemberRate removes one rate card. Existing entries keep their snapshot.
func (sv *Service) DeleteMemberRate(ctx context.Context, id string) error {
	s, err := caller(ctx)
	if err != nil {
		return err
	}
	if err := require(s, authz.RatesManage); err != nil {
		return err
	}
	return sv.tx(ctx, func(tx *sql.Tx) error {
		var user string
		var day time.Time
		err := tx.QueryRowContext(ctx, `DELETE FROM member_rates WHERE workspace_id = $1 AND id = $2 RETURNING user_id, effective_from`,
			s.WorkspaceID, strings.TrimSpace(id)).Scan(&user, &day)
		if errors.Is(err, sql.ErrNoRows) {
			return notFound("rate")
		}
		if err != nil {
			return err
		}
		return record(ctx, tx, s, entry{Action: "rate.deleted", SubjectType: "member_rate", SubjectID: strings.TrimSpace(id),
			Changes: map[string]any{"user_id": user, "effective_from": day.Format("2006-01-02")}})
	})
}

// ---- workspace time settings --------------------------------------------------------------------------

// TimeSettings are the workspace's time and rate defaults.
type TimeSettings struct {
	Timezone             string `json:"timezone" doc:"IANA name, e.g. Africa/Cairo"`
	WeekStart            int    `json:"week_start" doc:"0 = Sunday … 6 = Saturday"`
	RoundingMinutes      int    `json:"rounding_minutes" doc:"Applied at report time only; 0 = none"`
	Currency             string `json:"currency"`
	Locale               string `json:"locale" doc:"en or ar: seeds new projects' default columns"`
	DefaultBillRateMinor *int64 `json:"default_bill_rate_minor,omitempty" doc:"rates:read only"`
	DefaultCostRateMinor *int64 `json:"default_cost_rate_minor,omitempty" doc:"rates:read only"`
	ReminderRunningHours int    `json:"reminder_running_hours" doc:"A timer running longer raises a reminder"`
	ReminderDaily        bool   `json:"reminder_daily" doc:"Remind people with no time by 18:00 local on workdays"`
	CanManage            bool   `json:"can_manage"`
}

// TimeSettingsInput changes them (admins). A default rate of 0 clears it.
type TimeSettingsInput struct {
	Timezone             *string `json:"timezone,omitempty"`
	WeekStart            *int    `json:"week_start,omitempty" minimum:"0" maximum:"6"`
	RoundingMinutes      *int    `json:"rounding_minutes,omitempty" enum:"0,1,5,6,10,15,30,60"`
	Currency             *string `json:"currency,omitempty" pattern:"^[A-Z]{3}$"`
	Locale               *string `json:"locale,omitempty" enum:"en,ar"`
	DefaultBillRateMinor *int64  `json:"default_bill_rate_minor,omitempty" minimum:"0" doc:"0 clears it"`
	DefaultCostRateMinor *int64  `json:"default_cost_rate_minor,omitempty" minimum:"0" doc:"0 clears it"`
	ReminderRunningHours *int    `json:"reminder_running_hours,omitempty" minimum:"1" maximum:"24"`
	ReminderDaily        *bool   `json:"reminder_daily,omitempty"`
}

// GetTimeSettings is visible to every member (the UI needs the timezone and week start).
func (sv *Service) GetTimeSettings(ctx context.Context) (*TimeSettings, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	c, err := loadTimeConf(ctx, sv.DB, s.WorkspaceID)
	if err != nil {
		return nil, err
	}
	out := &TimeSettings{Timezone: c.Timezone, WeekStart: c.WeekStart, RoundingMinutes: c.Rounding, Currency: c.Currency,
		Locale: c.Locale, ReminderRunningHours: c.ReminderHours, ReminderDaily: c.ReminderDaily,
		CanManage: authz.Can(s.Role, authz.WorkspaceUpdate)}
	if authz.Can(s.Role, authz.RatesRead) {
		out.DefaultBillRateMinor, out.DefaultCostRateMinor = c.DefaultBill, c.DefaultCost
	}
	return out, nil
}

// UpdateTimeSettings changes the workspace's time settings (admins). A currency change applies to
// entries created from now on; existing entries keep the currency of their snapshot.
func (sv *Service) UpdateTimeSettings(ctx context.Context, in TimeSettingsInput) (*TimeSettings, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := require(s, authz.WorkspaceUpdate); err != nil {
		return nil, err
	}
	cols, args := []string{}, []any{s.WorkspaceID}
	changes := map[string]any{}
	set := func(col string, v any) {
		args = append(args, v)
		cols = append(cols, col+" = $"+itoa(len(args)))
		changes[col] = v
	}
	if v, ok := trimmed(in.Timezone); ok {
		if _, err := time.LoadLocation(v); err != nil || v == "" || v == "Local" {
			return nil, invalid("%q is not a timezone (use an IANA name such as Africa/Cairo)", v)
		}
		set("timezone", v)
	}
	if in.WeekStart != nil {
		if *in.WeekStart < 0 || *in.WeekStart > 6 {
			return nil, invalid("week_start is 0 (Sunday) to 6 (Saturday)")
		}
		set("week_start", *in.WeekStart)
	}
	if in.RoundingMinutes != nil {
		if err := oneOf("rounding_minutes", itoa(*in.RoundingMinutes), "0", "1", "5", "6", "10", "15", "30", "60"); err != nil {
			return nil, err
		}
		set("rounding_minutes", *in.RoundingMinutes)
	}
	if v, ok := trimmed(in.Currency); ok {
		if !currencyRe.MatchString(v) {
			return nil, invalid("currency is a 3-letter ISO code, e.g. EGP")
		}
		set("currency", v)
	}
	if v, ok := trimmed(in.Locale); ok {
		if err := oneOf("locale", v, "en", "ar"); err != nil {
			return nil, err
		}
		set("locale", v)
	}
	rate := func(col string, v *int64) {
		if v == nil {
			return
		}
		if *v <= 0 {
			set(col, nil)
			return
		}
		if !authz.Can(s.Role, authz.RatesManage) {
			return
		}
		set(col, *v)
	}
	rate("default_bill_rate_minor", in.DefaultBillRateMinor)
	rate("default_cost_rate_minor", in.DefaultCostRateMinor)
	if in.ReminderRunningHours != nil {
		if *in.ReminderRunningHours < 1 || *in.ReminderRunningHours > 24 {
			return nil, invalid("reminder_running_hours is 1 to 24")
		}
		set("reminder_running_hours", *in.ReminderRunningHours)
	}
	if in.ReminderDaily != nil {
		set("reminder_daily", *in.ReminderDaily)
	}
	if len(cols) > 0 {
		err = sv.tx(ctx, func(tx *sql.Tx) error {
			if _, err := tx.ExecContext(ctx, `UPDATE workspaces SET `+strings.Join(cols, ", ")+`, updated_at = now() WHERE id = $1`, args...); err != nil {
				return err
			}
			return record(ctx, tx, s, entry{Action: "workspace.updated", SubjectType: "workspace", SubjectID: s.WorkspaceID, Changes: changes})
		})
		if err != nil {
			return nil, err
		}
	}
	return sv.GetTimeSettings(ctx)
}
