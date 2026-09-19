// Package mailer adds a "file" driver to togo-framework/mail and answers "is real email
// configured?" for the settings page.
//
// togo mail ships two drivers: smtp and log. The log driver writes only the recipient and subject
// to the application log, so nothing can be checked. The file driver writes every message as an
// RFC 5322 .eml file under $MAIL_DIR (default $STORAGE_DIR/mail), which a test or a person can
// open. It is the development driver (MAIL_DRIVER=file); neither it nor log delivers anything, and
// the UI says "email is not configured" for both rather than offering switches that do nothing.
package mailer

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"mime"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/togo-framework/mail"
	"github.com/togo-framework/togo"
)

func init() {
	mail.RegisterDriver("file", func(k *togo.Kernel) (mail.Mailer, error) {
		return &fileMailer{dir: Dir()}, nil
	})
}

// Dir is where the file driver writes.
func Dir() string {
	if d := os.Getenv("MAIL_DIR"); d != "" {
		return d
	}
	base := os.Getenv("STORAGE_DIR")
	if base == "" {
		base = "storage"
	}
	return filepath.Join(base, "mail")
}

type fileMailer struct{ dir string }

func (f *fileMailer) Send(_ context.Context, m mail.Message) error {
	if err := os.MkdirAll(f.dir, 0o755); err != nil {
		return err
	}
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	name := fmt.Sprintf("%s-%s.eml", time.Now().UTC().Format("20060102T150405.000"), hex.EncodeToString(b))
	var s strings.Builder
	from := m.From
	if from == "" {
		from = os.Getenv("MAIL_FROM")
	}
	fmt.Fprintf(&s, "From: %s\r\nTo: %s\r\nSubject: %s\r\nDate: %s\r\nMIME-Version: 1.0\r\n",
		from, strings.Join(m.To, ", "), mime.QEncoding.Encode("utf-8", m.Subject), time.Now().UTC().Format(time.RFC1123Z))
	if m.HTML != "" {
		const boundary = "mahaam-file-mailer"
		fmt.Fprintf(&s, "Content-Type: multipart/alternative; boundary=%q\r\n\r\n", boundary)
		fmt.Fprintf(&s, "--%s\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n%s\r\n", boundary, m.Text)
		fmt.Fprintf(&s, "--%s\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n%s\r\n--%s--\r\n", boundary, m.HTML, boundary)
	} else {
		fmt.Fprintf(&s, "Content-Type: text/plain; charset=UTF-8\r\n\r\n%s", m.Text)
	}
	return os.WriteFile(filepath.Join(f.dir, name), []byte(s.String()), 0o644)
}

// Sender is what the domain needs from mail.
type Sender interface {
	Send(ctx context.Context, m mail.Message) error
	Driver() string
}

// FromKernel returns the mail service, or nil when the plugin is not installed.
func FromKernel(k *togo.Kernel) Sender {
	if k == nil {
		return nil
	}
	if s, ok := mail.FromKernel(k); ok {
		return s
	}
	return nil
}

// Delivers reports whether a driver actually delivers mail. log and file do not.
func Delivers(driver string) bool {
	switch driver {
	case "", "log", "file":
		return false
	}
	return true
}
