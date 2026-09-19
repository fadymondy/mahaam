package work

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/csv"
	"errors"
	"fmt"
	"net/mail"
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"

	importexport "github.com/togo-framework/import-export"
	"github.com/xuri/excelize/v2"

	"github.com/fadymondy/mahaam/internal/authz"
	"github.com/fadymondy/mahaam/internal/limits"
	"github.com/fadymondy/mahaam/internal/tenant"
)

/*
Customer import: contacts from a CSV / XLSX file (incl. a Google Contacts CSV export), a vCard
file (WhatsApp / phone contacts export), Google Contacts (OAuth, client_import_sources.go) or a
configured WhatsApp Business / Evolution API — into the workspace's clients.

Two steps, the same plan both times:
  - preview: parse, detect the header row, map columns to fields (auto-detected; the caller may
    override), validate every row and match it against existing clients. Nothing is written.
  - commit: re-parse and re-plan from the same input (the preview is never trusted), then apply
    in one transaction with a savepoint per row, so one bad row never fails the import: it is
    reported with its row and column, and the rest go in. Every created / updated client gets
    its activity entry (client.created / client.updated, source import:<source>).

Dedupe: a row matches an existing client by email (case-insensitive) or phone (digits only, a
leading international 00 dropped); email wins when both match different clients. A match
UPDATES the client by filling fields it does not have yet (email, phone, company) and appending
new notes — an import never overwrites what the workspace already has, and never renames a
client. A match with nothing new is skipped ("already up to date"). update_existing=false skips
every match. Rows repeating an email / phone seen earlier in the same file are skipped.

Parsing: CSV / XLSX are read here rather than with togo import-export's Import, which takes row 1
as the header and returns rows as maps (no column order, no header detection); its RowError type
is the error shape. Its HTTP routes stay blocked in the guard (README note 19).

Manager+ (clients:write) for both steps: the preview shows which existing clients match.
*/

// Import fields a column can map to ("" ignores the column).
var ImportFields = []string{"name", "first_name", "last_name", "email", "phone", "company", "notes"}

// ImportSources are the accepted sources.
var ImportSources = []string{"csv", "xlsx", "google_csv", "vcard", "google", "whatsapp_api"}

const (
	maxImportRows  = 5000
	MaxImportBytes = 8 << 20
)

// ImportContact is one parsed contact before planning.
type ImportContact struct {
	Row                                                     int
	Name, FirstName, LastName, Email, Phone, Company, Notes string
}

// ClientImportInput is the body of preview and commit.
type ClientImportInput struct {
	Source         string            `json:"source" enum:"csv,xlsx,google_csv,vcard,google,whatsapp_api" doc:"csv / google_csv / vcard take content (text); xlsx takes content_base64; google takes session"`
	Content        string            `json:"content,omitempty" doc:"CSV or vCard text"`
	ContentBase64  string            `json:"content_base64,omitempty" doc:"The file, base64 (XLSX; also accepted for CSV / vCard)"`
	Mapping        map[string]string `json:"mapping,omitempty" doc:"Source column header → name, first_name, last_name, email, phone, company, notes, or \"\" to ignore. Omitted columns keep the detected mapping."`
	Session        string            `json:"session,omitempty" doc:"Google import session (from the OAuth callback)"`
	UpdateExisting *bool             `json:"update_existing,omitempty" doc:"Default true: a row matching a client by email or phone fills in what the client lacks; false skips matches"`
}

// ImportRowResult is one row of the plan (preview) or of the outcome (commit).
type ImportRowResult struct {
	Row      int                     `json:"row" doc:"Line in the file (CSV/XLSX, header = its own line), card number (vCard) or contact number"`
	Action   string                  `json:"action" doc:"create, update, skip or invalid"`
	ClientID *string                 `json:"client_id,omitempty" doc:"The matched (update/skip) or created client"`
	Match    string                  `json:"match,omitempty" doc:"email or phone: what matched an existing client"`
	Name     string                  `json:"name"`
	Email    string                  `json:"email,omitempty"`
	Phone    string                  `json:"phone,omitempty"`
	Company  string                  `json:"company,omitempty"`
	Notes    string                  `json:"notes,omitempty"`
	Changes  []string                `json:"changes,omitempty" doc:"Fields an update fills in"`
	Reason   string                  `json:"reason,omitempty"`
	Errors   []importexport.RowError `json:"errors,omitempty"`
}

