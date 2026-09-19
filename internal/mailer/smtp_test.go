package mailer

import (
	"strings"
	"testing"

	togomail "github.com/togo-framework/mail"
)

func TestBuildMessage(t *testing.T) {
	from := parseFrom("Mahaam <info@3x1.io>", "")
	if from.Address != "info@3x1.io" || from.Name != "Mahaam" {
		t.Fatalf("parseFrom: %+v", from)
	}
	if f := parseFrom("info@3x1.io", "Mahaam"); f.Name != "Mahaam" || f.Address != "info@3x1.io" {
		t.Fatalf("parseFrom fallback name: %+v", f)
	}
	raw := string(buildMessage(from, togomail.Message{To: []string{"a@b.co"}, Subject: "دعوة إلى مهام", Text: "مرحبا", HTML: "<p>مرحبا</p>"}))
	for _, want := range []string{"From: \"Mahaam\" <info@3x1.io>", "Subject: =?utf-8?q?", "Message-ID: <", "Date: ", "Content-Transfer-Encoding: base64", "multipart/alternative"} {
		if !strings.Contains(raw, want) {
			t.Errorf("message lacks %q:\n%s", want, raw)
		}
	}
	if strings.Contains(raw, "دعوة") {
		t.Error("the Arabic subject/body must be encoded, not raw")
	}
}
