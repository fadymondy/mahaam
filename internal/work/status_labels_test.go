package work

import (
	"strings"
	"testing"
)

func TestStatusLabels(t *testing.T) {
	b, m, err := statusLabels(map[string]string{" EN ": " To do ", "ar": "للتنفيذ", "en_blank": ""})
	if err == nil {
		t.Fatalf("unknown locale accepted: %s", b)
	}
	b, m, err = statusLabels(map[string]string{" EN ": " To do ", "ar": " "})
	if err != nil {
		t.Fatal(err)
	}
	if m["en"] != "To do" || len(m) != 1 || string(b) != `{"en":"To do"}` {
		t.Fatalf("got %v / %s", m, b)
	}
	if _, _, err := statusLabels(map[string]string{"ar": strings.Repeat("ب", 61)}); err == nil {
		t.Fatal("61-character label accepted")
	}
	if _, _, err := statusLabels(map[string]string{"ar": strings.Repeat("ب", 60)}); err != nil {
		t.Fatalf("60 Arabic characters rejected: %v", err)
	}
}

func TestStatusIcon(t *testing.T) {
	if v, err := statusIcon(" Rocket "); err != nil || v != "rocket" {
		t.Fatalf("rocket: %v %v", v, err)
	}
	if v, err := statusIcon(""); err != nil || v != nil {
		t.Fatalf("empty should clear: %v %v", v, err)
	}
	if _, err := statusIcon("skull"); err == nil {
		t.Fatal("icon outside the allow-list accepted")
	}
}