// ImportCounts sums a plan.
type ImportCounts struct {
	Total   int `json:"total"`
	Create  int `json:"create"`
	Update  int `json:"update"`
	Skip    int `json:"skip"`
	Invalid int `json:"invalid"`
}

// ClientImportPreview is the plan.
type ClientImportPreview struct {
	Source    string                  `json:"source"`
	Headers   []string                `json:"headers" doc:"The detected header row (tabular sources)"`
	HeaderRow int                     `json:"header_row" doc:"Its line (0 = the file has no header row)"`
	Mapping   map[string]string       `json:"mapping" doc:"Column → field in effect"`
	Fields    []string                `json:"fields"`
	Sample    [][]string              `json:"sample" doc:"The first data rows as read (tabular sources)"`
	Rows      []ImportRowResult       `json:"rows"`
	Counts    ImportCounts            `json:"counts"`
	Errors    []importexport.RowError `json:"errors" doc:"Every row error, flattened"`
}

// ClientImportResult is the outcome of a commit.
type ClientImportResult struct {
	Source string                  `json:"source"`
	Rows   []ImportRowResult       `json:"rows"`
	Counts ImportCounts            `json:"counts" doc:"What was done: create = created, update = updated"`
	Errors []importexport.RowError `json:"errors"`
}

// ---- tabular parsing ------------------------------------------------------------------------------

func decodeContent(in ClientImportInput) ([]byte, error) {
	if in.ContentBase64 != "" {
		b, err := base64.StdEncoding.DecodeString(strings.TrimSpace(in.ContentBase64))
		if err != nil {
			return nil, invalid("content_base64 is not base64")
		}
		if len(b) > MaxImportBytes {
			return nil, invalid("the file is larger than %d MB", MaxImportBytes>>20)
		}
		return b, nil
	}
	if len(in.Content) > MaxImportBytes {
		return nil, invalid("the file is larger than %d MB", MaxImportBytes>>20)
	}
	if in.Content == "" {
		return nil, invalid("the file is empty")
	}
	return []byte(in.Content), nil
}

// ReadTable reads CSV text (delimiter sniffed: , ; or tab; UTF-8 BOM dropped) into records.
func ReadCSV(data []byte) ([][]string, error) {
	data = bytes.TrimPrefix(data, []byte("\xEF\xBB\xBF"))
	if !utf8.Valid(data) {
		return nil, invalid("the file is not UTF-8 text (save it as \"CSV UTF-8\")")
	}
	first := string(data)
	if i := strings.IndexByte(first, '\n'); i >= 0 {
		first = first[:i]
	}
	delim, best := ',', strings.Count(first, ",")
	for _, d := range []rune{';', '\t'} {
		if n := strings.Count(first, string(d)); n > best {
			delim, best = d, n
		}
	}
	r := csv.NewReader(bytes.NewReader(data))
	r.Comma = delim
	r.FieldsPerRecord = -1
	r.LazyQuotes = true
	recs, err := r.ReadAll()
	if err != nil {
		var pe *csv.ParseError
		if errors.As(err, &pe) {
			return nil, invalid("the CSV cannot be read at line %d: %v", pe.Line, pe.Err)
		}
		return nil, invalid("the CSV cannot be read: %v", err)
	}
	return recs, nil
}

// ReadXLSX reads the first sheet of an XLSX workbook.
func ReadXLSX(data []byte) ([][]string, error) {
	f, err := excelize.OpenReader(bytes.NewReader(data))
	if err != nil {
		return nil, invalid("the file is not an XLSX workbook")
	}
	defer f.Close()
	rows, err := f.GetRows(f.GetSheetName(0))
	if err != nil {
		return nil, invalid("the workbook's first sheet cannot be read")
	}
	return rows, nil
}

