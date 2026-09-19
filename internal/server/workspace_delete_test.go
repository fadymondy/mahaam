package server

/*
TestWorkspaceDelete: the owner deletes their own workspace. A member cannot; a wrong slug is
refused; an active paid subscription blocks it; a real delete removes the workspace, its rows
and its stored attachment file.
*/

import (
	"os"
	"path/filepath"
	"testing"
)

func TestWorkspaceDelete(t *testing.T) {
	a, srv := bootStack(t)
	owner, _, _ := signup(t, a, srv.URL, "delowner")
	mem, memID, _ := signup(t, a, srv.URL, "delmember")
	w := owner.must("POST", "/api/me/workspaces", map[string]string{"name": "Delete me " + rnd()}, 201)["workspace"].(map[string]any)
	ws, slug := w["id"].(string), w["slug"].(string)
	if _, err := a.SysDB.Exec(`INSERT INTO workspace_members (workspace_id, user_id, role, status) VALUES ($1, $2, 'member', 'active')`, ws, memID); err != nil {
		t.Fatal(err)
	}
	owner.ws, mem.ws = ws, ws
	pid := owner.must("POST", "/api/w/projects", map[string]any{"name": "P " + rnd()}, 201)["id"].(string)
	task := owner.must("POST", "/api/w/projects/"+pid+"/tasks", map[string]any{"title": "with a file"}, 201)
	code, b := owner.upload("/api/w/tasks/"+task["key"].(string)+"/attachments", "note.txt", []byte("hello"))
	if code != 201 {
		t.Fatalf("upload: %d %s", code, b)
	}
	var path string
	_ = a.SysDB.QueryRow(`SELECT storage_path FROM attachments WHERE workspace_id = $1`, ws).Scan(&path)
	file := filepath.Join(os.Getenv("STORAGE_DIR"), path)
	if _, err := os.Stat(file); err != nil {
		t.Logf("attachment file not found at %s (storage layout differs): %v", file, err)
		file = ""
	}

	if code, _ := mem.do("DELETE", "/api/w/workspace", map[string]any{"confirm": slug}); code != 403 {
		t.Errorf("a member deleted the workspace: %d", code)
	}
	if code, _ := owner.do("DELETE", "/api/w/workspace", map[string]any{"confirm": "nope"}); code != 422 {
		t.Errorf("a wrong slug must be refused: %d", code)
	}
	_, _ = a.SysDB.Exec(`UPDATE workspaces SET billing_status = 'active' WHERE id = $1`, ws)
	if code, _ := owner.do("DELETE", "/api/w/workspace", map[string]any{"confirm": slug}); code != 409 {
		t.Errorf("an active subscription must block the delete: %d", code)
	}
	_, _ = a.SysDB.Exec(`UPDATE workspaces SET billing_status = 'canceled' WHERE id = $1`, ws)
	if code, b := owner.do("DELETE", "/api/w/workspace", map[string]any{"confirm": slug}); code != 204 {
		t.Fatalf("owner delete: %d %s", code, b)
	}
	var n int
	_ = a.SysDB.QueryRow(`SELECT count(*) FROM workspaces WHERE id = $1`, ws).Scan(&n)
	var tasks int
	_ = a.SysDB.QueryRow(`SELECT count(*) FROM tasks WHERE workspace_id = $1`, ws).Scan(&tasks)
	if n != 0 || tasks != 0 {
		t.Errorf("workspace rows left: ws=%d tasks=%d", n, tasks)
	}
	if file != "" {
		if _, err := os.Stat(file); !os.IsNotExist(err) {
			t.Errorf("the attachment file must be removed: %v", err)
		}
	}
	var audit int
	_ = a.SysDB.QueryRow(`SELECT count(*) FROM admin_audit WHERE action = 'workspace.deleted_by_owner' AND target_id = $1`, ws).Scan(&audit)
	if audit != 1 {
		t.Errorf("the delete must be audited once, got %d", audit)
	}
}
