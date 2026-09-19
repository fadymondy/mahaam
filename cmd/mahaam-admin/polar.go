package main

import (
	"context"
	"flag"
	"fmt"
	"os"

	"github.com/togo-framework/togo"

	"github.com/fadymondy/mahaam/internal/billing/polar"
	"github.com/fadymondy/mahaam/internal/envfile"
)

// polarSync maps the plans onto Polar products and meters (internal/billing/polar).
//
//	mahaam-admin polar-sync [--dry-run] [--webhook https://console.mahaam.app/api/billing/polar/webhook]
//
// --dry-run reads Polar and prints what would change, calling no write endpoint. --webhook also
// creates the webhook endpoint (once) and prints its secret for POLAR_WEBHOOK_SECRET.
func polarSync(args []string) {
	fs := flag.NewFlagSet("polar-sync", flag.ExitOnError)
	dry := fs.Bool("dry-run", false, "print the plan; call no Polar write endpoint")
	hook := fs.String("webhook", "", "also create the webhook endpoint at this URL")
	_ = fs.Parse(args)

	envfile.Load(".env")
	k := togo.New()
	defer k.Close()
	ctx := context.Background()
	db, err := k.SQL(ctx)
	if err != nil {
		fmt.Fprintln(os.Stderr, "database unavailable:", err)
		os.Exit(1)
	}
	c, err := polar.FromEnv()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	rep, err := polar.Sync(ctx, db, c, *dry)
	if err != nil {
		fmt.Fprintln(os.Stderr, "polar sync failed:", err)
		os.Exit(1)
	}
	mode := "applied"
	if *dry {
		mode = "dry run — nothing changed"
	}
	fmt.Printf("Polar sync (%s):\n", mode)
	for _, a := range rep.Actions {
		fmt.Println("  -", a)
	}
	if *hook != "" {
		if *dry {
			fmt.Println("  - would ensure the webhook endpoint", *hook)
			return
		}
		created, secret, err := polar.EnsureWebhook(ctx, c, *hook)
		if err != nil {
			fmt.Fprintln(os.Stderr, "webhook:", err)
			os.Exit(1)
		}
		if !created {
			fmt.Println("  - webhook endpoint already exists:", *hook)
			return
		}
		fmt.Printf("  - created webhook endpoint %s\n\nPut this in POLAR_WEBHOOK_SECRET (shown once):\n\n  %s\n\n", *hook, secret)
	}
}
