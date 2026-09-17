package work

import (
	"context"
	"fmt"
	"strings"

	importexport "github.com/togo-framework/import-export"
)

/*
Report export (P5): the table the reports page shows, as CSV or XLSX, through togo import-export.
The columns are the page's columns, in its order, with the same h:mm and money formatting, plus the
total row — so the file matches the screen cell for cell.

Two things the plugin does not do and this file does:
  - spreadsheet formula injection: a text cell starting with = + - @ (or a tab / CR) is prefixed with
    an apostrophe; numbers are left alone
  - it writes every XLSX cell as text; the values here are pre-formatted strings for that reason
*/

var exportHeaders = map[string]map[string]string{
	"en": {"project": "Project", "member": "Member", "client": "Client", "label": "Label", "task": "Task", "day": "Day", "week": "Week",
		"tracked": "Tracked", "rounded": "Rounded", "hours": "Hours", "billable": "Billable", "entries": "Entries",
		"billable_value": "Billable value", "cost_value": "Cost", "profit": "Profit", "margin": "Margin %", "none": "(none)", "total": "Total"},
	"ar": {"project": "المشروع", "member": "العضو", "client": "العميل", "label": "الوسم", "task": "المهمة", "day": "اليوم", "week": "الأسبوع",
		"tracked": "المسجّل", "rounded": "بعد التقريب", "hours": "الساعات", "billable": "قابل للفوترة", "entries": "الإدخالات",
		"billable_value": "القيمة القابلة للفوترة", "cost_value": "التكلفة", "profit": "الربح", "margin": "الهامش ٪", "none": "(بلا)", "total": "الإجمالي"},
}

func headers(lang string) map[string]string {
	if h, ok := exportHeaders[lang]; ok {
		return h
	}
	return exportHeaders["en"]
}

// HM formats seconds as h:mm (the table's duration format).
func HM(sec int64) string { return hm(sec) }

// Hours formats seconds as decimal hours with two places.
func Hours(sec int64) string { return fmt.Sprintf("%.2f", float64(sec)/3600) }

// Money formats minor units as a decimal amount with two places.
func Money(minor int64) string {
	sign := ""
	if minor < 0 {
		sign, minor = "-", -minor
	}
	return fmt.Sprintf("%s%d.%02d", sign, minor/100, minor%100)
}

func safeCell(s string) string {
	if s == "" {
		return s
	}
	switch s[0] {
	case '=', '+', '-', '@', '\t', '\r':
		// A formatted number ("-12.00") is not a formula; anything else gets neutralised.
		if strings.Trim(s, "-0123456789.:") == "" {
			return s
		}
		return "'" + s
	}
	return s
}

// ExportTable is a rendered table.
type ExportTable struct {
	Columns []string
	Rows    []map[string]any
}

// TimeReportTable renders a time report as the page's table.
func TimeReportTable(rep *TimeReport, lang string) ExportTable {
	h := headers(lang)
	cols := []string{h[rep.GroupBy], h["tracked"], h["rounded"], h["hours"], h["billable"], h["entries"]}
	if rep.Finance {
		cols = append(cols, h["billable_value"]+" ("+rep.Currency+")", h["cost_value"]+" ("+rep.Currency+")", h["profit"]+" ("+rep.Currency+")")
	}
	line := func(name string, r ReportRow) map[string]any {
		m := map[string]any{cols[0]: safeCell(name), cols[1]: HM(r.Seconds), cols[2]: HM(r.Rounded), cols[3]: Hours(r.Rounded),
			cols[4]: HM(r.BillableRounded), cols[5]: fmt.Sprint(r.Entries)}
		if rep.Finance && r.BillableMinor != nil {
			m[cols[6]], m[cols[7]], m[cols[8]] = Money(*r.BillableMinor), Money(*r.CostMinor), Money(*r.ProfitMinor)
		}
		return m
	}
	t := ExportTable{Columns: cols}
	for _, r := range rep.Rows {
		name := r.Name
		if r.Key == "" {
			name = h["none"]
		}
		t.Rows = append(t.Rows, line(name, r))
	}
	t.Rows = append(t.Rows, line(h["total"], rep.Total))
	return t
}

// ProfitabilityTable renders the per-project (or per-client) profitability table.
func ProfitabilityTable(p *Profitability, by, lang string) ExportTable {
	h := headers(lang)
	cols := []string{h[by], h["rounded"], h["billable"], h["billable_value"] + " (" + p.Currency + ")", h["cost_value"] + " (" + p.Currency + ")",
		h["profit"] + " (" + p.Currency + ")", h["margin"]}
	list := p.Projects
	if by == "client" {
		list = p.Clients
	}
	line := func(name string, r ProfitRow) map[string]any {
		margin := ""
		if r.MarginPercent != nil {
			margin = fmt.Sprintf("%.1f", *r.MarginPercent)
		}
		return map[string]any{cols[0]: safeCell(name), cols[1]: HM(r.Seconds), cols[2]: HM(r.Billable),
			cols[3]: Money(r.BillableMinor), cols[4]: Money(r.CostMinor), cols[5]: Money(r.ProfitMinor), cols[6]: margin}
	}
	t := ExportTable{Columns: cols}
	for _, r := range list {
		name := r.Name
		if r.Key == "" {
			name = h["none"]
		}
		t.Rows = append(t.Rows, line(name, r))
	}
	t.Rows = append(t.Rows, line(h["total"], p.Total))
	return t
}

// ExportFile is a rendered download.
type ExportFile struct {
	Name, ContentType string
	Data              []byte
}

// ExportReport renders kind (time | profitability) as format (csv | xlsx).
func (sv *Service) ExportReport(ctx context.Context, kind, format, lang, by string, q ReportQuery) (*ExportFile, error) {
	if format == "" {
		format = "csv"
	}
	if err := oneOf("format", format, "csv", "xlsx"); err != nil {
		return nil, err
	}
	var t ExportTable
	var from, to string
	switch kind {
	case "", "time":
		kind = "time"
		rep, err := sv.TimeReport(ctx, q)
		if err != nil {
			return nil, err
		}
		t, from, to = TimeReportTable(rep, lang), rep.From, rep.To
		kind += "-by-" + rep.GroupBy
	case "profitability":
		if by == "" {
			by = "project"
		}
		if err := oneOf("by", by, "project", "client"); err != nil {
			return nil, err
		}
		p, err := sv.Profitability(ctx, q)
		if err != nil {
			return nil, err
		}
		t, from, to = ProfitabilityTable(p, by, lang), p.From, p.To
		kind += "-by-" + by
	default:
		return nil, invalid("kind must be time or profitability")
	}
	ie := sv.Sheet
	if ie == nil {
		ie = &importexport.Service{}
	}
	data, err := ie.Export(ctx, t.Rows, importexport.ExportOpts{Format: format, Columns: t.Columns, Sheet: "Report"})
	if err != nil {
		return nil, err
	}
	f := &ExportFile{Name: fmt.Sprintf("managy-%s-%s-%s.%s", kind, from, to, format), Data: data,
		ContentType: "text/csv; charset=utf-8"}
	if format == "xlsx" {
		f.ContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
	} else {
		// A UTF-8 byte-order mark so spreadsheet apps read Arabic names correctly.
		f.Data = append([]byte("\xEF\xBB\xBF"), data...)
	}
	return f, nil
}
