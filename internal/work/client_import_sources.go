package work

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/quotedprintable"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/fadymondy/mahaam/internal/secretbox"
	"github.com/fadymondy/mahaam/internal/tenant"
)

/*
Import sources other than a spreadsheet.

vCard (.vcf) — the phone / WhatsApp contacts export (vCard 2.1, 3.0 and 4.0): folded lines,
QUOTED-PRINTABLE values (Android's 2.1 export, soft line breaks included), grouped properties
(item1.TEL), escapes. FN (or N) → name, the first EMAIL / TEL (a "pref" one wins), ORG → company,
NOTE → notes.

Google Contacts — OAuth 2.0 authorization code flow, contacts.readonly:
  1. POST /api/w/clients/import/google/start (manager+) returns Google's consent URL. The state is
     {workspace, user, slug, locale, expiry, nonce} signed with secretbox (MAHAAM_SECRET_KEY); the
     nonce is also set as an HttpOnly cookie scoped to the callback path, so a consent URL started
     by one browser cannot complete in another (an attacker cannot make a victim's contacts land in
     the attacker's session).
  2. GET /api/integrations/google/callback (PUBLIC, guard allowlist) verifies state + cookie,
     exchanges the code, pages through people/me/connections (names, emailAddresses,
     phoneNumbers, organizations, biographies) and keeps the contacts in an in-memory import
     session bound to that user and workspace for 30 minutes. The access token is used for these
     calls only and never stored. Then it redirects to the Clients page, which previews
     source=google with the session id.
  The session store is in-process (like internal/live): with several API replicas the callback
  and the preview must reach the same one (sticky sessions), or the preview answers 404.

WhatsApp Business / Evolution API — optional, by env: WHATSAPP_API_URL (e.g.
https://evo.example.com), WHATSAPP_API_TOKEN (the apikey header) and WHATSAPP_INSTANCE. It calls
POST {url}/chat/findContacts/{instance} and keeps person contacts (…@s.whatsapp.net) as name +
phone. Unset: "not configured" (503).
*/

// ---- vCard ----------------------------------------------------------------------------------------

type vProp struct {
	name   string
	params map[string][]string
	value  string
}

func unfoldVCard(text string) []string {
	text = strings.ReplaceAll(strings.ReplaceAll(text, "\r\n", "\n"), "\r", "\n")
	raw := strings.Split(text, "\n")
	var lines []string
	qpOpen := false
	for _, l := range raw {
		switch {
		case qpOpen && len(lines) > 0:
			// A QUOTED-PRINTABLE soft line break ("=" at the end) continues on the next line.
			lines[len(lines)-1] = strings.TrimSuffix(lines[len(lines)-1], "=") + strings.TrimLeft(l, " \t")
		case (strings.HasPrefix(l, " ") || strings.HasPrefix(l, "\t")) && len(lines) > 0:
			lines[len(lines)-1] += l[1:]
		default:
			lines = append(lines, l)
		}
		last := lines[len(lines)-1]
		head, _, _ := strings.Cut(last, ":")
		qpOpen = strings.Contains(strings.ToUpper(head), "QUOTED-PRINTABLE") && strings.HasSuffix(last, "=")
	}
	return lines
}

func parseVProp(line string) (vProp, bool) {
	head, value, ok := strings.Cut(line, ":")
	if !ok {
		return vProp{}, false
	}
	parts := strings.Split(head, ";")
	name := strings.ToUpper(strings.TrimSpace(parts[0]))
	if i := strings.LastIndexByte(name, '.'); i >= 0 { // item1.TEL
		name = name[i+1:]
	}
	p := vProp{name: name, params: map[string][]string{}, value: value}
	for _, prm := range parts[1:] {
		k, v, has := strings.Cut(prm, "=")
		k = strings.ToUpper(strings.TrimSpace(k))
		if !has { // vCard 2.1 bare params: TEL;CELL;PREF / ;QUOTED-PRINTABLE
			switch k {
			case "QUOTED-PRINTABLE", "BASE64", "B":
				p.params["ENCODING"] = append(p.params["ENCODING"], k)
			default:
				p.params["TYPE"] = append(p.params["TYPE"], strings.ToLower(k))
			}
			continue
		}
		for _, x := range strings.Split(strings.Trim(v, `"`), ",") {
			p.params[k] = append(p.params[k], strings.ToLower(strings.TrimSpace(x)))
		}
	}
	for _, e := range p.params["ENCODING"] {
		if strings.EqualFold(e, "quoted-printable") {
			if b, err := io.ReadAll(quotedprintable.NewReader(strings.NewReader(p.value))); err == nil {
				p.value = string(b)
			}
		}
	}
	return p, true
}

