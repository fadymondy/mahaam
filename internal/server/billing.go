package server

import (
	"context"
	"time"

	"github.com/togo-framework/scheduler"
	"github.com/togo-framework/togo"

	"github.com/fadymondy/mahaam/internal/app"
	"github.com/fadymondy/mahaam/internal/billing/polar"
)

// JobPolarBilling pushes overage usage to Polar and ends canceled subscriptions at period end.
const JobPolarBilling = "mahaam.billing.polar"

// installBilling mounts the PUBLIC Polar webhook (guard allowlist; the signature authenticates it)
// and schedules the billing job every 15 minutes.
func installBilling(k *togo.Kernel, a *app.App) {
	k.Router.Post(polar.WebhookPath, polar.WebhookHandler(a.SysDB, a.Log).ServeHTTP)
	scheduler.Register(JobPolarBilling, func(ctx context.Context) error {
		now := time.Now()
		if n, err := polar.ExpireCanceled(ctx, a.SysDB, now); err != nil {
			return err
		} else if n > 0 {
			a.Log.Info("billing: canceled subscriptions ended, back on free", "workspaces", n)
		}
		c, err := polar.FromEnv()
		if err != nil {
			return nil // not configured: nothing to push
		}
		n, err := polar.PushUsage(ctx, a.SysDB, c, now)
		if n > 0 {
			a.Log.Info("billing: usage pushed to Polar", "events", n)
		}
		return err
	})
	if s, ok := scheduler.FromKernel(k); ok {
		if err := s.Schedule(JobPolarBilling, scheduler.EveryFifteenMin); err != nil {
			a.Log.Error("billing job", "err", err)
		}
	}
}
