package work

import (
	"context"
	"sort"
	"time"

	"github.com/fadymondy/mahaam/internal/authz"
)

/*
Timesheets. Days are CALENDAR days in the workspace timezone: an entry is cut at every local
midnight (SplitByDay), so a 23:00–01:00 entry counts one hour on each day — the 3x1projects bug was
bucketing by the start's date. Days are not 24-hour blocks: on a DST day the cut still falls at
local midnight. A running entry counts up to now. Rounding (rounding_minutes) is applied here, at
report time, and never stored.
*/

// DaySlice is the part of [start, end) that falls on one local day.
type DaySlice struct {
	Day     string    `json:"day" doc:"YYYY-MM-DD, local"`
	Start   time.Time `json:"start"`
	End     time.Time `json:"end"`
	Seconds int64     `json:"seconds"`
}

// SplitByDay cuts [start, end) at every local midnight of loc.
func SplitByDay(start, end time.Time, loc *time.Location) []DaySlice {
	if !end.After(start) {
		return nil
	}
	var out []DaySlice
	ls := start.In(loc)
	day := time.Date(ls.Year(), ls.Month(), ls.Day(), 0, 0, 0, 0, loc)
	for day.Before(end) {
		next := time.Date(day.Year(), day.Month(), day.Day()+1, 0, 0, 0, 0, loc)
		s, e := start, end
		if day.After(s) {
			s = day
		}
		if next.Before(e) {
			e = next
		}
		if e.After(s) {
			out = append(out, DaySlice{Day: day.Format("2006-01-02"), Start: s.UTC(), End: e.UTC(), Seconds: int64(e.Sub(s) / time.Second)})
		}
		day = next
	}
	return out
}

// RoundSeconds rounds to the nearest multiple of minutes (half up). minutes <= 0 leaves it.
func RoundSeconds(sec int64, minutes int) int64 {
	if minutes <= 0 {
		return sec
	}
	step := int64(minutes) * 60
	return (sec + step/2) / step * step
}

// week returns the 8 local midnights bounding the week that contains ref (default: today).
func week(ref string, c *timeConf, now time.Time) ([]time.Time, error) {
	d, err := localDay(ref, c.Loc)
	if err != nil {
		return nil, err
	}
	if d == nil {
		n := now.In(c.Loc)
		t := time.Date(n.Year(), n.Month(), n.Day(), 0, 0, 0, 0, c.Loc)
		d = &t
	}
	back := (int(d.Weekday()) - c.WeekStart + 7) % 7
	out := make([]time.Time, 8)
	for i := range out {
		out[i] = time.Date(d.Year(), d.Month(), d.Day()-back+i, 0, 0, 0, 0, c.Loc)
	}
	return out, nil
}

func dayIndex(days []string, day string) int {
	for i, d := range days {
		if d == day {
			return i
		}
	}
	return -1
}

// TimesheetRow is one project/task line of the week grid.
type TimesheetRow struct {
	ProjectID    *string `json:"project_id"`
	ProjectName  *string `json:"project_name"`
	ProjectColor *string `json:"project_color"`
	TaskID       *string `json:"task_id"`
	TaskKey      *string `json:"task_key"`
	TaskTitle    *string `json:"task_title"`
	Seconds      []int64 `json:"seconds" doc:"Per day of the week"`
	Total        int64   `json:"total_s"`
}

// EntrySlice is one entry's share of one local day.
type EntrySlice struct {
	EntryID string `json:"entry_id"`
	DaySlice
}

