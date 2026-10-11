package mcp

import (
	"slices"
	"testing"

	"github.com/fadymondy/mahaam/internal/work"
)

func TestStatusRefs(t *testing.T) {
	d := &work.ProjectDetail{Statuses: []work.Status{{ID: "a", Name: "To do"}, {ID: "b", Name: "Doing"}, {ID: "c", Name: "Done"}}}
	d.Name = "P"
	if st, err := findStatus(d, "to DO"); err != nil || st.ID != "a" {
		t.Errorf("by name: %v %v", st, err)
	}
	if st, err := findStatus(d, "c"); err != nil || st.ID != "c" {
		t.Errorf("by id: %v %v", st, err)
	}
	if _, err := findStatus(d, "nope"); err == nil {
		t.Error("unknown column resolved")
	}
	got, err := statusOrder(d, []string{"Done", "a"})
	if err != nil || !slices.Equal(got, []string{"c", "a", "b"}) {
		t.Errorf("order = %v %v", got, err)
	}
	if _, err := statusOrder(d, []string{"Done", "c"}); err == nil {
		t.Error("duplicate accepted")
	}
	dup := &work.ProjectDetail{Statuses: []work.Status{{ID: "x", Name: "Same"}, {ID: "y", Name: "same"}}}
	if _, err := findStatus(dup, "same"); err == nil {
		t.Error("ambiguous name resolved")
	}
}
