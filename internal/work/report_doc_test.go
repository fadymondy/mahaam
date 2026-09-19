package work

import (
	"bytes"
	"strings"
	"testing"
	"time"
)

func sampleTimeReport(finance bool) *TimeReport {
	b, c, p := int64(150000), int64(90000), int64(60000)
	rows := []ReportRow{
		{Key: "p1", Name: "Website | redesign", Seconds: 5400, Rounded: 5400, BillableRounded: 3600, Entries: 2},
		{Key: "p2", Name: "موقع الشركة", Seconds: 1800, Rounded: 1800, Entries: 1},
		{Key: "", Name: "", Seconds: 600, Rounded: 900, Entries: 1},
	}
	total := ReportRow{Seconds: 7800, Rounded: 8100, BillableRounded: 3600, Entries: 4}
	if finance {
		rows[0].BillableMinor, rows[0].CostMinor, rows[0].ProfitMinor = &b, &c, &p
		rows[1].BillableMinor, rows[1].CostMinor, rows[1].ProfitMinor = ptr64(0), ptr64(0), ptr64(0)
		rows[2].BillableMinor, rows[2].CostMinor, rows[2].ProfitMinor = ptr64(0), ptr64(0), ptr64(0)
		total.BillableMinor, total.CostMinor, total.ProfitMinor = &b, &c, &p
	}
	return &TimeReport{From: "2026-09-01", To: "2026-09-18", GroupBy: "project", Timezone: "Africa/Cairo", RoundingMinutes: 15,
		Currency: "USD", Finance: finance, Rows: rows, Total: total, GeneratedAt: time.Date(2026, 9, 18, 10, 0, 0, 0, time.UTC)}
}

func TestTimeReportMarkdownMatchesTable(t *testing.T) {
	rep := sampleTimeReport(true)
	md := TimeReportDoc(rep, "en").Markdown()
	for _, want := range []string{
		"# Time report\n",
		"- **Grouped by:** Project\n",
		"- **Rounding:** 15 min\n",
		"| Project | Tracked | Rounded | Hours | Billable | Entries | Billable value (USD) | Cost (USD) | Profit (USD) |\n",
		"| --- | ---: | ---: |",
		// The pipe in a name is escaped; the numbers are the export table's.
		"| Website \\| redesign | 1:30 | 1:30 | 1.50 | 1:00 | 2 | 1500.00 | 900.00 | 600.00 |\n",
		"| موقع الشركة | 0:30 | 0:30 | 0.50 | 0:00 | 1 | 0.00 | 0.00 | 0.00 |\n",
		"| (none) | 0:10 | 0:15 | 0.25 | 0:00 | 1 |",
		"| **Total** | **2:10** | **2:15** | **2.25** | **1:00** | **4** | **1500.00** | **900.00** | **600.00** |\n",
	} {
		if !strings.Contains(md, want) {
			t.Errorf("markdown lacks %q:\n%s", want, md)
		}
	}
	// Same cells as the CSV table (minus the spreadsheet guard).
	tbl := tableFrom(timeReportTable(rep, "en", plainCell), true)
	if len(tbl.Rows) != len(rep.Rows)+1 {
		t.Fatalf("rows: %d", len(tbl.Rows))
	}

	ar := TimeReportDoc(sampleTimeReport(false), "ar").Markdown()
	for _, want := range []string{"# تقرير الوقت", "| المشروع | المسجّل |", "| **الإجمالي** |"} {
		if !strings.Contains(ar, want) {
			t.Errorf("arabic markdown lacks %q:\n%s", want, ar)
		}
	}
	if strings.Contains(ar, "Billable value") || strings.Contains(ar, "القيمة القابلة للفوترة") {
		t.Error("no money columns without finance")
	}
}

func TestMarkdownEscaping(t *testing.T) {
	d := &Doc{Title: "# Not a heading", Lang: "en"}
	d.p("- not a list\n=SUM(A1) <script>")
	d.table(&DocTable{Columns: []string{"a|b"}, Rows: [][]string{{"line1\nline2 *bold*"}}})
	md := d.Markdown()
	for _, want := range []string{"# \\# Not a heading", "\\- not a list", "\\=SUM(A1) &lt;script&gt;", "| a\\|b |", "| line1<br>line2 \\*bold\\* |"} {
		if !strings.Contains(md, want) {
			t.Errorf("markdown lacks %q:\n%s", want, md)
		}
	}
}

