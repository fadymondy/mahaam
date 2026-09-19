package server

import (
	"context"

	"github.com/togo-framework/scheduler"
	"github.com/togo-framework/togo"

	"github.com/fadymondy/mahaam/internal/app"
	"github.com/fadymondy/mahaam/internal/integrations"
)

// Integration jobs (togo scheduler): Jira/Linear re-import every 30 minutes, and the GitHub
// mirror (Mahaam close/reopen pushed to linked GitHub issues) every five. Both are idempotent.
const (
	JobIntegrationsSync = "managy.integrations.sync"
	JobGitHubMirror     = "managy.integrations.github_mirror"
)

func installIntegrations(k *togo.Kernel, a *app.App) {
	integrations.Mount(k, a) // PUBLIC: /api/integrations/github/{webhook,callback} (guard allowlist)
	sv := integrations.New(a)
	scheduler.Register(JobIntegrationsSync, func(ctx context.Context) error {
		n, err := sv.SyncAllImports(ctx)
		if n > 0 {
			a.Log.Info("integrations: imports synced", "integrations", n)
		}
		return err
	})
	scheduler.Register(JobGitHubMirror, func(ctx context.Context) error {
		n, err := sv.MirrorAllGitHub(ctx)
		if n > 0 {
			a.Log.Info("integrations: github state mirrored", "issues", n)
		}
		return err
	})
	s, ok := scheduler.FromKernel(k)
	if !ok {
		a.Log.Warn("scheduler plugin not registered — integration re-sync is off")
		return
	}
	for job, spec := range map[string]string{JobIntegrationsSync: scheduler.EveryThirtyMin, JobGitHubMirror: scheduler.EveryFiveMinutes} {
		if err := s.Schedule(job, spec); err != nil {
			a.Log.Error("integrations", "job", job, "err", err)
		}
	}
}
