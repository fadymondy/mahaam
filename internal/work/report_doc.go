package work

import (
	"bytes"
	_ "embed"
	"fmt"
	"strings"

	"github.com/go-pdf/fpdf"
)

/*
Report documents: the time report and the project report are built once as a Doc (headings,
key/value facts, paragraphs, tables of pre-formatted cells) and rendered to Markdown or PDF, so
both formats carry exactly the same numbers as the JSON the UI renders.

PDF is pure Go (github.com/go-pdf/fpdf) with Vazirmatn (SIL OFL 1.1, internal/work/fonts/OFL.txt)
embedded: one family for Latin and Arabic. Arabic is shaped and reordered by pdf_shape.go; see
its comment for the limits. Markdown is the lossless path (logical order, any script).
*/

//go:embed fonts/Vazirmatn-Regular.ttf
var fontRegular []byte

//go:embed fonts/Vazirmatn-Bold.ttf
var fontBold []byte

// Block is one piece of a report document.
type Block struct {
	Kind  string      // h2 | p | kv | table | note
	Text  string      // h2, p, note
	KV    [][2]string // kv
	Table *DocTable   // table
}

// DocTable is a rendered table (cells are display strings). Right lists numeric columns.
type DocTable struct {
	Columns []string
	Rows    [][]string
	Right   map[int]bool
	Total   bool // the last row is a total row (bold)
}

// Doc is a report document.
type Doc struct {
	Title    string
	Subtitle string
	Lang     string // en | ar: drives the page direction of the PDF
	Blocks   []Block
}

func (d *Doc) h2(s string)           { d.Blocks = append(d.Blocks, Block{Kind: "h2", Text: s}) }
func (d *Doc) p(s string)            { d.Blocks = append(d.Blocks, Block{Kind: "p", Text: s}) }
func (d *Doc) note(s string)         { d.Blocks = append(d.Blocks, Block{Kind: "note", Text: s}) }
func (d *Doc) kv(pairs ...[2]string) { d.Blocks = append(d.Blocks, Block{Kind: "kv", KV: pairs}) }
func (d *Doc) table(t *DocTable)     { d.Blocks = append(d.Blocks, Block{Kind: "table", Table: t}) }
func pair(k, v string) [2]string     { return [2]string{k, v} }
func (d *Doc) rtl() bool             { return d.Lang == "ar" }

// tableFrom converts an ExportTable (map rows) to a DocTable in column order.
func tableFrom(t ExportTable, total bool) *DocTable {
	out := &DocTable{Columns: t.Columns, Right: map[int]bool{}, Total: total}
	for i := 1; i < len(t.Columns); i++ {
		out.Right[i] = true
	}
	for _, r := range t.Rows {
		row := make([]string, len(t.Columns))
		for i, c := range t.Columns {
			if v, ok := r[c]; ok && v != nil {
				row[i] = fmt.Sprint(v)
			}
		}
		out.Rows = append(out.Rows, row)
	}
	return out
}

// ---- Markdown -------------------------------------------------------------------------------------