func (p vProp) pref() bool {
	for _, t := range p.params["TYPE"] {
		if t == "pref" {
			return true
		}
	}
	return len(p.params["PREF"]) > 0
}

// splitVComponents splits a structured value on unescaped ';'.
func splitVComponents(v string) []string {
	var out []string
	var cur strings.Builder
	for i := 0; i < len(v); i++ {
		if v[i] == '\\' && i+1 < len(v) {
			cur.WriteByte(v[i])
			cur.WriteByte(v[i+1])
			i++
			continue
		}
		if v[i] == ';' {
			out = append(out, cur.String())
			cur.Reset()
			continue
		}
		cur.WriteByte(v[i])
	}
	return append(out, cur.String())
}

func vUnescape(v string) string {
	r := strings.NewReplacer(`\n`, "\n", `\N`, "\n", `\,`, ",", `\;`, ";", `\:`, ":", `\\`, `\`)
	return strings.TrimSpace(r.Replace(v))
}

// ParseVCards parses a .vcf file into contacts (Row = the card's number, 1-based).
func ParseVCards(text string) ([]ImportContact, error) {
	var out []ImportContact
	var cur *ImportContact
	var emailPref, phonePref bool
	n := 0
	for _, line := range unfoldVCard(text) {
		if strings.TrimSpace(line) == "" {
			continue
		}
		p, ok := parseVProp(line)
		if !ok {
			continue
		}
		switch p.name {
		case "BEGIN":
			if strings.EqualFold(strings.TrimSpace(p.value), "VCARD") {
				n++
				cur, emailPref, phonePref = &ImportContact{Row: n}, false, false
			}
			continue
		case "END":
			if cur != nil && strings.EqualFold(strings.TrimSpace(p.value), "VCARD") {
				out = append(out, *cur)
				cur = nil
			}
			continue
		}
		if cur == nil {
			continue
		}
		switch p.name {
		case "FN":
			cur.Name = vUnescape(p.value)
		case "N":
			c := splitVComponents(p.value)
			if len(c) > 0 {
				cur.LastName = vUnescape(c[0])
			}
			if len(c) > 1 {
				cur.FirstName = vUnescape(strings.Join(c[1:min(3, len(c))], " "))
			}
		case "EMAIL":
			if v := vUnescape(p.value); v != "" && (cur.Email == "" || (p.pref() && !emailPref)) {
				cur.Email, emailPref = v, p.pref()
			}
		case "TEL":
			v := vUnescape(strings.TrimPrefix(strings.TrimPrefix(p.value, "tel:"), "TEL:"))
			if v != "" && (cur.Phone == "" || (p.pref() && !phonePref)) {
				cur.Phone, phonePref = v, p.pref()
			}
		case "ORG":
			cur.Company = vUnescape(splitVComponents(p.value)[0])
		case "NOTE":
			cur.Notes = vUnescape(p.value)
		}
	}
	if n == 0 {
		return nil, invalid("the file has no vCard (BEGIN:VCARD … END:VCARD)")
	}
	return out, nil
}

// ---- import sessions (Google) ---------------------------------------------------------------------

type importSession struct {
	ws, user string
	contacts []ImportContact
	exp      time.Time
}

var sessions = struct {
	sync.Mutex
	m map[string]*importSession
}{m: map[string]*importSession{}}

const sessionTTL = 30 * time.Minute

func putSession(ws, user string, contacts []ImportContact) string {
	sessions.Lock()
	defer sessions.Unlock()
	now := time.Now()
	for id, s := range sessions.m {
		if now.After(s.exp) {
			delete(sessions.m, id)
		}
	}
	id := newID()
	sessions.m[id] = &importSession{ws: ws, user: user, contacts: contacts, exp: now.Add(sessionTTL)}
	return id
}

// takeSession returns the session's contacts if it belongs to the caller (drop removes it).
func takeSession(s *tenant.Scope, id string, drop bool) ([]ImportContact, error) {
	sessions.Lock()
	defer sessions.Unlock()
	sess, ok := sessions.m[strings.TrimSpace(id)]
	if !ok || sess.ws != s.WorkspaceID || sess.user != s.UserID || time.Now().After(sess.exp) {
		return nil, notFound("import session (it expires 30 minutes after connecting Google — connect again)")
	}
	if drop {
		delete(sessions.m, id)
	}
	return sess.contacts, nil
}

// ---- Google ---------------------------------------------------------------------------------------

// GoogleConfig is read from the environment.
type GoogleConfig struct {
	ClientID, ClientSecret string
	RedirectURL            string // <APP_URL>/api/integrations/google/callback (GOOGLE_REDIRECT_URL overrides)
	AuthURL, TokenURL      string // GOOGLE_AUTH_URL / GOOGLE_TOKEN_URL override (tests)
	PeopleURL              string // GOOGLE_PEOPLE_URL overrides https://people.googleapis.com
}

const GoogleCallbackPath = "/api/integrations/google/callback"

func googleConfig() (*GoogleConfig, bool) {
	c := &GoogleConfig{ClientID: strings.TrimSpace(os.Getenv("GOOGLE_CLIENT_ID")), ClientSecret: strings.TrimSpace(os.Getenv("GOOGLE_CLIENT_SECRET")),
		RedirectURL: strings.TrimSpace(os.Getenv("GOOGLE_REDIRECT_URL")),
		AuthURL:     envOr("GOOGLE_AUTH_URL", "https://accounts.google.com/o/oauth2/v2/auth"),
		TokenURL:    envOr("GOOGLE_TOKEN_URL", "https://oauth2.googleapis.com/token"),
		PeopleURL:   strings.TrimRight(envOr("GOOGLE_PEOPLE_URL", "https://people.googleapis.com"), "/")}
	if c.RedirectURL == "" {
		c.RedirectURL = strings.TrimRight(os.Getenv("APP_URL"), "/") + GoogleCallbackPath
	}
	return c, c.ClientID != "" && c.ClientSecret != ""
}

func envOr(k, def string) string {
	if v := strings.TrimSpace(os.Getenv(k)); v != "" {
		return v
	}
	return def
}

// ImportSources reports which optional sources are configured.
type ImportSourceStatus struct {
	Google      bool     `json:"google" doc:"GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are set"`
	WhatsAppAPI bool     `json:"whatsapp_api" doc:"WHATSAPP_API_URL / WHATSAPP_API_TOKEN / WHATSAPP_INSTANCE are set"`
	MaxRows     int      `json:"max_rows"`
	MaxBytes    int      `json:"max_bytes"`
	Fields      []string `json:"fields"`
}

// ClientImportSources is GET /api/w/clients/import/sources (manager+).
func (sv *Service) ClientImportSources(ctx context.Context) (*ImportSourceStatus, error) {
	if _, err := sv.importCaller(ctx); err != nil {
		return nil, err
	}
	_, g := googleConfig()
	_, w := whatsAppConfig()
	return &ImportSourceStatus{Google: g, WhatsAppAPI: w, MaxRows: maxImportRows, MaxBytes: MaxImportBytes, Fields: ImportFields}, nil
}

type googleState struct {
	WS     string `json:"w"`
	User   string `json:"u"`
	Slug   string `json:"s"`
	Locale string `json:"l"`
	Nonce  string `json:"n"`
	Exp    int64  `json:"e"`
}

// GoogleStateCookie holds the start's nonce, scoped to the callback path.
const GoogleStateCookie = "managy_google_import"

func signState(st googleState) string {
	body, _ := json.Marshal(st)
	enc := base64.RawURLEncoding.EncodeToString(body)
	return enc + "." + secretbox.Sign([]byte("google-import:"+enc))
}

func verifyState(raw string, now time.Time) (*googleState, error) {
	enc, sig, ok := strings.Cut(raw, ".")
	if !ok || !secretbox.Verify([]byte("google-import:"+enc), sig) {
		return nil, invalid("the Google sign-in state is invalid — start the import again")
	}
	body, err := base64.RawURLEncoding.DecodeString(enc)
	if err != nil {
		return nil, invalid("the Google sign-in state is invalid — start the import again")
	}
	var st googleState
	if err := json.Unmarshal(body, &st); err != nil || st.WS == "" || st.User == "" {
		return nil, invalid("the Google sign-in state is invalid — start the import again")
	}
	if now.Unix() > st.Exp {
		return nil, invalid("the Google sign-in took too long — start the import again")
	}
	return &st, nil
}

// GoogleStart is the consent URL plus the nonce cookie to set.
type GoogleStart struct {
	URL    string
	Cookie *http.Cookie
}

// StartGoogleImport builds Google's consent URL (manager+).
func (sv *Service) StartGoogleImport(ctx context.Context, locale string) (*GoogleStart, error) {
	s, err := sv.importCaller(ctx)
	if err != nil {
		return nil, err
	}
	cfg, ok := googleConfig()
	if !ok {
		return nil, &Error{http.StatusServiceUnavailable, "Google import is not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)"}
	}
	if locale != "ar" {
		locale = "en"
	}
	nonce := newID()
	st := googleState{WS: s.WorkspaceID, User: s.UserID, Slug: s.WorkspaceSlug, Locale: locale, Nonce: nonce, Exp: time.Now().Add(15 * time.Minute).Unix()}
	q := url.Values{
		"client_id": {cfg.ClientID}, "redirect_uri": {cfg.RedirectURL}, "response_type": {"code"},
		"scope": {"https://www.googleapis.com/auth/contacts.readonly"}, "access_type": {"online"},
		"include_granted_scopes": {"true"}, "prompt": {"consent"}, "state": {signState(st)},
	}
	secure := strings.HasPrefix(cfg.RedirectURL, "https://")
	return &GoogleStart{URL: cfg.AuthURL + "?" + q.Encode(), Cookie: &http.Cookie{Name: GoogleStateCookie, Value: nonce,
		Path: GoogleCallbackPath, MaxAge: 900, HttpOnly: true, Secure: secure, SameSite: http.SameSiteLaxMode}}, nil
}

type googlePerson struct {
	Names []struct {
		DisplayName string `json:"displayName"`
		GivenName   string `json:"givenName"`
		FamilyName  string `json:"familyName"`
	} `json:"names"`
	EmailAddresses []struct {
		Value    string `json:"value"`
		Metadata struct {
			Primary bool `json:"primary"`
		} `json:"metadata"`
	} `json:"emailAddresses"`
	PhoneNumbers []struct {
		Value         string `json:"value"`
		CanonicalForm string `json:"canonicalForm"`
		Metadata      struct {
			Primary bool `json:"primary"`
		} `json:"metadata"`
	} `json:"phoneNumbers"`
	Organizations []struct {
		Name string `json:"name"`
	} `json:"organizations"`
	Biographies []struct {
		Value string `json:"value"`
	} `json:"biographies"`
}

// GooglePeopleContacts maps a People API connections page to contacts (numbered from start).
func GooglePeopleContacts(people []googlePerson, start int) []ImportContact {
	out := make([]ImportContact, 0, len(people))
	for i, p := range people {
		c := ImportContact{Row: start + i}
		if len(p.Names) > 0 {
			c.Name, c.FirstName, c.LastName = p.Names[0].DisplayName, p.Names[0].GivenName, p.Names[0].FamilyName
		}
		for _, e := range p.EmailAddresses {
			if c.Email == "" || e.Metadata.Primary {
				c.Email = e.Value
			}
		}
		for _, ph := range p.PhoneNumbers {
			v := ph.CanonicalForm
			if v == "" {
				v = ph.Value
			}
			if c.Phone == "" || ph.Metadata.Primary {
				c.Phone = v
			}
		}
		if len(p.Organizations) > 0 {
			c.Company = p.Organizations[0].Name
		}
		if len(p.Biographies) > 0 {
			c.Notes = p.Biographies[0].Value
		}
		if c.Name == "" && c.FirstName == "" && c.Email == "" && c.Phone == "" && c.Company == "" {
			continue
		}
		out = append(out, c)
	}
	return out
}

var googleHTTP = &http.Client{Timeout: 20 * time.Second}

func googleFetchContacts(ctx context.Context, cfg *GoogleConfig, code string) ([]ImportContact, error) {
	form := url.Values{"code": {code}, "client_id": {cfg.ClientID}, "client_secret": {cfg.ClientSecret},
		"redirect_uri": {cfg.RedirectURL}, "grant_type": {"authorization_code"}}
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, cfg.TokenURL, strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	res, err := googleHTTP.Do(req)
	if err != nil {
		return nil, fmt.Errorf("google token: %w", err)
	}
	var tok struct {
		AccessToken string `json:"access_token"`
		Error       string `json:"error"`
	}
	err = json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&tok)
	res.Body.Close()
	if err != nil || tok.AccessToken == "" {
		return nil, invalid("Google did not grant access (%s) — start the import again", firstNonEmpty(tok.Error, res.Status))
	}
	var out []ImportContact
	pageToken := ""
	for page := 0; page < 50; page++ {
		q := url.Values{"personFields": {"names,emailAddresses,phoneNumbers,organizations,biographies"}, "pageSize": {"1000"}}
		if pageToken != "" {
			q.Set("pageToken", pageToken)
		}
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, cfg.PeopleURL+"/v1/people/me/connections?"+q.Encode(), nil)
		req.Header.Set("Authorization", "Bearer "+tok.AccessToken)
		res, err := googleHTTP.Do(req)
		if err != nil {
			return nil, fmt.Errorf("google people: %w", err)
		}
		var body struct {
			Connections   []googlePerson `json:"connections"`
			NextPageToken string         `json:"nextPageToken"`
		}
		err = json.NewDecoder(io.LimitReader(res.Body, 32<<20)).Decode(&body)
		res.Body.Close()
		if res.StatusCode != http.StatusOK {
			return nil, invalid("Google Contacts answered %s", res.Status)
		}
		if err != nil {
			return nil, fmt.Errorf("google people: %w", err)
		}
		out = append(out, GooglePeopleContacts(body.Connections, len(out)+1)...)
		if body.NextPageToken == "" || len(out) > maxImportRows {
			break
		}
		pageToken = body.NextPageToken
	}
	return out, nil
}

func firstNonEmpty(v ...string) string {
	for _, s := range v {
		if s != "" {
			return s
		}
	}
	return ""
}

// GoogleCallback serves GET /api/integrations/google/callback (PUBLIC; see the guard). It never
// trusts anything but the signed state and the nonce cookie.
func (sv *Service) GoogleCallback() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		st, err := verifyState(q.Get("state"), time.Now())
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		c, cerr := r.Cookie(GoogleStateCookie)
		if cerr != nil || c.Value == "" || c.Value != st.Nonce {
			http.Error(w, "This Google sign-in was started in another browser — start the import again from the Clients page.", http.StatusBadRequest)
			return
		}
		http.SetCookie(w, &http.Cookie{Name: GoogleStateCookie, Value: "", Path: GoogleCallbackPath, MaxAge: -1, HttpOnly: true})
		back := webBase() + "/" + st.Locale + "/w/" + url.PathEscape(st.Slug) + "/clients?import=google"
		if e := q.Get("error"); e != "" {
			http.Redirect(w, r, back+"&error="+url.QueryEscape("Google: "+e), http.StatusFound)
			return
		}
		cfg, ok := googleConfig()
		if !ok {
			http.Redirect(w, r, back+"&error="+url.QueryEscape("Google import is not configured"), http.StatusFound)
			return
		}
		contacts, err := googleFetchContacts(r.Context(), cfg, q.Get("code"))
		if err != nil {
			msg := "Google Contacts could not be read"
			if e, ok := AsError(err); ok {
				msg = e.Msg
			} else if sv.Log != nil {
				sv.Log.Error("google import", "err", err)
			}
			http.Redirect(w, r, back+"&error="+url.QueryEscape(msg), http.StatusFound)
			return
		}
		id := putSession(st.WS, st.User, contacts)
		http.Redirect(w, r, back+"&session="+id, http.StatusFound)
	}
}

func webBase() string {
	base := strings.TrimRight(os.Getenv("WEB_URL"), "/")
	if u, err := url.Parse(base); base == "" || err != nil || u.Scheme == "" || u.Host == "" {
		return ""
	}
	return base
}

// ---- WhatsApp Business / Evolution API ------------------------------------------------------------

type whatsAppConf struct{ URL, Token, Instance string }

func whatsAppConfig() (*whatsAppConf, bool) {
	c := &whatsAppConf{URL: strings.TrimRight(strings.TrimSpace(os.Getenv("WHATSAPP_API_URL")), "/"),
		Token: strings.TrimSpace(os.Getenv("WHATSAPP_API_TOKEN")), Instance: strings.TrimSpace(os.Getenv("WHATSAPP_INSTANCE"))}
	return c, c.URL != "" && c.Token != "" && c.Instance != ""
}

// WhatsAppContacts maps Evolution API contacts to import contacts (groups and broadcasts dropped).
func WhatsAppContacts(list []map[string]any) []ImportContact {
	out := []ImportContact{}
	for _, c := range list {
		jid, _ := c["remoteJid"].(string)
		if jid == "" {
			jid, _ = c["id"].(string)
		}
		num, host, ok := strings.Cut(jid, "@")
		if !ok || host != "s.whatsapp.net" || PhoneKey(num) == "" {
			continue
		}
		name, _ := c["pushName"].(string)
		if name == "" {
			name, _ = c["name"].(string)
		}
		out = append(out, ImportContact{Row: len(out) + 1, Name: name, Phone: "+" + PhoneKey(num)})
	}
	return out
}

func fetchWhatsAppContacts(ctx context.Context) ([]ImportContact, error) {
	cfg, ok := whatsAppConfig()
	if !ok {
		return nil, &Error{http.StatusServiceUnavailable, "the WhatsApp API is not configured (WHATSAPP_API_URL / WHATSAPP_API_TOKEN / WHATSAPP_INSTANCE) — import a vCard export instead"}
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, cfg.URL+"/chat/findContacts/"+url.PathEscape(cfg.Instance), strings.NewReader("{}"))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("apikey", cfg.Token)
	res, err := googleHTTP.Do(req)
	if err != nil {
		return nil, &Error{http.StatusBadGateway, "the WhatsApp API cannot be reached"}
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK && res.StatusCode != http.StatusCreated {
		return nil, &Error{http.StatusBadGateway, "the WhatsApp API answered " + res.Status}
	}
	var list []map[string]any
	if err := json.NewDecoder(io.LimitReader(res.Body, 32<<20)).Decode(&list); err != nil {
		return nil, errors.New("whatsapp: " + err.Error())
	}
	return WhatsAppContacts(list), nil
}
