package work

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestReadCSVDelimiterAndBOM(t *testing.T) {
	recs, err := ReadCSV([]byte("\xEF\xBB\xBFName;Email;Phone\nعلي;ali@example.com;+20 100 123 4567\n"))
	if err != nil {
		t.Fatal(err)
	}
	if len(recs) != 2 || recs[0][0] != "Name" || recs[1][0] != "علي" || recs[1][2] != "+20 100 123 4567" {
		t.Fatalf("records: %q", recs)
	}
	if _, err := ReadCSV([]byte{0xff, 0xfe, 'a'}); err == nil {
		t.Error("non-UTF-8 input must be refused with a message")
	}
}

func TestDetectHeaderAndMapping(t *testing.T) {
	// A title line above the header, Arabic and English headers, an unknown column.
	recs := [][]string{
		{"Customer export 2026"},
		{"الاسم", "E-mail Address", "Mobile", "Organisation", "Tier", "Notes"},
		{"Acme Owner", "OWNER@ACME.TEST", "0100 000 0001", "Acme", "gold", "Met at expo"},
		{"", "", "", "", "", ""},
		{"Beta", "beta@example.com", "", "", "", ""},
	}
	idx, headers, m := DetectHeader(recs)
	if idx != 1 {
		t.Fatalf("header row: %d", idx)
	}
	want := map[string]string{"الاسم": "name", "E-mail Address": "email", "Mobile": "phone", "Organisation": "company", "Tier": "", "Notes": "notes"}
	for h, f := range want {
		if m[h] != f {
			t.Errorf("mapping[%q] = %q, want %q", h, m[h], f)
		}
	}
	rows := MapRecords(recs, idx, headers, m)
	if len(rows) != 2 {
		t.Fatalf("blank rows are dropped: %+v", rows)
	}
	if rows[0].Row != 3 || rows[0].Email != "OWNER@ACME.TEST" || rows[0].Company != "Acme" || rows[1].Row != 5 {
		t.Errorf("rows: %+v", rows)
	}
}

func TestDetectHeaderGoogleCSV(t *testing.T) {
	// Google Contacts' export (older layout) — mapped without any user input.
	head := []string{"Name", "Given Name", "Family Name", "Notes", "E-mail 1 - Type", "E-mail 1 - Value", "Phone 1 - Type", "Phone 1 - Value", "Organization 1 - Name"}
	recs := [][]string{head, {"", "Sara", "Ali", "vip", "* Home", "sara@example.com", "Mobile", "+971 50 123 4567", "Sara Co"}}
	idx, headers, m := DetectHeader(recs)
	rows := MapRecords(recs, idx, headers, m)
	c := validateContact(rows[0])
	if c.name != "Sara Ali" || c.email != "sara@example.com" || c.phone != "+971 50 123 4567" || c.company != "Sara Co" || c.notes != "vip" {
		t.Errorf("google csv: %+v (mapping %v)", c, m)
	}
	// Newer layout.
	recs = [][]string{{"First Name", "Last Name", "Organization Name", "E-mail 1 - Value", "Phone 1 - Value"}, {"Omar", "Z", "OZ", "o@z.test", "+1 555 0100"}}
	idx, headers, m = DetectHeader(recs)
	c = validateContact(MapRecords(recs, idx, headers, m)[0])
	if c.name != "Omar Z" || c.company != "OZ" || c.email != "o@z.test" {
		t.Errorf("google csv (new): %+v", c)
	}
}

func TestDetectHeaderless(t *testing.T) {
	recs := [][]string{{"Mona", "mona@example.com", "+20 111 222 3333"}, {"Hany", "hany@example.com", "01000000000"}}
	idx, headers, m := DetectHeader(recs)
	if idx != -1 || m[headers[0]] != "name" || m[headers[1]] != "email" || m[headers[2]] != "phone" {
		t.Fatalf("headerless guess: idx=%d %v", idx, m)
	}
	if rows := MapRecords(recs, idx, headers, m); len(rows) != 2 || rows[0].Row != 1 {
		t.Errorf("headerless rows: %+v", rows)
	}
}