func docMDEscape(s string) string {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	r := strings.NewReplacer(`\`, `\\`, "|", `\|`, "*", `\*`, "_", `\_`, "`", "\\`", "<", "&lt;", ">", "&gt;", "[", `\[`, "]", `\]`)
	s = r.Replace(s)
	// A leading #, -, + or digit-dot would turn a line into a heading or a list item.
	lines := strings.Split(s, "\n")
	for i, l := range lines {
		t := strings.TrimLeft(l, " ")
		if t != "" && strings.ContainsRune("#-+>=", rune(t[0])) {
			lines[i] = strings.Repeat(" ", len(l)-len(t)) + `\` + t
		}
	}
	return strings.Join(lines, "\n")
}

func docMDCell(s string) string {
	return strings.ReplaceAll(docMDEscape(s), "\n", "<br>")
}

// Markdown renders the document as GitHub-flavoured Markdown.
func (d *Doc) Markdown() string {
	var b strings.Builder
	fmt.Fprintf(&b, "# %s\n\n", docMDEscape(d.Title))
	if d.Subtitle != "" {
		fmt.Fprintf(&b, "%s\n\n", docMDEscape(d.Subtitle))
	}
	for _, bl := range d.Blocks {
		switch bl.Kind {
		case "h2":
			fmt.Fprintf(&b, "## %s\n\n", docMDEscape(bl.Text))
		case "p":
			fmt.Fprintf(&b, "%s\n\n", docMDEscape(bl.Text))
		case "note":
			fmt.Fprintf(&b, "_%s_\n\n", docMDEscape(bl.Text))
		case "kv":
			for _, kv := range bl.KV {
				fmt.Fprintf(&b, "- **%s:** %s\n", docMDEscape(kv[0]), docMDEscape(kv[1]))
			}
			b.WriteString("\n")
		case "table":
			t := bl.Table
			cols := make([]string, len(t.Columns))
			align := make([]string, len(t.Columns))
			for i, c := range t.Columns {
				cols[i] = docMDCell(c)
				align[i] = "---"
				if t.Right[i] {
					align[i] = "---:"
				}
			}
			fmt.Fprintf(&b, "| %s |\n| %s |\n", strings.Join(cols, " | "), strings.Join(align, " | "))
			for ri, r := range t.Rows {
				cells := make([]string, len(t.Columns))
				for i := range t.Columns {
					if i < len(r) {
						cells[i] = docMDCell(r[i])
					}
					if t.Total && ri == len(t.Rows)-1 && cells[i] != "" {
						cells[i] = "**" + cells[i] + "**"
					}
				}
				fmt.Fprintf(&b, "| %s |\n", strings.Join(cells, " | "))
			}
			b.WriteString("\n")
		}
	}
	return b.String()
}

// ---- PDF ------------------------------------------------------------------------------------------

const (
	pdfFont   = "vazirmatn"
	pdfMargin = 14.0
	pdfLine   = 5.2
)

// PDF renders the document as an A4 PDF (landscape when a table is wide).
func (d *Doc) PDF() ([]byte, error) {
	orient := "P"
	for _, bl := range d.Blocks {
		if bl.Kind == "table" && len(bl.Table.Columns) > 6 {
			orient = "L"
		}
	}
	f := fpdf.New(orient, "mm", "A4", "")
	f.SetMargins(pdfMargin, pdfMargin, pdfMargin)
	f.SetAutoPageBreak(true, pdfMargin+4)
	f.AddUTF8FontFromBytes(pdfFont, "", fontRegular)
	f.AddUTF8FontFromBytes(pdfFont, "B", fontBold)
	f.SetTitle(d.Title, true)
	f.SetCreator("Mahaam", true)
	f.AliasNbPages("{nb}")
	f.SetFooterFunc(func() {
		f.SetY(-pdfMargin)
		f.SetFont(pdfFont, "", 8)
		f.SetTextColor(120, 120, 120)
		f.CellFormat(0, 5, fmt.Sprintf("%d / {nb}", f.PageNo()), "", 0, "C", false, 0, "")
	})
	f.AddPage()
	pageW, _ := f.GetPageSize()
	width := pageW - 2*pdfMargin

	text := func(s string, size float64, style string, color [3]int) {
		f.SetFont(pdfFont, style, size)
		f.SetTextColor(color[0], color[1], color[2])
		h := size * 0.45
		for _, para := range strings.Split(strings.ReplaceAll(s, "\r\n", "\n"), "\n") {
			for _, line := range wrapLogical(f, para, width) {
				vis, _ := visualLine(line)
				align := "L"
				if d.rtl() {
					align = "R"
				}
				f.CellFormat(width, h, vis, "", 1, align, false, 0, "")
			}
		}
	}
	dark, muted := [3]int{20, 20, 20}, [3]int{110, 110, 110}

	text(d.Title, 18, "B", dark)
	if d.Subtitle != "" {
		text(d.Subtitle, 9.5, "", muted)
	}
	f.Ln(3)
	for _, bl := range d.Blocks {
		switch bl.Kind {
		case "h2":
			f.Ln(3)
			text(bl.Text, 13, "B", dark)
			f.Ln(1)
		case "p":
			text(bl.Text, 10, "", dark)
			f.Ln(1.5)
		case "note":
			text(bl.Text, 8.5, "", muted)
			f.Ln(1)
		case "kv":
			d.pdfKV(f, bl.KV, width)
			f.Ln(2)
		case "table":
			d.pdfTable(f, bl.Table, width)
			f.Ln(3)
		}
	}
	if err := f.Error(); err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	if err := f.Output(&buf); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// wrapLogical wraps a logical-order line to width by words (measured shaped).
func wrapLogical(f *fpdf.Fpdf, s string, width float64) []string {
	if s == "" {
		return []string{""}
	}
	words := strings.Fields(s)
	var lines []string
	cur := ""
	for _, w := range words {
		next := w
		if cur != "" {
			next = cur + " " + w
		}
		if cur != "" && f.GetStringWidth(shapeArabic(next)) > width {
			lines = append(lines, cur)
			cur = w
			continue
		}
		cur = next
	}
	return append(lines, cur)
}

// fit truncates a logical string so its shaped width fits w, with an ellipsis.
func fit(f *fpdf.Fpdf, s string, w float64) string {
	s = strings.Join(strings.Fields(s), " ")
	if f.GetStringWidth(shapeArabic(s)) <= w {
		return s
	}
	rs := []rune(s)
	for len(rs) > 0 && f.GetStringWidth(shapeArabic(string(rs)+"…")) > w {
		rs = rs[:len(rs)-1]
	}
	return string(rs) + "…"
}

func (d *Doc) pdfKV(f *fpdf.Fpdf, kv [][2]string, width float64) {
	keyW := width * 0.3
	for _, p := range kv {
		f.SetFont(pdfFont, "B", 9.5)
		f.SetTextColor(90, 90, 90)
		k, _ := visualLine(fit(f, p[0], keyW-2))
		f.SetFont(pdfFont, "", 9.5)
		v, _ := visualLine(fit(f, p[1], width-keyW-2))
		if d.rtl() {
			f.SetTextColor(20, 20, 20)
			f.CellFormat(width-keyW, pdfLine+0.6, v, "", 0, "R", false, 0, "")
			f.SetFont(pdfFont, "B", 9.5)
			f.SetTextColor(90, 90, 90)
			f.CellFormat(keyW, pdfLine+0.6, k, "", 1, "R", false, 0, "")
			continue
		}
		f.SetFont(pdfFont, "B", 9.5)
		f.CellFormat(keyW, pdfLine+0.6, k, "", 0, "L", false, 0, "")
		f.SetFont(pdfFont, "", 9.5)
		f.SetTextColor(20, 20, 20)
		f.CellFormat(width-keyW, pdfLine+0.6, v, "", 1, "L", false, 0, "")
	}
}

func (d *Doc) pdfTable(f *fpdf.Fpdf, t *DocTable, width float64) {
	n := len(t.Columns)
	if n == 0 {
		return
	}
	// Column widths: proportional to the widest cell, the first (name) column favoured.
	f.SetFont(pdfFont, "B", 8.5)
	want := make([]float64, n)
	for i, c := range t.Columns {
		want[i] = f.GetStringWidth(shapeArabic(c)) + 4
	}
	f.SetFont(pdfFont, "", 8.5)
	for _, r := range t.Rows {
		for i := 0; i < n && i < len(r); i++ {
			if w := f.GetStringWidth(shapeArabic(r[i])) + 4; w > want[i] {
				want[i] = w
			}
		}
	}
	total := 0.0
	for i := range want {
		if i > 0 && want[i] > 45 {
			want[i] = 45
		}
		total += want[i]
	}
	widths := make([]float64, n)
	for i := range want {
		widths[i] = want[i] * width / total
	}
	// Right-to-left table: columns laid out from the right.
	order := make([]int, n)
	for i := range order {
		order[i] = i
		if d.rtl() {
			order[i] = n - 1 - i
		}
	}
	_, pageH := f.GetPageSize()
	h := pdfLine + 1
	header := func() {
		f.SetFont(pdfFont, "B", 8.5)
		f.SetFillColor(238, 238, 238)
		f.SetTextColor(40, 40, 40)
		for _, i := range order {
			v, _ := visualLine(fit(f, t.Columns[i], widths[i]-2))
			f.CellFormat(widths[i], h, v, "B", 0, cellAlign(t, i, d.rtl()), true, 0, "")
		}
		f.Ln(-1)
	}
	header()
	for ri, r := range t.Rows {
		if f.GetY()+h > pageH-pdfMargin-6 {
			f.AddPage()
			header()
		}
		style := ""
		if t.Total && ri == len(t.Rows)-1 {
			style = "B"
		}
		f.SetFont(pdfFont, style, 8.5)
		f.SetTextColor(20, 20, 20)
		border := "B"
		for _, i := range order {
			cell := ""
			if i < len(r) {
				cell = r[i]
			}
			v, _ := visualLine(fit(f, cell, widths[i]-2))
			f.SetDrawColor(225, 225, 225)
			f.CellFormat(widths[i], h, v, border, 0, cellAlign(t, i, d.rtl()), false, 0, "")
		}
		f.Ln(-1)
	}
	f.SetDrawColor(0, 0, 0)
}

func cellAlign(t *DocTable, i int, rtl bool) string {
	if t.Right[i] {
		return "R"
	}
	if rtl {
		return "R"
	}
	return "L"
}
