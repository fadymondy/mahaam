package work

import (
	"reflect"
	"testing"
	"time"
)

func mustLoc(t *testing.T, name string) *time.Location {
	t.Helper()
	l, err := time.LoadLocation(name)
	if err != nil {
		t.Fatalf("load %s: %v", name, err)
	}
	return l
}

type got struct {
	Day     string
	Seconds int64
}

func slices(ds []DaySlice) []got {
	out := []got{}
	for _, d := range ds {
		out = append(out, got{d.Day, d.Seconds})
	}
	return out
}

// The same six hours (20:00–02:00 UTC) are one day in New York and two in Cairo.
func TestSplitByDayTwoTimezones(t *testing.T) {
	start := time.Date(2026, 9, 14, 20, 0, 0, 0, time.UTC)
	end := start.Add(6 * time.Hour)
	for _, tc := range []struct {
		zone string
		want []got
	}{
		// Cairo is UTC+3 in September (EEST): 23:00 -> 05:00 local.
		{"Africa/Cairo", []got{{"2026-09-14", 3600}, {"2026-09-15", 18000}}},
		// New York is UTC-4 (EDT): 16:00 -> 22:00 local, all on the 14th.
		{"America/New_York", []got{{"2026-09-14", 21600}}},
	} {
		if g := slices(SplitByDay(start, end, mustLoc(t, tc.zone))); !reflect.DeepEqual(g, tc.want) {
			t.Errorf("%s: got %v, want %v", tc.zone, g, tc.want)
		}
	}
}

// A cross-midnight entry by local clock: 23:00 -> 01:15 is 1h on the first day and 1h15m on the next,
// in either zone.
func TestSplitByDayLocalMidnight(t *testing.T) {
	for _, zone := range []string{"Africa/Cairo", "America/New_York"} {
		loc := mustLoc(t, zone)
		start := time.Date(2026, 9, 14, 23, 0, 0, 0, loc)
		end := time.Date(2026, 9, 15, 1, 15, 0, 0, loc)
		want := []got{{"2026-09-14", 3600}, {"2026-09-15", 4500}}
		if g := slices(SplitByDay(start, end, loc)); !reflect.DeepEqual(g, want) {
			t.Errorf("%s: got %v, want %v", zone, g, want)
		}
	}
}

// Days are calendar days, not 24-hour blocks: the cut stays at local midnight across DST.
func TestSplitByDayDST(t *testing.T) {
	// Egypt springs forward at midnight on the last Friday of April (2026-04-24): 00:00 -> 01:00.
	// 23:00 (+02) on the 23rd to 02:00 (+03) on the 24th is two real hours, one on each day.
	cairo := mustLoc(t, "Africa/Cairo")
	start := time.Date(2026, 4, 23, 21, 0, 0, 0, time.UTC)
	end := time.Date(2026, 4, 23, 23, 0, 0, 0, time.UTC)
	if g, want := slices(SplitByDay(start, end, cairo)), []got{{"2026-04-23", 3600}, {"2026-04-24", 3600}}; !reflect.DeepEqual(g, want) {
		t.Errorf("Cairo spring-forward: got %v, want %v", g, want)
	}
	// New York falls back on 2026-11-01 (02:00 EDT -> 01:00 EST): 23:00 EDT on Oct 31 to 01:30 EST
	// is 3h30m — 1h on the 31st and 2h30m on Nov 1 (a 25-hour day).
	ny := mustLoc(t, "America/New_York")
	start = time.Date(2026, 11, 1, 3, 0, 0, 0, time.UTC)
	end = time.Date(2026, 11, 1, 6, 30, 0, 0, time.UTC)
	if g, want := slices(SplitByDay(start, end, ny)), []got{{"2026-10-31", 3600}, {"2026-11-01", 9000}}; !reflect.DeepEqual(g, want) {
		t.Errorf("New York fall-back: got %v, want %v", g, want)
	}
}

