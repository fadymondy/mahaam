package push

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"
	"github.com/togo-framework/auth"
)

type stateOut struct {
	Body struct {
		Enabled   bool   `json:"enabled" doc:"Push is configured on this server"`
		PublicKey string `json:"public_key" doc:"VAPID application server key (base64url)"`
		Devices   int    `json:"devices" doc:"Devices you subscribed"`
	}
}

// Register mounts the account-level (signed in, no workspace) endpoints under /api/me/push.
func Register(api huma.API, s *Service) {
	huma.Register(api, huma.Operation{OperationID: "me-push", Method: http.MethodGet, Path: "/api/me/push",
		Summary: "Push notification settings for the installed app", Tags: []string{"Push"}},
		func(ctx context.Context, _ *struct{}) (*stateOut, error) {
			id, err := who(ctx)
			if err != nil {
				return nil, err
			}
			out := &stateOut{}
			out.Body.Enabled = s.Enabled()
			if out.Body.Enabled {
				out.Body.PublicKey = s.public
				out.Body.Devices = s.Count(ctx, id)
			}
			return out, nil
		})

	huma.Register(api, huma.Operation{OperationID: "me-push-subscribe", Method: http.MethodPost, Path: "/api/me/push",
		DefaultStatus: http.StatusNoContent, Summary: "Subscribe this device to push notifications", Tags: []string{"Push"}},
		func(ctx context.Context, in *struct {
			UserAgent string `header:"User-Agent"`
			Body      struct {
				PushSubscription PushSubscription `json:"subscription"`
				Locale           string           `json:"locale,omitempty" enum:"en,ar,"`
			}
		}) (*struct{}, error) {
			id, err := who(ctx)
			if err != nil {
				return nil, err
			}
			if !s.Enabled() {
				return nil, huma.Error409Conflict("push notifications are not configured on this server")
			}
			if err := s.Save(ctx, id, in.Body.PushSubscription, in.UserAgent, in.Body.Locale); err != nil {
				return nil, huma.Error500InternalServerError("could not save the subscription")
			}
			return nil, nil
		})

	huma.Register(api, huma.Operation{OperationID: "me-push-unsubscribe", Method: http.MethodDelete, Path: "/api/me/push",
		DefaultStatus: http.StatusNoContent, Summary: "Stop push notifications on this device", Tags: []string{"Push"}},
		func(ctx context.Context, in *struct {
			Body struct {
				Endpoint string `json:"endpoint" minLength:"10" maxLength:"2000"`
			}
		}) (*struct{}, error) {
			id, err := who(ctx)
			if err != nil {
				return nil, err
			}
			if s.DB != nil {
				if err := s.Remove(ctx, id, in.Body.Endpoint); err != nil {
					return nil, huma.Error500InternalServerError("could not remove the subscription")
				}
			}
			return nil, nil
		})
}

func who(ctx context.Context) (string, error) {
	id, ok := auth.IdentityFrom(ctx)
	if !ok || id == nil {
		return "", huma.Error401Unauthorized("unauthorized")
	}
	return id.ID, nil
}