func TestValidateContact(t *testing.T) {
	cases := []struct {
		in      ImportContact
		name    string
		errCols []string
	}{
		{ImportContact{Name: "  A   B ", Email: "A@B.Test"}, "A B", nil},
		{ImportContact{Email: "x@y.test"}, "x@y.test", nil},
		{ImportContact{Company: "Only Co"}, "Only Co", nil},
		{ImportContact{Name: "Bad", Email: "not-an-email"}, "Bad", []string{"email"}},
		{ImportContact{Name: "Bad", Phone: "12"}, "Bad", []string{"phone"}},
		{ImportContact{Notes: "just a note"}, "", []string{"name"}},
		{ImportContact{Name: strings.Repeat("x", 121)}, "", []string{"name"}},
	}
	for i, c := range cases {
		got := validateContact(c.in)
		var cols []string
		for _, e := range got.errs {
			cols = append(cols, e.Column)
		}
		if strings.Join(cols, ",") != strings.Join(c.errCols, ",") {
			t.Errorf("case %d: errors %v, want %v", i, cols, c.errCols)
		}
		if c.errCols == nil && got.name != c.name {
			t.Errorf("case %d: name %q, want %q", i, got.name, c.name)
		}
	}
	if PhoneKey("+20 (100) 123-4567") != "201001234567" || PhoneKey("0020 100 1234567") != "201001234567" || PhoneKey("٠١٠٠") != "0100" {
		t.Error("PhoneKey")
	}
}

func TestPlanImportDedupe(t *testing.T) {
	existing := []existingClient{
		{id: "c1", name: "Acme", email: "owner@acme.test", phone: "", company: "", notes: "old"},
		{id: "c2", name: "Beta", email: "", phone: "+20 100 000 0002", company: "Beta LLC"},
		{id: "c3", name: "Gamma", email: "g@gamma.test", phone: "+1 555 0100", company: "Gamma"},
	}
	contacts := []ImportContact{
		{Row: 2, Name: "Acme Owner", Email: "OWNER@acme.test", Phone: "+20 100 000 0001", Company: "Acme"}, // update c1 by email: fills phone, company
		{Row: 3, Name: "Beta person", Phone: "00201000000002", Company: "Other"},                           // update c2 by phone: company kept, nothing new → skip
		{Row: 4, Name: "Gamma", Email: "g@gamma.test", Phone: "+1 555 0100", Company: "Gamma"},             // up to date
		{Row: 5, Name: "New One", Email: "new@x.test"},                                                     // create
		{Row: 6, Name: "New Again", Email: "NEW@x.test"},                                                   // duplicate of row 5
		{Row: 7, Name: "Broken", Email: "nope"},                                                            // invalid
		{Row: 8, Name: "Acme again", Phone: "+20 100 000 0001"},                                            // same phone as row 2 → in-file duplicate
		{Row: 9, Name: "Acme note", Email: "owner@acme.test", Notes: "new note"},                           // same email as row 2 → in-file duplicate
	}
	plan := planImport(contacts, existing, true)
	got := map[int]planned{}
	for _, p := range plan {
		got[p.Row] = p
	}
	expect := map[int]string{2: "update", 3: "skip", 4: "skip", 5: "create", 6: "skip", 7: "invalid", 8: "skip", 9: "skip"}
	for row, action := range expect {
		if got[row].Action != action {
			t.Errorf("row %d: %s (%s), want %s", row, got[row].Action, got[row].Reason, action)
		}
	}
	if r := got[2]; r.Match != "email" || strings.Join(r.Changes, ",") != "company,phone" || *r.ClientID != "c1" || r.Name != "Acme" {
		t.Errorf("row 2: %+v", r)
	}
	if r := got[3]; r.Match != "phone" || r.Reason != "already up to date" {
		t.Errorf("row 3 must match by phone and keep the existing company: %+v", r)
	}
	if !strings.Contains(got[6].Reason, "row 5") {
		t.Errorf("row 6: %q", got[6].Reason)
	}
	if got[7].Errors[0].Column != "email" || got[7].Errors[0].Row != 7 {
		t.Errorf("row 7 errors: %+v", got[7].Errors)
	}
	if r := got[8]; !strings.Contains(r.Reason, "row 2 (same phone)") {
		t.Errorf("row 8: %+v", r)
	}
	if r := planImport([]ImportContact{{Row: 1, Name: "x", Email: "owner@acme.test", Notes: "new note"}}, existing, true)[0]; r.Action != "update" || r.set["notes"] != "old\n\nnew note" {
		t.Errorf("a new note is appended: %+v", r)
	}
	if c := got[5]; c.set["email"] != "new@x.test" || c.set["name"] != "New One" {
		t.Errorf("create set: %v", c.set)
	}

	// update_existing = false: every match is skipped.
	for _, p := range planImport(contacts[:1], existing, false) {
		if p.Action != "skip" || p.Match != "email" {
			t.Errorf("no-update: %+v", p)
		}
	}
	counts, errs := count([]ImportRowResult{got[2].ImportRowResult, got[5].ImportRowResult, got[7].ImportRowResult})
	if counts.Update != 1 || counts.Create != 1 || counts.Invalid != 1 || len(errs) != 1 {
		t.Errorf("counts: %+v %v", counts, errs)
	}
}