func TestSplitByDayConservesTime(t *testing.T) {
	loc := mustLoc(t, "Africa/Cairo")
	start := time.Date(2026, 9, 10, 7, 13, 0, 0, time.UTC)
	end := start.Add(50 * time.Hour)
	var sum int64
	parts := SplitByDay(start, end, loc)
	for _, p := range parts {
		sum += p.Seconds
	}
	if sum != 50*3600 || len(parts) != 3 {
		t.Errorf("50h split into %d parts summing %ds", len(parts), sum)
	}
	if SplitByDay(end, start, loc) != nil || SplitByDay(start, start, loc) != nil {
		t.Error("an empty or reversed span has no slices")
	}
}

func TestRoundSeconds(t *testing.T) {
	for _, tc := range []struct {
		sec     int64
		minutes int
		want    int64
	}{
		{449, 15, 0}, {450, 15, 900}, {1320, 15, 900}, {1350, 15, 1800}, {3599, 0, 3599}, {61, 1, 60}, {90, 1, 120},
	} {
		if g := RoundSeconds(tc.sec, tc.minutes); g != tc.want {
			t.Errorf("RoundSeconds(%d, %d) = %d, want %d", tc.sec, tc.minutes, g, tc.want)
		}
	}
}

func TestWeekStart(t *testing.T) {
	loc := mustLoc(t, "Africa/Cairo")
	for _, tc := range []struct {
		start int
		first string
	}{{1, "2026-09-14"}, {6, "2026-09-12"}, {0, "2026-09-13"}} {
		b, err := week("2026-09-17", &timeConf{Loc: loc, WeekStart: tc.start}, time.Now()) // a Thursday
		if err != nil || b[0].Format("2006-01-02") != tc.first || len(b) != 8 {
			t.Errorf("week start %d: got %v (%v), want first day %s", tc.start, b, err, tc.first)
		}
	}
	// The New York week containing the fall-back Sunday is 169 hours long.
	ny := mustLoc(t, "America/New_York")
	b, _ := week("2026-11-01", &timeConf{Loc: ny, WeekStart: 0}, time.Now())
	if d := b[7].Sub(b[0]); d != 169*time.Hour {
		t.Errorf("fall-back week is %v, want 169h", d)
	}
}

func TestWorkday(t *testing.T) {
	if !workday(time.Monday, 1) || workday(time.Saturday, 1) || !workday(time.Sunday, 0) || workday(time.Friday, 0) || !workday(time.Saturday, 6) {
		t.Error("workdays are the five days from the week start")
	}
}

// A week starts on the workspace's day and a month on the 1st; both come with the period before.
func TestPeriodBounds(t *testing.T) {
	cairo := mustLoc(t, "Africa/Cairo")
	now := time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC)
	day := func(x time.Time) string { return x.Format("2006-01-02") }
	for _, tc := range []struct {
		kind, ref, wantPrev, wantCur, wantEnd string
		weekStart                             int
	}{
		{"week", "2026-09-30", "2026-09-21", "2026-09-28", "2026-10-05", 1}, // Wednesday -> Monday week
		{"week", "2026-09-30", "2026-09-20", "2026-09-27", "2026-10-04", 0}, // Sunday week
		{"", "", "2026-09-28", "2026-10-05", "2026-10-12", 1},               // default: this week
		{"month", "2026-03-15", "2026-02-01", "2026-03-01", "2026-04-01", 1},
		{"month", "2026-01-31", "2025-12-01", "2026-01-01", "2026-02-01", 1}, // across the year
	} {
		p, c, e, err := periodBounds(tc.kind, tc.ref, &timeConf{Loc: cairo, WeekStart: tc.weekStart}, now)
		if err != nil || day(p) != tc.wantPrev || day(c) != tc.wantCur || day(e) != tc.wantEnd {
			t.Errorf("%s %q start %d: got %s %s %s (%v), want %s %s %s", tc.kind, tc.ref, tc.weekStart, day(p), day(c), day(e), err, tc.wantPrev, tc.wantCur, tc.wantEnd)
		}
	}
	if _, _, _, err := periodBounds("year", "", &timeConf{Loc: cairo}, now); err == nil {
		t.Error("an unknown kind is refused")
	}
}
