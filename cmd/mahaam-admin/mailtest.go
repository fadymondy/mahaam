package main

import (
	"context"
	"fmt"
	"os"
	"time"

	togomail "github.com/togo-framework/mail"
	"github.com/togo-framework/togo"

	"github.com/fadymondy/mahaam/internal/envfile"
	_ "github.com/fadymondy/mahaam/internal/mailer" // the smtp/file drivers
)

// mailTest sends one message through the configured MAIL_DRIVER:
//
//	mahaam-admin mail-test <to>
func mailTest(args []string) {
	if len(args) < 1 {
		usage()
	}
	envfile.Load(".env")
	k := togo.New()
	defer k.Close()
	m, ok := togomail.FromKernel(k)
	if !ok {
		fail("the mail plugin is not installed")
	}
	fmt.Printf("driver: %s\n", m.Driver())
	err := m.Send(context.Background(), togomail.Message{
		To:      []string{args[0]},
		Subject: "Mahaam mail test — اختبار البريد من مهام",
		Text:    "This is a test message from Mahaam (" + time.Now().Format(time.RFC1123) + ").\n\nهذه رسالة اختبار من مهام.",
		HTML:    "<p>This is a test message from <b>Mahaam</b>.</p><p dir=\"rtl\">هذه رسالة اختبار من <b>مهام</b>.</p>",
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, "send failed:", err)
		os.Exit(1)
	}
	fmt.Println("sent to", args[0])
}
