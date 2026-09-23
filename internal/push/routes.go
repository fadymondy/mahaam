package push

import (
	"context"
	"errors"
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

type deviceOut struct {
	Body struct {
		NativeEnabled bool `json:"native_enabled" doc:"FCM is configured on this server"`
	}
}

// RegisterDevices mounts the native half under /api/me/devices (MH-352).
func RegisterDevices(api huma.API, s *Service) {
	huma.Register(api, huma.Operation{OperationID: "me-device-register", Method: http.MethodPost, Path: "/api/me/devices",
		Summary: "Register this phone for push notifications", Tags: []string{"Push"},
		Description: "Call on every app start and whenever FCM hands the app a new token (pass the old one as previous_token). " +
			"Registering a token another account had moves it to you. Works whether or not the server has FCM configured; " +
			"native_enabled says whether anything will actually be sent."},
		func(ctx context.Context, in *struct{ Body Device }) (*deviceOut, error) {
			id, err := who(ctx)
			if err != nil {
				return nil, err
			}
			if s.DB == nil {
				return nil, huma.Error503ServiceUnavailable("push is unavailable")
			}
			if err := s.SaveDevice(ctx, id, in.Body); err != nil {
				s.Log.Error("push: save device", "err", err)
				return nil, huma.Error500InternalServerError("could not register the device")
			}
			out := &deviceOut{}
			out.Body.NativeEnabled = NativeEnabled()
			return out, nil
		})

	huma.Register(api, huma.Operation{OperationID: "me-device-remove", Method: http.MethodDelete, Path: "/api/me/devices/{token}",
		DefaultStatus: http.StatusNoContent, Summary: "Stop push notifications on this phone", Tags: []string{"Push"}},
		func(ctx context.Context, in *struct {
			Token string `path:"token" maxLength:"4096"`
		}) (*struct{}, error) {
			id, err := who(ctx)
			if err != nil {
				return nil, err
			}
			if s.DB != nil {
				if err := s.RemoveDevice(ctx, id, in.Token); err != nil {
					return nil, huma.Error500InternalServerError("could not remove the device")
				}
			}
			return nil, nil
		})
}

// RegisterLiveActivity mounts /api/me/devices/{token}/live-activity (MH-355).
func RegisterLiveActivity(api huma.API, s *Service) {
	huma.Register(api, huma.Operation{OperationID: "me-device-live-activity", Method: http.MethodPost,
		Path: "/api/me/devices/{token}/live-activity", DefaultStatus: http.StatusNoContent, Tags: []string{"Push"},
		Summary: "Register a Live Activity token for this phone",
		Description: "activity_token: the token of the activity the app is showing now (send it whenever iOS hands out a new one). " +
			"push_to_start_token: the app's push-to-start token (iOS 17.2+), so a timer started elsewhere can start the activity. Either or both."},
		func(ctx context.Context, in *struct {
			Token string `path:"token" maxLength:"4096"`
			Body  struct {
				Kind             string `json:"kind" enum:"timer"`
				ActivityToken    string `json:"activity_token,omitempty" maxLength:"4096"`
				PushToStartToken string `json:"push_to_start_token,omitempty" maxLength:"4096"`
			}
		}) (*struct{}, error) {
			id, err := who(ctx)
			if err != nil {
				return nil, err
			}
			if in.Body.ActivityToken == "" && in.Body.PushToStartToken == "" {
				return nil, huma.Error422UnprocessableEntity("send activity_token, push_to_start_token, or both")
			}
			for typ, tok := range map[string]string{"update": in.Body.ActivityToken, "start": in.Body.PushToStartToken} {
				if tok == "" {
					continue
				}
				if err := s.SaveLiveActivityToken(ctx, id, in.Token, in.Body.Kind, typ, tok); err != nil {
					if errors.Is(err, errNoDevice) {
						return nil, huma.Error404NotFound("register the device first (POST /api/me/devices)")
					}
					return nil, huma.Error500InternalServerError("could not save the token")
				}
			}
			return nil, nil
		})

	huma.Register(api, huma.Operation{OperationID: "me-device-live-activity-end", Method: http.MethodDelete,
		Path: "/api/me/devices/{token}/live-activity", DefaultStatus: http.StatusNoContent, Tags: []string{"Push"},
		Summary: "The activity ended on the phone: forget its token"},
		func(ctx context.Context, in *struct {
			Token string `path:"token" maxLength:"4096"`
		}) (*struct{}, error) {
			id, err := who(ctx)
			if err != nil {
				return nil, err
			}
			if err := s.ForgetLiveActivity(ctx, id, in.Token, "timer"); err != nil {
				return nil, huma.Error500InternalServerError("could not forget the token")
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
