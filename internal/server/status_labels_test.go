package server

import "testing"

// A board column's per-locale labels and icon: seeded on the default columns, set and cleared
// through PATCH /api/w/statuses/{id}, and validated (known locales, the icon allow-list).
func TestStatusLabels(t *testing.T) {
	a, srv := bootStack(t)
	owner, _, _ := signup(t, a, srv.URL, "slabels")
	owner.ws = owner.must("POST", "/api/me/workspaces", map[string]string{"name": "Labels " + rnd()}, 201)["workspace"].(map[string]any)["id"].(string)
	pid := owner.must("POST", "/api/w/projects", map[string]any{"name": "Board " + rnd()}, 201)["id"].(string)

	statuses := owner.must("GET", "/api/w/projects/"+pid, nil, 200)["statuses"].([]any)
	first := statuses[0].(map[string]any)
	labels, _ := first["labels"].(map[string]any)
	if labels["en"] != "Backlog" || labels["ar"] != "قائمة الانتظار" {
		t.Fatalf("default column labels: %v", first)
	}
	id := first["id"].(string)

	got := owner.must("PATCH", "/api/w/statuses/"+id, map[string]any{"labels": map[string]string{"en": "Ideas", "ar": "أفكار"}, "icon": "sparkles"}, 200)
	if l := got["labels"].(map[string]any); l["en"] != "Ideas" || l["ar"] != "أفكار" || got["icon"] != "sparkles" {
		t.Fatalf("patched: %v", got)
	}

	owner.must("PATCH", "/api/w/statuses/"+id, map[string]any{"icon": "skull"}, 422)
	owner.must("PATCH", "/api/w/statuses/"+id, map[string]any{"labels": map[string]string{"fr": "Idées"}}, 422)

	got = owner.must("PATCH", "/api/w/statuses/"+id, map[string]any{"icon": ""}, 200)
	if got["icon"] != "" || got["labels"].(map[string]any)["ar"] != "أفكار" {
		t.Fatalf("clearing the icon must keep the labels: %v", got)
	}

	created := owner.must("POST", "/api/w/projects/"+pid+"/statuses", map[string]any{"labels": map[string]string{"ar": "اختبار"}, "icon": "test-tube", "stage": "in_review"}, 201)
	if created["name"] != "اختبار" || created["icon"] != "test-tube" {
		t.Fatalf("created from labels only: %v", created)
	}
}