func normHeader(s string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(strings.TrimSpace(s)) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// headerSynonyms: normalised header → field. Covers common CRM / spreadsheet headers, Arabic
// headers, and both Google Contacts CSV layouts (Name / Given Name / Family Name / E-mail 1 -
// Value / Phone 1 - Value / Organization 1 - Name, and the newer First Name / Last Name /
// Organization Name).
var headerSynonyms = func() map[string]string {
	m := map[string]string{}
	add := func(field string, names ...string) {
		for _, n := range names {
			m[normHeader(n)] = field
		}
	}
	add("name", "name", "full name", "fullname", "display name", "contact", "contact name", "client", "client name", "customer",
		"customer name", "file as", "الاسم", "الاسم الكامل", "اسم العميل", "العميل")
	add("first_name", "first name", "firstname", "given name", "given", "forename", "الاسم الأول")
	add("last_name", "last name", "lastname", "family name", "surname", "اسم العائلة", "الاسم الأخير")
	add("email", "email", "e-mail", "email address", "e-mail address", "mail", "e-mail 1 - value", "email 1 - value",
		"primary email", "work email", "البريد", "البريد الإلكتروني", "الإيميل")
	add("phone", "phone", "phone number", "telephone", "tel", "mobile", "mobile phone", "cell", "whatsapp", "phone 1 - value",
		"primary phone", "work phone", "الهاتف", "رقم الهاتف", "الجوال", "الموبايل", "واتساب")
	add("company", "company", "company name", "organization", "organisation", "organization name", "organization 1 - name",
		"business", "account", "account name", "الشركة", "اسم الشركة", "المؤسسة")
	add("notes", "notes", "note", "comments", "comment", "description", "ملاحظات", "ملاحظة")
	return m
}()

// DetectHeader finds the header row among the first rows (the first with at least one known
// column) and the mapping it implies. No known column anywhere: the file has no header row; the
// columns are named "Column 1…n" and guessed from their contents (an @ = email, mostly digits =
// phone, the first other text column = name).
func DetectHeader(recs [][]string) (headerIdx int, headers []string, mapping map[string]string) {
	for i := 0; i < len(recs) && i < 5; i++ {
		m := map[string]string{}
		for _, h := range recs[i] {
			if f, ok := headerSynonyms[normHeader(h)]; ok && strings.TrimSpace(h) != "" {
				if _, dup := m[h]; !dup {
					m[h] = f
				}
			}
		}
		if len(m) > 0 {
			hs := make([]string, len(recs[i]))
			for c, h := range recs[i] {
				hs[c] = strings.TrimSpace(h)
				if hs[c] == "" {
					hs[c] = fmt.Sprintf("Column %d", c+1)
				}
			}
			mapping = map[string]string{}
			used := map[string]bool{}
			for _, h := range hs {
				if f, ok := headerSynonyms[normHeader(h)]; ok && !used[f] {
					mapping[h], used[f] = f, true
				} else {
					mapping[h] = ""
				}
			}
			return i, hs, mapping
		}
	}
	width := 0
	for _, r := range recs {
		if len(r) > width {
			width = len(r)
		}
	}
	headers = make([]string, width)
	mapping = map[string]string{}
	used := map[string]bool{}
	for c := 0; c < width; c++ {
		headers[c] = fmt.Sprintf("Column %d", c+1)
		mapping[headers[c]] = ""
		emails, phones, texts := 0, 0, 0
		for r := 0; r < len(recs) && r < 20; r++ {
			if c >= len(recs[r]) {
				continue
			}
			v := strings.TrimSpace(recs[r][c])
			switch {
			case v == "":
			case strings.Contains(v, "@"):
				emails++
			case looksLikePhone(v):
				phones++
			default:
				texts++
			}
		}
		f := ""
		switch {
		case emails > 0 && emails >= phones && emails >= texts:
			f = "email"
		case phones > 0 && phones >= texts:
			f = "phone"
		case texts > 0:
			f = "name"
		}
		if f != "" && !used[f] {
			mapping[headers[c]], used[f] = f, true
		}
	}
	return -1, headers, mapping
}

func looksLikePhone(v string) bool {
	digits := 0
	for _, r := range v {
		switch {
		case r >= '0' && r <= '9':
			digits++
		case strings.ContainsRune("+-() .", r):
		default:
			return false
		}
	}
	return digits >= 5
}

// MapRecords applies a mapping (header → field) to the data rows after headerIdx.
func MapRecords(recs [][]string, headerIdx int, headers []string, mapping map[string]string) []ImportContact {
	out := []ImportContact{}
	for i := headerIdx + 1; i < len(recs); i++ {
		rec := recs[i]
		c := ImportContact{Row: i + 1}
		blank := true
		for col, h := range headers {
			if col >= len(rec) {
				break
			}
			v := strings.TrimSpace(rec[col])
			if v == "" {
				continue
			}
			blank = false
			switch mapping[h] {
			case "name":
				c.Name = v
			case "first_name":
				c.FirstName = v
			case "last_name":
				c.LastName = v
			case "email":
				if c.Email == "" {
					c.Email = v
				}
			case "phone":
				if c.Phone == "" {
					c.Phone = v
				}
			case "company":
				c.Company = v
			case "notes":
				if c.Notes != "" {
					c.Notes += "\n"
				}
				c.Notes += v
			}
		}
		if !blank {
			out = append(out, c)
		}
	}
	return out
}

// ---- validation -----------------------------------------------------------------------------------

type cleanContact struct {
	row                                int
	name, email, phone, company, notes string
	phoneKey                           string
	errs                               []importexport.RowError
}

// PhoneKey is the dedupe key of a phone number: its digits, a leading international 00 dropped.
func PhoneKey(p string) string {
	var b strings.Builder
	for _, r := range p {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		} else if r >= '٠' && r <= '٩' { // Arabic-Indic digits
			b.WriteRune('0' + (r - '٠'))
		}
	}
	return strings.TrimPrefix(b.String(), "00")
}

