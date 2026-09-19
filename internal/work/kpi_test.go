package work

import (
	"strings"
	"testing"
	"time"

	"github.com/fadymondy/mahaam/internal/secretbox"
)

func TestGitHubUserStateSignVerify(t *testing.T) {
	now := time.Now()
	st := GitHubUserState{WS: "ws1", User: "u1", Slug: "acme", Locale: "en", Nonce: "n1", Exp: now.Add(time.Minute).Unix()}
	raw := SignGitHubUserState(st)
	got, err := VerifyGitHubUserState(raw, now)
	if err != nil || *got != st {
		t.Fatalf("round trip: %v %+v", err, got)
	}
	// Expired.
	if _, err := VerifyGitHubUserState(raw, now.Add(2*time.Minute)); err == nil || !strings.Contains(err.Error(), "expired") {
		t.Errorf("expired state accepted: %v", err)
	}
	// Tampered payload (another user) with the old signature.
	enc, sig, _ := strings.Cut(raw, ".")
	other := SignGitHubUserState(GitHubUserState{WS: "ws1", User: "attacker", Slug: "acme", Locale: "en", Nonce: "n1", Exp: st.Exp})
	oenc, _, _ := strings.Cut(other, ".")
	if _, err := VerifyGitHubUserState(oenc+"."+sig, now); err == nil {
		t.Error("a payload swapped under a valid signature was accepted")
	}
	for _, bad := range []string{"", "nodot", enc + ".", "." + sig, enc + "." + sig + "x"} {
		if _, err := VerifyGitHubUserState(bad, now); err == nil {
			t.Errorf("malformed state %q accepted", bad)
		}
	}
	// A signature made for another purpose (the plain payload, as the install state signs) fails.
	if _, err := VerifyGitHubUserState(enc+"."+signPlainForTest(enc), now); err == nil {
		t.Error("a state signed without the github-user purpose was accepted")
	}
	// Missing fields.
	empty := SignGitHubUserState(GitHubUserState{WS: "ws1", Exp: st.Exp})
	if _, err := VerifyGitHubUserState(empty, now); err == nil {
		t.Error("a state without user/slug/nonce was accepted")
	}
}

func TestCutDays(t *testing.T) {
	loc := time.FixedZone("UTC+3", 3*3600)
	// 22:00 → 02:00 local = two local days, 2h each.
	a := time.Date(2026, 9, 1, 22, 0, 0, 0, loc)
	got := cutDays(a, a.Add(4*time.Hour), loc)
	if got["2026-09-01"] != 7200 || got["2026-09-02"] != 7200 || len(got) != 2 {
		t.Errorf("cut at local midnight: %v", got)
	}
}

func TestKPIMarkdown(t *testing.T) {
	cost := int64(1234)
	avg := 4.5
	due := time.Date(2026, 9, 3, 0, 0, 0, 0, time.UTC)
	k := &KPI{
		Member: KPIMember{UserID: "u1", Email: "dev@example.test", Role: "member"},
		From:   "2026-09-01", To: "2026-09-30", Timezone: "UTC", Finance: true,
		GitHub: &GitHubAccount{Login: "dev-octo", Emails: []string{"dev@example.test"}, ConnectedVia: "manual"},
		Time: KPITime{TrackedS: 5400, BillableS: 3600, Entries: 2, DaysTracked: 2,
			ByProject: []KPIKeyed{{Key: "p1", Name: "Acme | App", Seconds: 5400, Billable: 3600}},
			ByWeek:    []KPIKeyed{{Key: "2026-08-31", Seconds: 5400, Billable: 3600}}},
		Tasks:    KPITasks{Completed: 1, CompletedLate: 1, CompletedList: []KPITaskRef{{Key: "MG-7", Title: "Ship\nit", Project: "Acme", DueAt: &due, CompletedAt: &due}}},
		Issues:   KPIIssues{Started: 2, Finished: 1, AgentSeconds: 600, MentionsAnswered: 1},
		AI:       KPIAI{InputTokens: 1000, OutputTokens: 500, CostMinor: &cost, Currency: "USD", ByModel: []KPIKeyed{{Name: "claude-opus-5", Tokens: 1500, CostMinor: &cost}}},
		Git:      KPIGitHub{Connected: true, Login: "dev-octo", Commits: 3, PullRequests: 1, PRsMerged: 1, Deployments: 1, DeploysOK: 1},
		Activity: KPIActivity{Actions: 10, MCPActions: 4, MCPTokens: 1},
		Reviews: KPIReviews{Count: 1, AvgRating: &avg, Items: []MemberReview{{PeriodStart: "2026-09-01", PeriodEnd: "2026-09-30", AuthorEmail: "boss@example.test",
			Body: "Great work.\nKeep going."}}},
	}
	md := KPIMarkdown(k)
	for _, want := range []string{
		"# Employee KPI dossier — dev@example.test",
		"- Period: 2026-09-01 to 2026-09-30",
		"GitHub: @dev-octo (manual",
		"| Hours tracked | 1:30 |",
		"| Billable hours | 1:00 |",
		"| Acme \\| App | 1:30 | 1:00 |", // pipes escaped in cells
		"| MG-7 | Ship it | Acme | 2026-09-03 | 2026-09-03 |",
		"| Plans posted (started) | 2 |",
		"| @agent mentions answered | 1 |",
		"cost 12.34 USD",
		"| Commits | 3 |",
		"4 of them via MCP from 1 token(s)",
		"average rating 4.5 / 5",
		"> Great work.\n> Keep going.",
	} {
		if !strings.Contains(md, want) {
			t.Errorf("dossier lacks %q:\n%s", want, md)
		}
	}

	// A member's own view: no cost anywhere, and missing sources are stated, not guessed.
	k2 := &KPI{Member: KPIMember{Email: "x@example.test"}, From: "2026-09-01", To: "2026-09-30"}
	md2 := KPIMarkdown(k2)
	for _, want := range []string{"GitHub: not connected", "No AI usage was recorded", "No GitHub account is mapped", "No manager review covers this period"} {
		if !strings.Contains(md2, want) {
			t.Errorf("empty dossier lacks %q", want)
		}
	}
	if strings.Contains(md2, "AI cost") {
		t.Error("a dossier without finance shows AI cost")
	}

	team := TeamKPIMarkdown(&TeamKPI{From: "2026-09-01", To: "2026-09-30", Timezone: "UTC", Currency: "USD", Finance: true,
		Rows: []TeamKPIRow{{Member: KPIMember{Email: "a@example.test"}, TrackedS: 3600, AICostMinor: &cost, GitHubLogin: "a", Commits: 2}, {Member: KPIMember{Email: "b@example.test"}}}})
	if !strings.Contains(team, "| a@example.test | 1:00 |") || !strings.Contains(team, "12.34 USD") || !strings.Contains(team, "| n/a |") {
		t.Errorf("team table:\n%s", team)
	}
}

func signPlainForTest(enc string) string { return secretbox.Sign([]byte(enc)) }