func TestProjectReportDoc(t *testing.T) {
	client := "Nile Co"
	bm := int64(600)
	r := &ProjectReport{
		Project: Project{Name: "Portal", Status: "active", BillingMode: "hourly", ClientName: &client, Tasks: TaskCounts{Todo: 1, Doing: 1, Done: 2}},
		From:    "2026-09-01", To: "2026-09-18", Timezone: "UTC", TotalTasks: 4, PercentDone: 50,
		Statuses:      []Status{{Name: "Backlog", Category: "todo", TaskCount: 1}, {Name: "Shipped", Category: "done", TaskCount: 2}},
		Budget:        &Budget{BudgetMinutes: &bm, SpentSeconds: 8100, HoursPercent: func() *float64 { v := 22.5; return &v }(), Level: "ok"},
		ByMember:      sampleTimeReport(false),
		ByWeek:        &TimeReport{GroupBy: "week", Rows: []ReportRow{}},
		IssuesVisible: true, OpenIssueCount: 1,
		OpenIssues:  []ProjectIssue{{Key: "MG-7", Title: "Login fails", Type: "bug", Status: "todo", Priority: "high", CreatedAt: time.Date(2026, 9, 2, 0, 0, 0, 0, time.UTC)}},
		Activity:    []ProjectActivityLine{{At: time.Date(2026, 9, 3, 12, 30, 0, 0, time.UTC), Actor: "a@b.test", Action: "task.created", Subject: "Build login"}},
		GeneratedAt: time.Date(2026, 9, 18, 0, 0, 0, 0, time.UTC),
	}
	r.ByMember.GroupBy = "member"
	md := r.Doc("en").Markdown()
	for _, want := range []string{
		"# Project report · Portal", "- **Client:** Nile Co", "- **Done:** 50%", "| Shipped | Done | 2 |",
		"- **Hours budget:** 10:00 · Spent 2:15 (22%)", "## Time by member", "| Member | Tracked |",
		"## Time by week\n\nNo time tracked in this period.", "| MG-7 | Login fails | bug | todo | high | 2026-09-02 |",
		"| 2026-09-03 12:30 | a@b.test | task.created | Build login |",
	} {
		if !strings.Contains(md, want) {
			t.Errorf("project markdown lacks %q:\n%s", want, md)
		}
	}
	r.IssuesVisible = false
	if md := r.Doc("ar").Markdown(); !strings.Contains(md, "دورك لا يسمح بقراءة المشكلات") || strings.Contains(md, "MG-7") {
		t.Errorf("hidden issues:\n%s", md)
	}
}

func TestArabicShaping(t *testing.T) {
	// "سلام": seen initial, lam-alef final ligature, meem final.
	if got := shapeArabic("سلام"); got != "\uFEB3\uFEFC\uFEE1" {
		t.Errorf("shape سلام: %U", []rune(got))
	}
	// Non-joining letters break the word: "دار" = dal isolated, alef isolated, reh isolated.
	if got := shapeArabic("دار"); got != "\uFEA9\uFE8D\uFEAD" {
		t.Errorf("shape دار: %U", []rune(got))
	}
	// An RTL paragraph with a number keeps the digits' order and reverses the runs.
	vis, rtl := visualLine("ساعة 12")
	if !rtl || !strings.HasPrefix(vis, "12 ") {
		t.Errorf("visual: %q rtl=%v", vis, rtl)
	}
	// An LTR paragraph embeds the Arabic run reversed in place.
	vis, rtl = visualLine("Client: دار (x)")
	if rtl || !strings.HasPrefix(vis, "Client: \uFEAD\uFE8D\uFEA9") || !strings.HasSuffix(vis, "(x)") {
		t.Errorf("visual ltr: %q rtl=%v", vis, rtl)
	}
	if v, _ := visualLine("plain"); v != "plain" {
		t.Error("Latin text is untouched")
	}
}

func TestReportPDF(t *testing.T) {
	for _, lang := range []string{"en", "ar"} {
		data, err := TimeReportDoc(sampleTimeReport(true), lang).PDF()
		if err != nil {
			t.Fatalf("%s: %v", lang, err)
		}
		if !bytes.HasPrefix(data, []byte("%PDF-")) || len(data) < 2000 {
			t.Errorf("%s: not a PDF (%d bytes)", lang, len(data))
		}
	}
	// A long table spans pages without error.
	d := &Doc{Title: "Long", Lang: "en"}
	tbl := &DocTable{Columns: []string{"#", "Name"}}
	for i := 0; i < 300; i++ {
		tbl.Rows = append(tbl.Rows, []string{strings.Repeat("9", 3), "Row name that is fairly long to force truncation of the cell at some point " + strings.Repeat("x", 80)})
	}
	d.table(tbl)
	if _, err := d.PDF(); err != nil {
		t.Fatal(err)
	}
}