func validateContact(c ImportContact) cleanContact {
	out := cleanContact{row: c.Row}
	fail := func(col, format string, args ...any) {
		out.errs = append(out.errs, importexport.RowError{Row: c.Row, Column: col, Message: fmt.Sprintf(format, args...)})
	}
	name := strings.Join(strings.Fields(c.Name), " ")
	if name == "" {
		name = strings.Join(strings.Fields(strings.TrimSpace(c.FirstName+" "+c.LastName)), " ")
	}
	out.company = strings.Join(strings.Fields(c.Company), " ")
	if c.Email != "" {
		addr, err := mail.ParseAddress(strings.TrimSpace(c.Email))
		if err != nil || !strings.Contains(addr.Address, "@") {
			fail("email", "%q is not an email address", c.Email)
		} else {
			out.email = strings.ToLower(addr.Address)
		}
	}
	if p := strings.TrimSpace(c.Phone); p != "" {
		key := PhoneKey(p)
		switch {
		case len(key) < 5 || len(key) > 20:
			fail("phone", "%q is not a phone number", p)
		case len(p) > 40:
			fail("phone", "the phone number is longer than 40 characters")
		default:
			out.phone, out.phoneKey = p, key
		}
	}
	out.notes = strings.TrimSpace(c.Notes)
	if name == "" {
		// A contact with no name still names the client: company, then email, then phone.
		for _, v := range []string{out.company, out.email, out.phone} {
			if v != "" {
				name = v
				break
			}
		}
	}
	switch {
	case name == "" && len(out.errs) == 0:
		fail("name", "the row has no name, email or phone")
	case utf8.RuneCountInString(name) > 120:
		fail("name", "the name is longer than 120 characters")
	}
	if utf8.RuneCountInString(out.company) > 160 {
		fail("company", "the company is longer than 160 characters")
	}
	if utf8.RuneCountInString(out.notes) > 4000 {
		fail("notes", "the notes are longer than 4000 characters")
	}
	out.name = name
	return out
}

// ---- planning -------------------------------------------------------------------------------------

type existingClient struct {
	id, name                     string
	email, phone, company, notes string
	archived                     bool
}

