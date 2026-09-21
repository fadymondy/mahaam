package work

import (
	"database/sql"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

/*
Guards on notification delivery.

A notification is written inside the transaction of the change that causes it and announced only
after that transaction commits. The announcement — the realtime event and the Web Push that rides
on it — therefore depends on the writer being handed the transaction. Hand it a *sql.DB and the
row is stored and then nothing tells anyone: the inbox badge does not move until a reload, and no
push is sent. There is no error, which is what makes it worth a test.
*/

func TestQueueNoteCountsWhatItCannotDeliver(t *testing.T) {
	before := UndeliveredNotifications()

	// A *sql.DB is not a transaction. Nothing will ever publish this.
	queueNote((*sql.DB)(nil), "ws", "user", &Notification{Kind: "task.assigned"})

	if got := UndeliveredNotifications() - before; got != 1 {
		t.Errorf("an undeliverable notification was counted %d times, want 1 — silence here is the bug", got)
	}
}

func TestQueueNoteIgnoresNothing(t *testing.T) {
	// notify() returns nil for a muted kind or a deduped repeat. That is not a delivery failure.
	before := UndeliveredNotifications()
	queueNote((*sql.DB)(nil), "ws", "user", nil)
	if got := UndeliveredNotifications() - before; got != 0 {
		t.Errorf("a nil notification was counted as undelivered %d times", got)
	}
}

// TestEveryFannedOutActionRunsInATransaction is the guard that matters.
//
// fanout only notifies for a handful of actions. Every code path that records one of them must
// pass a transaction, or the notification is written and never announced. Today every such path
// does; the integration hooks that pass a *sql.DB record actions fanout ignores. This fails if
// someone adds one of those actions to fanout's switch without also moving the call into a
// transaction.
func TestEveryFannedOutActionRunsInATransaction(t *testing.T) {
	notified := notifiedActions(t)
	if len(notified) == 0 {
		t.Fatal("found no actions in fanout's switch — this guard has stopped guarding anything")
	}
	t.Logf("fanout notifies for: %s", strings.Join(notified, ", "))

	for _, file := range goFiles(t, ".", "../integrations") {
		src, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		lines := strings.Split(string(src), "\n")

		var outside []int
		for i, line := range lines {
			// The call sites that pass a non-transaction querier. `tx` is the only name a
			// transaction is ever bound to in this repo, which is what makes this readable.
			if strings.Contains(line, "RecordActivity(ctx, sv.DB") || strings.Contains(line, "record(ctx, sv.DB") {
				outside = append(outside, i+1)
			}
		}
		if len(outside) == 0 {
			continue
		}

		// The action is not always a literal at the call site — webhook.go passes it through a
		// closure — so the rule is file-level and conservative: a file that records activity
		// outside a transaction may not mention any notified action at all. That over-reports in
		// principle, and the failure tells you exactly which pairing to look at.
		for _, n := range notified {
			for i, line := range lines {
				if !strings.Contains(line, `"`+n+`"`) {
					continue
				}
				t.Errorf("%s mentions %q at line %d and records activity outside a transaction at line(s) %v. "+
					"fanout notifies for %q, so if those meet, the notification is stored and never announced — "+
					"no realtime event, no push, no error. Pass the transaction of the change instead.",
					file, n, i+1, outside, n)
			}
		}
	}
}

// notifiedActions reads the case labels of fanout's switch out of the source, so the guard cannot
// drift from the code it guards.
func notifiedActions(t *testing.T) []string {
	t.Helper()
	fset := token.NewFileSet()
	f, err := parser.ParseFile(fset, "notify.go", nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	var out []string
	ast.Inspect(f, func(n ast.Node) bool {
		fn, ok := n.(*ast.FuncDecl)
		if !ok || fn.Name.Name != "fanout" {
			return true
		}
		ast.Inspect(fn.Body, func(m ast.Node) bool {
			cc, ok := m.(*ast.CaseClause)
			if !ok {
				return true
			}
			for _, e := range cc.List {
				if lit, ok := e.(*ast.BasicLit); ok && lit.Kind == token.STRING {
					out = append(out, strings.Trim(lit.Value, `"`))
				}
			}
			return true
		})
		return false
	})
	return out
}

func goFiles(t *testing.T, dirs ...string) []string {
	t.Helper()
	var out []string
	for _, d := range dirs {
		entries, err := os.ReadDir(d)
		if err != nil {
			t.Fatalf("%s: %v", d, err)
		}
		for _, e := range entries {
			if !e.IsDir() && strings.HasSuffix(e.Name(), ".go") && !strings.HasSuffix(e.Name(), "_test.go") {
				out = append(out, filepath.Join(d, e.Name()))
			}
		}
	}
	return out
}

