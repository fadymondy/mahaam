package work

import (
	"context"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/togo-framework/togo"

	"github.com/fadymondy/mahaam/internal/app"
	"github.com/fadymondy/mahaam/internal/db/migrate"
)

/*
MH-249: two runners must never mail the same notification twice.

The reported symptom was a test whose counts disagreed — "11 sent, 23 files" —
and the first reading was duplicate delivery. It was not: the scheduler fires
the email job every minute, so on a run that straddled a minute boundary the
scheduler and the test each delivered part of the same inbox, and the test's
own count only covered its half.

The scheduler is off in tests now, which makes THAT test deterministic. This
one covers the thing that actually matters and was never checked: run the
delivery twice AT THE SAME TIME and assert every notification produced exactly
one mail. It is the claim, not the absence of a scheduler, that has to hold —
in production there really are two runners.
*/

func bootWork(t *testing.T) (*app.App, string) {
	t.Helper()
	owner, appURL := os.Getenv("TEST_DATABASE_URL"), os.Getenv("TEST_APP_DATABASE_URL")
	if owner == "" || appURL == "" {
		t.Skip("set TEST_DATABASE_URL and TEST_APP_DATABASE_URL (a throwaway database)")
	}
	mailDir := t.TempDir()
	t.Setenv("DATABASE_URL", owner)
	t.Setenv("APP_DATABASE_URL", appURL)
	t.Setenv("DB_DRIVER", "pgx")
	t.Setenv("AUTH_SECRET", "claim-test-secret-claim-test-secret-claim-01234")
	t.Setenv("STORAGE_DIR", t.TempDir())
	t.Setenv("MAIL_DRIVER", "file")
	t.Setenv("MAIL_DIR", mailDir)
	t.Setenv("SCHEDULER", "off")

	k0 := togo.New()
	sys, err := k0.SQL(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if err := migrate.Run(context.Background(), sys, appURL, "../..", func(string, ...any) {}); err != nil {
		t.Fatal(err)
	}
	k0.Close()

	k := togo.New()
	a := app.New(context.Background(), k)
	t.Cleanup(func() { k.Close() })
	return a, mailDir
}

func TestDeliverEmailsNeverSendsOneTwice(t *testing.T) {
	a, mailDir := bootWork(t)
	ctx := context.Background()
	sv := New(a)
	if sv.Mail == nil {
		t.Skip("no mail driver in this environment")
	}

	// A workspace, a member who wants email, and a handful of notifications.
	wsID, userID := seedInbox(t, a, 8)

	files := func() int {
		m, _ := filepath.Glob(filepath.Join(mailDir, "*.eml"))
		return len(m)
	}
	before := files()

	// Two runners, at once — which is what the scheduler and a hand-run are.
	var wg sync.WaitGroup
	sent := make([]int, 2)
	errs := make([]error, 2)
	for i := range sent {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			sent[i], errs[i] = sv.DeliverEmails(ctx)
		}(i)
	}
	wg.Wait()

	for i, err := range errs {
		if err != nil {
			t.Fatalf("runner %d: %v", i, err)
		}
	}
	total := sent[0] + sent[1]
	if got := files() - before; got != total {
		t.Errorf("two runners reported %d sent (%d + %d) but wrote %d files — a notification went out more than once",
			total, sent[0], sent[1], got)
	}
	if total != 8 {
		t.Errorf("8 notifications should produce 8 mails between them, got %d", total)
	}

	// And nothing is left claimed-but-unfinished.
	var stuck int
	if err := a.SysDB.QueryRow(`SELECT count(*) FROM notifications WHERE workspace_id = $1 AND email_status = 'sending'`, wsID).Scan(&stuck); err != nil {
		t.Fatal(err)
	}
	if stuck != 0 {
		t.Errorf("%d notifications are still marked 'sending'", stuck)
	}
	_ = userID
}

func TestReclaimStuckEmailsPutsBackWhatAProcessAbandoned(t *testing.T) {
	a, _ := bootWork(t)
	ctx := context.Background()
	sv := New(a)
	wsID, _ := seedInbox(t, a, 2)

	// A runner that died mid-send leaves the row claimed. Backdated, because
	// the reclaim deliberately leaves a send that is genuinely in progress
	// alone.
	if _, err := a.SysDB.Exec(`UPDATE notifications SET email_status = 'sending', updated_at = now() - interval '30 minutes'
		WHERE workspace_id = $1`, wsID); err != nil {
		t.Fatal(err)
	}
	n, err := sv.ReclaimStuckEmails(ctx, 10*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if n != 2 {
		t.Errorf("reclaimed %d, want 2", n)
	}

	// A fresh claim is left alone.
	if _, err := a.SysDB.Exec(`UPDATE notifications SET email_status = 'sending', updated_at = now() WHERE workspace_id = $1`, wsID); err != nil {
		t.Fatal(err)
	}
	if n, _ := sv.ReclaimStuckEmails(ctx, 10*time.Minute); n != 0 {
		t.Errorf("reclaimed %d rows that were still in flight", n)
	}
}

// seedInbox makes a workspace with one member who wants email, and n
// notifications waiting to go out. It writes on the owner pool because it is
// setting up several tenants' worth of rows on purpose.
func seedInbox(t *testing.T, a *app.App, n int) (workspaceID, userID string) {
	t.Helper()
	ctx := context.Background()
	email := "claim" + time.Now().Format("150405.000000") + "@example.test"

	if err := a.SysDB.QueryRowContext(ctx, `
		INSERT INTO users (id, email, password_hash, created_at)
		VALUES (gen_random_uuid()::text, $1, 'x', now()::text) RETURNING id`, email).Scan(&userID); err != nil {
		t.Fatal(err)
	}
	if err := a.SysDB.QueryRowContext(ctx, `
		INSERT INTO workspaces (name, slug, created_by, plan) VALUES ($1, $2, $3, 'unlimited') RETURNING id`,
		"Claim "+email, "claim-"+time.Now().Format("150405.000000"), userID).Scan(&workspaceID); err != nil {
		t.Fatal(err)
	}
	if _, err := a.SysDB.ExecContext(ctx, `
		INSERT INTO workspace_members (workspace_id, user_id, role, status) VALUES ($1, $2, 'owner', 'active')`,
		workspaceID, userID); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < n; i++ {
		if _, err := a.SysDB.ExecContext(ctx, `
			INSERT INTO notifications (workspace_id, user_id, kind, title, body)
			VALUES ($1, $2, 'task.mentioned', $3, 'body')`,
			workspaceID, userID, "Notification "+time.Now().Format("15:04:05.000000")); err != nil {
			t.Fatal(err)
		}
	}
	return workspaceID, userID
}