func loadExisting(ctx context.Context, q querier, ws string) ([]existingClient, error) {
	rows, err := q.QueryContext(ctx, `SELECT id, name, COALESCE(email, ''), COALESCE(phone, ''), COALESCE(company, ''),
		COALESCE(notes, ''), archived_at IS NOT NULL FROM clients WHERE workspace_id = $1 ORDER BY archived_at NULLS FIRST, created_at`, ws)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []existingClient
	for rows.Next() {
		var c existingClient
		if err := rows.Scan(&c.id, &c.name, &c.email, &c.phone, &c.company, &c.notes, &c.archived); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// planned is one planned row with what to write.
type planned struct {
	ImportRowResult
	set map[string]string // column → value (create: all non-empty; update: the fills)
}

// PlanImport matches contacts against existing clients (pure; unit-tested).
func planImport(contacts []ImportContact, existing []existingClient, updateExisting bool) []planned {
	byEmail, byPhone := map[string]*existingClient{}, map[string]*existingClient{}
	for i := range existing {
		c := &existingClient{}
		*c = existing[i]
		if e := strings.ToLower(strings.TrimSpace(c.email)); e != "" {
			if _, ok := byEmail[e]; !ok {
				byEmail[e] = c
			}
		}
		if k := PhoneKey(c.phone); len(k) >= 5 {
			if _, ok := byPhone[k]; !ok {
				byPhone[k] = c
			}
		}
	}
	seenEmail, seenPhone := map[string]int{}, map[string]int{}
	out := make([]planned, 0, len(contacts))
	for _, raw := range contacts {
		c := validateContact(raw)
		p := planned{ImportRowResult: ImportRowResult{Row: c.row, Name: c.name, Email: c.email, Phone: c.phone,
			Company: c.company, Notes: c.notes}, set: map[string]string{}}
		if len(c.errs) > 0 {
			p.Action, p.Errors = "invalid", c.errs
			out = append(out, p)
			continue
		}
		if r, ok := seenEmail[c.email]; ok && c.email != "" {
			p.Action, p.Reason = "skip", fmt.Sprintf("duplicate of row %d (same email)", r)
			out = append(out, p)
			continue
		}
		if r, ok := seenPhone[c.phoneKey]; ok && c.phoneKey != "" {
			p.Action, p.Reason = "skip", fmt.Sprintf("duplicate of row %d (same phone)", r)
			out = append(out, p)
			continue
		}
		if c.email != "" {
			seenEmail[c.email] = c.row
		}
		if c.phoneKey != "" {
			seenPhone[c.phoneKey] = c.row
		}

		var match *existingClient
		if c.email != "" {
			if m, ok := byEmail[c.email]; ok {
				match, p.Match = m, "email"
			}
		}
		if match == nil && c.phoneKey != "" {
			if m, ok := byPhone[c.phoneKey]; ok {
				match, p.Match = m, "phone"
			}
		}
		if match == nil {
			p.Action = "create"
			for col, v := range map[string]string{"name": c.name, "email": c.email, "phone": c.phone, "company": c.company, "notes": c.notes} {
				if v != "" {
					p.set[col] = v
				}
			}
			out = append(out, p)
			continue
		}
		id := match.id
		p.ClientID = &id
		p.Name = match.name
		if !updateExisting {
			p.Action, p.Reason = "skip", "matches an existing client ("+p.Match+")"
			out = append(out, p)
			continue
		}
		fill := func(col, cur, v string) {
			if v != "" && strings.TrimSpace(cur) == "" {
				p.set[col] = v
				p.Changes = append(p.Changes, col)
			}
		}
		fill("email", match.email, c.email)
		fill("phone", match.phone, c.phone)
		fill("company", match.company, c.company)
		if c.notes != "" && !strings.Contains(match.notes, c.notes) {
			n := c.notes
			if strings.TrimSpace(match.notes) != "" {
				n = match.notes + "\n\n" + c.notes
			}
			if utf8.RuneCountInString(n) <= 4000 {
				p.set["notes"] = n
				p.Changes = append(p.Changes, "notes")
			}
		}
		// Later rows see the fills (a second row matching the same client by phone).
		for col, v := range p.set {
			switch col {
			case "email":
				match.email = v
				byEmail[v] = match
			case "phone":
				match.phone = v
				if k := PhoneKey(v); k != "" {
					byPhone[k] = match
				}
			case "company":
				match.company = v
			case "notes":
				match.notes = v
			}
		}
		sort.Strings(p.Changes)
		if len(p.Changes) == 0 {
			p.Action, p.Reason = "skip", "already up to date"
		} else {
			p.Action = "update"
		}
		if match.archived {
			p.Reason = strings.TrimSpace(p.Reason + " (the client is archived)")
		}
		out = append(out, p)
	}
	return out
}

func count(rows []ImportRowResult) (ImportCounts, []importexport.RowError) {
	c := ImportCounts{Total: len(rows)}
	errs := []importexport.RowError{}
	for _, r := range rows {
		switch r.Action {
		case "create":
			c.Create++
		case "update":
			c.Update++
		case "skip":
			c.Skip++
		case "invalid":
			c.Invalid++
		}
		errs = append(errs, r.Errors...)
	}
	return c, errs
}

// ---- service --------------------------------------------------------------------------------------

type parsed struct {
	contacts  []ImportContact
	headers   []string
	headerRow int
	mapping   map[string]string
	sample    [][]string
}

func (sv *Service) parseImport(ctx context.Context, s *tenant.Scope, in ClientImportInput) (*parsed, error) {
	src := strings.TrimSpace(in.Source)
	if err := oneOf("source", src, ImportSources...); err != nil {
		return nil, err
	}
	for h, f := range in.Mapping {
		if f == "" {
			continue
		}
		if err := oneOf("mapping["+h+"]", f, ImportFields...); err != nil {
			return nil, err
		}
	}
	out := &parsed{headers: []string{}, mapping: map[string]string{}, sample: [][]string{}}
	switch src {
	case "vcard":
		data, err := decodeContent(in)
		if err != nil {
			return nil, err
		}
		cards, err := ParseVCards(string(bytes.TrimPrefix(data, []byte("\xEF\xBB\xBF"))))
		if err != nil {
			return nil, err
		}
		out.contacts = cards
	case "google":
		rows, err := takeSession(s, in.Session, false)
		if err != nil {
			return nil, err
		}
		out.contacts = rows
	case "whatsapp_api":
		rows, err := fetchWhatsAppContacts(ctx)
		if err != nil {
			return nil, err
		}
		out.contacts = rows
	default: // csv, google_csv, xlsx
		data, err := decodeContent(in)
		if err != nil {
			return nil, err
		}
		var recs [][]string
		if src == "xlsx" || bytes.HasPrefix(data, []byte("PK\x03\x04")) {
			recs, err = ReadXLSX(data)
		} else {
			recs, err = ReadCSV(data)
		}
		if err != nil {
			return nil, err
		}
		if len(recs) == 0 {
			return nil, invalid("the file has no rows")
		}
		idx, headers, mapping := DetectHeader(recs)
		for h, f := range in.Mapping {
			if _, known := mapping[h]; known {
				mapping[h] = f
			}
		}
		out.headers, out.headerRow, out.mapping = headers, idx+1, mapping
		for i := idx + 1; i < len(recs) && len(out.sample) < 5; i++ {
			out.sample = append(out.sample, recs[i])
		}
		hasTarget := false
		for _, f := range mapping {
			if f != "" {
				hasTarget = true
			}
		}
		if !hasTarget {
			return nil, invalid("no column is mapped to a field — map at least a name, email or phone column")
		}
		out.contacts = MapRecords(recs, idx, headers, mapping)
	}
	if len(out.contacts) > maxImportRows {
		return nil, invalid("an import takes at most %d rows (this one has %d) — split the file", maxImportRows, len(out.contacts))
	}
	return out, nil
}

func (sv *Service) importCaller(ctx context.Context) (*tenant.Scope, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := require(s, authz.ClientsWrite); err != nil {
		return nil, err
	}
	return s, nil
}

// PreviewClientImport parses and plans without writing anything.
func (sv *Service) PreviewClientImport(ctx context.Context, in ClientImportInput) (*ClientImportPreview, error) {
	s, err := sv.importCaller(ctx)
	if err != nil {
		return nil, err
	}
	p, err := sv.parseImport(ctx, s, in)
	if err != nil {
		return nil, err
	}
	existing, err := loadExisting(ctx, sv.DB, s.WorkspaceID)
	if err != nil {
		return nil, err
	}
	plan := planImport(p.contacts, existing, in.UpdateExisting == nil || *in.UpdateExisting)
	rows := make([]ImportRowResult, len(plan))
	for i := range plan {
		rows[i] = plan[i].ImportRowResult
	}
	counts, errs := count(rows)
	return &ClientImportPreview{Source: in.Source, Headers: p.headers, HeaderRow: p.headerRow, Mapping: p.mapping,
		Fields: ImportFields, Sample: p.sample, Rows: rows, Counts: counts, Errors: errs}, nil
}

// CommitClientImport re-plans and applies the import; invalid or failing rows are reported and
// the rest are written.
func (sv *Service) CommitClientImport(ctx context.Context, in ClientImportInput) (*ClientImportResult, error) {
	s, err := sv.importCaller(ctx)
	if err != nil {
		return nil, err
	}
	p, err := sv.parseImport(ctx, s, in)
	if err != nil {
		return nil, err
	}
	var currency string
	if err := sv.DB.QueryRowContext(ctx, `SELECT currency FROM workspaces WHERE id = $1`, s.WorkspaceID).Scan(&currency); err != nil {
		return nil, err
	}
	source := "import:" + in.Source
	var rows []ImportRowResult
	err = sv.tx(ctx, func(tx *sql.Tx) error {
		// Serialise imports per workspace so two concurrent commits cannot both create the same contact.
		if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtext('client-import:' || $1))`, s.WorkspaceID); err != nil {
			return err
		}
		existing, err := loadExisting(ctx, tx, s.WorkspaceID)
		if err != nil {
			return err
		}
		plan := planImport(p.contacts, existing, in.UpdateExisting == nil || *in.UpdateExisting)
		creates := int64(0)
		for _, pl := range plan {
			if pl.Action == "create" {
				creates++
			}
		}
		if creates > 0 {
			if err := quota(ctx, s, limits.Clients, creates); err != nil {
				return err
			}
		}
		rows = make([]ImportRowResult, 0, len(plan))
		for _, pl := range plan {
			r := pl.ImportRowResult
			if r.Action == "create" || r.Action == "update" {
				if err := sv.applyImportRow(ctx, tx, s, &r, pl.set, currency, source); err != nil {
					// A constraint the row broke is that row's error; anything else aborts the import.
					e, ok := AsError(err)
					if !ok {
						return err
					}
					r.Action, r.Errors = "invalid", []importexport.RowError{{Row: r.Row, Message: e.Msg}}
					if r.ClientID != nil && pl.Action == "create" {
						r.ClientID = nil
					}
				}
			}
			rows = append(rows, r)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if in.Source == "google" {
		_, _ = takeSession(s, in.Session, true) // one import per Google session
	}
	counts, errs := count(rows)
	return &ClientImportResult{Source: in.Source, Rows: rows, Counts: counts, Errors: errs}, nil
}

// applyImportRow writes one row inside a savepoint: a failure rolls back that row only.
func (sv *Service) applyImportRow(ctx context.Context, tx *sql.Tx, s *tenant.Scope, r *ImportRowResult, set map[string]string,
	currency, source string) error {
	if _, err := tx.ExecContext(ctx, `SAVEPOINT import_row`); err != nil {
		return err
	}
	err := func() error {
		pt := newPatch()
		for _, col := range []string{"name", "email", "phone", "company", "notes"} {
			if v, ok := set[col]; ok {
				pt.set(col, v)
			}
		}
		if r.Action == "create" {
			pt.set("currency", currency)
			var id string
			cols, marks, args := pt.insert(s.WorkspaceID)
			if err := tx.QueryRowContext(ctx, `INSERT INTO clients (`+cols+`) VALUES (`+marks+`) RETURNING id`, args...).Scan(&id); err != nil {
				return err
			}
			r.ClientID = &id
			return record(ctx, tx, s, entry{Action: "client.created", SubjectType: "client", SubjectID: id,
				Changes: map[string]any{"name": set["name"], "source": source}})
		}
		if err := pt.update(ctx, tx, "clients", s.WorkspaceID, *r.ClientID); err != nil {
			return err
		}
		pt.changes["name"] = r.Name
		pt.changes["source"] = source
		return record(ctx, tx, s, entry{Action: "client.updated", SubjectType: "client", SubjectID: *r.ClientID, Changes: pt.changes})
	}()
	if err != nil {
		if _, rbErr := tx.ExecContext(ctx, `ROLLBACK TO SAVEPOINT import_row`); rbErr != nil {
			return rbErr
		}
		if _, ok := AsError(err); ok {
			return err
		}
		return fmt.Errorf("client import row %d: %w", r.Row, err)
	}
	_, err = tx.ExecContext(ctx, `RELEASE SAVEPOINT import_row`)
	return err
}