// Timesheet is one person's week.
type Timesheet struct {
	UserID          string         `json:"user_id"`
	Timezone        string         `json:"timezone"`
	WeekStart       int            `json:"week_start"`
	RoundingMinutes int            `json:"rounding_minutes"`
	Days            []string       `json:"days" doc:"The 7 local dates of the week"`
	Rows            []TimesheetRow `json:"rows"`
	DayTotals       []int64        `json:"day_totals"`
	Total           int64          `json:"total_s"`
	RoundedTotal    int64          `json:"rounded_total_s" doc:"Each entry's time this week rounded to rounding_minutes, summed"`
	BillableTotal   int64          `json:"billable_s"`
	Entries         []TimeEntry    `json:"entries" doc:"Every entry overlapping the week, oldest first"`
	Slices          []EntrySlice   `json:"slices" doc:"Each entry cut at local midnight (this week's days only)"`
	Running         *TimeEntry     `json:"running"`
	Now             time.Time      `json:"now"`
}

// Timesheet is the week of ref (YYYY-MM-DD, default this week) for you or (time:manage) a member.
func (sv *Service) Timesheet(ctx context.Context, userRef, ref string) (*Timesheet, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := require(s, authz.TimeTrack); err != nil {
		return nil, err
	}
	who, err := sv.personFor(ctx, s, userRef)
	if err != nil {
		return nil, err
	}
	conf, err := loadTimeConf(ctx, sv.DB, s.WorkspaceID)
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	bounds, err := week(ref, conf, now)
	if err != nil {
		return nil, err
	}
	ts := &Timesheet{UserID: who, Timezone: conf.Timezone, WeekStart: conf.WeekStart, RoundingMinutes: conf.Rounding,
		Days: make([]string, 7), DayTotals: make([]int64, 7), Rows: []TimesheetRow{}, Entries: []TimeEntry{}, Slices: []EntrySlice{}, Now: now}
	for i := 0; i < 7; i++ {
		ts.Days[i] = bounds[i].Format("2006-01-02")
	}
	rows, err := sv.DB.QueryContext(ctx, entrySelect+`WHERE e.workspace_id = $1 AND e.user_id = $2 AND e.started_at < $3
		AND (e.ended_at IS NULL OR e.ended_at > $4) ORDER BY e.started_at`, s.WorkspaceID, who, bounds[7].UTC(), bounds[0].UTC())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	grid := map[string]*TimesheetRow{}
	for rows.Next() {
		e, err := scanEntry(rows)
		if err != nil {
			return nil, err
		}
		e = view(s, e)
		ts.Entries = append(ts.Entries, *e)
		end := now
		if e.EndedAt != nil {
			end = *e.EndedAt
		} else {
			if e.Source != "mcp" || ts.Running == nil {
				ts.Running = e // the human timer wins; else an agent timer
			}
		}
		k := sval(e.ProjectID) + "|" + sval(e.TaskID)
		row := grid[k]
		if row == nil {
			row = &TimesheetRow{ProjectID: e.ProjectID, ProjectName: e.ProjectName, ProjectColor: e.ProjectColor,
				TaskID: e.TaskID, TaskKey: e.TaskKey, TaskTitle: e.TaskTitle, Seconds: make([]int64, 7)}
			grid[k] = row
		}
		var inWeek int64
		for _, sl := range SplitByDay(e.StartedAt, end, conf.Loc) {
			i := dayIndex(ts.Days, sl.Day)
			if i < 0 {
				continue
			}
			ts.Slices = append(ts.Slices, EntrySlice{EntryID: e.ID, DaySlice: sl})
			row.Seconds[i] += sl.Seconds
			row.Total += sl.Seconds
			ts.DayTotals[i] += sl.Seconds
			ts.Total += sl.Seconds
			inWeek += sl.Seconds
		}
		ts.RoundedTotal += RoundSeconds(inWeek, conf.Rounding)
		if e.Billable {
			ts.BillableTotal += inWeek
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for _, r := range grid {
		ts.Rows = append(ts.Rows, *r)
	}
	sort.Slice(ts.Rows, func(i, j int) bool {
		a, b := ts.Rows[i], ts.Rows[j]
		if (a.ProjectName == nil) != (b.ProjectName == nil) {
			return b.ProjectName == nil // "no project" last
		}
		if sval(a.ProjectName) != sval(b.ProjectName) {
			return sval(a.ProjectName) < sval(b.ProjectName)
		}
		return sval(a.TaskKey) < sval(b.TaskKey)
	})
	return ts, nil
}

// TeamRow is one member's week.
type TeamRow struct {
	UserID   string  `json:"user_id"`
	Role     string  `json:"role"`
	Seconds  []int64 `json:"seconds"`
	Total    int64   `json:"total_s"`
	Billable int64   `json:"billable_s"`
	Running  bool    `json:"running"`
}

// TeamTimesheet is everyone's week (time:manage).
type TeamTimesheet struct {
	Timezone        string    `json:"timezone"`
	WeekStart       int       `json:"week_start"`
	RoundingMinutes int       `json:"rounding_minutes"`
	Days            []string  `json:"days"`
	Members         []TeamRow `json:"members"`
	DayTotals       []int64   `json:"day_totals"`
	Total           int64     `json:"total_s"`
	RoundedTotal    int64     `json:"rounded_total_s"`
	Billable        int64     `json:"billable_s"`
}

// TeamTimesheet is the week of ref for every active, non-client member.
func (sv *Service) TeamTimesheet(ctx context.Context, ref string) (*TeamTimesheet, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := require(s, authz.TimeManage); err != nil {
		return nil, err
	}
	conf, err := loadTimeConf(ctx, sv.DB, s.WorkspaceID)
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	bounds, err := week(ref, conf, now)
	if err != nil {
		return nil, err
	}
	tt := &TeamTimesheet{Timezone: conf.Timezone, WeekStart: conf.WeekStart, RoundingMinutes: conf.Rounding,
		Days: make([]string, 7), DayTotals: make([]int64, 7), Members: []TeamRow{}}
	for i := 0; i < 7; i++ {
		tt.Days[i] = bounds[i].Format("2006-01-02")
	}
	mrows, err := sv.DB.QueryContext(ctx, `SELECT user_id, role FROM workspace_members
		WHERE workspace_id = $1 AND status = 'active' AND role <> 'client' ORDER BY created_at`, s.WorkspaceID)
	if err != nil {
		return nil, err
	}
	index := map[string]int{}
	for mrows.Next() {
		r := TeamRow{Seconds: make([]int64, 7)}
		if err := mrows.Scan(&r.UserID, &r.Role); err != nil {
			mrows.Close()
			return nil, err
		}
		index[r.UserID] = len(tt.Members)
		tt.Members = append(tt.Members, r)
	}
	mrows.Close()
	rows, err := sv.DB.QueryContext(ctx, `SELECT user_id, started_at, ended_at, billable FROM time_entries
		WHERE workspace_id = $1 AND started_at < $2 AND (ended_at IS NULL OR ended_at > $3)`,
		s.WorkspaceID, bounds[7].UTC(), bounds[0].UTC())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var user string
		var start time.Time
		var ended *time.Time
		var billable bool
		if err := rows.Scan(&user, &start, &ended, &billable); err != nil {
			return nil, err
		}
		i, ok := index[user]
		if !ok {
			continue // a removed member's history stays in the table, not in this week's grid
		}
		end := now
		if ended != nil {
			end = *ended
		} else {
			tt.Members[i].Running = true
		}
		var inWeek int64
		for _, sl := range SplitByDay(start, end, conf.Loc) {
			d := dayIndex(tt.Days, sl.Day)
			if d < 0 {
				continue
			}
			tt.Members[i].Seconds[d] += sl.Seconds
			tt.Members[i].Total += sl.Seconds
			tt.DayTotals[d] += sl.Seconds
			tt.Total += sl.Seconds
			inWeek += sl.Seconds
		}
		tt.RoundedTotal += RoundSeconds(inWeek, conf.Rounding)
		if billable {
			tt.Members[i].Billable += inWeek
			tt.Billable += inWeek
		}
	}
	return tt, rows.Err()
}