func TestParseVCards(t *testing.T) {
	vcf := "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Layla Hassan\r\nN:Hassan;Layla;;;\r\nitem1.TEL;TYPE=CELL:+20 100 555 0101\r\n" +
		"TEL;TYPE=WORK,PREF:+20 2 555 0102\r\nEMAIL;TYPE=INTERNET:layla@example.com\r\nORG:Nile Tech;Sales\r\n" +
		"NOTE:Line one\\nLine two\\, with comma\r\nEND:VCARD\r\n" +
		// vCard 2.1 from an Android / WhatsApp export: QUOTED-PRINTABLE with a soft line break, bare params.
		"BEGIN:VCARD\nVERSION:2.1\nN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:;=D9=85=D8=AD=D9=85=D8=AF;;;\n" +
		"FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:=D9=85=D8=AD=D9=85=D8=AF =D8=A7=D9=84=D8=B9=\n=D9=84=D9=8A\n" +
		"TEL;CELL;PREF:+966501234567\nEND:VCARD\n" +
		// Folded line (RFC 6350) and no FN.
		"BEGIN:VCARD\nVERSION:4.0\nN:Doe;Jo\n hn;;;\nEMAIL:john@\n example.com\nEND:VCARD\n"
	cards, err := ParseVCards(vcf)
	if err != nil {
		t.Fatal(err)
	}
	if len(cards) != 3 {
		t.Fatalf("cards: %+v", cards)
	}
	a := cards[0]
	if a.Name != "Layla Hassan" || a.Phone != "+20 2 555 0102" || a.Email != "layla@example.com" || a.Company != "Nile Tech" || a.Notes != "Line one\nLine two, with comma" {
		t.Errorf("card 1: %+v", a)
	}
	if b := cards[1]; b.Name != "محمد العلي" || b.Phone != "+966501234567" || b.Row != 2 {
		t.Errorf("card 2 (QP): %+v", b)
	}
	c := validateContact(cards[2])
	if c.name != "John Doe" || c.email != "john@example.com" {
		t.Errorf("card 3 (folded, N only): %+v", c)
	}
	if _, err := ParseVCards("Name,Email\nx,y"); err == nil {
		t.Error("a file without vCards must be refused")
	}
}

func TestGoogleAndWhatsAppMapping(t *testing.T) {
	var page struct {
		Connections []googlePerson `json:"connections"`
	}
	raw := `{"connections":[
	 {"names":[{"displayName":"Nour Adel","givenName":"Nour","familyName":"Adel"}],
	  "emailAddresses":[{"value":"n@work.test"},{"value":"nour@home.test","metadata":{"primary":true}}],
	  "phoneNumbers":[{"value":"010 1234 5678","canonicalForm":"+201012345678"}],
	  "organizations":[{"name":"Adel & Co"}],"biographies":[{"value":"met 2025"}]},
	 {"names":[]},
	 {"phoneNumbers":[{"value":"+1 555 0100"}]}]}`
	if err := json.Unmarshal([]byte(raw), &page); err != nil {
		t.Fatal(err)
	}
	got := GooglePeopleContacts(page.Connections, 1)
	if len(got) != 2 {
		t.Fatalf("empty people are dropped: %+v", got)
	}
	if g := got[0]; g.Name != "Nour Adel" || g.Email != "nour@home.test" || g.Phone != "+201012345678" || g.Company != "Adel & Co" || g.Notes != "met 2025" {
		t.Errorf("person: %+v", g)
	}
	wa := WhatsAppContacts([]map[string]any{
		{"remoteJid": "201001112222@s.whatsapp.net", "pushName": "Karim"},
		{"remoteJid": "120363@g.us", "pushName": "Group"},
		{"id": "971500000000@s.whatsapp.net"},
	})
	if len(wa) != 2 || wa[0].Phone != "+201001112222" || wa[0].Name != "Karim" || wa[1].Phone != "+971500000000" {
		t.Errorf("whatsapp: %+v", wa)
	}
}

func TestGoogleState(t *testing.T) {
	st := googleState{WS: "w1", User: "u1", Slug: "acme", Locale: "ar", Nonce: "n", Exp: time.Now().Add(time.Minute).Unix()}
	raw := signState(st)
	got, err := verifyState(raw, time.Now())
	if err != nil || got.WS != "w1" || got.User != "u1" || got.Locale != "ar" {
		t.Fatalf("round trip: %v %+v", err, got)
	}
	if _, err := verifyState(raw, time.Now().Add(2*time.Minute)); err == nil {
		t.Error("an expired state must be refused")
	}
	_, sig, _ := strings.Cut(raw, ".")
	forged := base64.RawURLEncoding.EncodeToString([]byte(`{"w":"w2","u":"u1","e":9999999999}`)) + "." + sig
	if _, err := verifyState(forged, time.Now()); err == nil {
		t.Error("a state with another body must be refused")
	}
}
