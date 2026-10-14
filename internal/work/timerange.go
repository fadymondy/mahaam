package work

import (
	"context"
	"time"

	"github.com/fadymondy/mahaam/internal/authz"
)

/*
The "my time" overview reads a whole week or month plus the period before it (for the change
against it) in ONE request, instead of one timesheet per week: a month is five or six weeks, and a
Free workspace allows 60 API calls a minute. Same rules as Timesheet: entries are cut at local
midnight (SplitByDay), a running entry counts up to now, nothing is rounded here.
*/

// TimePeriod is a run of local days, both ends inclusive.
type TimePeriod struct {
	From string `json:"from" doc:"YYYY-MM-DD, local"`
	To   string `json:"to" doc:"YYYY-MM-DD, local"`
}

// TimeRange is a person's entries over a period and the one before it.
type TimeRange struct {
	UserID          string       `json:"user_id"`
	Timezone        string       `json:"timezone"`
	WeekStart       int          `json:"week_start"`
	RoundingMinutes int          `json:"rounding_minutes"`
	Kind            string       `json:"kind" doc:"week or month"`
	Current         TimePeriod   `json:"current"`
	Previous        TimePeriod   `json:"previous"`
	Entries         []TimeEntry  `json:"entries" doc:"Every entry overlapping the two periods, oldest first"`
	Slices          []EntrySlice `json:"slices" doc:"Each entry cut at local midnight, for the days of both periods"`
	Running         *TimeEntry   `json:"running"`
	Now             time.Time    `json:"now"`
}

// periodBounds returns the local midnights that bound the period of kind around ref and the one
// before it: [curStart, curEnd) and [prevStart, curStart). curEnd is the midnight after the last day.
func periodBounds(kind, ref string, c *timeConf, now time.Time) (prevStart, curStart, curEnd time.Time, err error) {
	d, err := localDay(ref, c.Loc)
	if err != nil {
		return
	}
	if d == nil {
		n := now.In(c.Loc)
		t := time.Date(n.Year(), n.Month(), n.Day(), 0, 0, 0, 0, c.Loc)
		d = &t
	}
	switch kind {
	case "", "week":
		back := (int(d.Weekday()) - c.WeekStart + 7) % 7
		curStart = time.Date(d.Year(), d.Month(), d.Day()-back, 0, 0, 0, 0, c.Loc)
		curEnd = time.Date(d.Year(), d.Month(), d.Day()-back+7, 0, 0, 0, 0, c.Loc)
		prevStart = time.Date(d.Year(), d.Month(), d.Day()-back-7, 0, 0, 0, 0, c.Loc)
	case "month":
		curStart = time.Date(d.Year(), d.Month(), 1, 0, 0, 0, 0, c.Loc)
		curEnd = time.Date(d.Year(), d.Month()+1, 1, 0, 0, 0, 0, c.Loc)
		prevStart = time.Date(d.Year(), d.Month()-1, 1, 0, 0, 0, 0, c.Loc)
	default:
		err = invalid("kind is week or month")
	}
	return
}

// TimeRange is the week or month of ref (default: now) and the period before it.
func (sv *Service) TimeRange(ctx context.Context, userRef, kind, ref string) (*TimeRange, error) {
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
	prevStart, curStart, curEnd, err := periodBounds(kind, ref, conf, now)
	if err != nil {
		return nil, err
	}
	const day = "2006-01-02"
	if kind == "" {
		kind = "week"
	}
	tr := &TimeRange{UserID: who, Timezone: conf.Timezone, WeekStart: conf.WeekStart, RoundingMinutes: conf.Rounding, Kind: kind,
		Current:  TimePeriod{From: curStart.Format(day), To: curEnd.AddDate(0, 0, -1).Format(day)},
		Previous: TimePeriod{From: prevStart.Format(day), To: curStart.AddDate(0, 0, -1).Format(day)},
		Entries:  []TimeEntry{}, Slices: []EntrySlice{}, Now: now}
	rows, err := sv.DB.QueryContext(ctx, entrySelect+`WHERE e.workspace_id = $1 AND e.user_id = $2 AND e.started_at < $3
		AND (e.ended_at IS NULL OR e.ended_at > $4) ORDER BY e.started_at`, s.WorkspaceID, who, curEnd.UTC(), prevStart.UTC())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		e, err := scanEntry(rows)
		if err != nil {
			return nil, err
		}
		e = view(s, e)
		tr.Entries = append(tr.Entries, *e)
		end := now
		if e.EndedAt != nil {
			end = *e.EndedAt
		} else if e.Source != "mcp" || tr.Running == nil {
			tr.Running = e // the human timer wins; else an agent timer
		}
		for _, sl := range SplitByDay(e.StartedAt, end, conf.Loc) {
			if sl.Day >= tr.Previous.From && sl.Day <= tr.Current.To {
				tr.Slices = append(tr.Slices, EntrySlice{EntryID: e.ID, DaySlice: sl})
			}
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return tr, nil
}
