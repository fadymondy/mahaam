package mailer

import (
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"mime"
	"net"
	"net/mail"
	"net/smtp"
	"os"
	"strings"
	"time"

	togomail "github.com/togo-framework/mail"
	"github.com/togo-framework/togo"
)

/*
The smtp driver, replacing togo mail's (registered after it, so this one wins). The plugin's
driver breaks with a real provider:

  - it passes MAIL_FROM verbatim as the SMTP envelope sender, so "Mahaam <info@3x1.io>" is
    refused — the envelope must be the bare address;
  - it writes the Subject raw, so an Arabic subject arrives as mojibake (needs RFC 2047);
  - it sends no Date or Message-ID, which spam filters penalise.

MAIL_HOST, MAIL_PORT (587), MAIL_USERNAME, MAIL_PASSWORD, MAIL_ENCRYPTION (starttls | tls | ssl |
none), MAIL_FROM ("Name <address>" or an address) and MAIL_FROM_NAME (used when MAIL_FROM has no
name). Bodies are base64 so UTF-8 text survives any relay.
*/

func init() {
	togomail.RegisterDriver("smtp", func(k *togo.Kernel) (togomail.Mailer, error) { return newSMTP(), nil })
}

type smtpMailer struct {
	host, port, user, pass, encryption string
	from                               mail.Address
}

func newSMTP() *smtpMailer {
	s := &smtpMailer{
		host:       os.Getenv("MAIL_HOST"),
		port:       envOr("MAIL_PORT", "587"),
		user:       os.Getenv("MAIL_USERNAME"),
		pass:       os.Getenv("MAIL_PASSWORD"),
		encryption: strings.ToLower(envOr("MAIL_ENCRYPTION", "starttls")),
	}
	s.from = parseFrom(os.Getenv("MAIL_FROM"), os.Getenv("MAIL_FROM_NAME"))
	return s
}

func envOr(k, def string) string {
	if v := strings.TrimSpace(os.Getenv(k)); v != "" {
		return v
	}
	return def
}

// parseFrom reads "Name <addr>" or a bare address; name falls back to fallbackName.
func parseFrom(raw, fallbackName string) mail.Address {
	raw = strings.TrimSpace(raw)
	if a, err := mail.ParseAddress(raw); err == nil {
		if a.Name == "" {
			a.Name = fallbackName
		}
		return *a
	}
	return mail.Address{Name: fallbackName, Address: raw}
}

func (s *smtpMailer) Send(_ context.Context, m togomail.Message) error {
	if s.host == "" {
		return fmt.Errorf("mail: MAIL_HOST is not set")
	}
	from := s.from
	if strings.TrimSpace(m.From) != "" {
		from = parseFrom(m.From, s.from.Name)
	}
	if from.Address == "" {
		return fmt.Errorf("mail: MAIL_FROM is not set")
	}
	rcpts := append(append(append([]string{}, m.To...), m.Cc...), m.Bcc...)
	raw := buildMessage(from, m)
	addr := net.JoinHostPort(s.host, s.port)
	var auth smtp.Auth
	if s.user != "" {
		auth = smtp.PlainAuth("", s.user, s.pass, s.host)
	}
	switch s.encryption {
	case "tls", "ssl": // implicit TLS, e.g. port 465
		conn, err := tls.Dial("tcp", addr, &tls.Config{ServerName: s.host, MinVersion: tls.VersionTLS12})
		if err != nil {
			return err
		}
		return deliver(conn, s.host, auth, from.Address, rcpts, raw, false)
	default: // STARTTLS (required unless MAIL_ENCRYPTION=none)
		conn, err := net.DialTimeout("tcp", addr, 20*time.Second)
		if err != nil {
			return err
		}
		return deliver(conn, s.host, auth, from.Address, rcpts, raw, s.encryption != "none")
	}
}

func deliver(conn net.Conn, host string, auth smtp.Auth, from string, to []string, msg []byte, starttls bool) error {
	_ = conn.SetDeadline(time.Now().Add(60 * time.Second))
	c, err := smtp.NewClient(conn, host)
	if err != nil {
		conn.Close()
		return err
	}
	defer c.Close()
	if starttls {
		if ok, _ := c.Extension("STARTTLS"); !ok {
			return fmt.Errorf("mail: %s does not offer STARTTLS (set MAIL_ENCRYPTION=tls or none)", host)
		}
		if err := c.StartTLS(&tls.Config{ServerName: host, MinVersion: tls.VersionTLS12}); err != nil {
			return err
		}
	}
	if auth != nil {
		if err := c.Auth(auth); err != nil {
			return err
		}
	}
	if err := c.Mail(from); err != nil {
		return err
	}
	for _, r := range to {
		if err := c.Rcpt(r); err != nil {
			return err
		}
	}
	w, err := c.Data()
	if err != nil {
		return err
	}
	if _, err := w.Write(msg); err != nil {
		return err
	}
	if err := w.Close(); err != nil {
		return err
	}
	return c.Quit()
}

// buildMessage assembles an RFC 5322 message: encoded headers, Date, Message-ID, base64 parts.
func buildMessage(from mail.Address, m togomail.Message) []byte {
	var b strings.Builder
	h := func(k, v string) { fmt.Fprintf(&b, "%s: %s\r\n", k, v) }
	h("From", from.String())
	h("To", strings.Join(m.To, ", "))
	if len(m.Cc) > 0 {
		h("Cc", strings.Join(m.Cc, ", "))
	}
	h("Subject", mime.QEncoding.Encode("utf-8", m.Subject))
	h("Date", time.Now().Format(time.RFC1123Z))
	h("Message-ID", messageID(from.Address))
	h("MIME-Version", "1.0")
	part := func(ctype, body string) {
		fmt.Fprintf(&b, "Content-Type: %s; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n", ctype)
		enc := base64.StdEncoding.EncodeToString([]byte(body))
		for len(enc) > 76 {
			b.WriteString(enc[:76] + "\r\n")
			enc = enc[76:]
		}
		b.WriteString(enc + "\r\n")
	}
	if m.HTML != "" {
		boundary := "mahaam-" + randHex(8)
		fmt.Fprintf(&b, "Content-Type: multipart/alternative; boundary=%q\r\n\r\n", boundary)
		fmt.Fprintf(&b, "--%s\r\n", boundary)
		part("text/plain", m.Text)
		fmt.Fprintf(&b, "--%s\r\n", boundary)
		part("text/html", m.HTML)
		fmt.Fprintf(&b, "--%s--\r\n", boundary)
	} else {
		part("text/plain", m.Text)
	}
	return []byte(b.String())
}

func messageID(from string) string {
	domain := "mahaam.app"
	if i := strings.LastIndex(from, "@"); i >= 0 && i < len(from)-1 {
		domain = from[i+1:]
	}
	return fmt.Sprintf("<%d.%s@%s>", time.Now().UnixNano(), randHex(6), domain)
}

func randHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
