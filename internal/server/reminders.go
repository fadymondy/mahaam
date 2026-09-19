package server

import (
	"context"
	"time"

	"github.com/togo-framework/scheduler"
	"github.com/togo-framework/togo"

	"github.com/fadymondy/mahaam/internal/app"
	"github.com/fadymondy/mahaam/internal/work"
)

// Reminder job names (togo scheduler). They run every five minutes and are idempotent: each
// reminder is sent once per timer / per person per day (notifications.dedupe_key).
const (
	JobLongRunningTimers = "managy.time.long_running"
	JobMissingTime       = "managy.time.missing_day"
	// P5
	JobBudgetAlerts = "managy.budget.alerts"
	JobEmail        = "managy.notifications.email"
	JobDigest       = "managy.notifications.digest"
)

// installReminders registers and schedules the P2 reminder jobs. The scheduler plugin's provider
// runs inside togo.New(), so its service is on the kernel by the time Boot gets here. With the
// queue plugin installed a due job is dispatched onto the in-process queue, which runs it on its
// own goroutine. P5 adds budget alerts, notification email (every minute) and the daily digest
// (internal/work/alerts.go, email.go).
func installReminders(k *togo.Kernel, a *app.App) {
	sv := work.New(a)
	scheduler.Register(JobLongRunningTimers, func(ctx context.Context) error {
		n, err := sv.RemindLongRunning(ctx, time.Now())
		if n > 0 {
			a.Log.Info("reminders: long-running timers", "sent", n)
		}
		return err
	})
	scheduler.Register(JobMissingTime, func(ctx context.Context) error {
		n, err := sv.RemindMissingTime(ctx, time.Now())
		if n > 0 {
			a.Log.Info("reminders: no time today", "sent", n)
		}
		return err
	})
	scheduler.Register(JobBudgetAlerts, func(ctx context.Context) error {
		n, err := sv.CheckBudgets(ctx, time.Now().UTC())
		if n > 0 {
			a.Log.Info("budget alerts", "sent", n)
		}
		return err
	})
	scheduler.Register(JobEmail, func(ctx context.Context) error {
		n, err := sv.DeliverEmails(ctx)
		if n > 0 {
			a.Log.Info("notification email", "sent", n)
		}
		return err
	})
	scheduler.Register(JobDigest, func(ctx context.Context) error {
		n, err := sv.SendDigests(ctx, time.Now().UTC())
		if n > 0 {
			a.Log.Info("daily digest", "sent", n)
		}
		return err
	})
	s, ok := scheduler.FromKernel(k)
	if !ok {
		a.Log.Warn("scheduler plugin not registered — time reminders are off")
		return
	}
	schedule := map[string]string{JobLongRunningTimers: scheduler.EveryFiveMinutes, JobMissingTime: scheduler.EveryFiveMinutes,
		JobBudgetAlerts: scheduler.EveryFiveMinutes, JobEmail: scheduler.EveryMinute, JobDigest: scheduler.EveryFiveMinutes}
	for job, spec := range schedule {
		if err := s.Schedule(job, spec); err != nil {
			a.Log.Error("reminders", "job", job, "err", err)
		}
	}
}
