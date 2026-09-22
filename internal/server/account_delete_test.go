package server

/*
TestAccountDeletion: deleting your own account (MH-344), against the real stack.

The refusal while you are a workspace's only owner, what ends at once, signing in again as the
undo, and what the purge leaves behind: the row other people's work points at, but no longer
anyone's.

	TEST_DATABASE_URL=… TEST_APP_DATABASE_URL=… go test -count=1 ./internal/server/ -run AccountDeletion -v
*/

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/fadymondy/mahaam/internal/account"
)

func TestAccountDeletion(t *testing.T) {
	mailDir := t.TempDir()
	t.Setenv("MAIL_DRIVER", "file")
	t.Setenv("MAIL_DIR", mailDir)
	a, srv := bootStack(t)
	ctx := context.Background()
	reaper := &account.Service{DB: a.SysDB}

	alice, aliceID, email := signup(t, a, srv.URL, "delete-alice")
	_, bobID, _ := signup(t, a, srv.URL, "delete-bob")
	ws := alice.must("POST", "/api/me/workspaces", map[string]string{"name": "Delete " + rnd()}, 201)["workspace"].(map[string]any)
	wsID := ws["id"].(string)
	alice.ws = wsID

	// 1. The only owner of a workspace is refused, and told which one.
	if code, _ := alice.do("POST", "/api/me/delete", map[string]string{"password": "not-my-password"}); code != 403 {
		t.Errorf("delete with the wrong password: %d", code)
	}
	code, b := alice.do("POST", "/api/me/delete", map[string]string{"password": "correct-horse-9"})
	if code != http.StatusConflict || !strings.Contains(string(b), `"sole_owner"`) || !strings.Contains(string(b), wsID) {
		t.Fatalf("sole owner: got %d %s", code, b)
	}

	// Work of alice's that must outlive her account: a project she created (projects.created_by
	// references users with no cascade). Then bob becomes a second owner, so she may leave.
	project := alice.must("POST", "/api/w/projects", map[string]any{"name": "Outlives " + rnd(), "visibility": "workspace"}, 201)["id"].(string)
	if _, err := a.SysDB.Exec(`INSERT INTO workspace_members (workspace_id, user_id, role, status) VALUES ($1, $2, 'owner', 'active')`, wsID, bobID); err != nil {
		t.Fatal(err)
	}
	pat := alice.must("POST", "/api/auth/tokens", map[string]any{"name": "phone"}, 201)["token"].(string)
	byPAT := newClient(t, srv.URL)
	byPAT.bearer = pat
	alice.must("POST", "/api/w/mcp_tokens", map[string]any{"name": "agent", "scopes": []string{"projects:read"}}, 201)

	// 2. The request. Sessions carry whole-second iats: one made in the same second as the
	// request would survive it, so the clock moves on first (as in the admin sign-out test).
	time.Sleep(1100 * time.Millisecond)
	out := alice.must("POST", "/api/me/delete", map[string]string{"password": "correct-horse-9"}, 202)
	purge, err := time.Parse(time.RFC3339, out["purge_after"].(string))
	if err != nil || purge.Before(time.Now().Add(13*24*time.Hour)) {
		t.Errorf("purge_after %v (%v), want about 14 days out", out["purge_after"], err)
	}
	mailTo(t, mailDir, email, "will be deleted", 0)

	// 3. Everything that acted as alice stops at once.
	if code, _ := alice.do("GET", "/api/me/profile", nil); code != http.StatusUnauthorized {
		t.Errorf("the cookie session after delete: %d", code)
	}
	if code, _ := byPAT.do("GET", "/api/me/profile", nil); code != http.StatusUnauthorized {
		t.Errorf("the PAT after delete: %d", code)
	}
	var tokens int
	_ = a.SysDB.QueryRow(`SELECT (SELECT count(*) FROM personal_access_tokens WHERE user_id = $1) + (SELECT count(*) FROM mcp_tokens WHERE user_id = $1)`, aliceID).Scan(&tokens)
	if tokens != 0 {
		t.Errorf("%d token(s) survived the request", tokens)
	}

	// 4. Signing in again is the undo.
	back := newClient(t, srv.URL)
	back.must("POST", "/api/auth/login", map[string]string{"email": email, "password": "correct-horse-9"}, 200)
	back.must("GET", "/api/me/profile", nil, 200)
	var pending bool
	_ = a.SysDB.QueryRow(`SELECT deletion_requested_at IS NOT NULL FROM platform_users WHERE user_id = $1`, aliceID).Scan(&pending)
	if pending {
		t.Fatal("signing in again did not cancel the deletion")
	}
	mailTo(t, mailDir, email, "will not be deleted", 0)
	// A purge after a cancel does nothing.
	if _, err := reaper.PurgeDue(ctx, time.Now().Add(30*24*time.Hour)); err != nil {
		t.Fatal(err)
	}
	var gone bool
	_ = a.SysDB.QueryRow(`SELECT deleted_at IS NOT NULL FROM platform_users WHERE user_id = $1`, aliceID).Scan(&gone)
	if gone {
		t.Error("the reaper purged alice after she cancelled")
	}

	// 5. Deleted for real this time: request, the grace period runs out, the reaper runs.
	time.Sleep(1100 * time.Millisecond)
	back.must("POST", "/api/me/delete", map[string]string{"password": "correct-horse-9"}, 202)
	if _, err := reaper.PurgeDue(ctx, time.Now()); err != nil {
		t.Fatal(err)
	}
	var early bool
	_ = a.SysDB.QueryRow(`SELECT deleted_at IS NOT NULL FROM platform_users WHERE user_id = $1`, aliceID).Scan(&early)
	if early {
		t.Error("the reaper purged alice inside her grace period")
	}
	// At least one: the shared test database may hold other accounts whose time is also up.
	// Which one matters is checked below, by what happened to alice's row.
	if n, err := reaper.PurgeDue(ctx, time.Now().Add(15*24*time.Hour)); err != nil || n < 1 {
		t.Fatalf("the reaper after the grace period: %d %v", n, err)
	}

	// 6. What is left: the row, no longer anyone; and the work that pointed at it.
	var gotEmail, hash string
	_ = a.SysDB.QueryRow(`SELECT email, password_hash FROM users WHERE id = $1`, aliceID).Scan(&gotEmail, &hash)
	if gotEmail != "deleted-"+aliceID+"@deleted.invalid" || hash != "!" {
		t.Errorf("the users row still identifies someone: %q %q", gotEmail, hash)
	}
	var members, projects int
	_ = a.SysDB.QueryRow(`SELECT count(*) FROM workspace_members WHERE user_id = $1`, aliceID).Scan(&members)
	_ = a.SysDB.QueryRow(`SELECT count(*) FROM projects WHERE id = $1 AND created_by = $2`, project, aliceID).Scan(&projects)
	if members != 0 {
		t.Errorf("%d membership(s) survived the purge", members)
	}
	if projects != 1 {
		t.Error("the project alice created did not survive her account")
	}
	fresh := newClient(t, srv.URL)
	if code, _ := fresh.do("POST", "/api/auth/login", map[string]string{"email": email, "password": "correct-horse-9"}); code != 401 {
		t.Errorf("a purged account signed in: %d", code)
	}
	// The address is free again.
	fresh.must("POST", "/api/auth/register", map[string]string{"email": email, "password": "correct-horse-9"}, 201)

	// 7. Someone who became a workspace's only owner during their grace period is not purged: the
	// rule the request enforced is enforced again at the end.
	carol, carolID, _ := signup(t, a, srv.URL, "delete-carol")
	_, daveID, _ := signup(t, a, srv.URL, "delete-dave")
	shared := carol.must("POST", "/api/me/workspaces", map[string]string{"name": "Shared " + rnd()}, 201)["workspace"].(map[string]any)["id"].(string)
	if _, err := a.SysDB.Exec(`INSERT INTO workspace_members (workspace_id, user_id, role, status) VALUES ($1, $2, 'owner', 'active')`, shared, daveID); err != nil {
		t.Fatal(err)
	}
	carol.must("POST", "/api/me/delete", map[string]string{"password": "correct-horse-9"}, 202)
	if _, err := a.SysDB.Exec(`DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`, shared, daveID); err != nil {
		t.Fatal(err)
	}
	if _, err := reaper.PurgeDue(ctx, time.Now().Add(15*24*time.Hour)); err != nil {
		t.Fatal(err)
	}
	var carolDeleted bool
	_ = a.SysDB.QueryRow(`SELECT deleted_at IS NOT NULL FROM platform_users WHERE user_id = $1`, carolID).Scan(&carolDeleted)
	if carolDeleted {
		t.Error("carol was anonymised while her workspace had no other owner")
	}
}
