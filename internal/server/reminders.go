package server

import (
	"context"
	"time"

	"github.com/togo-framework/scheduler"
	"github.com/togo-framework/togo"

	"github.com/fadymondy/managy/internal/app"
	"github.com/fadymondy/managy/internal/work"
)

// Reminder job names (togo scheduler). They run every five minutes and are idempotent: each
// reminder is sent once per timer / per person per day (notifications.dedupe_key).
const (
	JobLongRunningTimers = "managy.time.long_running"
	JobMissingTime       = "managy.time.missing_day"
)

// installReminders registers and schedules the P2 reminder jobs. The scheduler plugin's provider
// runs inside togo.New(), so its service is on the kernel by the time Boot gets here. With the
// queue plugin installed a due job is dispatched onto the in-process queue, which runs it on its
// own goroutine. Delivery is in-app only (notifications rows + the per-user stream); email waits
// for P5.
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
	s, ok := scheduler.FromKernel(k)
	if !ok {
		a.Log.Warn("scheduler plugin not registered — time reminders are off")
		return
	}
	for _, job := range []string{JobLongRunningTimers, JobMissingTime} {
		if err := s.Schedule(job, scheduler.EveryFiveMinutes); err != nil {
			a.Log.Error("reminders", "job", job, "err", err)
		}
	}
}
